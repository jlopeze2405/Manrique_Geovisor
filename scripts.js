(function () {
  'use strict';

  var initialCenter = [6.28, -75.59];
  var initialZoom = 12;
  function webMercatorToLatLng(x, y) {
    var lng = (x / 20037508.34) * 180;
    var lat = (y / 20037508.34) * 180;
    lat = (180 / Math.PI) * (2 * Math.atan(Math.exp(lat * Math.PI / 180)) - Math.PI / 2);
    return [lat, lng];
  }
  var manriqueSouthWest = webMercatorToLatLng(-8410971.368524, 698894.894891);
  var manriqueNorthEast = webMercatorToLatLng(-8407927.578103, 700845.937304);
  var manriqueImageBounds = L.latLngBounds(manriqueSouthWest, manriqueNorthEast);
  var map = L.map('map', { zoomControl: false, rotate: true, bearing: 0, rotateControl: false, dragRotate: true, shiftKeyRotate: true, touchRotate: true, doubleClickZoom: true }).setView(initialCenter, initialZoom);
  map.createPane('riskPane');
  map.getPane('riskPane').style.zIndex = 350;
  map.createPane('parcelPane');
  map.getPane('parcelPane').style.zIndex = 450;
  map.createPane('constructionPane');
  map.getPane('constructionPane').style.zIndex = 460;
  map.createPane('landmarkPane');
  map.getPane('landmarkPane').style.zIndex = 640;
  var userChangedView = false;
  map.on('dragstart zoomstart', function () { userChangedView = true; });
  var imagery = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
    maxZoom: 19,
    attribution: 'Tiles &copy; Esri, Sources: Esri, i-cubed, USDA, USGS, AEX, GeoEye, Getmapping, Aerogrid, IGN, IGP, UPR-EGP, and the GIS User Community'
  });
  var streets = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}', {
    maxZoom: 19,
    attribution: 'Tiles &copy; Esri, DeLorme, NAVTEQ, USGS, Intermap, NRCAN, Esri Japan, METI, Esri China (Hong Kong), TomTom'
  });
  imagery.addTo(map);
  L.control.scale({ imperial: false, metric: true, maxWidth: 130, position: 'bottomright' }).addTo(map);

  var overlays = {};
  var scaleLimitedLayers = [];
  var parcelFilterFeatures = [];
  var constructionFilterFeatures = [];
  var neighborhoodFeatures = [];
  var riskZoneFeatures = [];
  var riskZonesReady = false;
  var riskZoneVersion = 0;
  var riskFilter = document.getElementById('risk-filter');
  var neighborhoodFilter = document.getElementById('neighborhood-filter');
  var baseLayers = [imagery, streets];
  var drawings = L.featureGroup().addTo(map);
  var measurementLayer = L.layerGroup().addTo(map);
  var activeAction = null;
  var vertices = [];
  var previewLine = null;
  var previewShape = null;
  var vertexMarkers = [];
  var bearing = 0;
  var layerList = document.getElementById('layer-list');
  var finishButton = document.getElementById('finish-draw');
  var cancelButton = document.getElementById('cancel-draw');
  var undoButton = document.getElementById('undo-draw');
  var hint = document.getElementById('draw-hint');
  var layerControlIndex = 0;
  var layerGroups = {};
  var layerGroupTabs = {};
  var layerGroupTabList = null;
  var layerGroupPanelList = null;
  var landuseFilter = document.getElementById('landuse-filter');
  var entityFilter = document.getElementById('entity-filter');
  var spatialSelection = [];
  var spatialQueryActive = false;
  var selectedInspectorLayer = null;
  var metadataDialog = null;

  function showLayerMetadata(name, path, group) {
    if (!metadataDialog) {
      metadataDialog = document.createElement('dialog'); metadataDialog.className = 'metadata-dialog';
      metadataDialog.innerHTML = '<form method="dialog"><button class="dialog-close" aria-label="Cerrar">×</button></form><h2></h2><div class="metadata-content"></div>';
      document.body.appendChild(metadataDialog);
    }
    metadataDialog.querySelector('h2').textContent = name;
    var content = metadataDialog.querySelector('.metadata-content'); content.textContent = '';
    var records = [
      [/Amenaza por movimiento/i, '2026-11-01', 'EPSG:9377'], [/Barrios de Manrique/i, '2026-10-07', 'EPSG:9377'],
      [/Buffer/i, '2026-09-30', 'EPSG:4326'], [/Comunas/i, '2026-09-18', 'EPSG:9377'],
      [/Construcciones/i, '2026-10-21', 'EPSG:9377'], [/Predios/i, '2026-11-01', 'EPSG:9377'], [/Riesgo/i, '2026-11-01', 'EPSG:9377']
    ];
    var record = records.find(function (item) { return item[0].test(name); });
    var attrs = [['Descripción', 'No declarada en el metadato disponible'], ['Fuente disponible', 'Archivo shapefile local: ' + path], ['Última modificación del metadato', record ? record[1] : 'No declarada'], ['Sistema de referencia', record ? record[2] : 'Consultar archivo .prj'], ['Escala de captura', 'No declarada en el metadato disponible'], ['Metodología', 'El metadato no declara una metodología completa']];
    attrs.forEach(function (pair) { var row = document.createElement('p'); var b = document.createElement('strong'); b.textContent = pair[0] + ': '; row.append(b, document.createTextNode(pair[1])); content.appendChild(row); });
    var count = group.featureData ? group.featureData.length.toLocaleString('es') : 'Cargando';
    var featureCount = document.createElement('p'); var label = document.createElement('strong'); label.textContent = 'Entidades: '; featureCount.append(label, document.createTextNode(count)); content.appendChild(featureCount);
    if (typeof metadataDialog.showModal === 'function') metadataDialog.showModal(); else metadataDialog.setAttribute('open', 'open');
  }

  function layerGroupName(name, base) {
    if (base) return 'Cartografía base';
    if (/Amenaza|Riesgo|Buffer/i.test(name)) return 'Amenaza y riesgo';
    return 'Catastro y territorio';
  }

  function activateLayerGroup(key) {
    Object.keys(layerGroups).forEach(function (groupKey) {
      var active = groupKey === key;
      layerGroups[groupKey].hidden = !active;
      layerGroupTabs[groupKey].setAttribute('aria-selected', active ? 'true' : 'false');
      layerGroupTabs[groupKey].tabIndex = active ? 0 : -1;
      layerGroupTabs[groupKey].classList.toggle('active', active);
    });
  }

  function layerGroupContainer(name, base) {
    var key = layerGroupName(name, base);
    if (layerGroups[key]) return layerGroups[key];
    if (!layerGroupTabList) {
      layerGroupTabList = document.createElement('div');
      layerGroupTabList.className = 'layer-tabs';
      layerGroupTabList.setAttribute('role', 'tablist');
      layerGroupTabList.setAttribute('aria-label', 'Grupos de capas');
      layerGroupPanelList = document.createElement('div');
      layerGroupPanelList.className = 'layer-tab-panels';
      layerList.append(layerGroupTabList, layerGroupPanelList);
    }
    var isFirstGroup = Object.keys(layerGroups).length === 0;
    var tab = document.createElement('button');
    tab.type = 'button'; tab.className = 'layer-tab'; tab.id = 'layer-tab-' + layerControlIndex;
    tab.setAttribute('role', 'tab'); tab.setAttribute('aria-controls', 'layer-panel-' + layerControlIndex);
    tab.setAttribute('aria-selected', isFirstGroup ? 'true' : 'false'); tab.tabIndex = isFirstGroup ? 0 : -1; tab.textContent = key;
    tab.addEventListener('click', function () { activateLayerGroup(key); });
    tab.addEventListener('keydown', function (event) {
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight' && event.key !== 'Home' && event.key !== 'End') return;
      event.preventDefault();
      var keys = Object.keys(layerGroups); var current = keys.indexOf(key);
      var nextIndex = event.key === 'Home' ? 0 : (event.key === 'End' ? keys.length - 1 : (current + (event.key === 'ArrowRight' ? 1 : keys.length - 1)) % keys.length);
      var nextKey = keys[nextIndex]; activateLayerGroup(nextKey); layerGroupTabs[nextKey].focus();
    });
    layerGroupTabList.appendChild(tab);
    var section = document.createElement('section');
    section.className = 'layer-group';
    section.id = 'layer-panel-' + layerControlIndex;
    section.setAttribute('role', 'tabpanel'); section.setAttribute('aria-labelledby', tab.id); section.hidden = !isFirstGroup;
    var heading = document.createElement('div');
    heading.className = 'layer-group-heading';
    var title = document.createElement('strong'); title.textContent = key;
    var toggle = document.createElement('button'); toggle.type = 'button'; toggle.textContent = 'Activar grupo';
    toggle.addEventListener('click', function () {
      var inputs = Array.from(section.querySelectorAll('.layer-item input[type="checkbox"]'));
      if (key === 'Cartografía base') {
        var radios = Array.from(section.querySelectorAll('input[name="base-layer"]'));
        var currentIndex = radios.findIndex(function (radio) { return radio.checked; });
        var next = radios[(currentIndex + 1) % radios.length];
        if (next) { next.checked = true; next.dispatchEvent(new Event('change')); }
        return;
      }
      var enable = inputs.some(function (input) { return !input.checked; });
      inputs.forEach(function (input) { if (input.checked !== enable) { input.checked = enable; input.dispatchEvent(new Event('change')); } });
      toggle.textContent = enable ? 'Apagar grupo' : 'Activar grupo';
    });
    if (key === 'Cartografía base') toggle.textContent = 'Cambiar base';
    heading.append(title, toggle); section.appendChild(heading); layerGroupPanelList.appendChild(section);
    layerGroups[key] = section;
    layerGroupTabs[key] = tab;
    layerControlIndex++;
    return section;
  }

  function getLayerBounds(layer) {
    if (layer && typeof layer.getBounds === 'function') {
      var ownBounds = layer.getBounds();
      if (ownBounds && ownBounds.isValid()) return ownBounds;
    }
    var bounds = L.latLngBounds();
    if (layer && typeof layer.getLatLng === 'function') bounds.extend(layer.getLatLng());
    if (layer && typeof layer.eachLayer === 'function') {
      layer.eachLayer(function (child) {
        var childBounds = getLayerBounds(child);
        if (childBounds) bounds.extend(childBounds);
      });
    }
    return bounds.isValid() ? bounds : null;
  }

  function applyOpacityToLayerTree(layer, value) {
    if (!layer) return;
    if (typeof layer.setOpacity === 'function') layer.setOpacity(value);
    if (layer._path) layer._path.style.filter = 'opacity(' + value + ')';
    if (typeof layer.eachLayer === 'function') layer.eachLayer(function (child) { applyOpacityToLayerTree(child, value); });
  }

  function updateScaleLimitedLayers() {
    var zoom = map.getZoom();
    scaleLimitedLayers.forEach(function (entry) {
      var active = map.hasLayer(entry.group);
      var inRange = zoom >= entry.minZoom && zoom <= entry.maxZoom;
      var shouldRender = active && inRange;
      var hasGeometry = entry.group.hasLayer(entry.layer);
      if (shouldRender && !hasGeometry) entry.group.addLayer(entry.layer);
      else if (!shouldRender && hasGeometry) entry.group.removeLayer(entry.layer);
      if (shouldRender && entry.group._uiOpacity != null) applyOpacityToLayerTree(entry.layer, entry.group._uiOpacity);
      if (entry.state) entry.state.textContent = !active ? 'OFF' : (inRange ? 'ON' : 'ZOOM ' + entry.minZoom + '–' + entry.maxZoom);
    });
    updateRiskLegendPanel();
  }
  map.on('zoomend', updateScaleLimitedLayers);

  var featureLabels = [];
  function updateFeatureLabels() {
    var zoom = map.getZoom();
    var bounds = map.getBounds();
    featureLabels.forEach(function (item) {
      var featureBounds = item.bounds;
      var visible = map.hasLayer(item.group) && zoom >= item.minZoom && featureBounds && bounds.intersects(featureBounds);
      if (visible) item.layer.openTooltip();
      else item.layer.closeTooltip();
    });
  }
  map.on('moveend zoomend', updateFeatureLabels);
  function addLayerControl(name, layer, color, checked, base) {
    var row = document.createElement('div');
    row.className = 'layer-item';
    var input = document.createElement('input');
    input.type = base ? 'radio' : 'checkbox';
    input.name = base ? 'base-layer' : 'overlay-' + name;
    input.checked = checked;
    input.id = 'layer-control-' + layerControlIndex++;
    var label = document.createElement('label');
    label.htmlFor = input.id;
    label.textContent = name;
    var swatch = document.createElement('span');
    swatch.className = 'layer-swatch';
    swatch.style.setProperty('--swatch', color);
    var state = document.createElement('span');
    state.className = 'layer-state';
    state.textContent = base ? 'BASE' : 'ON';
    var extentButton = null;
    if (!base) {
      extentButton = document.createElement('button');
      extentButton.type = 'button';
      extentButton.className = 'layer-extent-button';
      extentButton.title = 'Acercar a esta capa';
      extentButton.setAttribute('aria-label', 'Acercar a ' + name);
      extentButton.textContent = '⌖';
      extentButton.addEventListener('click', function (event) {
        event.preventDefault();
        event.stopPropagation();
        var extent = getLayerBounds(layer._scaleLimitedChild || layer);
        if (extent) map.fitBounds(extent, { padding: [36, 36], maxZoom: 17 });
        else state.textContent = 'CARGANDO';
      });
      var infoButton = document.createElement('button'); infoButton.type = 'button'; infoButton.className = 'layer-info-button'; infoButton.textContent = 'i'; infoButton.title = 'Ver metadatos disponibles';
      infoButton.addEventListener('click', function (event) { event.preventDefault(); event.stopPropagation(); showLayerMetadata(name, layer._sourcePath || 'origen no especificado', layer); });
      row._infoButton = infoButton;
    }
    input.addEventListener('change', function () {
      if (base) {
        if (input.checked) {
          baseLayers.forEach(function (baseLayer) { if (map.hasLayer(baseLayer)) map.removeLayer(baseLayer); });
          layer.addTo(map);
          document.querySelectorAll('input[name="base-layer"]').forEach(function (radio) {
            radio.closest('.layer-item').querySelector('.layer-state').textContent = radio.checked ? 'BASE' : '—';
          });
        }
      } else {
        if (input.checked) layer.addTo(map);
        else map.removeLayer(layer);
        state.textContent = input.checked ? 'ON' : 'OFF';
        updateScaleLimitedLayers();
        updateFeatureLabels();
        updateRiskLegendPanel();
        var groupInputs = Array.from(row.parentElement.querySelectorAll('.layer-item input[type="checkbox"]'));
        var groupToggle = row.parentElement.querySelector('.layer-group-heading button');
        if (groupToggle && groupInputs.length) groupToggle.textContent = groupInputs.some(function (item) { return !item.checked; }) ? 'Activar grupo' : 'Apagar grupo';
      }
    });
    if (extentButton) row.append(input, swatch, label, state, extentButton, row._infoButton);
    else row.append(input, swatch, label, state);
    var parent = layerGroupContainer(name, base);
    parent.appendChild(row);
    if (!base) {
      var opacityWrap = document.createElement('label'); opacityWrap.className = 'layer-opacity';
      opacityWrap.appendChild(document.createTextNode('Opacidad'));
      var opacity = document.createElement('input'); opacity.type = 'range'; opacity.min = '20'; opacity.max = '100'; opacity.value = '100'; opacity.setAttribute('aria-label', 'Opacidad de ' + name);
      row._opacityInput = opacity;
      opacity.addEventListener('input', function () {
        var value = Number(opacity.value) / 100;
        layer._uiOpacity = value;
        applyOpacityToLayerTree(layer, value);
      });
      opacityWrap.appendChild(opacity); parent.appendChild(opacityWrap);
    }
  }

  addLayerControl('Imagen satelital', imagery, '#1976d2', true, true);
  addLayerControl('Mapa de calles', streets, '#0b2e59', false, true);

  function loadGeoTiffOverlay(path, name, options, color, initiallyVisible, isBase) {
    options = options || {};
    var group = L.layerGroup();
    overlays[name] = group;
    addLayerControl(name, group, color, initiallyVisible, Boolean(isBase));
    if (isBase) baseLayers.push(group);
    if (initiallyVisible) group.addTo(map);

    fetch(path).then(function (response) {
      if (!response.ok) throw new Error('HTTP ' + response.status);
      return response.arrayBuffer();
    }).then(function (buffer) {
      return parseGeoraster(buffer, { readOnDemand: true });
    }).then(function (georaster) {
      var raster = new GeoRasterLayer({
        georaster: georaster,
        resolution: 256,
        pixelValuesToColorFn: function (values) {
          if (values[0] == null || Number.isNaN(values[0])) return null;
          if (values.length < 3) {
            var minimum = georaster.mins[0];
            var maximum = georaster.maxs[0];
            var gray = maximum > minimum ? Math.round((values[0] - minimum) / (maximum - minimum) * 255) : 0;
            gray = Math.max(0, Math.min(255, gray));
            return 'rgb(' + gray + ', ' + gray + ', ' + gray + ')';
          }
          if (values.slice(0, 3).some(function (value) { return value == null || Number.isNaN(value); })) return null;

          var r, g, b;
          if (options.ycbcr) {
            var y = values[0], cb = values[1] - 128, cr = values[2] - 128;
            r = Math.round(y + 1.402 * cr);
            g = Math.round(y - 0.34414 * cb - 0.71414 * cr);
            b = Math.round(y + 1.772 * cb);
          } else {
            r = values[0];
            g = values[1];
            b = values[2];
          }
          if (options.fondoNegro && r <= 5 && g <= 5 && b <= 5) return null;
          if (values.length > 3) return 'rgba(' + r + ', ' + g + ', ' + b + ', ' + values[3] / 255 + ')';
          return 'rgb(' + r + ', ' + g + ', ' + b + ')';
        }
      });
      group.addLayer(raster);
      if (isBase && initiallyVisible) {
        baseLayers.forEach(function (baseLayer) { if (baseLayer !== group && map.hasLayer(baseLayer)) map.removeLayer(baseLayer); });
        group.addTo(map);
      }
      var layerRow = Array.from(layerList.querySelectorAll('.layer-item')).find(function (item) {
        return item.querySelector('label').textContent === name;
      });
      if (layerRow) layerRow.querySelector('.layer-state').textContent = layerRow.querySelector('input').checked ? 'ON' : 'OFF';
      if (initiallyVisible && map.hasLayer(group) && !userChangedView) {
        map.fitBounds(options.viewBounds || raster.getBounds(), { padding: [28, 28], maxZoom: 17 });
      }
    }).catch(function (error) {
      console.error('No se pudo cargar ' + path + ':', error);
      var row = Array.from(layerList.querySelectorAll('.layer-item')).find(function (item) {
        return item.querySelector('label').textContent === name;
      });
      if (row) row.querySelector('.layer-state').textContent = 'ERROR';
    });

    return group;
  }

  function loadDemExtentReference() {
    var name = 'Límite de referencia del DEM';
    var group = L.layerGroup();
    overlays[name] = group;
    addLayerControl(name, group, '#ffc247', false, false);
    fetch('data/Raster/ZONA_ESTUDIO.tfw').then(function (response) {
      if (!response.ok) throw new Error('HTTP ' + response.status);
      return response.text();
    }).then(function (text) {
      if (!window.proj4) throw new Error('No está disponible la transformación EPSG:9377.');
      proj4.defs('EPSG:9377', '+proj=tmerc +lat_0=4 +lon_0=-73 +k=0.9992 +x_0=5000000 +y_0=2000000 +ellps=GRS80 +units=m +no_defs +type=crs');
      var world = text.trim().split(/\s+/).map(Number);
      if (world.length !== 6 || !world.every(Number.isFinite) || Math.abs(world[1]) > 1e-9 || Math.abs(world[2]) > 1e-9) throw new Error('El TFW no describe una cuadrícula norte-arriba válida.');
      var pixelX = world[0], centerX = world[4], centerY = world[5];
      var bounds = { xmin: centerX - pixelX / 2, xmax: centerX + (205 - 0.5) * pixelX, ymax: centerY - world[3] / 2, ymin: centerY + (144 - 0.5) * world[3] };
      var ring = [];
      var corners = [[bounds.xmin, bounds.ymax], [bounds.xmax, bounds.ymax], [bounds.xmax, bounds.ymin], [bounds.xmin, bounds.ymin], [bounds.xmin, bounds.ymax]];
      corners.forEach(function (a, edge) {
        var b = corners[(edge + 1) % corners.length];
        for (var step = 0; step < 12; step++) {
          var t = step / 12;
          ring.push(proj4('EPSG:9377', 'EPSG:4326', [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]));
        }
      });
      ring.push(ring[0]);
      var feature = { type: 'Feature', properties: { nombre: name }, geometry: { type: 'Polygon', coordinates: [ring] } };
      group.addLayer(L.geoJSON(feature, { style: { color: '#b87900', weight: 3, opacity: 1, fill: false, dashArray: '7 5' } }));
      var row = Array.from(layerList.querySelectorAll('.layer-item')).find(function (item) { return item.querySelector('label').textContent === name; });
      if (row) row.querySelector('.layer-state').textContent = 'OFF';
    }).catch(function (error) { console.warn('No se pudo dibujar la extensión de referencia del DEM:', error); });
  }

  var ortofoto2024 = L.esri.imageMapLayer({
    url: 'https://www.medellin.gov.co/servidormapas/rest/services/ServiciosImagen/Ortofoto_Medellin_2024/ImageServer',
    renderingRule: { rasterFunction: 'Ortofoto_2024_3' },
    format: 'jpgpng',
    attribution: 'Ortofoto Medellín 2024 · Alcaldía de Medellín'
  });
  baseLayers.push(ortofoto2024);
  addLayerControl('Ortofoto Medellín 2024', ortofoto2024, '#2f855a', true, true);
  baseLayers.forEach(function (baseLayer) { if (baseLayer !== ortofoto2024 && map.hasLayer(baseLayer)) map.removeLayer(baseLayer); });
  ortofoto2024.addTo(map);

  var uvaIcon = L.divIcon({
    className: 'uva-div-icon',
    html: '<span class="uva-marker-shell" aria-hidden="true"><svg viewBox="0 0 24 24" focusable="false"><path d="M4 17.5h16M6.5 17.5V9l5.5-4 5.5 4v8.5M9.5 17.5v-4h5v4M8.5 9.5h.01M12 8h.01M15.5 9.5h.01" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg></span>',
    iconSize: [40, 44],
    iconAnchor: [20, 40],
    tooltipAnchor: [17, -28],
    popupAnchor: [0, -38]
  });
  var uvaMarker = L.marker([6.27452, -75.54542], {
    pane: 'landmarkPane',
    icon: uvaIcon,
    title: 'UVA La Armonía',
    alt: 'UVA La Armonía, Santa Inés'
  }).addTo(map);
  uvaMarker.bindTooltip('UVA La Armonía', {
    permanent: true,
    direction: 'right',
    offset: [10, -15],
    className: 'uva-label',
    opacity: 1
  });
  var uvaPopup = document.createElement('article');
  uvaPopup.className = 'uva-popup';
  var uvaPopupPhoto = document.createElement('img');
  uvaPopupPhoto.className = 'uva-popup-photo';
  uvaPopupPhoto.src = 'Images/Uva_Armonía.jpg';
  uvaPopupPhoto.alt = 'Vista de la UVA La Armonía, su piscina y el barrio de ladera';
  var uvaPopupTitle = document.createElement('strong');
  uvaPopupTitle.textContent = 'UVA La Armonía';
  var uvaPopupAddress = document.createElement('span');
  uvaPopupAddress.textContent = 'Carrera 36 # 84-98 · Santa Inés, Manrique';
  uvaPopup.append(uvaPopupPhoto, uvaPopupTitle, uvaPopupAddress);
  uvaMarker.bindPopup(uvaPopup, { className: 'uva-popup-container', maxWidth: 320 });

  var attributeFeatures = [];
  var attributePage = 0;
  var attributePageSize = 25;
  var attributeTitle = document.getElementById('attribute-table-title');
  var attributeSearch = document.getElementById('attribute-table-search');
  var attributeHead = document.getElementById('attribute-table-head');
  var attributeBody = document.getElementById('attribute-table-body');
  var attributePageLabel = document.getElementById('attribute-table-page');
  var attributePanel = document.getElementById('attribute-table-panel');

  var selectedFeatureLayer = null;
  function inspectorValue(label, value, host) {
    if (value == null || String(value).trim() === '') return;
    var row = document.createElement('div'); row.className = 'inspector-row';
    var key = document.createElement('span'); key.textContent = label;
    var text = document.createElement('strong'); text.textContent = String(value);
    row.append(key, text); host.appendChild(row);
  }

  function showFeatureInspector(layer) {
    if (!layer || !layer.feature) return;
    var feature = layer.feature, p = feature.properties || {};
    var isParcel = !!layer._isParcelLayer;
    var panel = document.getElementById('feature-inspector');
    var content = document.getElementById('inspector-content');
    content.textContent = '';
    document.getElementById('inspector-title').textContent = isParcel ? 'Detalle del predio' : 'Detalle de construcción';
    var id = isParcel ? propertyValue(p, ['fid_', 'numero_pre', 'matricula_']) : propertyValue(p, ['id_constru', 'cbml', 'numero_edi']);
    document.getElementById('inspector-subtitle').textContent = id ? 'Identificador: ' + id : 'Identificador no disponible en atributos';
    inspectorValue('Barrio por ubicación', neighborhoodForFeature(feature) || 'Sin barrio asignado por los polígonos disponibles', content);
    if (isParcel) {
      inspectorValue('Número predial', propertyValue(p, ['numero_pre']), content);
      inspectorValue('Matrícula', propertyValue(p, ['matricula_']), content);
      inspectorValue('Destinación', propertyValue(p, ['destinacio']), content);
      inspectorValue('Tipo de predio', propertyValue(p, ['tipo_predi']), content);
      inspectorValue('Área registrada', propertyValue(p, ['Shape_Area']), content);
    } else {
      inspectorValue('CBML', propertyValue(p, ['cbml']), content);
      inspectorValue('Tipo de construcción', propertyValue(p, ['tipo_const']), content);
      inspectorValue('Número de pisos', propertyValue(p, ['numero_pis']), content);
      inspectorValue('Área construida', propertyValue(p, ['area_const']), content);
      inspectorValue('Altura', propertyValue(p, ['Altura']), content);
    }
    inspectorValue('Categoría de amenaza', propertyValue(p, ['Cat_Amenza']), content);
    inspectorValue('Categoría de riesgo', propertyValue(p, ['Cat_Riesgo']), content);
    selectedInspectorLayer = layer; panel.hidden = false;
  }

  function selectFeatureLayer(layer) {
    if (selectedFeatureLayer && selectedFeatureLayer !== layer && selectedFeatureLayer._originalFeatureStyle) {
      selectedFeatureLayer.setStyle(selectedFeatureLayer._originalFeatureStyle);
    }
    selectedFeatureLayer = layer;
    if (layer && (layer._isParcelLayer || layer._isConstructionLayer)) showFeatureInspector(layer);
    if (layer && typeof layer.setStyle === 'function') {
      layer.setStyle({ color: '#1976d2', weight: 4, opacity: 1, fillColor: '#1976d2', fillOpacity: 0, radius: 8 });
    }
  }

  function neighborhoodForFeature(feature) {
    if (feature._neighborhoodLabel != null && neighborhoodFeatures.length) return feature._neighborhoodLabel;
    var point = featureAnchor(feature);
    if (!point) return '';
    var found = neighborhoodFeatures.find(function (item) { return pointInGeometry(point, item.geometry); });
    var label = found ? String(propertyValue(found.properties, ['nombre', 'label']) || '') : '';
    if (neighborhoodFeatures.length) feature._neighborhoodLabel = label;
    return label;
  }

  function renderAttributeTable() {
    var query = attributeSearch.value.trim().toLocaleLowerCase('es');
    var filtered = attributeFeatures.filter(function (feature) {
      return Object.keys(feature.properties || {}).some(function (key) {
        return String(feature.properties[key] == null ? '' : feature.properties[key]).toLocaleLowerCase('es').indexOf(query) !== -1;
      });
    });
    var keys = [];
    filtered.forEach(function (feature) {
      Object.keys(feature.properties || {}).forEach(function (key) { if (keys.indexOf(key) === -1) keys.push(key); });
    });
    attributeHead.textContent = '';
    var headerRow = document.createElement('tr');
    keys.forEach(function (key) { var th = document.createElement('th'); th.textContent = key; headerRow.appendChild(th); });
    attributeHead.appendChild(headerRow);
    attributeBody.textContent = '';
    var pageCount = Math.max(1, Math.ceil(filtered.length / attributePageSize));
    attributePage = Math.min(attributePage, pageCount - 1);
    filtered.slice(attributePage * attributePageSize, (attributePage + 1) * attributePageSize).forEach(function (feature, index) {
      var tr = document.createElement('tr');
      tr.title = 'Acercar a esta entidad';
      tr.addEventListener('click', function () {
        var layer = feature._leafletLayer;
        selectFeatureLayer(layer);
        var bounds = getLayerBounds(layer);
        if (bounds) map.fitBounds(bounds, { padding: [36, 36], maxZoom: 17 });
        if (layer && layer.getPopup && layer.getPopup()) layer.openPopup();
      });
      keys.forEach(function (key) { var td = document.createElement('td'); var value = feature.properties && feature.properties[key]; td.textContent = value == null ? '' : String(value); tr.appendChild(td); });
      attributeBody.appendChild(tr);
    });
    attributePageLabel.textContent = (filtered.length ? attributePage * attributePageSize + 1 : 0) + '–' + Math.min((attributePage + 1) * attributePageSize, filtered.length) + ' de ' + filtered.length;
    document.getElementById('attribute-table-prev').disabled = attributePage <= 0;
    document.getElementById('attribute-table-next').disabled = attributePage >= pageCount - 1;
  }

  function showAttributeTable(name, features) {
    attributeTitle.textContent = 'Tabla de atributos · ' + name;
    attributeFeatures = features;
    attributePage = 0;
    attributeSearch.value = '';
    renderAttributeTable();
    attributePanel.hidden = false;
  }

  attributeSearch.addEventListener('input', function () { attributePage = 0; renderAttributeTable(); });
  document.getElementById('attribute-table-close').addEventListener('click', function () { attributePanel.hidden = true; });
  document.getElementById('attribute-table-prev').addEventListener('click', function () { if (attributePage > 0) { attributePage--; renderAttributeTable(); } });
  document.getElementById('attribute-table-next').addEventListener('click', function () { attributePage++; renderAttributeTable(); });

  function getCategoryValue(properties, kind) {
    if (!properties) return '';
    var fields = kind === 'threat' ? ['Cat_Amenza', 'grado_amen', 'categoria', 'categoria_'] : ['Cat_Riesgo', 'riesgo', 'categoria', 'categoria_'];
    for (var i = 0; i < fields.length; i++) {
      var key = Object.keys(properties).find(function (candidate) { return candidate.toLocaleLowerCase('es') === fields[i].toLocaleLowerCase('es'); });
      if (key && properties[key] != null && String(properties[key]).trim() && String(properties[key]).trim() !== '0') return String(properties[key]).trim();
    }
    return '';
  }

  function ringArea(ring) {
    var area = 0;
    for (var i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      area += ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
    }
    return Math.abs(area / 2);
  }

  function geometryArea(geometry) {
    if (!geometry || !geometry.coordinates) return 0;
    var polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : (geometry.type === 'MultiPolygon' ? geometry.coordinates : []);
    return polygons.reduce(function (total, polygon) {
      if (!polygon.length) return total;
      return total + Math.max(0, ringArea(polygon[0]) - polygon.slice(1).reduce(function (holes, ring) { return holes + ringArea(ring); }, 0));
    }, 0);
  }

  function normalizedText(value) {
    return String(value == null ? '' : value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('es').replace(/[^a-z0-9]/g, '');
  }

  function propertyValue(properties, aliases) {
    if (!properties) return '';
    var wanted = aliases.map(normalizedText);
    var key = Object.keys(properties).find(function (candidate) { return wanted.indexOf(normalizedText(candidate)) !== -1; });
    return key ? properties[key] : '';
  }

  function geometryCentroid(geometry) {
    if (!geometry || !geometry.coordinates) return null;
    var polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : (geometry.type === 'MultiPolygon' ? geometry.coordinates : []);
    var sumX = 0, sumY = 0, sumArea = 0;
    polygons.forEach(function (rings) {
      rings.forEach(function (ring, ringIndex) {
        var crossSum = 0, cx = 0, cy = 0;
        for (var i = 0, j = ring.length - 1; i < ring.length; j = i++) {
          var cross = ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
          crossSum += cross; cx += (ring[j][0] + ring[i][0]) * cross; cy += (ring[j][1] + ring[i][1]) * cross;
        }
        var signedArea = crossSum / 2;
        if (Math.abs(signedArea) < 1e-12) return;
        var area = Math.abs(signedArea) * (ringIndex === 0 ? 1 : -1);
        sumX += (cx / (6 * signedArea)) * area; sumY += (cy / (6 * signedArea)) * area; sumArea += area;
      });
    });
    return sumArea > 0 ? [sumX / sumArea, sumY / sumArea] : null;
  }

  function featureAnchor(feature) {
    var geometry = feature && feature.geometry;
    if (!geometry || !geometry.coordinates) return null;
    var centroid = geometryCentroid(geometry);
    if (centroid) return centroid;
    var coordinates = [];
    function collect(value) {
      if (!Array.isArray(value)) return;
      if (value.length >= 2 && typeof value[0] === 'number' && typeof value[1] === 'number') coordinates.push(value);
      else value.forEach(collect);
    }
    collect(geometry.coordinates);
    if (!coordinates.length) return null;
    var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    coordinates.forEach(function (point) { minX = Math.min(minX, point[0]); maxX = Math.max(maxX, point[0]); minY = Math.min(minY, point[1]); maxY = Math.max(maxY, point[1]); });
    return [(minX + maxX) / 2, (minY + maxY) / 2];
  }

  function pointInRing(point, ring) {
    var inside = false;
    for (var i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      var xi = ring[i][0], yi = ring[i][1], xj = ring[j][0], yj = ring[j][1];
      var crosses = ((yi > point[1]) !== (yj > point[1])) && (point[0] < (xj - xi) * (point[1] - yi) / ((yj - yi) || 1e-12) + xi);
      if (crosses) inside = !inside;
    }
    return inside;
  }

  function pointInGeometry(point, geometry) {
    if (!point || !geometry || !geometry.coordinates) return false;
    var polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : (geometry.type === 'MultiPolygon' ? geometry.coordinates : []);
    return polygons.some(function (rings) {
      return rings.length && pointInRing(point, rings[0]) && !rings.slice(1).some(function (hole) { return pointInRing(point, hole); });
    });
  }

  function geometryVertices(geometry) {
    var vertices = [];
    function collect(value) {
      if (!Array.isArray(value)) return;
      if (value.length >= 2 && typeof value[0] === 'number' && typeof value[1] === 'number') vertices.push(value);
      else value.forEach(collect);
    }
    if (geometry && geometry.coordinates) collect(geometry.coordinates);
    return vertices;
  }

  function geometryRings(geometry) {
    if (!geometry || !geometry.coordinates) return [];
    var polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : (geometry.type === 'MultiPolygon' ? geometry.coordinates : []);
    return polygons.reduce(function (all, polygon) { return all.concat(polygon); }, []);
  }

  function segmentsCross(a, b, c, d) {
    function orientation(p, q, r) { return (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]); }
    function onSegment(p, q, r) { return q[0] <= Math.max(p[0], r[0]) && q[0] >= Math.min(p[0], r[0]) && q[1] <= Math.max(p[1], r[1]) && q[1] >= Math.min(p[1], r[1]); }
    var o1 = orientation(a, b, c), o2 = orientation(a, b, d), o3 = orientation(c, d, a), o4 = orientation(c, d, b);
    if (((o1 < 0) !== (o2 < 0)) && ((o3 < 0) !== (o4 < 0))) return true;
    return (o1 === 0 && onSegment(a, c, b)) || (o2 === 0 && onSegment(a, d, b)) || (o3 === 0 && onSegment(c, a, d)) || (o4 === 0 && onSegment(c, b, d));
  }

  function geometriesIntersect(a, b) {
    if (!a || !b || !boundsOverlap(featureGeometryBounds(a), featureGeometryBounds(b))) return false;
    var aVertices = geometryVertices(a.geometry), bVertices = geometryVertices(b.geometry);
    if (pointInGeometry(featureAnchor(a), b.geometry) || pointInGeometry(featureAnchor(b), a.geometry)) return true;
    if (aVertices.some(function (point) { return pointInGeometry(point, b.geometry); }) || bVertices.some(function (point) { return pointInGeometry(point, a.geometry); })) return true;
    var aRings = geometryRings(a.geometry), bRings = geometryRings(b.geometry);
    return aRings.some(function (ringA) { return bRings.some(function (ringB) {
      for (var i = 1; i < ringA.length; i++) for (var j = 1; j < ringB.length; j++) if (segmentsCross(ringA[i - 1], ringA[i], ringB[j - 1], ringB[j])) return true;
      return false;
    }); });
  }

  function buildingOverlapsRisk(feature) {
    if (!riskZonesReady || !riskZoneFeatures.length) return false;
    if (feature._riskOverlapVersion === riskZoneVersion) return feature._riskOverlap;
    var bounds = featureGeometryBounds(feature);
    feature._riskOverlap = riskZoneFeatures.some(function (zone) {
      return riskGroup(zone.properties) !== 'unclassified' && boundsOverlap(bounds, featureGeometryBounds(zone)) && geometriesIntersect(feature, zone);
    });
    feature._riskOverlapVersion = riskZoneVersion;
    return feature._riskOverlap;
  }

  function featureGeometryBounds(feature) {
    if (feature._geometryBounds) return feature._geometryBounds;
    var vertices = geometryVertices(feature.geometry);
    if (!vertices.length) return null;
    feature._geometryBounds = vertices.reduce(function (bounds, point) {
      bounds.minX = Math.min(bounds.minX, point[0]); bounds.maxX = Math.max(bounds.maxX, point[0]);
      bounds.minY = Math.min(bounds.minY, point[1]); bounds.maxY = Math.max(bounds.maxY, point[1]);
      return bounds;
    }, { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity });
    return feature._geometryBounds;
  }

  function boundsOverlap(a, b) {
    return a && b && a.minX <= b.maxX && a.maxX >= b.minX && a.minY <= b.maxY && a.maxY >= b.minY;
  }

  function riskGroup(properties) {
    var value = normalizedText(getCategoryValue(properties, 'landslide'));
    if (!value || value === '0') return 'unclassified';
    if (value.indexOf('nomitigable') !== -1) return 'high_non_mitigable';
    if (value.indexOf('alto') !== -1 && value.indexOf('mitigable') !== -1) return 'high_mitigable';
    if (value.indexOf('medio') !== -1) return 'medium';
    if (value.indexOf('bajo') !== -1 || value.indexOf('condiciones') !== -1) return 'low';
    return 'unclassified';
  }

  function matchesSelectedArea(feature) {
    var selected = neighborhoodFilter ? neighborhoodFilter.value : 'all';
    if (selected === 'all') return true;
    feature._areaMembershipCache = feature._areaMembershipCache || {};
    if (Object.prototype.hasOwnProperty.call(feature._areaMembershipCache, selected)) return feature._areaMembershipCache[selected];
    var barrio = neighborhoodFeatures.find(function (item) {
      return normalizedText(propertyValue(item.properties, ['nombre', 'label'])) === normalizedText(selected);
    });
    var matches = false;
    if (barrio && feature.geometry && boundsOverlap(featureGeometryBounds(feature), featureGeometryBounds(barrio))) {
      var featurePoint = featureAnchor(feature);
      var barrioPoint = featureAnchor(barrio);
      matches = pointInGeometry(featurePoint, barrio.geometry) || pointInGeometry(barrioPoint, feature.geometry) ||
        geometryVertices(feature.geometry).some(function (point) { return pointInGeometry(point, barrio.geometry); }) ||
        geometryVertices(barrio.geometry).some(function (point) { return pointInGeometry(point, feature.geometry); });
    }
    feature._areaMembershipCache[selected] = matches;
    return matches;
  }

  function featureUseKey(feature) {
    var p = feature.properties || {};
    return feature._entityKind === 'parcel' ? propertyValue(p, ['destinacio', 'tipo_predi']) : propertyValue(p, ['tipo_const']);
  }

  function passesDataFilters(feature) {
    var selectedRisk = riskFilter ? riskFilter.value : 'all';
    if (!matchesSelectedArea(feature)) return false;
    if (selectedRisk !== 'all' && riskGroup(feature.properties) !== selectedRisk) return false;
    var use = landuseFilter ? landuseFilter.value : 'all';
    if (use !== 'all' && featureUseKey(feature) !== use) return false;
    var query = entityFilter ? normalizedText(entityFilter.value.trim()) : '';
    if (query) {
      var p = feature.properties || {};
      var ids = ['fid_', 'numero_pre', 'matricula_', 'id_constru', 'cbml', 'numero_edi', 'numero_mej'];
      if (!ids.some(function (field) { var value = propertyValue(p, [field]); return value !== '' && normalizedText(value).indexOf(query) !== -1; })) return false;
    }
    return true;
  }

  function populateLanduseFilter() {
    if (!landuseFilter) return;
    var current = landuseFilter.value;
    var values = [];
    parcelFilterFeatures.concat(constructionFilterFeatures).forEach(function (feature) {
      var value = featureUseKey(feature);
      if (value != null && String(value).trim() && values.indexOf(String(value)) === -1) values.push(String(value));
    });
    values.sort(function (a, b) { return a.localeCompare(b, 'es'); });
    landuseFilter.textContent = '';
    var all = document.createElement('option'); all.value = 'all'; all.textContent = 'Todos los usos disponibles'; landuseFilter.appendChild(all);
    values.forEach(function (value) { var option = document.createElement('option'); option.value = value; option.textContent = value; landuseFilter.appendChild(option); });
    if (values.indexOf(current) !== -1) landuseFilter.value = current;
  }

  function applyDataFilters() {
    parcelFilterFeatures.concat(constructionFilterFeatures).forEach(function (feature) {
      var visible = passesDataFilters(feature);
      var layer = feature._leafletLayer;
      if (!layer || typeof layer.setStyle !== 'function') return;
      var fill = layer._isParcelLayer ? 0.07 : 0.18;
      layer.setStyle({ opacity: visible ? 0.95 : 0, fillOpacity: visible ? fill : 0 });
      var element = layer.getElement && layer.getElement();
      if (element) element.style.pointerEvents = visible ? 'auto' : 'none';
    });
    if (spatialQueryActive) {
      var visibleSpatial = spatialSelection.filter(function (item) { return passesDataFilters(item.feature); });
      visibleSpatial.forEach(function (item) {
        var selectedLayer = item.feature._leafletLayer;
        if (selectedLayer && selectedLayer.setStyle) selectedLayer.setStyle({ color: '#087e8b', weight: 3, opacity: 1, fillColor: '#28a9b5', fillOpacity: 0.3 });
      });
      document.getElementById('spatial-result').textContent = 'Consulta por centroide dentro del polígono: ' + visibleSpatial.filter(function (item) { return item.kind === 'building'; }).length.toLocaleString('es') + ' construcciones y ' + visibleSpatial.filter(function (item) { return item.kind === 'parcel'; }).length.toLocaleString('es') + ' predios después de aplicar los filtros.';
    }
    updateAreaStatistics();
  }

  function updateAreaStatistics() {
    var selected = neighborhoodFilter ? neighborhoodFilter.value : 'all';
    var parcels = parcelFilterFeatures.filter(passesDataFilters);
    var buildings = constructionFilterFeatures.filter(passesDataFilters);
    var atRisk = buildings.filter(buildingOverlapsRisk).length;
    var countNode = document.getElementById('parcel-count');
    var percentNode = document.getElementById('building-risk-percent');
    var scopeNode = document.getElementById('stats-scope');
    if (countNode) countNode.textContent = parcels.length.toLocaleString('es');
    var buildingCount = document.getElementById('building-count');
    if (buildingCount) buildingCount.textContent = buildings.length.toLocaleString('es');
    if (percentNode) percentNode.textContent = !riskZonesReady ? '—' : ((buildings.length ? Math.round(atRisk * 100 / buildings.length) : 0) + '%');
    if (scopeNode) scopeNode.textContent = selected === 'all' ? 'Área de estudio · filtros vigentes' : 'Barrio: ' + neighborhoodFilter.options[neighborhoodFilter.selectedIndex].textContent;
    var distribution = document.getElementById('risk-distribution');
    if (distribution) {
      distribution.textContent = '';
      [['high_non_mitigable', 'Alto no mitigable'], ['high_mitigable', 'Alto mitigable'], ['medium', 'Medio'], ['low', 'Bajo / condiciones'], ['unclassified', 'Sin categoría']].forEach(function (category) {
        var count = buildings.filter(function (feature) { return riskGroup(feature.properties) === category[0]; }).length;
        var line = document.createElement('div'); line.className = 'distribution-row';
        var label = document.createElement('span'); label.textContent = category[1] + ' · ' + count.toLocaleString('es');
        var track = document.createElement('span'); track.className = 'distribution-track';
        var bar = document.createElement('i'); bar.style.width = (buildings.length ? Math.round(count * 100 / buildings.length) : 0) + '%'; bar.dataset.risk = category[0]; track.appendChild(bar);
        line.append(label, track); distribution.appendChild(line);
      });
    }
    function renderDistribution(nodeId, features, labelFor) {
      var host = document.getElementById(nodeId); if (!host) return;
      var counts = Object.create(null);
      features.forEach(function (feature) { var key = labelFor(feature) || 'Sin dato'; counts[key] = (counts[key] || 0) + 1; });
      var sorted = Object.keys(counts).map(function (key) { return [key, counts[key]]; }).sort(function (a, b) { return b[1] - a[1] || a[0].localeCompare(b[0], 'es'); });
      if (sorted.length > 8) { var otherCount = sorted.slice(7).reduce(function (total, item) { return total + item[1]; }, 0); sorted = sorted.slice(0, 7).concat([['Otras categorías', otherCount]]); }
      host.textContent = '';
      sorted.forEach(function (item) {
        var row = document.createElement('div'); row.className = 'distribution-row';
        var label = document.createElement('span'); label.textContent = item[0] + ' · ' + item[1].toLocaleString('es');
        var track = document.createElement('span'); track.className = 'distribution-track';
        var bar = document.createElement('i'); bar.style.width = (features.length ? Math.round(item[1] * 100 / features.length) : 0) + '%'; track.appendChild(bar);
        row.append(label, track); host.appendChild(row);
      });
    }
    var entities = parcels.concat(buildings);
    renderDistribution('landuse-distribution', entities, function (feature) {
      var value = featureUseKey(feature);
      return (feature._entityKind === 'parcel' ? 'Predio · ' : 'Construcción · ') + (value == null || String(value).trim() === '' ? 'Sin dato' : String(value));
    });
    renderDistribution('neighborhood-distribution', entities, function (feature) { return neighborhoodForFeature(feature) || 'Sin barrio asignado'; });
  }

  if (riskFilter) riskFilter.addEventListener('change', applyDataFilters);
  if (neighborhoodFilter) neighborhoodFilter.addEventListener('change', applyDataFilters);
  if (landuseFilter) landuseFilter.addEventListener('change', applyDataFilters);
  if (entityFilter) entityFilter.addEventListener('input', applyDataFilters);

  function riskAppearance(properties, kind) {
    var value = normalizedText(getCategoryValue(properties, kind));
    if (kind === 'threat') {
      if (value.indexOf('alta') !== -1) return { color: '#b42332', fillOpacity: 0.12, weight: 2, dashArray: '5 3' };
      if (value.indexOf('media') !== -1) return { color: '#e98b16', fillOpacity: 0.16, weight: 1.7 };
      if (value.indexOf('baja') !== -1) return { color: '#21845b', fillOpacity: 0.13, weight: 1.5 };
      return { color: '#78879a', fillOpacity: 0.1, weight: 1.4 };
    }
    if (value.indexOf('nomitigable') !== -1) return { color: '#b42332', fillOpacity: 0.1, weight: 2.1, dashArray: '6 3' };
    if (value.indexOf('mitigable') !== -1) return { color: '#e87516', fillOpacity: 0.16, weight: 1.8 };
    if (value.indexOf('medio') !== -1) return { color: '#d6a41d', fillOpacity: 0.19, weight: 1.7 };
    if (value.indexOf('condiciones') !== -1) return { color: '#8b9d26', fillOpacity: 0.16, weight: 1.5 };
    if (value.indexOf('bajo') !== -1) return { color: '#21845b', fillOpacity: 0.14, weight: 1.5 };
    return { color: '#78879a', fillOpacity: 0.1, weight: 1.4 };
  }

  var riskLegendPanel = null;
  var riskLegendEntries = [];

  function updateRiskLegendPanel() {
    if (!riskLegendPanel) return;
    var hasVisibleLegend = false;
    riskLegendEntries.forEach(function (entry) {
      var zoom = map.getZoom();
      var withinScale = !entry.group._scaleMinZoom || (zoom >= entry.group._scaleMinZoom && zoom <= entry.group._scaleMaxZoom && entry.group.hasLayer(entry.group._scaleLimitedChild));
      var visible = map.hasLayer(entry.group) && withinScale;
      entry.element.hidden = !visible;
      if (visible) hasVisibleLegend = true;
    });
    riskLegendPanel.hidden = !hasVisibleLegend;
  }

  function addRiskLegend(name, kind, group) {
    var items = kind === 'flood' ? [
      ['Alto no mitigable', '#b42332', 'dashed'], ['Alto mitigable', '#e87516'], ['Con condiciones', '#d6a41d']
    ] : kind === 'threat' ? [
      ['Amenaza alta', '#b42332', 'dashed'], ['Amenaza media', '#e98b16'], ['Amenaza baja', '#21845b']
    ] : [
      ['Alto riesgo no mitigable', '#b42332', 'dashed'], ['Alto riesgo mitigable', '#e87516'], ['Riesgo medio', '#d6a41d'], ['Con condiciones de riesgo', '#8b9d26'], ['Riesgo bajo', '#21845b']
    ];
    if (!riskLegendPanel) {
      riskLegendPanel = document.createElement('aside');
      riskLegendPanel.className = 'map-risk-legend';
      riskLegendPanel.setAttribute('aria-label', 'Simbología de las capas de riesgo y amenaza');
      var heading = document.createElement('h3');
      heading.textContent = 'Simbología';
      riskLegendPanel.appendChild(heading);
      document.querySelector('.map-stage').appendChild(riskLegendPanel);
    }
    var section = document.createElement('section');
    section.className = 'map-risk-legend-section';
    section.hidden = !map.hasLayer(group);
    var title = document.createElement('h4');
    title.textContent = name;
    section.appendChild(title);
    items.forEach(function (item) {
      var entry = document.createElement('div');
      entry.className = 'map-risk-legend-item';
      var swatch = document.createElement('i');
      swatch.style.setProperty('--legend-color', item[1]);
      if (item[2] === 'dashed') swatch.classList.add('risk-swatch-dashed');
      entry.append(swatch, document.createTextNode(item[0]));
      section.appendChild(entry);
    });
    riskLegendPanel.appendChild(section);
    riskLegendEntries.push({ element: section, group: group });
    updateRiskLegendPanel();
  }

  function buildParcelPopup(properties) {
    var card = document.createElement('article');
    card.className = 'parcel-popup';
    var fid = propertyValue(properties, ['fid_']);
    var head = document.createElement('header');
    head.className = 'parcel-popup-head';
    var heading = document.createElement('div');
    var title = document.createElement('h3');
    title.textContent = 'Ficha predial';
    var subtitle = document.createElement('p');
    subtitle.textContent = fid === '' ? 'Identificador no disponible' : 'Predio individual';
    heading.append(title, subtitle);
    var tag = document.createElement('span');
    tag.className = 'parcel-popup-tag';
    tag.textContent = fid === '' ? 'FID —' : 'FID ' + fid;
    head.append(heading, tag);
    card.appendChild(head);

    function addSection(label, fields) {
      var section = document.createElement('section');
      section.className = 'parcel-popup-section';
      var sectionTitle = document.createElement('h4');
      sectionTitle.textContent = label;
      section.appendChild(sectionTitle);
      fields.forEach(function (field) {
        var value = propertyValue(properties, [field[0]]);
        if (value == null || String(value).trim() === '') return;
        var row = document.createElement('div');
        row.className = 'parcel-popup-row';
        var key = document.createElement('span');
        key.textContent = field[1];
        var text = document.createElement('span');
        text.textContent = String(value);
        row.append(key, text);
        section.appendChild(row);
      });
      card.appendChild(section);
    }

    addSection('Identificación catastral', [
      ['cod_divipo', 'Código DIVIPOLA'], ['numero_pre', 'Número predial'], ['matricula_', 'Matrícula'],
      ['zona', 'Zona'], ['condicion_', 'Condición'], ['destinacio', 'Destinación'], ['tipo_predi', 'Tipo de predio'], ['Shape_Area', 'Área registrada']
    ]);
    addSection('Condición de amenaza y riesgo', [
      ['Cat_Amenza', 'Amenaza por movimiento en masa'], ['Cat_Riesgo', 'Categoría de riesgo']
    ]);

    var actions = document.createElement('div');
    actions.className = 'parcel-popup-actions';
    var exportButton = document.createElement('button');
    exportButton.type = 'button';
    exportButton.className = 'parcel-export-button';
    exportButton.textContent = 'Exportar ficha predial';
    var status = document.createElement('span');
    status.className = 'parcel-export-status';
    status.setAttribute('aria-live', 'polite');
    exportButton.addEventListener('click', function (event) {
      event.stopPropagation();
      status.textContent = 'Acción de demostración: exportación de ficha próximamente.';
    });
    actions.append(exportButton, status);
    card.appendChild(actions);
    return card;
  }

  function buildConstructionPopup(properties) {
    var card = document.createElement('article'); card.className = 'parcel-popup';
    var title = document.createElement('h3'); title.textContent = 'Ficha de construcción'; card.appendChild(title);
    [['id_constru', 'ID construcción'], ['cbml', 'CBML'], ['tipo_const', 'Tipo'], ['numero_pis', 'Pisos'], ['area_const', 'Área construida'], ['Cat_Amenza', 'Amenaza'], ['Cat_Riesgo', 'Riesgo']].forEach(function (field) {
      var value = propertyValue(properties, [field[0]]);
      if (value == null || String(value).trim() === '') return;
      var row = document.createElement('div'); row.className = 'parcel-popup-row';
      var key = document.createElement('span'); key.textContent = field[1];
      var text = document.createElement('span'); text.textContent = String(value);
      row.append(key, text); card.appendChild(row);
    });
    var note = document.createElement('p'); note.textContent = 'Selecciona la construcción para abrir el detalle lateral.'; card.appendChild(note);
    return card;
  }

  function loadShapefileOverlay(path, name, color) {
    var group = L.layerGroup();
    overlays[name] = group;
    group._sourcePath = path + '.shp';
    addLayerControl(name, group, color, false, false);
    var row = Array.from(layerList.querySelectorAll('.layer-item')).find(function (item) {
      return item.querySelector('label').textContent === name;
    });
    var showTable = true;
    if (showTable && row) {
      var tableButton = document.createElement('button');
      tableButton.type = 'button';
      tableButton.className = 'layer-table-button';
      tableButton.textContent = 'Tabla';
      tableButton.title = 'Ver tabla de atributos';
      tableButton.addEventListener('click', function (event) { event.preventDefault(); event.stopPropagation(); if (group.featureData) showAttributeTable(name, group.featureData); });
      row.appendChild(tableButton);
    }
    if (row) row.querySelector('.layer-state').textContent = 'CARGANDO';

    var source = /\.zip$/i.test(path)
      ? fetch(path).then(function (response) {
          if (!response.ok) throw new Error('HTTP ' + response.status);
          return response.arrayBuffer();
        }).then(function (buffer) { return shp(buffer); })
      : shp(new URL(path, document.baseURI).href);
    source.then(function (geojson) {
      var collections = Array.isArray(geojson) ? geojson :
        (geojson && geojson.type === 'FeatureCollection' ? [geojson] : Object.keys(geojson || {}).map(function (key) { return geojson[key]; }));
      var features = collections.reduce(function (all, item) {
        if (item && item.type === 'FeatureCollection') return all.concat(item.features || []);
        if (item && item.type === 'Feature') all.push(item);
        return all;
      }, []);
      var isBoundary = path.indexOf('shp_barrios_y_veredas_mr') !== -1 || path.indexOf('Barrios_Manrique') !== -1;
      var isParcelLayer = /Predios_Influencia/i.test(path);
      var isConstructionLayer = /Construcciones_Area_Estudio/i.test(path);
      var riskKind = path.indexOf('Amenaza_Mov_Masa') !== -1 ? 'threat' : (/RIESGO_MOV_MASA|Riesgo_Mov_Masa|Construcciones_Area_Estudio|Predios_Influencia/i.test(path) ? 'landslide' : null);
      var isRiskZoneLayer = riskKind && !isParcelLayer && !isConstructionLayer;
      var featurePane = isRiskZoneLayer ? 'riskPane' : (isParcelLayer ? 'parcelPane' : (isConstructionLayer ? 'constructionPane' : undefined));
      // Mantener el orden original en la tabla y dibujar los predios grandes
      // antes que los pequeños para que los menores queden por encima.
      var renderFeatures = isParcelLayer ? features.slice().sort(function (a, b) { return geometryArea(b.geometry) - geometryArea(a.geometry); }) : features;
      if (path.indexOf('Barrios_Manrique') !== -1) {
        neighborhoodFeatures = features;
        parcelFilterFeatures.concat(constructionFilterFeatures).forEach(function (feature) { delete feature._areaMembershipCache; delete feature._neighborhoodLabel; });
      }
      if (isParcelLayer) parcelFilterFeatures = features;
      if (isConstructionLayer) constructionFilterFeatures = features;
      if (isRiskZoneLayer && riskKind === 'landslide') { riskZoneFeatures = features; riskZonesReady = true; riskZoneVersion++; }
      features.forEach(function (feature) { feature._entityKind = isParcelLayer ? 'parcel' : (isConstructionLayer ? 'building' : ''); });
      var layer = L.geoJSON({ type: 'FeatureCollection', features: renderFeatures }, {
        bubblingMouseEvents: true,
        style: function (feature) {
          var appearance = riskKind ? riskAppearance(feature && feature.properties, riskKind) : {};
          var featureColor = riskKind ? appearance.color : color;
          return {
            pane: featurePane,
            color: isBoundary ? '#e8edf2' : featureColor,
            weight: isBoundary ? 1.25 : (isRiskZoneLayer || isConstructionLayer ? appearance.weight : (isParcelLayer ? 1.15 : 1.5)),
            opacity: 0.95,
            fillColor: featureColor,
            fillOpacity: isRiskZoneLayer ? appearance.fillOpacity : (isParcelLayer ? 0.08 : (isConstructionLayer ? Math.min(0.22, appearance.fillOpacity + 0.06) : 0)),
            dashArray: appearance.dashArray,
            className: isBoundary ? 'boundary-feature' : undefined
          };
        },
        pointToLayer: function (feature, latlng) {
          var pointStyle = riskKind ? riskAppearance(feature && feature.properties, riskKind) : {};
          var pointColor = riskKind ? pointStyle.color : color;
          return L.circleMarker(latlng, { pane: featurePane, radius: 5, color: pointColor, weight: pointStyle.weight || 1.5, dashArray: pointStyle.dashArray, fillColor: pointColor, fillOpacity: riskKind ? pointStyle.fillOpacity : 0 });
        },
        onEachFeature: function (feature, featureLayer) {
          var properties = feature && feature.properties ? feature.properties : {};
          featureLayer._isParcelLayer = isParcelLayer;
          featureLayer._isConstructionLayer = isConstructionLayer;
          if (isParcelLayer) {
            var fidKey = Object.keys(properties).find(function (key) { return key.toLocaleLowerCase('es') === 'fid_'; });
            if (fidKey && properties[fidKey] != null) featureLayer.bindTooltip('FID: ' + properties[fidKey], { direction: 'top', sticky: true });
          }
          var content = isParcelLayer ? buildParcelPopup(properties) : (isConstructionLayer ? buildConstructionPopup(properties) : document.createElement('div'));
          if (isParcelLayer || isConstructionLayer) {
            featureLayer.bindPopup(content, { maxWidth: 350, minWidth: 260, className: 'parcel-popup-container' });
          } else {
            var title = document.createElement('strong');
            title.textContent = name;
            content.appendChild(title);
            Object.keys(properties).forEach(function (key) {
              var line = document.createElement('div');
              line.textContent = key + ': ' + properties[key];
              content.appendChild(line);
            });
            featureLayer.bindPopup(content);
          }
          featureLayer._originalFeatureStyle = Object.assign({}, featureLayer.options);
          featureLayer.on('click', function () {
            selectFeatureLayer(featureLayer);
            if (activeAction && featureLayer.closePopup) featureLayer.closePopup();
          });
          feature._leafletLayer = featureLayer;
          if (isBoundary) {
            var label = String(properties.nombre || properties.label || '').trim();
            if (label) {
              featureLayer.bindTooltip(label, { permanent: false, direction: 'center', className: 'map-feature-label', interactive: false });
              featureLabels.push({ layer: featureLayer, group: group, bounds: getLayerBounds(featureLayer), minZoom: isBoundary ? 13 : 16 });
            }
          }
        }
      });
      if (isParcelLayer || isConstructionLayer) {
        var minZoom = isParcelLayer ? 16 : 15;
        var maxZoom = 19;
        group._scaleLimitedChild = layer;
        group._scaleMinZoom = minZoom;
        group._scaleMaxZoom = maxZoom;
        scaleLimitedLayers.push({ group: group, layer: layer, state: row && row.querySelector('.layer-state'), minZoom: minZoom, maxZoom: maxZoom });
      }
      group.addLayer(layer);
      group.featureData = features;
      var opacityInput = row && row._opacityInput;
      if (opacityInput) opacityInput.dispatchEvent(new Event('input'));
      if (isParcelLayer || isConstructionLayer) updateScaleLimitedLayers();
      if (path.indexOf('Barrios_Manrique') !== -1) applyDataFilters();
      if (isRiskZoneLayer && riskKind === 'landslide') applyDataFilters();
      if (isParcelLayer || isConstructionLayer) { populateLanduseFilter(); applyDataFilters(); }
      if (showTable) {
        if (row && !row.querySelector('.layer-table-button')) {
          var tableButton = document.createElement('button');
          tableButton.type = 'button';
          tableButton.className = 'layer-table-button';
          tableButton.textContent = 'Tabla';
          tableButton.addEventListener('click', function (event) { event.preventDefault(); event.stopPropagation(); showAttributeTable(name, group.featureData); });
          row.appendChild(tableButton);
        }
      }
      if (riskKind) addRiskLegend(name, riskKind, group);
      updateFeatureLabels();
      if (row) row.querySelector('.layer-state').textContent = row.querySelector('input').checked ? 'ON' : 'OFF';
      if (isParcelLayer || isConstructionLayer) updateScaleLimitedLayers();
    }).catch(function (error) {
      console.error('No se pudo cargar ' + path + ':', error);
      if (row) row.querySelector('.layer-state').textContent = 'ERROR';
    });
    return group;
  }

  // Capas vectoriales incluidas en data; quedan disponibles desde el panel.
  loadShapefileOverlay('data/recorte/Amenaza_Mov_Masa', 'Amenaza por movimiento en masa', '#f72585');
  loadShapefileOverlay('data/Barrios_Manrique/Barrios_Manrique', 'Barrios de Manrique', '#06d6a0');
  loadShapefileOverlay('data/Comunas_Corregimientos/Comunas_Corregimientos_Med', 'Comunas y corregimientos', '#00b4d8');
  loadShapefileOverlay('data/Curva_Nivel/Curva_nivel_10x10_10', 'Curvas de nivel · 10 m', '#ffb703');
  loadShapefileOverlay('data/Construcciones_Area_Estudio/Construcciones_Area_Estudio', 'Construcciones del área de estudio', '#e76f51');
  loadShapefileOverlay('data/Predios/Predios_Influencia', 'Predios de la zona de influencia', '#9b5de5');
  loadShapefileOverlay('data/RIESGO_MOV_MASA/RIESGO_MOV_MASA', 'Riesgo por movimiento en masa', '#4361ee');
  loadDemExtentReference();
  // Los GeoTIFF se conservan como insumos analíticos del escenario 3D;
  // no son capas vectoriales del panel Catastro y territorio.
  function updateActionButtons() {
    var active = !!activeAction;
    finishButton.disabled = !active || (activeAction && activeAction.kind === 'draw' && activeAction.type === 'marker') || vertices.length < (activeAction && activeAction.type === 'polygon' ? 3 : 2);
    cancelButton.disabled = !active;
    undoButton.disabled = !active || vertices.length === 0;
    finishButton.textContent = activeAction && activeAction.kind === 'measure' ? 'Terminar medición' : 'Finalizar dibujo';
    document.querySelectorAll('[data-draw]').forEach(function (button) {
      button.classList.toggle('active', activeAction && activeAction.kind === 'draw' && activeAction.type === button.dataset.draw);
    });
    document.querySelectorAll('[data-measure]').forEach(function (button) {
      button.classList.toggle('active', activeAction && activeAction.kind === 'measure' && activeAction.type === button.dataset.measure);
    });
  }

  function cleanTemporary() {
    if (previewLine) map.removeLayer(previewLine);
    if (previewShape) map.removeLayer(previewShape);
    previewLine = null;
    previewShape = null;
    vertexMarkers.forEach(function (marker) { map.removeLayer(marker); });
    vertexMarkers = [];
  }

  function endAction(message) {
    cleanTemporary();
    vertices = [];
    activeAction = null;
    document.body.classList.remove('drawing');
    map.doubleClickZoom.enable();
    hint.textContent = message || 'Selecciona una geometría para comenzar.';
    updateActionButtons();
  }

  function startAction(kind, type) {
    endAction('Haz clic en el mapa para agregar vértices.');
    activeAction = { kind: kind, type: type };
    if (kind === 'measure') {
      document.getElementById('measure-result').innerHTML = '<span class="result-dot"></span><span>Marca puntos en el mapa para medir.</span>';
      hint.textContent = type === 'distance' ? 'Marca al menos dos puntos; doble clic o “Terminar medición” para cerrar.' : 'Marca el contorno del polígono; necesitas tres puntos.';
    } else {
      hint.textContent = type === 'marker' ? 'Haz clic en el mapa para colocar el punto.' : 'Haz clic para agregar vértices y finaliza el dibujo.';
    }
    document.body.classList.add('drawing');
    map.doubleClickZoom.disable();
    updateActionButtons();
  }

  function formatDistance(meters) {
    return meters >= 1000 ? (meters / 1000).toLocaleString('es-CO', { maximumFractionDigits: 3 }) + ' km' : meters.toLocaleString('es-CO', { maximumFractionDigits: 1 }) + ' m';
  }

  function geodesicArea(points) {
    var radius = 6378137;
    var area = 0;
    for (var i = 0, len = points.length; i < len; i++) {
      var p1 = points[i], p2 = points[(i + 1) % len];
      area += (p2.lng - p1.lng) * Math.PI / 180 * (2 + Math.sin(p1.lat * Math.PI / 180) + Math.sin(p2.lat * Math.PI / 180));
    }
    return Math.abs(area * radius * radius / 2);
  }

  function formatArea(area) {
    if (area >= 1000000) return (area / 1000000).toLocaleString('es-CO', { maximumFractionDigits: 4 }) + ' km²';
    return area.toLocaleString('es-CO', { maximumFractionDigits: 1 }) + ' m²';
  }

  function pathLength(points, close) {
    var length = 0;
    for (var i = 1; i < points.length; i++) length += points[i - 1].distanceTo(points[i]);
    if (close && points.length > 2) length += points[points.length - 1].distanceTo(points[0]);
    return length;
  }

  function addVertex(point) {
    vertices.push(point);
    var marker = L.marker(point, { interactive: false, icon: L.divIcon({ className: 'draw-vertex', iconSize: [11, 11], iconAnchor: [5, 5] }) });
    marker.addTo(map);
    vertexMarkers.push(marker);
    updateActionButtons();
    if (activeAction.kind === 'measure') updateMeasurementPreview();
    else updateDrawingPreview();
  }

  function updateDrawingPreview() {
    if (previewLine) map.removeLayer(previewLine);
    if (previewShape) map.removeLayer(previewShape);
    if (vertices.length < 2) return;
    var style = { color: '#1976d2', weight: 3, opacity: .9, dashArray: '7 5' };
    if (activeAction.type === 'polygon' && vertices.length >= 3) previewShape = L.polygon(vertices, Object.assign({}, style, { fillColor: '#0b2e59', fillOpacity: .15 })).addTo(map);
    else previewLine = L.polyline(vertices, style).addTo(map);
  }

  function updateMeasurementPreview() {
    if (previewLine) map.removeLayer(previewLine);
    if (previewShape) map.removeLayer(previewShape);
    if (vertices.length < 2) return;
    var type = activeAction.type;
    if (type === 'distance') previewLine = L.polyline(vertices, { color: '#0b2e59', weight: 3, dashArray: '6 5' }).addTo(map);
    else if (vertices.length >= 3) previewShape = L.polygon(vertices, { color: '#0b2e59', weight: 2, fillColor: '#0b2e59', fillOpacity: .12, dashArray: '6 5' }).addTo(map);
    var result = document.getElementById('measure-result');
    if (type === 'distance') result.innerHTML = '<span class="result-dot"></span><span>Distancia: <b>' + formatDistance(pathLength(vertices, false)) + '</b></span>';
    else if (vertices.length >= 3) {
      var value = type === 'perimeter' ? formatDistance(pathLength(vertices, true)) : formatArea(geodesicArea(vertices));
      result.innerHTML = '<span class="result-dot"></span><span>' + (type === 'perimeter' ? 'Perímetro: ' : 'Área: ') + '<b>' + value + '</b></span>';
    }
  }

  function finishAction() {
    if (!activeAction) return;
    var action = activeAction;
    if (action.kind === 'draw') {
      if (action.type === 'marker') {
        if (vertices.length) {
          var marker = L.marker(vertices[0], { icon: L.divIcon({ className: 'draw-point-icon', html: '<span></span>', iconSize: [16, 16], iconAnchor: [8, 8] }) });
          marker.bindPopup('<b>Punto dibujado</b><br>' + vertices[0].lat.toFixed(6) + ', ' + vertices[0].lng.toFixed(6));
          drawings.addLayer(marker);
          endAction('Punto agregado al mapa.');
        }
      } else if ((action.type === 'polyline' && vertices.length >= 2) || (action.type === 'polygon' && vertices.length >= 3)) {
        var queryGeometry = action.type === 'polygon' ? L.polygon(vertices).toGeoJSON().geometry : null;
        var layer = action.type === 'polygon'
          ? L.polygon(vertices, { color: '#1976d2', weight: 3, fillColor: '#0b2e59', fillOpacity: .22 })
          : L.polyline(vertices, { color: '#1976d2', weight: 3 });
        var title = action.type === 'polygon' ? 'Polígono' : 'Línea';
        var detail = action.type === 'polygon' ? 'Área: ' + formatArea(geodesicArea(vertices)) + '<br>Perímetro: ' + formatDistance(pathLength(vertices, true)) : 'Longitud: ' + formatDistance(pathLength(vertices, false));
        layer.bindPopup('<b>' + title + ' dibujado</b><br>' + detail);
        drawings.addLayer(layer);
        if (queryGeometry) runSpatialQuery(queryGeometry);
        endAction(title + ' agregado al mapa.');
      } else hint.textContent = 'Agrega más puntos antes de finalizar.';
    } else {
      if (action.type === 'distance' && vertices.length >= 2) {
        var line = L.polyline(vertices, { color: '#0b2e59', weight: 3 });
        line.bindPopup('Distancia: ' + formatDistance(pathLength(vertices, false)));
        measurementLayer.addLayer(line);
      } else if (vertices.length >= 3) {
        var polygon = L.polygon(vertices, { color: '#0b2e59', weight: 2, fillColor: '#0b2e59', fillOpacity: .15 });
        var measured = action.type === 'perimeter' ? formatDistance(pathLength(vertices, true)) : formatArea(geodesicArea(vertices));
        polygon.bindPopup((action.type === 'perimeter' ? 'Perímetro: ' : 'Área: ') + measured);
        measurementLayer.addLayer(polygon);
      } else { hint.textContent = 'Agrega más puntos antes de finalizar.'; return; }
      endAction('Medición guardada en el mapa.');
    }
  }

  function runSpatialQuery(geometry) {
    spatialSelection = [];
    spatialQueryActive = true;
    parcelFilterFeatures.concat(constructionFilterFeatures).forEach(function (feature) {
      var point = featureAnchor(feature);
      if (point && pointInGeometry(point, geometry)) spatialSelection.push({ feature: feature, kind: feature._entityKind });
    });
    spatialSelection.forEach(function (item) {
      var featureLayer = item.feature._leafletLayer;
      if (featureLayer && featureLayer.setStyle) featureLayer.setStyle({ color: '#087e8b', weight: 3, opacity: 1, fillColor: '#28a9b5', fillOpacity: 0.3 });
    });
    var buildings = spatialSelection.filter(function (item) { return item.kind === 'building'; }).length;
    var parcels = spatialSelection.filter(function (item) { return item.kind === 'parcel'; }).length;
    document.getElementById('spatial-result').textContent = 'Consulta por centroide dentro del polígono: ' + buildings.toLocaleString('es') + ' construcciones y ' + parcels.toLocaleString('es') + ' predios. CSV exportará este resultado.';
    document.getElementById('export-filtered').textContent = 'Descargar CSV de selección espacial';
    endAction('Consulta espacial terminada.');
  }

  function downloadCSV() {
    var entities = spatialQueryActive ? spatialSelection.filter(function (item) { return passesDataFilters(item.feature); }) : (function () { var f = filteredEntities(); return f.parcels.map(function (feature) { return { feature: feature, kind: 'parcel' }; }).concat(f.buildings.map(function (feature) { return { feature: feature, kind: 'building' }; })); }());
    var keys = [];
    entities.forEach(function (item) { Object.keys(item.feature.properties || {}).forEach(function (key) { if (keys.indexOf(key) < 0) keys.push(key); }); });
    var columns = ['tipo_entidad'].concat(keys);
    function quote(value) { return '"' + String(value == null ? '' : value).replace(/"/g, '""') + '"'; }
    var rows = [columns.map(quote).join(';')];
    entities.forEach(function (item) { var p = item.feature.properties || {}; rows.push([item.kind === 'parcel' ? 'Predio' : 'Construcción'].concat(keys.map(function (key) { return p[key]; })).map(quote).join(';')); });
    var blob = new Blob(['\uFEFF' + rows.join('\r\n')], { type: 'text/csv;charset=utf-8' });
    var url = URL.createObjectURL(blob); var anchor = document.createElement('a'); anchor.href = url; anchor.download = 'geovisor-manrique-resultados.csv'; anchor.click(); URL.revokeObjectURL(url);
  }

  document.getElementById('export-filtered').addEventListener('click', downloadCSV);
  document.getElementById('print-map').addEventListener('click', function () { window.print(); });
  window.addEventListener('beforeprint', function () {
    var active = Array.from(layerList.querySelectorAll('.layer-item input:checked')).map(function (input) {
      var name = input.closest('.layer-item').querySelector('label').textContent;
      var layer = overlays[name];
      return layer && layer._sourcePath ? name + ' (' + layer._sourcePath + ')' : name;
    });
    document.querySelector('.print-heading span').textContent = 'Capas visibles: ' + active.join(' · ') + ' · Escala y atribución cartográfica incluidas';
  });
  document.getElementById('inspector-close').addEventListener('click', function () { document.getElementById('feature-inspector').hidden = true; });
  document.getElementById('inspector-zoom').addEventListener('click', function () { var bounds = getLayerBounds(selectedInspectorLayer); if (bounds) map.fitBounds(bounds, { padding: [40, 40], maxZoom: 18 }); });

  map.on('click', function (event) {
    if (!activeAction) return;
    if (activeAction.kind === 'draw' && activeAction.type === 'marker') {
      vertices = [event.latlng];
      finishAction();
      return;
    }
    addVertex(event.latlng);
  });
  map.on('mousemove', function (event) {
    document.getElementById('coordinates').textContent = event.latlng.lat.toFixed(6) + '°, ' + event.latlng.lng.toFixed(6) + '°';
  });
  map.on('mouseout', function () { document.getElementById('coordinates').textContent = 'Mueve el cursor sobre el mapa'; });
  map.on('zoomend', updateZoom);
  function updateZoom() { document.getElementById('zoom-level').textContent = map.getZoom().toFixed(1); }
  updateZoom();

  document.querySelectorAll('[data-draw]').forEach(function (button) {
    button.addEventListener('click', function () { startAction('draw', button.dataset.draw); });
  });
  document.querySelectorAll('[data-measure]').forEach(function (button) {
    button.addEventListener('click', function () { startAction('measure', button.dataset.measure); });
  });
  finishButton.addEventListener('click', finishAction);
  cancelButton.addEventListener('click', function () { endAction('Acción cancelada.'); });
  undoButton.addEventListener('click', function () {
    if (!vertices.length) return;
    vertices.pop();
    var marker = vertexMarkers.pop();
    if (marker) map.removeLayer(marker);
    updateActionButtons();
    if (activeAction.kind === 'measure') updateMeasurementPreview(); else updateDrawingPreview();
  });
  map.on('dblclick', function (event) {
    if (!activeAction) return;
    if (activeAction.kind === 'measure') {
      L.DomEvent.stop(event.originalEvent);
      finishAction();
    }
  });
  document.getElementById('zoom-in').addEventListener('click', function () { map.zoomIn(); });
  document.getElementById('zoom-out').addEventListener('click', function () { map.zoomOut(); });
  document.getElementById('reset-view').addEventListener('click', function () { map.setView(initialCenter, initialZoom); setBearing(0); });
  document.getElementById('rotate-left').addEventListener('click', function () { setBearing(bearing - 15); });
  document.getElementById('rotate-right').addEventListener('click', function () { setBearing(bearing + 15); });
  document.querySelectorAll('[data-map-nav]').forEach(function (button) {
    button.addEventListener('click', function () {
      var action = button.dataset.mapNav;
      if (action === 'zoom-in') map.zoomIn();
      else if (action === 'zoom-out') map.zoomOut();
      else if (action === 'home') { map.setView(initialCenter, initialZoom); setBearing(0); }
      else if (action === 'north') setBearing(0);
      else if (action === 'rotate-left') setBearing(bearing - 15);
      else if (action === 'rotate-right') setBearing(bearing + 15);
    });
  });
  function syncBearingIndicator() {
    if (typeof map.getBearing === 'function') bearing = ((map.getBearing() % 360) + 360) % 360;
    document.getElementById('bearing-label').textContent = 'N · ' + Math.round(bearing) + '°';
    var compassArrow = document.querySelector('.map-compass-arrow');
    if (compassArrow) compassArrow.style.transform = 'rotate(' + (-bearing) + 'deg)';
  }

  function setBearing(value) {
    if (typeof map.setBearing !== 'function') {
      console.error('No se cargó el complemento de rotación de Leaflet.');
      return;
    }
    bearing = ((value % 360) + 360) % 360;
    map.setBearing(bearing);
    syncBearingIndicator();
  }
  map.on('rotate', syncBearingIndicator);
  document.getElementById('clear-drawings').addEventListener('click', function () {
    drawings.clearLayers();
    measurementLayer.clearLayers();
    document.getElementById('measure-result').innerHTML = '<span class="result-dot"></span><span>El resultado aparecerá aquí</span>';
    endAction('Geometrías y mediciones borradas.');
  });

  map.whenReady(function () { window.setTimeout(function () { map.invalidateSize(); }, 0); });
}());
