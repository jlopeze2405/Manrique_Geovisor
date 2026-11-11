(function () {
  'use strict';

  var initialCenter;
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
  var map = L.map('map', { zoomControl: false, doubleClickZoom: true });
  map.fitBounds(manriqueImageBounds, { padding: [30, 30], maxZoom: 13, animate: false });
  initialCenter = map.getCenter(); initialZoom = map.getZoom();
  var userChangedView = false;
  var sharedViewParams = new URLSearchParams(window.location.search);
  var sharedLayerNames = new Set((sharedViewParams.get('capas') || '').split('|').filter(Boolean));
  var sharedViewRequested = sharedViewParams.get('vista') === '1';
  if (sharedViewRequested) {
    var sharedLat = Number(sharedViewParams.get('lat'));
    var sharedLng = Number(sharedViewParams.get('lng'));
    var sharedZoom = Number(sharedViewParams.get('z'));
    if (Number.isFinite(sharedLat) && Math.abs(sharedLat) <= 90 && Number.isFinite(sharedLng) && Math.abs(sharedLng) <= 180 && Number.isFinite(sharedZoom)) {
      map.setView([sharedLat, sharedLng], Math.max(3, Math.min(19, sharedZoom)), { animate: false });
      userChangedView = true;
    }
  }
  map.createPane('riskPane');
  map.getPane('riskPane').style.zIndex = 350;
  map.createPane('parcelPane');
  map.getPane('parcelPane').style.zIndex = 450;
  map.createPane('constructionPane');
  map.getPane('constructionPane').style.zIndex = 460;
  map.createPane('diagnosticPane');
  map.getPane('diagnosticPane').style.zIndex = 615;
  map.getPane('diagnosticPane').style.pointerEvents = 'none';
  map.createPane('landmarkPane');
  map.getPane('landmarkPane').style.zIndex = 640;
  map.createPane('printGridPane');
  map.getPane('printGridPane').style.zIndex = 625;
  map.createPane('printGridLabelPane');
  map.getPane('printGridLabelPane').style.zIndex = 680;
  map.getPane('printGridLabelPane').style.pointerEvents = 'none';
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
  L.control.scale({ imperial: false, metric: true, maxWidth: 180, position: 'bottomright' }).addTo(map);

  var overlays = {};
  var scaleLimitedLayers = [];
  var parcelFilterFeatures = [];
  var constructionFilterFeatures = [];
  var buildingDiagnosticFeaturesReady = false;
  var buildingDiagnosticSelectedFeature = null;
  var buildingDiagnosticHighlight = L.geoJSON(null, { pane: 'diagnosticPane', style: { color: '#0b7285', weight: 4, opacity: 1, fillColor: '#52cad5', fillOpacity: 0.2, dashArray: '7 4' } }).addTo(map);
  var neighborhoodFeatures = [];
  var riskZoneFeatures = [];
  var riskZonesReady = false;
  var riskZoneVersion = 0;
  var riskFilter = document.getElementById('risk-filter');
  var neighborhoodFilter = document.getElementById('neighborhood-filter');
  var baseLayers = [imagery, streets];
  var drawings = L.featureGroup().addTo(map);
  var editHandles = L.layerGroup().addTo(map);
  var drawingRecords = [];
  var nextDrawingId = 1;
  var activeEdit = null;
  var drawingHistory = document.getElementById('drawing-history');
  var measurementLayer = L.layerGroup().addTo(map);
  var activeAction = null;
  var mapDraggingBeforeAction = null;
  var vertices = [];
  var previewLine = null;
  var previewShape = null;
  var vertexMarkers = [];
  var layerList = document.getElementById('layer-list');
  var activeLayerLegend = document.getElementById('active-layer-legend');
  function renderActiveLayerLegend() {
    if (!activeLayerLegend) return;
    activeLayerLegend.textContent = '';
    var entries = Array.from(layerList.querySelectorAll('.layer-control-entry')).filter(function (entry) {
      var input = entry.querySelector('input');
      return input && input.checked;
    });
    if (!entries.length) {
      var empty = document.createElement('p'); empty.textContent = 'No hay capas visibles.'; activeLayerLegend.appendChild(empty); return;
    }
    entries.forEach(function (entry) {
      var row = document.createElement('div'); row.className = 'map-layer-legend-item';
      var swatch = entry.querySelector('.layer-swatch');
      var symbol = document.createElement('i');
      symbol.style.setProperty('--layer-color', swatch ? getComputedStyle(swatch).getPropertyValue('--swatch').trim() || '#78879a' : '#1976d2');
      var label = entry.querySelector('.layer-item label');
      var text = document.createElement('span'); text.textContent = label ? label.textContent : 'Capa';
      row.append(symbol, text); activeLayerLegend.appendChild(row);
    });
  }
  var finishButton = document.getElementById('finish-draw');
  var cancelButton = document.getElementById('cancel-draw');
  var undoButton = document.getElementById('undo-draw');
  var hint = document.getElementById('draw-hint');
  var layerControlIndex = 0;
  var draggedLayerEntry = null;
  var layerGroups = {};
  var layerGroupTabs = {};
  var layerGroupTabList = null;
  var layerGroupPanelList = null;
  var entityFilter = document.getElementById('entity-filter');
  var spatialSelection = [];
  var spatialQueryActive = false;
  var lastSpatialQueryGeometry = null;
  var selectedInspectorLayer = null;
  var metadataDialog = null;

  function activateWorkspaceTab(key, focusTab) {
    var tabs = Array.from(document.querySelectorAll('[data-workspace-tab]'));
    var panels = Array.from(document.querySelectorAll('[data-workspace-panel]'));
    tabs.forEach(function (tab) {
      var active = tab.dataset.workspaceTab === key;
      tab.classList.toggle('active', active);
      tab.setAttribute('aria-selected', active ? 'true' : 'false');
      tab.tabIndex = active ? 0 : -1;
      if (active && focusTab) tab.focus();
    });
    panels.forEach(function (panel) {
      var active = panel.dataset.workspacePanel === key;
      panel.hidden = !active;
      panel.classList.toggle('active', active);
    });
  }

  document.querySelectorAll('[data-workspace-tab]').forEach(function (tab) {
    tab.addEventListener('click', function () { activateWorkspaceTab(tab.dataset.workspaceTab, false); });
    tab.addEventListener('keydown', function (event) {
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight' && event.key !== 'Home' && event.key !== 'End') return;
      event.preventDefault();
      var tabs = Array.from(document.querySelectorAll('[data-workspace-tab]'));
      var current = tabs.indexOf(tab);
      var next = event.key === 'Home' ? 0 : (event.key === 'End' ? tabs.length - 1 : (current + (event.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length);
      activateWorkspaceTab(tabs[next].dataset.workspaceTab, true);
    });
  });

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
      [/Buffer/i, '2026-05-17', 'EPSG:9377'], [/Comunas/i, '2026-09-18', 'EPSG:9377'],
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
    if (name.indexOf('[Temporal] ') === 0) return 'Capas temporales';
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
    if (typeof layer.eachLayer === 'function') {
      layer.eachLayer(function (child) { applyOpacityToLayerTree(child, value); });
      return;
    }
    if (typeof layer.setOpacity === 'function') {
      layer.setOpacity(value);
      return;
    }
    if (layer._path) {
      layer._path.style.opacity = String(value);
      layer._path.style.filter = '';
    }
  }

  function applyThemeStyle(layer, color, weight, restore) {
    if (!layer) return;
    if (typeof layer.eachLayer === 'function') { layer.eachLayer(function (child) { applyThemeStyle(child, color, weight, restore); }); return; }
    if (typeof layer.setStyle !== 'function') return;
    if (restore && layer._originalFeatureStyle) layer.setStyle(layer._originalFeatureStyle);
    else layer.setStyle({ color: color, fillColor: color, weight: weight });
  }

  function applyLayerWeight(layer, weight) {
    if (!layer) return;
    if (typeof layer.eachLayer === 'function') { layer.eachLayer(function (child) { applyLayerWeight(child, weight); }); return; }
    if (typeof layer.setStyle === 'function') layer.setStyle({ weight: weight });
  }

  function applyLayerStackOrder(section) {
    Array.from(section.querySelectorAll(':scope > .layer-control-entry')).forEach(function (entry, index) {
      var layer = entry._mapLayer;
      if (!layer) return;
      var panes = new Set();
      function collect(current) {
        if (current.eachLayer) current.eachLayer(collect);
        else if (current.options && current.options.pane) panes.add(current.options.pane);
        else panes.add('overlayPane');
        if (current.bringToFront) current.bringToFront();
      }
      collect(layer);
      panes.forEach(function (paneName) { var pane = map.getPane(paneName); if (pane) pane.style.zIndex = String(420 + index); });
    });
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
  function addLayerControl(name, layer, color, checked, base, styleEditable) {
    var row = document.createElement('div');
    row.className = 'layer-item';
    var input = document.createElement('input');
    input.type = base ? 'radio' : 'checkbox';
    input.name = base ? 'base-layer' : 'overlay-' + name;
    input.checked = checked;
    if (sharedViewRequested && base) input.checked = sharedViewParams.get('base') === name;
    if (sharedViewRequested && !base) input.checked = sharedLayerNames.has(name);
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
        var groupSection = row.closest('.layer-group');
        var groupInputs = Array.from(groupSection.querySelectorAll('.layer-item input[type="checkbox"]'));
        var groupToggle = groupSection.querySelector('.layer-group-heading button');
        if (groupToggle && groupInputs.length) groupToggle.textContent = groupInputs.some(function (item) { return !item.checked; }) ? 'Activar grupo' : 'Apagar grupo';
      }
    });
    input.addEventListener('change', renderActiveLayerLegend);
    if (sharedViewRequested && input.checked) {
      if (base) { baseLayers.forEach(function (baseLayer) { if (map.hasLayer(baseLayer)) map.removeLayer(baseLayer); }); layer.addTo(map); }
      else layer.addTo(map);
    }
    if (extentButton) row.append(input, swatch, label, state, extentButton, row._infoButton);
    else row.append(input, swatch, label, state);
    var parent = layerGroupContainer(name, base);
    var entry = document.createElement('div'); entry.className = 'layer-control-entry'; entry._mapLayer = layer;
    if (!base) {
      entry.draggable = true; entry.title = 'Arrastra para cambiar el orden de dibujo';
      entry.addEventListener('dragstart', function (event) { if (event.target.closest('button,input')) { event.preventDefault(); return; } draggedLayerEntry = entry; event.dataTransfer.effectAllowed = 'move'; });
      entry.addEventListener('dragover', function (event) { if (draggedLayerEntry && draggedLayerEntry !== entry) { event.preventDefault(); event.dataTransfer.dropEffect = 'move'; } });
      entry.addEventListener('drop', function (event) {
        event.preventDefault(); if (!draggedLayerEntry || draggedLayerEntry === entry) return;
        var bounds = entry.getBoundingClientRect();
        parent.insertBefore(draggedLayerEntry, event.clientY < bounds.top + bounds.height / 2 ? entry : entry.nextSibling);
        applyLayerStackOrder(parent);
      });
      entry.addEventListener('dragend', function () { draggedLayerEntry = null; });
    }
    entry.appendChild(row);
    parent.appendChild(entry);
    renderActiveLayerLegend();
    if (!base) {
      var opacityWrap = document.createElement('label'); opacityWrap.className = 'layer-opacity';
      opacityWrap.appendChild(document.createTextNode('Opacidad'));
      var opacity = document.createElement('input'); opacity.type = 'range'; opacity.min = '20'; opacity.max = '100'; opacity.value = '100'; opacity.setAttribute('aria-label', 'Opacidad de ' + name);
      var opacityValue = document.createElement('output'); opacityValue.textContent = '100%'; opacityValue.setAttribute('aria-hidden', 'true');
      row._opacityInput = opacity;
      opacity.addEventListener('input', function () {
        var value = Number(opacity.value) / 100;
        layer._uiOpacity = value;
        opacityValue.textContent = opacity.value + '%';
        applyOpacityToLayerTree(layer, value);
      });
      opacityWrap.append(opacity, opacityValue); entry.appendChild(opacityWrap);
      var styleWrap = document.createElement('div'); styleWrap.className = 'layer-style';
      var colorInput = document.createElement('input'); colorInput.type = 'color'; colorInput.value = color; colorInput.setAttribute('aria-label', 'Color de ' + name);
      var canChangeColor = styleEditable !== false;
      colorInput.disabled = !canChangeColor;
      var colorLockNote = document.createElement('small');
      if (!canChangeColor) colorLockNote.textContent = 'Color por riesgo';
      if (!canChangeColor) colorInput.title = 'Color definido por la categoría de riesgo';
      var weightInput = document.createElement('input'); weightInput.type = 'range'; weightInput.min = '0.5'; weightInput.max = '6'; weightInput.step = '0.5'; weightInput.value = '1.5'; weightInput.setAttribute('aria-label', 'Grosor de ' + name);
      var resetStyle = document.createElement('button'); resetStyle.type = 'button'; resetStyle.textContent = 'Restaurar'; resetStyle.title = 'Restaurar simbología original';
      function changeStyle() {
        if (!canChangeColor) {
          entry._customWeight = true;
          layer._uiWeight = Number(weightInput.value);
          applyLayerWeight(layer, Number(weightInput.value));
          return;
        }
        entry._customStyle = true;
        layer._uiStyle = { color: colorInput.value, weight: Number(weightInput.value) };
        applyThemeStyle(layer, colorInput.value, Number(weightInput.value), false);
        swatch.style.setProperty('--swatch', colorInput.value);
        renderActiveLayerLegend();
      }
      colorInput.addEventListener('input', changeStyle); weightInput.addEventListener('input', changeStyle);
      resetStyle.addEventListener('click', function (event) {
        event.preventDefault(); event.stopPropagation(); colorInput.value = color; weightInput.value = '1.5';
        entry._customStyle = false; entry._customWeight = false; layer._uiStyle = null; layer._uiWeight = null; swatch.style.setProperty('--swatch', color); applyThemeStyle(layer, color, 1.5, true);
      });
      styleWrap.append('Simbología ', colorInput, weightInput, resetStyle); entry.appendChild(styleWrap);
      if (!canChangeColor) styleWrap.appendChild(colorLockNote);
      row._colorInput = colorInput; row._weightInput = weightInput;
    }
  }

  addLayerControl('Imagen satelital', imagery, '#1976d2', true, true);
  addLayerControl('Mapa de calles', streets, '#0b2e59', false, true);

  function loadGeoTiffOverlay(path, name, options, color, initiallyVisible, isBase) {
    options = options || {};
    var group = L.layerGroup();
    overlays[name] = group;
    addLayerControl(name, group, color, initiallyVisible, Boolean(isBase));
    var controlInput = Array.from(layerList.querySelectorAll('.layer-item')).find(function (item) { return item.querySelector('label').textContent === name; });
    var shouldBeVisible = sharedViewRequested ? Boolean(controlInput && controlInput.querySelector('input').checked) : initiallyVisible;
    if (isBase) baseLayers.push(group);
    if (shouldBeVisible) group.addTo(map);

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
      if (group._uiOpacity != null) applyOpacityToLayerTree(raster, group._uiOpacity);
      if (isBase && shouldBeVisible) {
        baseLayers.forEach(function (baseLayer) { if (baseLayer !== group && map.hasLayer(baseLayer)) map.removeLayer(baseLayer); });
        group.addTo(map);
      }
      var layerRow = Array.from(layerList.querySelectorAll('.layer-item')).find(function (item) {
        return item.querySelector('label').textContent === name;
      });
      if (layerRow) layerRow.querySelector('.layer-state').textContent = layerRow.querySelector('input').checked ? 'ON' : 'OFF';
      if (shouldBeVisible && map.hasLayer(group) && !userChangedView) {
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

  var ortofotoMedellin = L.tileLayer('https://www.medellin.gov.co/servidormapas/rest/services/ServiciosCiudad/IMAGEN_WEBM_2024/MapServer/tile/{z}/{y}/{x}', {
    minZoom: 0,
    maxZoom: 19,
    maxNativeZoom: 19,
    tileSize: 256,
    updateWhenIdle: true,
    updateWhenZooming: false,
    keepBuffer: 2,
    detectRetina: false,
    attribution: 'Ortofoto Medellín 2025 · Alcaldía de Medellín (teselas precalculadas)'
  });
  baseLayers.push(ortofotoMedellin);
  addLayerControl('Ortofoto Medellín 2025 (carga optimizada)', ortofotoMedellin, '#2f855a', true, true);
  baseLayers.forEach(function (baseLayer) { if (baseLayer !== ortofotoMedellin && map.hasLayer(baseLayer)) map.removeLayer(baseLayer); });
  ortofotoMedellin.addTo(map);

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
  var attributeSourceFeatures = [];
  var attributeFocusedFeature = null;
  var attributePage = 0;
  var attributePageSize = 25;
  var attributeSort = { key: '', direction: 1 };
  var attributeSelected = new Set();
  var attributeTitle = document.getElementById('attribute-table-title');
  var attributeSearch = document.getElementById('attribute-table-search');
  var attributeHead = document.getElementById('attribute-table-head');
  var attributeBody = document.getElementById('attribute-table-body');
  var attributePageLabel = document.getElementById('attribute-table-page');
  var attributePanel = document.getElementById('attribute-table-panel');

  var selectedFeatureLayer = null;
  var selectionToolActive = false;
  var selectionMapDraggingBefore = null;
  function inspectorValue(label, value, host) {
    if (value == null || String(value).trim() === '') return;
    var row = document.createElement('div'); row.className = 'inspector-row';
    var key = document.createElement('span'); key.textContent = label;
    var text = document.createElement('strong'); text.textContent = String(value);
    row.append(key, text); host.appendChild(row);
  }

  function showFeatureInspector(layer) {
    if (!layer || !layer.feature) return;
    var feature = layer.feature, properties = feature.properties || {};
    var isParcel = !!layer._isParcelLayer;
    var isConstruction = !!layer._isConstructionLayer;
    var panel = document.getElementById('feature-inspector');
    var content = document.getElementById('inspector-content');
    content.textContent = '';
    document.getElementById('inspector-title').textContent = isParcel ? 'Detalle del predio' : (isConstruction ? 'Detalle de construccion' : 'Detalle de entidad');
    var id = propertyValue(properties, ['fid_', 'id', 'objectid', 'numero_pre', 'matricula_', 'id_constru', 'cbml', 'numero_edi']);
    document.getElementById('inspector-subtitle').textContent = (layer._featureLayerName || 'Capa seleccionada') + (id ? ' · Identificador: ' + id : '');
    if (isParcel || isConstruction) inspectorValue('Barrio por ubicacion', neighborhoodForFeature(feature) || 'Sin barrio asignado por los poligonos disponibles', content);
    Object.keys(properties).forEach(function (key) {
      var value = properties[key];
      if (value && typeof value === 'object') {
        try { value = JSON.stringify(value); } catch (error) { value = String(value); }
      }
      inspectorValue(key, value == null || value === '' ? '—' : value, content);
    });
    var shareButton = document.getElementById('inspector-share');
    if (shareButton) shareButton.hidden = !(isParcel || isConstruction);
    selectedInspectorLayer = layer;
    panel.hidden = false;
  }
  function selectFeatureLayer(layer) {
    if (selectedFeatureLayer && selectedFeatureLayer !== layer && selectedFeatureLayer._originalFeatureStyle) {
      selectedFeatureLayer.setStyle(selectedFeatureLayer._originalFeatureStyle);
    }
    selectedFeatureLayer = layer;
    attributeFocusedFeature = layer && layer.feature || null;
    if (layer && layer.feature) showFeatureInspector(layer);
    if (layer && typeof layer.setStyle === 'function') {
      layer.setStyle({ color: '#1976d2', weight: 4, opacity: 1, fillColor: '#1976d2', fillOpacity: 0, radius: 8 });
    }
    if (attributePanel && !attributePanel.hidden) renderAttributeTable();
  }

  function clearFeatureSelection() {
    if (selectedFeatureLayer && selectedFeatureLayer._originalFeatureStyle && selectedFeatureLayer.setStyle) selectedFeatureLayer.setStyle(selectedFeatureLayer._originalFeatureStyle);
    selectedFeatureLayer = null; selectedInspectorLayer = null; attributeFocusedFeature = null;
    var inspector = document.getElementById('feature-inspector');
    if (inspector) inspector.hidden = true;
    if (attributePanel && !attributePanel.hidden) renderAttributeTable();
  }

  function setSelectionToolActive(active) {
    selectionToolActive = !!active;
    var button = document.getElementById('toggle-feature-selection');
    if (button) {
      button.setAttribute('aria-pressed', String(selectionToolActive));
      button.classList.toggle('active', selectionToolActive);
      button.title = selectionToolActive ? 'Desactivar la selección de entidades' : 'Activar la selección de entidades';
      button.setAttribute('aria-label', button.title);
      button.querySelector('span').textContent = selectionToolActive ? 'CANCELAR SELECCIÓN' : 'SELECCIONAR ENTIDAD';
    }
    map.getContainer().style.cursor = selectionToolActive ? 'crosshair' : '';
    map.getContainer().classList.toggle('selection-active', selectionToolActive);
    clearFeatureSelection();
    if (selectionToolActive) {
      selectionMapDraggingBefore = map.dragging.enabled();
      map.dragging.disable();
    } else if (selectionMapDraggingBefore !== null) {
      if (selectionMapDraggingBefore) map.dragging.enable(); else map.dragging.disable();
      selectionMapDraggingBefore = null;
    }
  }

  function neighborhoodForFeature(feature) {
    if (feature._neighborhoodLabel != null && neighborhoodFeatures.length) return feature._neighborhoodLabel;
    var geometry = feature && feature.geometry;
    if (!geometry || !neighborhoodFeatures.length) return '';
    var point = featureAnchor(feature);
    var pointIsInterior = point && pointInGeometry(point, geometry);
    var found = pointIsInterior ? neighborhoodFeatures.find(function (item) { return pointInGeometry(point, item.geometry); }) : null;

    // A polygon centroid can fall outside a concave/multipart feature. In that
    // case, classify it from sampled points along its exterior boundary instead.
    if (!found) {
      var bounds = featureGeometryBounds(feature);
      var samples = [];
      var polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : (geometry.type === 'MultiPolygon' ? geometry.coordinates : []);
      polygons.forEach(function (polygon) {
        var ring = polygon && polygon[0];
        if (!ring || ring.length < 2) return;
        var stride = Math.max(1, Math.ceil((ring.length - 1) / 160));
        for (var i = 0; i < ring.length - 1; i += stride) {
          var end = Math.min(i + stride, ring.length - 1);
          var a = ring[i], b = ring[end];
          samples.push(a, [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]);
        }
      });
      if (pointIsInterior) samples.push(point);
      var bestScore = 0;
      neighborhoodFeatures.forEach(function (item) {
        if (!boundsOverlap(bounds, featureGeometryBounds(item))) return;
        var score = 0;
        samples.forEach(function (sample) { if (pointInGeometry(sample, item.geometry)) score++; });
        if (pointIsInterior && pointInGeometry(point, item.geometry)) score += samples.length + 1;
        if (score > bestScore) { bestScore = score; found = item; }
      });
    }
    var label = found ? String(propertyValue(found.properties, ['nombre', 'label']) || '') : '';
    feature._neighborhoodLabel = label;
    return label;
  }

  function renderAttributeTable() {
    var query = attributeSearch.value.trim().toLocaleLowerCase('es');
    var currentFeatures = attributeSourceFeatures.filter(function (feature) { return !feature._entityKind || passesDataFilters(feature); });
    attributeFeatures = currentFeatures;
    var filtered = currentFeatures.filter(function (feature) {
      return Object.keys(feature.properties || {}).some(function (key) {
        return String(feature.properties[key] == null ? '' : feature.properties[key]).toLocaleLowerCase('es').indexOf(query) !== -1;
      });
    });
    var keys = [];
    filtered.forEach(function (feature) {
      Object.keys(feature.properties || {}).forEach(function (key) { if (keys.indexOf(key) === -1) keys.push(key); });
    });
    if (attributeSort.key) filtered.sort(function (a, b) {
      var av = a.properties && a.properties[attributeSort.key], bv = b.properties && b.properties[attributeSort.key];
      var an = Number(av), bn = Number(bv);
      var compare = av != null && bv != null && String(av).trim() !== '' && String(bv).trim() !== '' && Number.isFinite(an) && Number.isFinite(bn)
        ? an - bn : String(av == null ? '' : av).localeCompare(String(bv == null ? '' : bv), 'es', { numeric: true, sensitivity: 'base' });
      return compare * attributeSort.direction;
    });
    attributeHead.textContent = '';
    var headerRow = document.createElement('tr');
    var selectHeader = document.createElement('th'); selectHeader.textContent = '✓'; selectHeader.setAttribute('aria-label', 'Selección'); headerRow.appendChild(selectHeader);
    keys.forEach(function (key) { var th = document.createElement('th'); var sort = document.createElement('button'); sort.type = 'button'; sort.className = 'table-sort-button'; sort.textContent = key + (attributeSort.key === key ? (attributeSort.direction > 0 ? ' ↑' : ' ↓') : ''); sort.addEventListener('click', function () { attributeSort = { key: key, direction: attributeSort.key === key ? -attributeSort.direction : 1 }; renderAttributeTable(); }); th.appendChild(sort); headerRow.appendChild(th); });
    attributeHead.appendChild(headerRow);
    attributeBody.textContent = '';
    var pageCount = Math.max(1, Math.ceil(filtered.length / attributePageSize));
    attributePage = Math.min(attributePage, pageCount - 1);
    filtered.slice(attributePage * attributePageSize, (attributePage + 1) * attributePageSize).forEach(function (feature, index) {
      var tr = document.createElement('tr');
      tr.title = 'Acercar a esta entidad';
      tr.classList.toggle('selected', attributeSelected.has(feature) || feature === attributeFocusedFeature);
      var selectCell = document.createElement('td'); var checkbox = document.createElement('input'); checkbox.type = 'checkbox'; checkbox.checked = attributeSelected.has(feature); checkbox.setAttribute('aria-label', 'Seleccionar registro ' + (index + 1));
      checkbox.addEventListener('click', function (event) { event.stopPropagation(); });
      checkbox.addEventListener('change', function () { if (checkbox.checked) attributeSelected.add(feature); else attributeSelected.delete(feature); updateAttributeSelectionCount(); renderAttributeTable(); });
      selectCell.appendChild(checkbox); tr.appendChild(selectCell);
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
    if (!filtered.length) { var emptyRow = document.createElement('tr'); var emptyCell = document.createElement('td'); emptyCell.colSpan = keys.length + 1; emptyCell.textContent = 'No hay registros para mostrar con los filtros actuales.'; emptyRow.appendChild(emptyCell); attributeBody.appendChild(emptyRow); }
    attributePageLabel.textContent = (filtered.length ? attributePage * attributePageSize + 1 : 0) + '–' + Math.min((attributePage + 1) * attributePageSize, filtered.length) + ' de ' + filtered.length;
    document.getElementById('attribute-table-prev').disabled = attributePage <= 0;
    document.getElementById('attribute-table-next').disabled = attributePage >= pageCount - 1;
  }

  function showAttributeTable(name, features) {
    attributeTitle.textContent = 'Tabla de atributos · ' + name;
    attributeSourceFeatures = features;
    attributeFeatures = features;
    attributePage = 0;
    attributeSelected = new Set();
    attributeSort = { key: '', direction: 1 };
    attributeSearch.value = '';
    renderAttributeTable();
    attributePanel.hidden = false;
  }

  function updateAttributeSelectionCount() {
    var count = document.getElementById('attribute-selection-count');
    var button = document.getElementById('attribute-export-selection');
    if (count) count.textContent = attributeSelected.size.toLocaleString('es') + ' seleccionados';
    if (button) button.disabled = attributeSelected.size === 0;
  }

  function downloadEntitiesCSV(entities, filename) {
    var outputCrs = document.getElementById('output-crs').value;
    var keys = [];
    entities.forEach(function (feature) { Object.keys(feature.properties || {}).forEach(function (key) { if (keys.indexOf(key) < 0) keys.push(key); }); });
    var extra = ['x_salida_epsg_' + outputCrs, 'y_salida_epsg_' + outputCrs, 'latitud_wgs84', 'longitud_wgs84'];
    var quote = function (value) { return '"' + String(value == null ? '' : value).replace(/"/g, '""') + '"'; };
    var rows = [['tipo_entidad'].concat(keys, extra).map(quote).join(';')];
    entities.forEach(function (feature) {
      var anchor = featureAnchor(feature), xy = exportCoordinate(anchor, outputCrs);
      var kind = feature._entityKind === 'parcel' ? 'Predio' : (feature._entityKind === 'building' ? 'Construccion' : 'Geometria');
      rows.push([kind].concat(keys.map(function (key) { return feature.properties && feature.properties[key]; }), [xy[0], xy[1], anchor && anchor[1], anchor && anchor[0]]).map(quote).join(';'));
    });
    var blob = new Blob(['\uFEFF' + rows.join('\r\n')], { type: 'text/csv;charset=utf-8' });
    downloadBlob(blob, filename);
  }

  document.getElementById('attribute-export-selection').addEventListener('click', function () { downloadEntitiesCSV(Array.from(attributeSelected).filter(function (feature) { return !feature._entityKind || passesDataFilters(feature); }), 'geovisor-manrique-seleccion.csv'); });

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

  var directEntityLinkResolved = false;
  function tryResolveDirectEntityLink() {
    if (directEntityLinkResolved) return;
    var params = new URLSearchParams(window.location.search);
    var parcelId = params.get('predio');
    var buildingId = params.get('construccion') || params.get('construcción');
    if (!parcelId && !buildingId) return;
    var requested = parcelId || buildingId;
    var features = parcelId ? parcelFilterFeatures : constructionFilterFeatures;
    if (!features.length) return;
    var aliases = parcelId ? ['numero_pre', 'matricula_', 'fid_', 'id_predial'] : ['id_constru', 'cbml', 'numero_edi'];
    var target = features.find(function (feature) { return aliases.some(function (key) { var value = propertyValue(feature.properties, [key]); return value !== '' && normalizedText(value) === normalizedText(requested); }); });
    if (!target || !target._leafletLayer) return;
    directEntityLinkResolved = true;
    if (riskFilter) riskFilter.value = 'all'; if (neighborhoodFilter) neighborhoodFilter.value = 'all'; if (entityFilter) entityFilter.value = '';
    applyDataFilters();
    Object.keys(overlays).forEach(function (name) {
      var group = overlays[name];
      if (group.featureData !== features) return;
      if (!map.hasLayer(group)) group.addTo(map);
      var control = Array.from(layerList.querySelectorAll('.layer-item')).find(function (row) { return row.querySelector('label').textContent === name; });
      if (control) { control.querySelector('input').checked = true; control.querySelector('.layer-state').textContent = 'ON'; }
    });
    updateScaleLimitedLayers();
    var layer = target._leafletLayer; selectFeatureLayer(layer);
    var bounds = getLayerBounds(layer); if (bounds) map.fitBounds(bounds, { padding: [40, 40], maxZoom: 18, animate: false });
    if (layer.openPopup) layer.openPopup();
    document.getElementById('spatial-result').textContent = (parcelId ? 'Predio' : 'Construcción') + ' abierto desde el enlace de consulta.';
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

  function geometryWithinGeometry(featureGeometry, containerGeometry) {
    var vertices = geometryVertices(featureGeometry);
    if (!vertices.length || !vertices.every(function (point) { return pointInOrOnGeometry(point, containerGeometry); })) return false;
    var containerRings = geometryRings(containerGeometry);
    return geometryPaths(featureGeometry).every(function (ring) {
      for (var i = 1; i < ring.length; i++) {
        var a = ring[i - 1], b = ring[i];
        var cuts = [0, 1];
        containerRings.forEach(function (boundary) { for (var j = 1; j < boundary.length; j++) { var t = segmentIntersectionParameter(a, b, boundary[j - 1], boundary[j]); if (t != null) cuts.push(t); } });
        cuts.sort(function (x, y) { return x - y; });
        for (var k = 1; k < cuts.length; k++) {
          if (cuts[k] - cuts[k - 1] < 1e-12) continue;
          var fraction = (cuts[k] + cuts[k - 1]) / 2;
          var sample = [a[0] + (b[0] - a[0]) * fraction, a[1] + (b[1] - a[1]) * fraction];
          if (!pointInOrOnGeometry(sample, containerGeometry)) return false;
        }
      }
      return true;
    });
  }

  function pointInOrOnGeometry(point, geometry) {
    if (pointInGeometry(point, geometry)) return true;
    return geometryRings(geometry).some(function (ring) {
      for (var i = 1; i < ring.length; i++) {
        var a = ring[i - 1], b = ring[i];
        var cross = (point[0] - a[0]) * (b[1] - a[1]) - (point[1] - a[1]) * (b[0] - a[0]);
        if (Math.abs(cross) <= 1e-10 && point[0] >= Math.min(a[0], b[0]) - 1e-10 && point[0] <= Math.max(a[0], b[0]) + 1e-10 && point[1] >= Math.min(a[1], b[1]) - 1e-10 && point[1] <= Math.max(a[1], b[1]) + 1e-10) return true;
      }
      return false;
    });
  }

  function segmentIntersectionParameter(a, b, c, d) {
    var rx = b[0] - a[0], ry = b[1] - a[1], sx = d[0] - c[0], sy = d[1] - c[1];
    var denominator = rx * sy - ry * sx;
    if (Math.abs(denominator) < 1e-14) return null;
    var qx = c[0] - a[0], qy = c[1] - a[1];
    var t = (qx * sy - qy * sx) / denominator, u = (qx * ry - qy * rx) / denominator;
    return t >= -1e-10 && t <= 1 + 1e-10 && u >= -1e-10 && u <= 1 + 1e-10 ? Math.max(0, Math.min(1, t)) : null;
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

  function geometryPaths(geometry) {
    if (!geometry) return [];
    if (geometry.type === 'LineString') return [geometry.coordinates || []];
    if (geometry.type === 'MultiLineString') return geometry.coordinates || [];
    if (geometry.type === 'Polygon' || geometry.type === 'MultiPolygon') return geometryRings(geometry);
    if (geometry.type === 'GeometryCollection') return (geometry.geometries || []).reduce(function (all, item) { return all.concat(geometryPaths(item)); }, []);
    return [];
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
    return normalizedText(neighborhoodForFeature(feature)) === normalizedText(selected);
  }

  function passesDataFilters(feature) {
    var selectedRisk = riskFilter ? riskFilter.value : 'all';
    if (!matchesSelectedArea(feature)) return false;
    if (selectedRisk !== 'all' && riskGroup(feature.properties) !== selectedRisk) return false;
    var query = entityFilter ? normalizedText(entityFilter.value.trim()) : '';
    if (query) {
      var p = feature.properties || {};
      var ids = ['fid_', 'numero_pre', 'matricula_', 'id_constru', 'cbml', 'numero_edi', 'numero_mej'];
      if (!ids.some(function (field) { var value = propertyValue(p, [field]); return value !== '' && normalizedText(value).indexOf(query) !== -1; })) return false;
    }
    return true;
  }

  function filteredEntities() {
    return { parcels: parcelFilterFeatures.filter(passesDataFilters), buildings: constructionFilterFeatures.filter(passesDataFilters) };
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
      document.getElementById('spatial-result').textContent = 'Consulta espacial (' + (document.getElementById('spatial-relation').value === 'within' ? 'contenido' : 'intersección') + '): ' + visibleSpatial.filter(function (item) { return item.kind === 'building'; }).length.toLocaleString('es') + ' construcciones y ' + visibleSpatial.filter(function (item) { return item.kind === 'parcel'; }).length.toLocaleString('es') + ' predios después de aplicar los filtros.';
    }
    updateAreaStatistics();
    if (attributePanel && !attributePanel.hidden && attributeSourceFeatures.length) renderAttributeTable();
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
    if (scopeNode) {
      var scopeParts = [];
      if (selected !== 'all' && neighborhoodFilter) scopeParts.push('barrio: ' + neighborhoodFilter.options[neighborhoodFilter.selectedIndex].textContent);
      if (riskFilter && riskFilter.value !== 'all') scopeParts.push('riesgo: ' + riskFilter.options[riskFilter.selectedIndex].textContent);
      if (entityFilter && entityFilter.value.trim()) scopeParts.push('identificador: ' + entityFilter.value.trim());
      scopeNode.textContent = scopeParts.length ? 'Filtros activos · ' + scopeParts.join(' · ') : 'Área de estudio · sin filtros';
    }
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
    renderDistribution('neighborhood-distribution', entities, function (feature) { return neighborhoodForFeature(feature) || 'Sin barrio asignado'; });
  }

  if (riskFilter) riskFilter.addEventListener('change', applyDataFilters);
  if (neighborhoodFilter) neighborhoodFilter.addEventListener('change', applyDataFilters);
  if (entityFilter) entityFilter.addEventListener('input', applyDataFilters);

  var buildingDiagnosticForm = document.getElementById('building-diagnostic-form');
  var buildingDiagnosticInput = document.getElementById('building-diagnostic-cbml');
  var buildingDiagnosticStatus = document.getElementById('building-diagnostic-status');
  var buildingDiagnosticCandidates = document.getElementById('building-diagnostic-candidates');
  var buildingDiagnosticRecord = document.getElementById('building-diagnostic-record');
  var buildingDiagnosticSearchButton = document.getElementById('building-diagnostic-search');

  function setBuildingDiagnosticReady(features) {
    buildingDiagnosticFeaturesReady = true;
    if (buildingDiagnosticSearchButton) buildingDiagnosticSearchButton.disabled = false;
    if (buildingDiagnosticStatus) buildingDiagnosticStatus.textContent = 'Capa disponible: ' + features.length.toLocaleString('es') + ' construcciones. La búsqueda compara el CBML completo.';
  }

  function normalizeBuildingCbml(value) {
    var normalized = String(value == null ? '' : value).trim().replace(/\.0+$/, '');
    if (/^\d{1,11}$/.test(normalized)) return normalized.padStart(11, '0');
    if (/^\d+(?:\.\d+)?e[+-]?\d+$/i.test(normalized)) {
      var numeric = Number(normalized);
      if (Number.isSafeInteger(numeric) && numeric >= 0) return String(numeric).padStart(11, '0');
    }
    return normalized;
  }

  function buildingDiagnosticSourceValue(properties, aliases) {
    var value = propertyValue(properties, aliases);
    if (value == null || String(value).trim() === '' || String(value).trim() === '0') return '';
    return String(value).trim();
  }

  function appendBuildingDiagnosticAttribute(host, label, value) {
    if (value == null || String(value).trim() === '') return;
    var item = document.createElement('div'); item.className = 'diagnostic-attribute';
    var key = document.createElement('span'); key.textContent = label;
    var text = document.createElement('strong'); text.textContent = String(value);
    item.append(key, text); host.appendChild(item);
  }

  function focusBuildingDiagnosticFeature(feature) {
    if (!feature || !feature.geometry) return;
    buildingDiagnosticSelectedFeature = feature;
    buildingDiagnosticHighlight.clearLayers();
    buildingDiagnosticHighlight.addData({ type: 'Feature', properties: {}, geometry: feature.geometry });
    var bounds = feature._leafletLayer ? getLayerBounds(feature._leafletLayer) : null;
    if (!bounds) bounds = L.geoJSON(feature).getBounds();
    if (bounds && bounds.isValid()) map.fitBounds(bounds, { padding: [90, 90], maxZoom: 18, animate: true });
  }

  function renderBuildingDiagnosticRecord(feature, sourceIndex, matchIndex) {
    buildingDiagnosticSelectedFeature = feature;
    var properties = feature.properties || {};
    document.getElementById('building-diagnostic-record-id').textContent = 'CBML ' + buildingDiagnosticSourceValue(properties, ['cbml']) + ' · Registro de capa ' + (sourceIndex + 1) + (matchIndex == null ? '' : ' · Resultado ' + (matchIndex + 1));
    var attributes = document.getElementById('building-diagnostic-attributes');
    attributes.textContent = '';
    appendBuildingDiagnosticAttribute(attributes, 'ID de construcción (fuente)', buildingDiagnosticSourceValue(properties, ['id_constru']));
    appendBuildingDiagnosticAttribute(attributes, 'Número de edificación (fuente)', buildingDiagnosticSourceValue(properties, ['numero_edi']));
    appendBuildingDiagnosticAttribute(attributes, 'Tipo registrado', buildingDiagnosticSourceValue(properties, ['tipo_const']));
    appendBuildingDiagnosticAttribute(attributes, 'Área construida (valor fuente)', buildingDiagnosticSourceValue(properties, ['area_const']));
    appendBuildingDiagnosticAttribute(attributes, 'Pisos registrados', buildingDiagnosticSourceValue(properties, ['numero_pis']));
    appendBuildingDiagnosticAttribute(attributes, 'Sótanos registrados', buildingDiagnosticSourceValue(properties, ['numero_sot']));
    appendBuildingDiagnosticAttribute(attributes, 'Altura (valor fuente)', buildingDiagnosticSourceValue(properties, ['Altura']));
    var threat = buildingDiagnosticSourceValue(properties, ['Cat_Amenza', 'grado_amen', 'categoria']);
    var risk = buildingDiagnosticSourceValue(properties, ['Cat_Riesgo', 'riesgo']);
    document.getElementById('building-diagnostic-threat').textContent = threat || 'Sin clasificación en el dato fuente';
    document.getElementById('building-diagnostic-risk').textContent = risk || 'Sin clasificación en el dato fuente';
    buildingDiagnosticRecord.hidden = false;
    buildingDiagnosticCandidates.querySelectorAll('.diagnostic-candidate').forEach(function (item) { item.classList.toggle('is-selected', Number(item.dataset.sourceIndex) === sourceIndex); });
    focusBuildingDiagnosticFeature(feature);
  }

  if (buildingDiagnosticForm) buildingDiagnosticForm.addEventListener('submit', function (event) {
    event.preventDefault();
    var requestedCbml = buildingDiagnosticInput.value.trim();
    buildingDiagnosticRecord.hidden = true;
    buildingDiagnosticCandidates.textContent = '';
    buildingDiagnosticHighlight.clearLayers();
    buildingDiagnosticSelectedFeature = null;
    if (!/^\d{11}$/.test(requestedCbml)) {
      buildingDiagnosticStatus.textContent = 'Escribe un CBML de exactamente 11 dígitos.';
      buildingDiagnosticInput.focus();
      return;
    }
    if (!buildingDiagnosticFeaturesReady) {
      buildingDiagnosticStatus.textContent = 'La capa de construcciones aún se está cargando. Intenta de nuevo en unos segundos.';
      return;
    }
    var matches = constructionFilterFeatures.filter(function (feature) {
      return normalizeBuildingCbml(buildingDiagnosticSourceValue(feature.properties, ['cbml'])) === requestedCbml;
    });
    if (!matches.length) {
      buildingDiagnosticStatus.textContent = 'No se encontraron construcciones para ese CBML en la capa disponible.';
      return;
    }
    buildingDiagnosticStatus.textContent = matches.length === 1
      ? 'Se encontró 1 construcción; se muestra su ficha preliminar.'
      : 'Se encontraron ' + matches.length.toLocaleString('es') + ' construcciones asociadas a este CBML. Selecciona el registro que quieres revisar.';
    matches.forEach(function (feature, matchIndex) {
      var sourceIndex = constructionFilterFeatures.indexOf(feature);
      var properties = feature.properties || {};
      var card = document.createElement('article'); card.className = 'diagnostic-candidate'; card.dataset.sourceIndex = String(sourceIndex);
      var title = document.createElement('h3'); title.textContent = 'Construcción · registro de capa ' + (sourceIndex + 1);
      var detailParts = [];
      [['ID', ['id_constru']], ['Edificación', ['numero_edi']], ['Tipo', ['tipo_const']], ['Área fuente', ['area_const']]].forEach(function (item) {
        var value = buildingDiagnosticSourceValue(properties, item[1]);
        if (value) detailParts.push(item[0] + ': ' + value);
      });
      var detail = document.createElement('p'); detail.textContent = detailParts.length ? detailParts.join(' · ') : 'El registro no tiene más atributos descriptivos disponibles.';
      var choose = document.createElement('button'); choose.type = 'button'; choose.textContent = 'Revisar'; choose.setAttribute('aria-label', 'Revisar construcción, registro de capa ' + (sourceIndex + 1));
      choose.addEventListener('click', function () { renderBuildingDiagnosticRecord(feature, sourceIndex, matchIndex); });
      card.append(title, detail, choose); buildingDiagnosticCandidates.appendChild(card);
    });
    if (matches.length === 1) {
      var selected = matches[0];
      renderBuildingDiagnosticRecord(selected, constructionFilterFeatures.indexOf(selected), 0);
    }
  });

  var clearBuildingDiagnosticButton = document.getElementById('building-diagnostic-clear');
  if (clearBuildingDiagnosticButton) clearBuildingDiagnosticButton.addEventListener('click', function () {
    buildingDiagnosticForm.reset();
    buildingDiagnosticCandidates.textContent = '';
    buildingDiagnosticRecord.hidden = true;
    buildingDiagnosticHighlight.clearLayers();
    buildingDiagnosticSelectedFeature = null;
    buildingDiagnosticStatus.textContent = buildingDiagnosticFeaturesReady
      ? 'Capa disponible: ' + constructionFilterFeatures.length.toLocaleString('es') + ' construcciones. La búsqueda compara el CBML completo.'
      : 'La búsqueda estará disponible cuando termine de cargar la capa de construcciones.';
  });

  var showBuildingDiagnosticOnMap = document.getElementById('building-diagnostic-map');
  if (showBuildingDiagnosticOnMap) showBuildingDiagnosticOnMap.addEventListener('click', function () {
    if (buildingDiagnosticSelectedFeature) focusBuildingDiagnosticFeature(buildingDiagnosticSelectedFeature);
  });

  if (sharedViewRequested) {
    if (riskFilter && Array.from(riskFilter.options).some(function (option) { return option.value === sharedViewParams.get('riesgo'); })) riskFilter.value = sharedViewParams.get('riesgo');
    if (neighborhoodFilter && Array.from(neighborhoodFilter.options).some(function (option) { return option.value === sharedViewParams.get('barrio'); })) neighborhoodFilter.value = sharedViewParams.get('barrio');
    if (entityFilter) entityFilter.value = sharedViewParams.get('id') || '';
  }

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
  var riskLegendUserHidden = false;

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
    riskLegendPanel.hidden = !hasVisibleLegend || riskLegendUserHidden;
  }

  function addRiskLegend(name, kind, group, constructionRiskLayer) {
    var items = kind === 'flood' ? [
      ['Alto no mitigable', '#b42332', 'dashed'], ['Alto mitigable', '#e87516'], ['Con condiciones', '#d6a41d']
    ] : kind === 'threat' ? [
      ['Amenaza alta', '#b42332', 'dashed'], ['Amenaza media', '#e98b16'], ['Amenaza baja', '#21845b']
    ] : constructionRiskLayer ? [
      ['Alto riesgo no mitigable', '#b42332', 'dashed'], ['Alto riesgo mitigable', '#e87516'], ['Riesgo medio', '#d6a41d'], ['Con condiciones de riesgo', '#8b9d26']
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
    group._sourceCrs = 'EPSG:9377'; group._displayCrs = 'EPSG:4326 · shpjs transforma las geometrías al cargarlas';
    var styleEditable = !/Predios_Influencia|Construcciones_Area_Estudio/i.test(path);
    addLayerControl(name, group, color, false, false, styleEditable);
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
      var isStudyBuffer = /Bff_Uva/i.test(path);
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
            color: isBoundary ? '#e8edf2' : (isStudyBuffer ? '#b87900' : featureColor),
            weight: isStudyBuffer ? 3 : (isBoundary ? 1.25 : (isRiskZoneLayer || isConstructionLayer ? appearance.weight : (isParcelLayer ? 1.15 : 1.5))),
            opacity: 0.95,
            fillColor: featureColor,
            fillOpacity: isStudyBuffer ? 0.08 : (isRiskZoneLayer ? appearance.fillOpacity : (isParcelLayer ? 0.08 : (isConstructionLayer ? Math.min(0.22, appearance.fillOpacity + 0.06) : 0))),
            dashArray: isStudyBuffer ? '7 4' : appearance.dashArray,
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
          // A feature click is handled here; prevent Leaflet from forwarding it
          // to the map click handler, which clears an active selection.
          featureLayer.options.bubblingMouseEvents = false;
          featureLayer._isParcelLayer = isParcelLayer;
          featureLayer._isConstructionLayer = isConstructionLayer;
          featureLayer._featureLayerName = name;
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
          // Keep the popup available for explicit actions, but do not let
          // Leaflet open it on every map click automatically.
          if (featureLayer._openPopup) featureLayer.off('click', featureLayer._openPopup, featureLayer);
          featureLayer._originalFeatureStyle = Object.assign({}, featureLayer.options);
          featureLayer.on('click', function (event) {
            if (activeAction || activeEdit) { if (event.originalEvent) L.DomEvent.stopPropagation(event.originalEvent); return; }
            if (event.originalEvent) L.DomEvent.stopPropagation(event.originalEvent);
            if (!selectionToolActive) {
              if (featureLayer.closePopup) featureLayer.closePopup();
              if (featureLayer.closeTooltip) featureLayer.closeTooltip();
              return;
            }
            if (selectionToolActive) {
              selectFeatureLayer(featureLayer);
              if (featureLayer.closePopup) featureLayer.closePopup();
              return;
            }
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
      if (isConstructionLayer) setBuildingDiagnosticReady(features);
      var controlEntry = row && row.parentElement;
      if (controlEntry && controlEntry._customStyle) applyThemeStyle(layer, row._colorInput.value, Number(row._weightInput.value), false);
      else if (controlEntry && controlEntry._customWeight) applyLayerWeight(layer, Number(row._weightInput.value));
      if (/Bff_Uva/i.test(path) && !userChangedView) {
        var studyBounds = getLayerBounds(layer);
        if (studyBounds) {
          map.fitBounds(studyBounds, { padding: [90, 90], maxZoom: 15, animate: false });
          initialCenter = map.getCenter(); initialZoom = map.getZoom(); userChangedView = false;
        }
      }
      var opacityInput = row && row._opacityInput;
      if (opacityInput) opacityInput.dispatchEvent(new Event('input'));
      if (isParcelLayer || isConstructionLayer) updateScaleLimitedLayers();
      if (path.indexOf('Barrios_Manrique') !== -1) applyDataFilters();
      if (isRiskZoneLayer && riskKind === 'landslide') applyDataFilters();
      if (isParcelLayer || isConstructionLayer) applyDataFilters();
      if (isParcelLayer || isConstructionLayer) tryResolveDirectEntityLink();
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
      if (riskKind) addRiskLegend(name, riskKind, group, isConstructionLayer);
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
  loadShapefileOverlay('data/Buffer_Area_Estudio/Bff_Uva', 'Buffer del área de estudio', '#ffc247');
  loadShapefileOverlay('data/Barrios_Manrique/Barrios_Manrique', 'Barrios de Manrique', '#06d6a0');
  loadShapefileOverlay('data/Comunas_Corregimientos/Comunas_Corregimientos_Med', 'Comunas y corregimientos', '#00b4d8');
  loadShapefileOverlay('data/Curva_Nivel/Curva_nivel_10x10_10', 'Curvas de nivel · 10 m', '#ffb703');
  loadShapefileOverlay('data/Construcciones_Area_Estudio/Construcciones_Area_Estudio', 'Construcciones del área de estudio', '#e76f51');
  loadShapefileOverlay('data/Predios/Predios_Influencia', 'Predios de la zona de influencia', '#9b5de5');
  loadShapefileOverlay('data/RIESGO_MOV_MASA/RIESGO_MOV_MASA', 'Riesgo por movimiento en masa', '#4361ee');
  var localLayerColorIndex = 0;
  var localLayerColors = ['#0f7180', '#c2410c', '#7c3aed', '#2563eb', '#b42332', '#15803d'];
  if (window.proj4) {
    proj4.defs('EPSG:3116', '+proj=tmerc +lat_0=4.59620041666667 +lon_0=-74.0775079166667 +k=1 +x_0=1000000 +y_0=1000000 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs +type=crs');
    proj4.defs('EPSG:9377', '+proj=tmerc +lat_0=4 +lon_0=-73 +k=0.9992 +x_0=5000000 +y_0=2000000 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs +type=crs');
  }

  function normalizeFeatureCollections(value) {
    var values = Array.isArray(value) ? value : (value && value.type === 'FeatureCollection' ? [value] : (value && value.type === 'Feature' ? [{ type: 'FeatureCollection', features: [value] }] : Object.keys(value || {}).map(function (key) { return value[key]; })));
    return values.map(function (item) {
      if (item && item.type === 'FeatureCollection') return item;
      if (item && item.type === 'Feature') return { type: 'FeatureCollection', features: [item], fileName: item.fileName };
      if (item && item.type && item.coordinates) return { type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry: item }] };
      return null;
    }).filter(function (item) { return item && Array.isArray(item.features); });
  }

  function transformFeatureCollection(collection, sourceCrs) {
    var code = String(sourceCrs || '4326').replace(/^EPSG:/i, '');
    if (code === '4326') return collection;
    if (!['3116', '9377', '3857'].includes(code)) throw new Error('CRS no compatible: EPSG:' + code + '.');
    if (!window.proj4) throw new Error('No se pudo cargar Proj4; las coordenadas proyectadas no pueden transformarse.');
    function transformCoordinates(value) {
      if (Array.isArray(value) && value.length >= 2 && typeof value[0] === 'number' && typeof value[1] === 'number') {
        var transformed = proj4('EPSG:' + code, 'EPSG:4326', [value[0], value[1]]);
        return [transformed[0], transformed[1]].concat(value.slice(2));
      }
      return Array.isArray(value) ? value.map(transformCoordinates) : value;
    }
    function transformGeometry(geometry) {
      if (!geometry) return;
      if (geometry.coordinates) geometry.coordinates = transformCoordinates(geometry.coordinates);
      if (geometry.geometries) geometry.geometries.forEach(transformGeometry);
    }
    collection.features.forEach(function (feature) { if (feature.geometry) transformGeometry(feature.geometry); });
    collection.crs = { type: 'name', properties: { name: 'EPSG:4326' } };
    return collection;
  }

  function localKmlFeatureCollection(xmlText) {
    var xml = new DOMParser().parseFromString(xmlText, 'application/xml');
    if (xml.querySelector('parsererror')) throw new Error('El KML no contiene XML válido.');
    function coordinates(node) {
      var text = node && node.textContent || '';
      return text.trim().split(/\s+/).filter(Boolean).map(function (tuple) { var values = tuple.split(',').map(Number); return values.length >= 2 && values.every(Number.isFinite) ? values.slice(0, 2) : null; }).filter(Boolean);
    }
    function geometry(node) {
      if (!node) return null;
      var type = node.localName;
      if (type === 'Point') return { type: 'Point', coordinates: coordinates(node.getElementsByTagName('coordinates')[0])[0] };
      if (type === 'LineString' || type === 'LinearRing') return { type: 'LineString', coordinates: coordinates(node.getElementsByTagName('coordinates')[0]) };
      if (type === 'Polygon') {
        var rings = [];
        var outer = node.getElementsByTagName('outerBoundaryIs')[0];
        if (outer) rings.push(coordinates(outer.getElementsByTagName('coordinates')[0]));
        Array.from(node.getElementsByTagName('innerBoundaryIs')).forEach(function (inner) { rings.push(coordinates(inner.getElementsByTagName('coordinates')[0])); });
        return rings.length ? { type: 'Polygon', coordinates: rings } : null;
      }
      if (type === 'MultiGeometry') {
        var geometries = Array.from(node.children).map(geometry).filter(Boolean);
        if (geometries.length === 1) return geometries[0];
        if (geometries.every(function (item) { return item.type === 'Point'; })) return { type: 'MultiPoint', coordinates: geometries.map(function (item) { return item.coordinates; }) };
        return { type: 'GeometryCollection', geometries: geometries };
      }
      return null;
    }
    var features = Array.from(xml.getElementsByTagName('Placemark')).map(function (placemark) {
      var properties = {};
      var name = placemark.getElementsByTagName('name')[0]; if (name) properties.name = name.textContent.trim();
      Array.from(placemark.getElementsByTagName('Data')).forEach(function (item) { var key = item.getAttribute('name'); var value = item.getElementsByTagName('value')[0]; if (key) properties[key] = value ? value.textContent.trim() : ''; });
      Array.from(placemark.getElementsByTagName('SimpleData')).forEach(function (item) { var key = item.getAttribute('name'); if (key) properties[key] = item.textContent.trim(); });
      var container = Array.from(placemark.children).find(function (child) { return ['Point', 'LineString', 'Polygon', 'MultiGeometry'].includes(child.localName); });
      var geom = geometry(container);
      return geom ? { type: 'Feature', properties: properties, geometry: geom } : null;
    }).filter(Boolean);
    return { type: 'FeatureCollection', features: features };
  }

  function localGpxFeatureCollection(xmlText) {
    var xml = new DOMParser().parseFromString(xmlText, 'application/xml');
    if (xml.querySelector('parsererror')) throw new Error('El GPX no contiene XML válido.');
    var features = [];
    function props(node) { var result = {}; ['name', 'desc', 'type', 'time', 'ele'].forEach(function (key) { var item = node.getElementsByTagName(key)[0]; if (item) result[key] = item.textContent.trim(); }); return result; }
    function point(node) { return [Number(node.getAttribute('lon')), Number(node.getAttribute('lat'))]; }
    Array.from(xml.getElementsByTagName('wpt')).forEach(function (node) { features.push({ type: 'Feature', properties: props(node), geometry: { type: 'Point', coordinates: point(node) } }); });
    Array.from(xml.getElementsByTagName('rte')).forEach(function (node) { var coords = Array.from(node.getElementsByTagName('rtept')).map(point); if (coords.length > 1) features.push({ type: 'Feature', properties: props(node), geometry: { type: 'LineString', coordinates: coords } }); });
    Array.from(xml.getElementsByTagName('trk')).forEach(function (node) { var lines = Array.from(node.getElementsByTagName('trkseg')).map(function (seg) { return Array.from(seg.getElementsByTagName('trkpt')).map(point); }).filter(function (line) { return line.length > 1; }); if (lines.length) features.push({ type: 'Feature', properties: props(node), geometry: lines.length === 1 ? { type: 'LineString', coordinates: lines[0] } : { type: 'MultiLineString', coordinates: lines } }); });
    return { type: 'FeatureCollection', features: features };
  }

  function addTemporaryGeoJSON(displayName, collection, sourceName, sourceCrs) {
    collection = transformFeatureCollection(collection, sourceCrs);
    var features = collection.features.filter(function (feature) { return feature && feature.type === 'Feature' && feature.geometry; });
    if (!features.length) throw new Error('El archivo no contiene geometrías que se puedan mostrar.');
    var label = '[Temporal] ' + displayName;
    var suffix = 2; while (overlays[label]) label = '[Temporal] ' + displayName + ' (' + suffix++ + ')';
    var color = localLayerColors[localLayerColorIndex++ % localLayerColors.length];
    var group = L.layerGroup(); group._sourcePath = sourceName; group._temporary = true; group._sourceCrs = sourceCrs || 'EPSG:4326';
    overlays[label] = group; addLayerControl(label, group, color, true, false); group.addTo(map);
    var geoLayer = L.geoJSON({ type: 'FeatureCollection', features: features }, {
      style: { color: color, fillColor: color, weight: 2, opacity: 0.9, fillOpacity: 0.2 },
      pointToLayer: function (feature, latlng) { return L.circleMarker(latlng, { radius: 6, color: color, fillColor: color, weight: 2, fillOpacity: 0.75 }); },
      onEachFeature: function (feature, featureLayer) {
        feature._leafletLayer = featureLayer; featureLayer._isTemporaryLayer = true; featureLayer._featureLayerName = displayName;
        featureLayer.options.bubblingMouseEvents = false;
        var popup = document.createElement('div'); var heading = document.createElement('strong'); heading.textContent = feature.properties && feature.properties.name || displayName; popup.appendChild(heading);
        Object.keys(feature.properties || {}).forEach(function (key) { var line = document.createElement('div'); line.textContent = key + ': ' + String(feature.properties[key] == null ? '' : feature.properties[key]); popup.appendChild(line); });
        featureLayer.bindPopup(popup);
        if (featureLayer._openPopup) featureLayer.off('click', featureLayer._openPopup, featureLayer);
        featureLayer._originalFeatureStyle = Object.assign({}, featureLayer.options);
        featureLayer.on('click', function (event) { if (activeAction || activeEdit) { if (event.originalEvent) L.DomEvent.stopPropagation(event.originalEvent); return; } if (event.originalEvent) L.DomEvent.stopPropagation(event.originalEvent); if (!selectionToolActive) { featureLayer.closePopup(); if (featureLayer.closeTooltip) featureLayer.closeTooltip(); return; } selectFeatureLayer(featureLayer); var bounds = getLayerBounds(featureLayer); if (bounds) map.fitBounds(bounds, { padding: [36, 36], maxZoom: 17 }); featureLayer.closePopup(); });
      }
    });
    group.addLayer(geoLayer); group.featureData = features;
    if (group._uiOpacity != null) applyOpacityToLayerTree(geoLayer, group._uiOpacity);
    var row = Array.from(layerList.querySelectorAll('.layer-item')).find(function (item) { return item.querySelector('label').textContent === label; });
    if (row) row.querySelector('.layer-state').textContent = 'ON';
    if (row) addTemporaryDeleteButton(row, label);
    if (row) { var table = document.createElement('button'); table.type = 'button'; table.className = 'layer-table-button'; table.textContent = 'Tabla'; table.addEventListener('click', function (event) { event.preventDefault(); event.stopPropagation(); showAttributeTable(label, group.featureData); }); row.appendChild(table); }
    return { group: group, name: label, count: features.length };
  }

  function addTemporaryDeleteButton(row, name) {
    if (!row || row.querySelector('.temporary-layer-delete')) return;
    var button = document.createElement('button'); button.type = 'button'; button.className = 'temporary-layer-delete'; button.textContent = 'Quitar'; button.title = 'Quitar esta capa temporal de la sesión';
    button.addEventListener('click', function (event) {
      event.preventDefault(); event.stopPropagation();
      if (!window.confirm('¿Quitar la capa temporal «' + name.replace(/</g, '') + '» de esta sesión?')) return;
      var layer = overlays[name]; if (layer && map.hasLayer(layer)) map.removeLayer(layer);
      delete overlays[name]; var entry = row.closest('.layer-control-entry'); if (entry) entry.remove(); updateRiskLegendPanel();
    });
    row.appendChild(button);
  }

  function parseDelimitedText(text) {
    var sample = (text.split(/\r?\n/)[0] || ''); var delimiters = [',', ';', '\t'];
    var delimiter = delimiters.sort(function (a, b) { return sample.split(b).length - sample.split(a).length; })[0];
    var rows = [], row = [], cell = '', quoted = false;
    for (var i = 0; i < text.length; i++) {
      var char = text[i];
      if (char === '"' && quoted && text[i + 1] === '"') { cell += '"'; i++; }
      else if (char === '"') quoted = !quoted;
      else if (char === delimiter && !quoted) { row.push(cell); cell = ''; }
      else if ((char === '\n' || char === '\r') && !quoted) { if (char === '\r' && text[i + 1] === '\n') i++; row.push(cell); if (row.some(function (value) { return value.trim(); })) rows.push(row); row = []; cell = ''; }
      else cell += char;
    }
    row.push(cell); if (row.some(function (value) { return value.trim(); })) rows.push(row);
    if (rows.length < 2) throw new Error('El CSV necesita encabezados y al menos una fila.');
    rows[0][0] = rows[0][0].replace(/^\uFEFF/, '');
    return rows;
  }

  function chooseCsvColumns(headers) {
    var dialog = document.getElementById('csv-import-dialog');
    var xSelect = document.getElementById('csv-x-column'), ySelect = document.getElementById('csv-y-column');
    [xSelect, ySelect].forEach(function (select) { select.textContent = ''; headers.forEach(function (header, index) { var option = document.createElement('option'); option.value = String(index); option.textContent = header || 'Columna ' + (index + 1); select.appendChild(option); }); });
    var xIndex = headers.findIndex(function (header) { return /^(x|lon|longitud|longitude|este|easting)$/i.test(header.trim()); });
    var yIndex = headers.findIndex(function (header) { return /^(y|lat|latitud|latitude|norte|northing)$/i.test(header.trim()); });
    if (xIndex >= 0) xSelect.value = String(xIndex); if (yIndex >= 0) ySelect.value = String(yIndex);
    return new Promise(function (resolve) {
      var close = function () { dialog.removeEventListener('close', close); resolve(dialog.returnValue === 'import' ? { x: Number(xSelect.value), y: Number(ySelect.value), epsg: document.getElementById('csv-crs').value } : null); };
      dialog.addEventListener('close', close, { once: true }); dialog.showModal();
    });
  }

  async function importLocalFile(file) {
    var extension = file.name.split('.').pop().toLowerCase();
    if (file.size > 150 * 1024 * 1024) throw new Error('El archivo supera 150 MB; reduce su tamaño para procesarlo en el navegador.');
    if (extension === 'zip') {
      var zip = await JSZip.loadAsync(file);
      var paths = Object.keys(zip.files).filter(function (path) { return !zip.files[path].dir; }).map(function (path) { return path.toLowerCase(); });
      var shapes = paths.filter(function (path) { return path.endsWith('.shp'); });
      if (!shapes.length) throw new Error('El ZIP no contiene un archivo .shp.');
      shapes.forEach(function (shape) { var stem = shape.slice(0, -4); ['.shx', '.dbf', '.prj'].forEach(function (ext) { if (!paths.includes(stem + ext)) throw new Error('Al shapefile le falta ' + ext + ' para ' + shape.split('/').pop() + '. Agrega el archivo auxiliar y vuelve a comprimirlo.'); }); });
      var parsed = normalizeFeatureCollections(await shp(await file.arrayBuffer()));
      var results = parsed.map(function (collection, index) { var layerName = collection.fileName || shapes[index] && shapes[index].split('/').pop().replace(/\.shp$/, '') || file.name.replace(/\.zip$/i, ''); return addTemporaryGeoJSON(layerName, collection, file.name, 'EPSG:4326'); });
      return { count: results.length, message: 'Shapefile ZIP validado (.shp/.shx/.dbf/.prj); las coordenadas se transformaron a WGS 84.' };
    }
    if (['geojson', 'json'].includes(extension)) {
      var json = JSON.parse(await file.text());
      var crsName = json.crs && json.crs.properties && json.crs.properties.name || '';
      var crsMatch = String(crsName).match(/(?:EPSG(?:::|:|\/)|urn:ogc:def:crs:EPSG::?)(4326|3857|3116|9377)/i);
      if (crsName && !crsMatch) throw new Error('El GeoJSON declara un CRS que el visor no puede transformar: ' + crsName + '.');
      var sourceCrs = crsMatch ? crsMatch[1] : '4326';
      var collections = normalizeFeatureCollections(json);
      if (!collections.length) throw new Error('El JSON no contiene GeoJSON válido.');
      return { count: collections.map(function (collection, i) { return addTemporaryGeoJSON(collection.fileName || file.name + (collections.length > 1 ? ' ' + (i + 1) : ''), collection, file.name, sourceCrs).count; }).reduce(function (a, b) { return a + b; }, 0), message: 'GeoJSON cargado en EPSG:' + sourceCrs + '.' };
    }
    if (extension === 'kml' || extension === 'gpx') {
      var text = await file.text(); var collection = extension === 'kml' ? localKmlFeatureCollection(text) : localGpxFeatureCollection(text);
      return { count: addTemporaryGeoJSON(file.name.replace(/\.(kml|gpx)$/i, ''), collection, file.name, '4326').count, message: extension.toUpperCase() + ' convertido a GeoJSON en memoria.' };
    }
    if (extension === 'kmz') {
      var archive = await JSZip.loadAsync(file); var kmlPath = Object.keys(archive.files).find(function (path) { return !archive.files[path].dir && path.toLowerCase().endsWith('.kml'); });
      if (!kmlPath) throw new Error('El KMZ no contiene un archivo KML.');
      var kmzCollection = localKmlFeatureCollection(await archive.file(kmlPath).async('string'));
      return { count: addTemporaryGeoJSON(file.name.replace(/\.kmz$/i, ''), kmzCollection, file.name, '4326').count, message: 'KMZ leído localmente; KML convertido en memoria.' };
    }
    if (extension === 'csv') {
      var rows = parseDelimitedText(await file.text()); var headers = rows[0].map(function (value) { return value.trim(); }); var options = await chooseCsvColumns(headers);
      if (!options) return { count: 0, message: 'Importación CSV cancelada.' };
      var points = [];
      rows.slice(1).forEach(function (row) {
        var x = Number(String(row[options.x] || '').trim().replace(',', '.')); var y = Number(String(row[options.y] || '').trim().replace(',', '.'));
        if (!Number.isFinite(x) || !Number.isFinite(y)) return;
        if (Number(options.epsg) !== 4326 && !window.proj4) throw new Error('No se pudo cargar Proj4 para transformar el CSV.');
        var coords = Number(options.epsg) === 4326 ? [x, y] : proj4('EPSG:' + options.epsg, 'EPSG:4326', [x, y]);
        if (coords[0] < -180 || coords[0] > 180 || coords[1] < -90 || coords[1] > 90) return;
        var properties = {}; headers.forEach(function (header, index) { properties[header || 'campo_' + (index + 1)] = row[index] == null ? '' : row[index]; });
        points.push({ type: 'Feature', properties: properties, geometry: { type: 'Point', coordinates: coords } });
      });
      if (!points.length) throw new Error('No se encontraron filas con coordenadas válidas en las columnas seleccionadas.');
      return { count: addTemporaryGeoJSON(file.name.replace(/\.csv$/i, ''), { type: 'FeatureCollection', features: points }, file.name, '4326').count, message: points.length.toLocaleString('es') + ' puntos convertidos desde EPSG:' + options.epsg + '.' };
    }
    if (extension === 'tif' || extension === 'tiff') {
      var georaster = await parseGeoraster(await file.arrayBuffer(), { readOnDemand: true });
      if (!Number.isFinite(georaster.xmin) || !Number.isFinite(georaster.ymin) || !Number.isFinite(georaster.xmax) || !Number.isFinite(georaster.ymax)) throw new Error('El GeoTIFF no declara una extensión espacial válida.');
      if (![4326, 3857].includes(Number(georaster.projection))) throw new Error('Este GeoTIFF declara EPSG:' + georaster.projection + '. El renderizador actual solo puede colocar rásteres EPSG:4326 o EPSG:3857; no se mostrará con una ubicación potencialmente incorrecta.');
      var rasterName = '[Temporal] ' + file.name; var rasterGroup = L.layerGroup(); rasterGroup._sourcePath = file.name; rasterGroup._temporary = true; rasterGroup._sourceCrs = 'EPSG:' + georaster.projection;
      overlays[rasterName] = rasterGroup; addLayerControl(rasterName, rasterGroup, localLayerColors[localLayerColorIndex++ % localLayerColors.length], true, false);
      var localRaster = new GeoRasterLayer({ georaster: georaster, resolution: 256, opacity: 1 }); rasterGroup.addLayer(localRaster); if (rasterGroup._uiOpacity != null) applyOpacityToLayerTree(localRaster, rasterGroup._uiOpacity); rasterGroup.addTo(map);
      var rasterRow = Array.from(layerList.querySelectorAll('.layer-item')).find(function (item) { return item.querySelector('label').textContent === rasterName; }); if (rasterRow) rasterRow.querySelector('.layer-state').textContent = 'ON';
      if (rasterRow) addTemporaryDeleteButton(rasterRow, rasterName);
      return { count: 1, message: 'GeoTIFF cargado · EPSG:' + georaster.projection + ' · resolución de visualización limitada a 256 px por tesela.' };
    }
    throw new Error('Formato no compatible: .' + extension + '.');
  }

  var localLayerInput = document.getElementById('local-layer-files');
  document.getElementById('add-local-layers').addEventListener('click', function () { localLayerInput.click(); });
  localLayerInput.addEventListener('change', async function () {
    var files = Array.from(localLayerInput.files || []); var status = document.getElementById('local-layer-status'); var messages = [];
    for (var i = 0; i < files.length; i++) {
      status.textContent = 'Leyendo ' + files[i].name + ' (' + (i + 1) + ' de ' + files.length + ')…';
      try { var result = await importLocalFile(files[i]); messages.push(files[i].name + ': ' + result.message + (result.count ? ' ' + result.count.toLocaleString('es') + ' entidades.' : '')); }
      catch (error) { console.error('No se pudo cargar la capa temporal ' + files[i].name + ':', error); messages.push(files[i].name + ': ' + error.message); }
    }
    status.textContent = messages.join(' '); localLayerInput.value = '';
  });
  // Los GeoTIFF se conservan como insumos analíticos del escenario 3D;
  // no son capas vectoriales del panel Catastro y territorio.
  function updateActionButtons() {
    var active = !!activeAction;
    var minimumVertices = activeAction && activeAction.type === 'polygon' ? 3 : (activeAction && activeAction.type === 'marker' ? 1 : 2);
    finishButton.disabled = !active || vertices.length < minimumVertices;
    cancelButton.disabled = !active;
    undoButton.disabled = !active || vertices.length === 0;
    finishButton.textContent = activeAction && activeAction.kind === 'measure' ? 'Terminar medición' : (activeAction && activeAction.type === 'marker' ? 'Finalizar puntos' : 'Finalizar dibujo');
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

  function drawingPoints(record) {
    if (record.type === 'marker') return [record.layer.getLatLng()];
    var latlngs = record.layer.getLatLngs();
    return record.type === 'polygon' ? (latlngs[0] || []) : latlngs;
  }

  function setDrawingPoints(record, points) {
    if (record.type === 'marker') record.layer.setLatLng(points[0]);
    else record.layer.setLatLngs(record.type === 'polygon' ? [points] : points);
  }

  function refreshDrawingPopup(record) {
    var points = drawingPoints(record);
    if (record.type === 'marker') record.layer.setPopupContent('<b>' + record.name + '</b><br>' + points[0].lat.toFixed(6) + ', ' + points[0].lng.toFixed(6));
    else if (record.type === 'polygon') record.layer.setPopupContent('<b>' + record.name + '</b><br>Área: ' + formatArea(geodesicArea(points)) + '<br>Perímetro: ' + formatDistance(pathLength(points, true)));
    else record.layer.setPopupContent('<b>' + record.name + '</b><br>Longitud: ' + formatDistance(pathLength(points, false)));
  }

  function finishDrawingEdit(restore) {
    if (!activeEdit) return;
    var editing = activeEdit;
    if (restore) setDrawingPoints(editing.record, editing.original);
    else refreshDrawingPopup(editing.record);
    editHandles.clearLayers();
    activeEdit = null;
    renderDrawingHistory();
    hint.textContent = restore ? 'Edición cancelada; se restauró la geometría.' : 'Edición guardada.';
  }

  function startDrawingEdit(record) {
    if (activeEdit) finishDrawingEdit(true);
    if (activeAction) endAction('Dibujo finalizado antes de editar.');
    var points = drawingPoints(record).map(function (point) { return L.latLng(point.lat, point.lng); });
    activeEdit = { record: record, original: points.map(function (point) { return L.latLng(point.lat, point.lng); }), points: points };
    points.forEach(function (point, index) {
      var handle = L.marker(point, { draggable: true, keyboard: true, title: 'Arrastra para mover este vértice', icon: L.divIcon({ className: 'edit-vertex', iconSize: [14, 14], iconAnchor: [7, 7] }) });
      handle.on('drag', function (event) {
        activeEdit.points[index] = event.target.getLatLng();
        setDrawingPoints(record, activeEdit.points);
      });
      editHandles.addLayer(handle);
    });
    renderDrawingHistory();
    hint.textContent = 'Arrastra los vértices azules y guarda o cancela la edición.';
  }

  function selectDrawing(record) {
    drawingRecords.forEach(function (item) {
      item.selected = item === record;
      if (item.layer.setStyle) item.layer.setStyle(item.selected ? { color: '#0f7180', weight: 5, opacity: 1, fillColor: '#0f7180' } : item.originalStyle);
    });
    if (!drawings.hasLayer(record.layer)) drawings.addLayer(record.layer);
    record.visible = true;
    var bounds = getLayerBounds(record.layer);
    if (bounds) map.fitBounds(bounds, { padding: [40, 40], maxZoom: 18 });
    if (record.layer.getPopup && record.layer.getPopup()) record.layer.openPopup();
    renderDrawingHistory();
  }

  function renderDrawingHistory() {
    if (!drawingHistory) return;
    drawingHistory.textContent = '';
    if (!drawingRecords.length) {
      var empty = document.createElement('p'); empty.className = 'drawing-history-empty'; empty.textContent = 'Todavía no hay geometrías dibujadas.'; drawingHistory.appendChild(empty); return;
    }
    drawingRecords.forEach(function (record) {
      var row = document.createElement('div'); row.className = 'drawing-record' + (record.selected ? ' selected' : '');
      var title = document.createElement('span'); title.className = 'drawing-record-title'; title.textContent = record.name;
      var actions = document.createElement('div'); actions.className = 'drawing-record-actions';
      function addButton(label, action, titleText) { var button = document.createElement('button'); button.type = 'button'; button.textContent = label; button.title = titleText || label; button.addEventListener('click', action); actions.appendChild(button); return button; }
      addButton('Ver', function () { selectDrawing(record); }, 'Seleccionar y acercar');
      addButton(record.visible ? 'Ocultar' : 'Mostrar', function () { record.visible = !record.visible; if (record.visible) drawings.addLayer(record.layer); else drawings.removeLayer(record.layer); renderDrawingHistory(); }, record.visible ? 'Ocultar geometría' : 'Mostrar geometría');
      addButton('Renombrar', function () { var name = window.prompt('Nombre de la geometría:', record.name); if (name && name.trim()) { record.name = name.trim(); refreshDrawingPopup(record); renderDrawingHistory(); } });
      var editButton = addButton(activeEdit && activeEdit.record === record ? 'Guardar' : 'Editar', function () {
        if (activeEdit && activeEdit.record === record) finishDrawingEdit(false); else startDrawingEdit(record);
      }, 'Editar vértices');
      if (activeEdit && activeEdit.record === record) addButton('Cancelar', function () { finishDrawingEdit(true); });
      addButton('Eliminar', function () {
        if (!window.confirm('¿Eliminar “' + record.name + '” de los dibujos de esta sesión?')) return;
        if (activeEdit && activeEdit.record === record) finishDrawingEdit(true);
        drawings.removeLayer(record.layer); drawingRecords = drawingRecords.filter(function (item) { return item !== record; }); renderDrawingHistory();
      });
      var state = document.createElement('span'); state.className = 'drawing-record-state';
      state.textContent = record.type + ' · ' + (record.visible ? 'visible' : 'oculta') + (activeEdit && activeEdit.record === record ? ' · edición activa' : '');
      row.append(title, actions, state); drawingHistory.appendChild(row);
    });
  }

  function registerDrawing(layer, type) {
    var id = nextDrawingId++;
    var record = { id: id, name: (type === 'marker' ? 'Punto ' : type === 'polyline' ? 'Línea ' : 'Polígono ') + id, type: type, layer: layer, visible: true, selected: false, originalStyle: layer.options ? { color: layer.options.color, weight: layer.options.weight, opacity: layer.options.opacity, fillColor: layer.options.fillColor, fillOpacity: layer.options.fillOpacity } : null };
    drawingRecords.push(record);
    layer._drawingRecord = record;
    refreshDrawingPopup(record);
    layer.on('click', function (event) { if (activeAction || activeEdit) return; if (event.originalEvent) L.DomEvent.stopPropagation(event.originalEvent); selectDrawing(record); });
    renderDrawingHistory();
    return record;
  }

  function exportDrawingFeatures() {
    var selectedOnly = document.getElementById('drawing-export-scope').value === 'selected';
    var records = drawingRecords.filter(function (record) { return !selectedOnly || record.selected; });
    var measurementCount = selectedOnly ? 0 : measurementLayer.getLayers().length;
    if (!records.length && !measurementCount) { hint.textContent = selectedOnly ? 'Selecciona uno o mÃ¡s dibujos en el historial para exportarlos.' : 'No hay dibujos ni mediciones para exportar.'; return; }
    var features = records.map(function (record, index) {
      var feature = record.layer.toGeoJSON(7);
      feature.properties = { nombre: record.name, tipo: record.type === 'marker' ? 'Punto' : (record.type === 'polyline' ? 'Línea' : 'Polígono'), id: record.id };
      feature.id = record.id;
      return feature;
    });
    if (!selectedOnly) measurementLayer.eachLayer(function (layer, index) {
      var feature = layer.toGeoJSON(7);
      var popupText = layer.getPopup && layer.getPopup() ? String(layer.getPopup().getContent()) : '';
      var isArea = feature.geometry && feature.geometry.type === 'Polygon';
      var measuredValue = isArea
        ? formatArea(geodesicArea((layer.getLatLngs()[0] || [])))
        : formatDistance(pathLength(layer.getLatLngs(), false));
      feature.properties = { nombre: 'Medición ' + (index + 1), tipo: isArea ? (popupText.indexOf('Perímetro') === 0 ? 'Perímetro' : 'Área') : 'Distancia', id: 'M' + (index + 1), medida: measuredValue };
      feature.id = 'M' + (index + 1);
      features.push(feature);
    });
    var format = document.getElementById('drawing-export-format').value;
    var blob, filename;
    if (format === 'geojson') {
      blob = new Blob([JSON.stringify({ type: 'FeatureCollection', name: 'Dibujos GeoVisor Manrique', crs: { type: 'name', properties: { name: 'EPSG:4326' } }, features: features })], { type: 'application/geo+json;charset=utf-8' });
      filename = 'geovisor-manrique-dibujos.geojson';
    } else if (format === 'shp') {
      if (!window.shpwrite || typeof window.shpwrite.zip !== 'function') { hint.textContent = 'No se pudo exportar SHP: el escritor de shapefile no está disponible. Revisa la conexión al CDN y vuelve a intentarlo.'; return; }
      var shapefileCollection = { type: 'FeatureCollection', features: features.filter(function (feature) { return feature.geometry && feature.geometry.type !== 'GeometryCollection'; }) };
      window.shpwrite.zip(shapefileCollection, { folder: 'geomanrique', filename: 'geomanrique-dibujos-mediciones', outputType: 'blob', types: { point: 'puntos', polyline: 'lineas', polygon: 'poligonos' }, prj: 'GEOGCS["WGS 84",DATUM["WGS_1984",SPHEROID["WGS 84",6378137,298.257223563]],PRIMEM["Greenwich",0],UNIT["degree",0.0174532925199433]]' }).then(function (zipBlob) {
        downloadBlob(zipBlob, 'geomanrique-dibujos-mediciones.zip');
        hint.textContent = shapefileCollection.features.length.toLocaleString('es') + ' dibujos y mediciones exportados como shapefile WGS 84. Los archivos se agrupan por tipo de geometría.';
      }).catch(function (error) { hint.textContent = 'No se pudo crear el shapefile: ' + error.message; });
      hint.textContent = 'Preparando shapefile ZIP…';
      return;
    } else {
      function escapeXml(value) { return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;'); }
      function coordList(coords) { return coords.map(function (point) { return point[0] + ',' + point[1] + (point[2] == null ? '' : ',' + point[2]); }).join(' '); }
      function geometryXml(geometry) {
        if (geometry.type === 'Point') return '<Point><coordinates>' + coordList([geometry.coordinates]) + '</coordinates></Point>';
        if (geometry.type === 'LineString') return '<LineString><tessellate>1</tessellate><coordinates>' + coordList(geometry.coordinates) + '</coordinates></LineString>';
        if (geometry.type === 'Polygon') return '<Polygon><outerBoundaryIs><LinearRing><coordinates>' + coordList(geometry.coordinates[0] || []) + '</coordinates></LinearRing></outerBoundaryIs>' + (geometry.coordinates.slice(1).map(function (ring) { return '<innerBoundaryIs><LinearRing><coordinates>' + coordList(ring) + '</coordinates></LinearRing></innerBoundaryIs>'; }).join('')) + '</Polygon>';
        return '';
      }
      var placemarks = features.map(function (feature) { return '<Placemark><name>' + escapeXml(feature.properties.nombre) + '</name><ExtendedData><Data name="tipo"><value>' + escapeXml(feature.properties.tipo) + '</value></Data><Data name="id"><value>' + feature.id + '</value></Data></ExtendedData>' + geometryXml(feature.geometry) + '</Placemark>'; }).join('');
      var kml = '<?xml version="1.0" encoding="UTF-8"?><kml xmlns="http://www.opengis.net/kml/2.2"><Document><name>Dibujos GeoVisor Manrique · WGS 84</name>' + placemarks + '</Document></kml>';
      if (format === 'kml') { blob = new Blob([kml], { type: 'application/vnd.google-earth.kml+xml;charset=utf-8' }); filename = 'geovisor-manrique-dibujos.kml'; }
      else { blob = null; filename = 'geovisor-manrique-dibujos.kmz'; }
      if (format === 'kmz') {
        var zip = new JSZip(); zip.file('doc.kml', kml);
        zip.generateAsync({ type: 'blob', compression: 'DEFLATE' }).then(function (kmz) { downloadBlob(kmz, filename); }).catch(function (error) { hint.textContent = 'No se pudo crear el KMZ: ' + error.message; });
        hint.textContent = 'Preparando archivo KMZ…';
        return;
      }
    }
    downloadBlob(blob, filename);
    hint.textContent = records.length.toLocaleString('es') + ' geometrías exportadas a ' + format.toUpperCase() + ' (EPSG:4326).';
  }

  function downloadBlob(blob, filename) {
    var url = URL.createObjectURL(blob); var anchor = document.createElement('a'); anchor.href = url; anchor.download = filename; anchor.click(); window.setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  document.getElementById('export-drawings').addEventListener('click', exportDrawingFeatures);

  function endAction(message) {
    cleanTemporary();
    vertices = [];
    activeAction = null;
    document.body.classList.remove('drawing');
    map.doubleClickZoom.enable();
    if (mapDraggingBeforeAction !== null) { if (mapDraggingBeforeAction) map.dragging.enable(); mapDraggingBeforeAction = null; }
    hint.textContent = message || 'Selecciona una geometría para comenzar.';
    updateActionButtons();
  }

  function startAction(kind, type) {
    if (selectionToolActive) setSelectionToolActive(false);
    if (activeEdit) finishDrawingEdit(true);
    endAction('Haz clic en el mapa para agregar vértices.');
    activeAction = { kind: kind, type: type };
    mapDraggingBeforeAction = map.dragging.enabled();
    map.dragging.disable();
    if (kind === 'measure') {
      document.getElementById('measure-result').innerHTML = '<span class="result-dot"></span><span>Marca puntos en el mapa para medir.</span>';
      hint.textContent = type === 'distance' ? 'Marca al menos dos puntos; doble clic o “Terminar medición” para cerrar.' : 'Marca el contorno del polígono; necesitas tres puntos.';
    } else {
      hint.textContent = type === 'marker' ? 'Marca todos los puntos y pulsa Finalizar puntos.' : 'Haz clic para agregar vértices y finaliza el dibujo.';
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
    var primary = area >= 1000000 ? (area / 1000000).toLocaleString('es-CO', { maximumFractionDigits: 4 }) + ' km²' : area.toLocaleString('es-CO', { maximumFractionDigits: 1 }) + ' m²';
    return primary + ' · ' + (area / 10000).toLocaleString('es-CO', { maximumFractionDigits: 3 }) + ' ha';
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
    else if (activeAction.type !== 'marker') updateDrawingPreview();
  }

  function updateDrawingPreview(cursor) {
    var points = vertices.slice();
    if (cursor && (!points.length || points[points.length - 1].distanceTo(cursor) > 0.1)) points.push(cursor);
    if (points.length < 2) { if (previewLine) map.removeLayer(previewLine); if (previewShape) map.removeLayer(previewShape); previewLine = previewShape = null; return; }
    var style = { color: '#1976d2', weight: 3, opacity: .9, dashArray: '7 5' };
    if (activeAction.type === 'polygon' && points.length >= 3) {
      if (previewLine) { map.removeLayer(previewLine); previewLine = null; }
      if (previewShape) previewShape.setLatLngs(points); else previewShape = L.polygon(points, Object.assign({}, style, { fillColor: '#0b2e59', fillOpacity: .15 })).addTo(map);
    } else {
      if (previewShape) { map.removeLayer(previewShape); previewShape = null; }
      if (previewLine) previewLine.setLatLngs(points); else previewLine = L.polyline(points, style).addTo(map);
    }
  }

  function updateMeasurementPreview(cursor) {
    var points = vertices.slice();
    if (cursor && (!points.length || points[points.length - 1].distanceTo(cursor) > 0.1)) points.push(cursor);
    if (points.length < 2) { if (previewLine) map.removeLayer(previewLine); if (previewShape) map.removeLayer(previewShape); previewLine = previewShape = null; return; }
    var type = activeAction.type;
    if (type === 'distance' || points.length < 3) {
      if (previewShape) { map.removeLayer(previewShape); previewShape = null; }
      if (previewLine) previewLine.setLatLngs(points); else previewLine = L.polyline(points, { color: '#0b2e59', weight: 3, dashArray: '6 5' }).addTo(map);
    } else {
      if (previewLine) { map.removeLayer(previewLine); previewLine = null; }
      if (previewShape) previewShape.setLatLngs(points); else previewShape = L.polygon(points, { color: '#0b2e59', weight: 2, fillColor: '#0b2e59', fillOpacity: .12, dashArray: '6 5' }).addTo(map);
    }
    var result = document.getElementById('measure-result');
    if (type === 'distance') result.innerHTML = '<span class="result-dot"></span><span>Distancia: <b>' + formatDistance(pathLength(points, false)) + '</b></span>';
    else if (points.length >= 3) {
      var value = type === 'perimeter' ? formatDistance(pathLength(points, true)) : formatArea(geodesicArea(points));
      result.innerHTML = '<span class="result-dot"></span><span>' + (type === 'perimeter' ? 'Perímetro: ' : 'Área: ') + '<b>' + value + '</b></span>';
    }
  }

  function finishAction() {
    if (!activeAction) return;
    var action = activeAction;
    if (action.kind === 'draw') {
      if (action.type === 'marker') {
        if (vertices.length) {
          vertices.forEach(function (point) {
          var marker = L.marker(point, { icon: L.divIcon({ className: 'draw-point-icon', html: '<span></span>', iconSize: [16, 16], iconAnchor: [8, 8] }) });
          marker.bindPopup('<b>Punto dibujado</b><br>' + point.lat.toFixed(6) + ', ' + point.lng.toFixed(6));
          drawings.addLayer(marker);
          registerDrawing(marker, 'marker');
          });
          endAction(vertices.length.toLocaleString('es') + ' puntos agregados al mapa.');
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
        registerDrawing(layer, action.type);
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
    spatialSelection.forEach(function (item) {
      var previousLayer = item.feature._leafletLayer;
      if (previousLayer && previousLayer.setStyle && previousLayer._originalFeatureStyle) previousLayer.setStyle(previousLayer._originalFeatureStyle);
    });
    spatialSelection = [];
    spatialQueryActive = true;
    lastSpatialQueryGeometry = geometry;
    applyDataFilters();
    var relation = document.getElementById('spatial-relation').value;
    var queryFeature = { type: 'Feature', properties: {}, geometry: geometry };
    parcelFilterFeatures.concat(constructionFilterFeatures).forEach(function (feature) {
      if (!passesDataFilters(feature)) return;
      var matches = relation === 'within'
        ? geometryWithinGeometry(feature.geometry, geometry)
        : geometriesIntersect(feature, queryFeature);
      if (matches) spatialSelection.push({ feature: feature, kind: feature._entityKind });
    });
    spatialSelection.forEach(function (item) {
      var featureLayer = item.feature._leafletLayer;
      if (featureLayer && featureLayer.setStyle) featureLayer.setStyle({ color: '#087e8b', weight: 3, opacity: 1, fillColor: '#28a9b5', fillOpacity: 0.3 });
    });
    var buildings = spatialSelection.filter(function (item) { return item.kind === 'building'; }).length;
    var parcels = spatialSelection.filter(function (item) { return item.kind === 'parcel'; }).length;
    document.getElementById('open-spatial-results').disabled = spatialSelection.length === 0;
    document.getElementById('spatial-result').textContent = 'Consulta espacial (' + (relation === 'within' ? 'contenido' : 'intersección') + '): ' + buildings.toLocaleString('es') + ' construcciones y ' + parcels.toLocaleString('es') + ' predios. CSV exportará este resultado.';
    document.getElementById('export-filtered').textContent = 'Descargar CSV de selección espacial';
    endAction('Consulta espacial terminada.');
  }

  function exportCoordinate(lonLat, epsg) {
    if (!lonLat) return ['', ''];
    if (epsg === '4326') return [lonLat[0], lonLat[1]];
    if (!window.proj4) throw new Error('Proj4 no está disponible para transformar las coordenadas de salida.');
    var xy = proj4('EPSG:4326', 'EPSG:' + epsg, lonLat);
    if (!Number.isFinite(xy[0]) || !Number.isFinite(xy[1])) throw new Error('La transformación de coordenadas de salida no produjo valores válidos.');
    return xy;
  }

  function downloadCSV() {
    try {
      var entities = spatialQueryActive ? spatialSelection.filter(function (item) { return passesDataFilters(item.feature); }) : (function () { var f = filteredEntities(); return f.parcels.map(function (feature) { return { feature: feature, kind: 'parcel' }; }).concat(f.buildings.map(function (feature) { return { feature: feature, kind: 'building' }; })); }());
      var outputCrs = document.getElementById('output-crs').value;
      var keys = [];
      entities.forEach(function (item) { Object.keys(item.feature.properties || {}).forEach(function (key) { if (keys.indexOf(key) < 0) keys.push(key); }); });
      var columns = ['tipo_entidad'].concat(keys, ['x_salida_epsg_' + outputCrs, 'y_salida_epsg_' + outputCrs, 'latitud_wgs84', 'longitud_wgs84']);
      function quote(value) { return '"' + String(value == null ? '' : value).replace(/"/g, '""') + '"'; }
      var rows = [columns.map(quote).join(';')];
      entities.forEach(function (item) {
        var properties = item.feature.properties || {}, anchor = featureAnchor(item.feature), xy = exportCoordinate(anchor, outputCrs);
        rows.push([item.kind === 'parcel' ? 'Predio' : 'Construccion'].concat(keys.map(function (key) { return properties[key]; }), [xy[0], xy[1], anchor && anchor[1], anchor && anchor[0]]).map(quote).join(';'));
      });
      var blob = new Blob(['\uFEFF' + rows.join('\r\n')], { type: 'text/csv;charset=utf-8' });
      downloadBlob(blob, 'geovisor-manrique-resultados.csv');
    } catch (error) { document.getElementById('spatial-result').textContent = 'No se pudo exportar CSV: ' + error.message; }
  }

  document.getElementById('export-filtered').addEventListener('click', downloadCSV);
  document.getElementById('open-spatial-results').addEventListener('click', function () {
    var results = spatialSelection.filter(function (item) { return passesDataFilters(item.feature); }).map(function (item) { return item.feature; });
    showAttributeTable('Resultados de consulta espacial', results);
  });
  document.getElementById('spatial-relation').addEventListener('change', function () { if (lastSpatialQueryGeometry) runSpatialQuery(lastSpatialQueryGeometry); });
  document.getElementById('print-map').addEventListener('click', function () { window.print(); });
  var topbarActions = document.querySelector('.map-topbar-actions');
  var selectionToolButton = document.createElement('button');
  selectionToolButton.id = 'toggle-feature-selection';
  selectionToolButton.type = 'button';
  selectionToolButton.className = 'map-badge selection-toggle';
  selectionToolButton.setAttribute('aria-pressed', 'false');
  selectionToolButton.setAttribute('aria-label', 'Activar la selección de entidades');
  selectionToolButton.title = 'Activar la selección de entidades';
  selectionToolButton.append(document.createTextNode('⌖ '));
  var selectionToolLabel = document.createElement('span'); selectionToolLabel.textContent = 'SELECCIONAR ENTIDAD';
  selectionToolButton.appendChild(selectionToolLabel);
  var preview3dLink = document.querySelector('.preview-3d-link');
  if (topbarActions) topbarActions.insertBefore(selectionToolButton, preview3dLink || null);
  selectionToolButton.addEventListener('click', function () {
    if (activeAction || activeEdit) return;
    setSelectionToolActive(!selectionToolActive);
  });
  var riskLegendToggle = document.getElementById('toggle-risk-legend');
  riskLegendToggle.addEventListener('click', function () {
    riskLegendUserHidden = !riskLegendUserHidden;
    updateRiskLegendPanel();
    riskLegendToggle.setAttribute('aria-expanded', String(!riskLegendUserHidden));
    riskLegendToggle.title = riskLegendUserHidden ? 'Mostrar la simbología de capas de riesgo' : 'Ocultar la simbología de capas de riesgo';
    riskLegendToggle.setAttribute('aria-label', riskLegendUserHidden ? 'Mostrar simbología' : 'Ocultar simbología');
    riskLegendToggle.querySelector('span').textContent = riskLegendUserHidden ? 'MOSTRAR SIMBOLOGÍA' : 'OCULTAR SIMBOLOGÍA';
  });
  var uvaMarkerToggle = document.getElementById('toggle-uva-marker');
  var uvaMarkerHidden = false;
  uvaMarkerToggle.addEventListener('click', function () {
    uvaMarkerHidden = !uvaMarkerHidden;
    if (uvaMarkerHidden) map.removeLayer(uvaMarker);
    else uvaMarker.addTo(map);
    uvaMarkerToggle.setAttribute('aria-expanded', String(!uvaMarkerHidden));
    uvaMarkerToggle.title = uvaMarkerHidden ? 'Mostrar marcador UVA La Armonía' : 'Ocultar marcador UVA La Armonía';
    uvaMarkerToggle.setAttribute('aria-label', uvaMarkerToggle.title);
    uvaMarkerToggle.querySelector('span').textContent = uvaMarkerHidden ? 'MOSTRAR UVA' : 'OCULTAR UVA';
  });
  function updatePrintComposition() {
    var rail = document.querySelector('.print-rail');
    if (!rail) return;
    var legend = rail.querySelector('.print-legend-content');
    legend.textContent = '';
    var detailedRiskSections = riskLegendPanel ? Array.from(riskLegendPanel.querySelectorAll('.map-risk-legend-section')).filter(function (section) { return !section.hidden; }) : [];
    if (detailedRiskSections.length) detailedRiskSections.forEach(function (section) { legend.appendChild(section.cloneNode(true)); });
    else Array.from(activeLayerLegend.children).forEach(function (entry) { legend.appendChild(entry.cloneNode(true)); });
    if (!legend.children.length) { var empty = document.createElement('p'); empty.textContent = 'Sin capas temáticas activas.'; legend.appendChild(empty); }
    var center = map.getCenter();
    rail.querySelector('.print-center').textContent = center.lat.toFixed(5) + '°, ' + center.lng.toFixed(5) + '°';
    var scale = document.querySelector('.leaflet-control-scale-line');
    rail.querySelector('.print-scale').textContent = scale ? scale.textContent : 'No disponible';
    var now = new Date();
    var formattedDate = new Intl.DateTimeFormat('es-CO', { year: 'numeric', month: 'long', day: 'numeric' }).format(now);
    rail.querySelector('.print-date').textContent = formattedDate;
    rail.querySelector('.print-footer-date').textContent = formattedDate;
    var attribution = map.getContainer().querySelector('.leaflet-control-attribution');
    rail.querySelector('.print-attribution').textContent = attribution ? attribution.textContent.replace(/\s+/g, ' ').trim() : 'Fuentes visibles en el mapa.';
  }
  var printGridLayer = L.layerGroup();
  function niceGridStep(span) {
    var rawStep = span / 5;
    var power = Math.pow(10, Math.floor(Math.log10(rawStep)));
    var normalized = rawStep / power;
    return (normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10) * power;
  }
  function formatGridCoordinate(value, isLatitude) {
    return Math.abs(value).toFixed(4) + '° ' + (isLatitude ? (value >= 0 ? 'N' : 'S') : (value >= 0 ? 'E' : 'O'));
  }
  function buildPrintGrid() {
    printGridLayer.clearLayers();
    var bounds = map.getBounds();
    var south = bounds.getSouth(); var north = bounds.getNorth();
    var west = bounds.getWest(); var east = bounds.getEast();
    var latStep = niceGridStep(north - south);
    var lngStep = niceGridStep(east - west);
    var latStart = Math.ceil(south / latStep) * latStep;
    var lngStart = Math.ceil(west / lngStep) * lngStep;
    var latInset = (north - south) * 0.018;
    var lngInset = (east - west) * 0.018;
    function addGridLabel(position, coordinate, anchor, align) {
      printGridLayer.addLayer(L.marker(position, { pane: 'printGridLabelPane', interactive: false, keyboard: false, icon: L.divIcon({ className: 'print-grid-label print-grid-label-' + align, html: formatGridCoordinate(coordinate, align === 'west' || align === 'east'), iconSize: [70, 12], iconAnchor: anchor }) }));
    }
    for (var latitude = latStart; latitude <= north && latitude <= south + latStep * 20; latitude += latStep) {
      printGridLayer.addLayer(L.polyline([[latitude, west], [latitude, east]], { pane: 'printGridPane', className: 'print-grid-line', color: '#173b4f', weight: 0.7, opacity: 0.38, interactive: false }));
      addGridLabel([latitude, west + lngInset], latitude, [0, 6], 'west');
      addGridLabel([latitude, east - lngInset], latitude, [70, 6], 'east');
    }
    for (var longitude = lngStart; longitude <= east && longitude <= west + lngStep * 20; longitude += lngStep) {
      printGridLayer.addLayer(L.polyline([[south, longitude], [north, longitude]], { pane: 'printGridPane', className: 'print-grid-line', color: '#173b4f', weight: 0.7, opacity: 0.38, interactive: false }));
      addGridLabel([south + latInset, longitude], longitude, [35, 12], 'south');
      addGridLabel([north - latInset, longitude], longitude, [35, 0], 'north');
    }
  }
  window.addEventListener('beforeprint', function () {
    updatePrintComposition();
    map.invalidateSize({ animate: false });
    buildPrintGrid();
    printGridLayer.addTo(map);
  });
  window.addEventListener('afterprint', function () {
    if (map.hasLayer(printGridLayer)) map.removeLayer(printGridLayer);
  });
  document.getElementById('inspector-close').addEventListener('click', function () { document.getElementById('feature-inspector').hidden = true; });
  document.getElementById('inspector-zoom').addEventListener('click', function () { var bounds = getLayerBounds(selectedInspectorLayer); if (bounds) map.fitBounds(bounds, { padding: [40, 40], maxZoom: 18 }); });
  document.getElementById('inspector-share').addEventListener('click', async function () {
    var feature = selectedInspectorLayer && selectedInspectorLayer.feature;
    if (!feature) { document.getElementById('inspector-share-status').textContent = 'Selecciona un predio o una construcción primero.'; return; }
    var isParcel = !!selectedInspectorLayer._isParcelLayer;
    var identifier = isParcel ? propertyValue(feature.properties, ['numero_pre', 'matricula_', 'fid_']) : propertyValue(feature.properties, ['id_constru', 'cbml', 'numero_edi']);
    if (identifier === '') { document.getElementById('inspector-share-status').textContent = 'Esta entidad no tiene un identificador utilizable para el enlace.'; return; }
    var shareUrl = new URL(window.location.href); shareUrl.search = ''; shareUrl.searchParams.set(isParcel ? 'predio' : 'construccion', String(identifier));
    try { await navigator.clipboard.writeText(shareUrl.href); document.getElementById('inspector-share-status').textContent = 'Enlace de consulta copiado.'; }
    catch (error) { document.getElementById('inspector-share-status').textContent = 'El navegador no permitió copiar el enlace. Usa la barra de dirección para compartirlo.'; }
  });

  map.on('click', function (event) {
    if (activeEdit) return;
    if (selectionToolActive && !activeAction) {
      if (event.layer && event.layer.feature) return;
      clearFeatureSelection(); return;
    }
    if (!activeAction) return;
    addVertex(event.latlng);
  });
  map.on('mousemove', function (event) {
    document.getElementById('coordinates').textContent = event.latlng.lat.toFixed(6) + '°, ' + event.latlng.lng.toFixed(6) + '°';
    if (activeAction && activeAction.type !== 'marker') {
      if (activeAction.kind === 'measure') updateMeasurementPreview(event.latlng);
      else updateDrawingPreview(event.latlng);
    }
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
    L.DomEvent.stop(event.originalEvent);
    if (activeAction.kind === 'draw' && activeAction.type === 'marker') {
      if (vertices.length > 1 && vertices[vertices.length - 1].distanceTo(vertices[vertices.length - 2]) < 0.5) {
        vertices.pop();
        var duplicatePointMarker = vertexMarkers.pop();
        if (duplicatePointMarker) map.removeLayer(duplicatePointMarker);
      }
      finishAction();
      return;
    }
    if (vertices.length > 1 && vertices[vertices.length - 1].distanceTo(vertices[vertices.length - 2]) < 0.5) {
      vertices.pop();
      var duplicateMarker = vertexMarkers.pop();
      if (duplicateMarker) map.removeLayer(duplicateMarker);
      updateActionButtons();
    }
    finishAction();
  });
  document.querySelectorAll('[data-map-nav]').forEach(function (button) {
    button.addEventListener('click', function () {
      var action = button.dataset.mapNav;
      if (action === 'zoom-in') map.zoomIn();
      else if (action === 'zoom-out') map.zoomOut();
      else if (action === 'home') map.setView(initialCenter, initialZoom);
    });
  });
  document.getElementById('share-view').addEventListener('click', async function () {
    var shareUrl = new URL(window.location.href);
    shareUrl.search = '';
    shareUrl.searchParams.set('vista', '1');
    shareUrl.searchParams.set('lat', map.getCenter().lat.toFixed(6));
    shareUrl.searchParams.set('lng', map.getCenter().lng.toFixed(6));
    shareUrl.searchParams.set('z', map.getZoom().toFixed(2));
    if (riskFilter) shareUrl.searchParams.set('riesgo', riskFilter.value);
    if (neighborhoodFilter) shareUrl.searchParams.set('barrio', neighborhoodFilter.value);
    if (entityFilter && entityFilter.value) shareUrl.searchParams.set('id', entityFilter.value);
    var checkedBase = layerList.querySelector('input[name="base-layer"]:checked');
    if (checkedBase) shareUrl.searchParams.set('base', checkedBase.nextElementSibling.nextElementSibling.textContent);
    var visibleNames = Array.from(layerList.querySelectorAll('.layer-control-entry')).filter(function (entry) {
      var checkbox = entry.querySelector('input[type="checkbox"]');
      return checkbox && checkbox.checked;
    }).map(function (entry) { return entry.querySelector('.layer-item label').textContent; }).filter(function (name) { return name.indexOf('[Temporal] ') !== 0; });
    if (visibleNames.length) shareUrl.searchParams.set('capas', visibleNames.join('|'));
    try { await navigator.clipboard.writeText(shareUrl.href); document.getElementById('share-view-status').textContent = 'Enlace copiado con encuadre, capas permanentes y filtros. Las capas temporales y dibujos de esta sesión no se incluyen.'; }
    catch (error) { document.getElementById('share-view-status').textContent = 'No se pudo copiar automáticamente. Mantén pulsado y copia este enlace: ' + shareUrl.href; }
  });
  document.getElementById('clear-drawings').addEventListener('click', function () {
    if ((drawingRecords.length || measurementLayer.getLayers().length) && !window.confirm('¿Borrar todos los dibujos y mediciones de esta sesión?')) return;
    if (activeEdit) finishDrawingEdit(true);
    drawings.clearLayers();
    drawingRecords = [];
    renderDrawingHistory();
    measurementLayer.clearLayers();
    spatialSelection = []; spatialQueryActive = false; lastSpatialQueryGeometry = null;
    document.getElementById('open-spatial-results').disabled = true;
    document.getElementById('spatial-result').textContent = 'Dibuja un polígono para consultar predios y construcciones.';
    document.getElementById('export-filtered').textContent = 'Descargar CSV filtrado';
    document.getElementById('measure-result').innerHTML = '<span class="result-dot"></span><span>El resultado aparecerá aquí</span>';
    endAction('Geometrías y mediciones borradas.');
  });

  map.whenReady(function () { window.setTimeout(function () { map.invalidateSize(); }, 0); });
}());
