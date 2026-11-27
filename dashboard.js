(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };
  var formatter = new Intl.NumberFormat('es-CO', { maximumFractionDigits: 0 });
  var decimalFormatter = new Intl.NumberFormat('es-CO', { maximumFractionDigits: 2 });
  var riskOrder = ['Riesgo bajo', 'Riesgo medio', 'Alto riesgo mitigable', 'Alto riesgo no mitigable', 'Con condiciones de riesgo'];
  var threatOrder = ['Amenaza baja por movimientos en masa', 'Amenaza media por movimientos en masa', 'Amenaza alta por movimientos en masa'];
  var riskLabels = { 'Riesgo bajo': 'Bajo', 'Riesgo medio': 'Medio', 'Alto riesgo mitigable': 'Alto mitigable', 'Alto riesgo no mitigable': 'Alto no mitigable', 'Con condiciones de riesgo': 'Con condiciones' };
  var threatLabels = { 'Amenaza baja por movimientos en masa': 'Baja', 'Amenaza media por movimientos en masa': 'Media', 'Amenaza alta por movimientos en masa': 'Alta' };
  var state = {
    neighborhood: 'all', risks: new Set(), threats: new Set(), types: new Set(), destinations: new Set(), floors: new Set(),
    search: '', tableSearch: '', tableKind: 'parcels', page: 0, sortKey: 'sourceId', sortDirection: 1,
    mapTheme: 'parcel-count', selectedRecord: null
  };
  var data = { parcels: [], buildings: [], neighborhoods: [], sourceRows: { parcels: 0, buildings: 0 } };
  var charts = {};
  var map;
  var neighborhoodLayer;
  var selectionLayer;
  var metricsByNeighborhood = new Map();
  var pageSize = 50;

  function setLoading(message) { $('loading-status').textContent = message; }
  function showError(message) {
    $('loading-overlay').classList.add('hidden');
    $('dashboard-error').textContent = message;
    $('dashboard-error').hidden = false;
  }
  function norm(value) { return String(value == null ? '' : value).trim().toLocaleLowerCase('es'); }
  function numeric(value) { var n = Number(value); return value != null && value !== '' && Number.isFinite(n) ? n : null; }
  function safeText(value) { return String(value == null ? '' : value); }
  function formatNumber(value) { return formatter.format(value || 0); }
  function formatArea(value) { return value == null || !Number.isFinite(value) ? '—' : decimalFormatter.format(value); }
  function normalizeKey(value) { return norm(value).normalize('NFD').replace(/[\u0300-\u036f]/g, ''); }
  function isHighRisk(value) { var key = normalizeKey(value); return key.indexOf('alto riesgo') === 0; }
  function isHighThreat(value) { return normalizeKey(value).indexOf('amenaza alta') === 0; }

  function pointInRing(point, ring) {
    if (!ring || ring.length < 3) return false;
    var inside = false;
    for (var i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      var a = ring[i], b = ring[j];
      var crosses = (a[1] > point[1]) !== (b[1] > point[1]) &&
        point[0] < (b[0] - a[0]) * (point[1] - a[1]) / ((b[1] - a[1]) || 1e-20) + a[0];
      if (crosses) inside = !inside;
    }
    return inside;
  }
  function pointInGeometry(point, geometry) {
    if (!geometry) return false;
    var polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : (geometry.type === 'MultiPolygon' ? geometry.coordinates : []);
    return polygons.some(function (polygon) {
      return polygon && pointInRing(point, polygon[0]) && !polygon.slice(1).some(function (hole) { return pointInRing(point, hole); });
    });
  }
  function geometryRings(geometry) {
    if (!geometry) return [];
    if (geometry.type === 'Polygon') return geometry.coordinates || [];
    if (geometry.type === 'MultiPolygon') return (geometry.coordinates || []).reduce(function (all, polygon) { return all.concat(polygon || []); }, []);
    return [];
  }
  function ringCentroid(ring) {
    var twiceArea = 0, cx = 0, cy = 0;
    if (!ring || ring.length < 3) return null;
    for (var i = 0; i < ring.length - 1; i++) {
      var cross = ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1];
      twiceArea += cross; cx += (ring[i][0] + ring[i + 1][0]) * cross; cy += (ring[i][1] + ring[i + 1][1]) * cross;
    }
    if (Math.abs(twiceArea) < 1e-15) return null;
    return [cx / (3 * twiceArea), cy / (3 * twiceArea)];
  }
  function representativePoint(geometry) {
    var rings = geometryRings(geometry).filter(function (ring) { return ring && ring.length > 2; });
    if (!rings.length) return null;
    for (var r = 0; r < rings.length; r++) {
      var centroid = ringCentroid(rings[r]);
      if (centroid && pointInGeometry(centroid, geometry)) return centroid;
    }
    var first = rings[0];
    var step = Math.max(1, Math.ceil((first.length - 1) / 100));
    for (var i = 0; i < first.length - 1; i += step) {
      var next = Math.min(i + step, first.length - 1);
      var mid = [(first[i][0] + first[next][0]) / 2, (first[i][1] + first[next][1]) / 2];
      if (pointInGeometry(mid, geometry)) return mid;
    }
    return first[0];
  }
  function neighborhoodName(feature) {
    var p = feature && feature.properties || {};
    return safeText(p.nombre_bar || p.barrio || p.nombre || p.label).trim();
  }
  function neighborhoodFor(geometry, neighborhoods) {
    var point = representativePoint(geometry);
    if (!point) return '';
    var found = neighborhoods.find(function (item) { return pointInGeometry(point, item.geometry); });
    if (found) return found.name;
    // A polygon can touch a barrio boundary; use a short sample on its exterior ring.
    var ring = geometryRings(geometry).filter(function (r) { return r && r.length > 1; })[0] || [];
    var scores = neighborhoods.map(function (item) {
      var score = 0;
      var step = Math.max(1, Math.ceil((ring.length - 1) / 80));
      for (var i = 0; i < ring.length - 1; i += step) {
        var next = Math.min(i + step, ring.length - 1);
        var sample = [(ring[i][0] + ring[next][0]) / 2, (ring[i][1] + ring[next][1]) / 2];
        if (pointInGeometry(sample, item.geometry)) score++;
      }
      return { item: item, score: score };
    }).sort(function (a, b) { return b.score - a.score; });
    return scores.length && scores[0].score ? scores[0].item.name : '';
  }

  async function loadGeometryOnly(base, label) {
    var responses = await Promise.all([fetch(base + '.shp'), fetch(base + '.prj')]);
    if (!responses[0].ok || !responses[1].ok) throw new Error('No se pudo leer la geometría de ' + label + '.');
    var buffers = await Promise.all([responses[0].arrayBuffer(), responses[1].text()]);
    if (!window.shp || typeof window.shp.parseShp !== 'function') throw new Error('No está disponible el lector de geometrías shapefile.');
    return window.shp.parseShp(buffers[0], buffers[1]);
  }
  function readSafeAttributes(item, kind, neighborhoods) {
    if (!item || typeof item !== 'object') return null;
    var isParcel = kind === 'parcels';
    var area = numeric(item.Shape_Area);
    return {
      sourceId: numeric(item.sourceId),
      geometryHash: safeText(item.geometryHash),
      identifier: safeText(isParcel ? item.numero_pre : item.cbml),
      secondaryId: safeText(isParcel ? '' : item.id_constru),
      landType: safeText(item.tipo_predi),
      destination: safeText(item.destinacio),
      floors: numeric(item.numero_pis),
      area: area != null && area >= 0 ? area : null,
      risk: safeText(item.riesgo),
      threat: safeText(item.categoria)
    };
  }
  async function combineGeometries(geometries, attributes, kind, neighborhoods) {
    if (!Array.isArray(geometries) || geometries.length !== attributes.length) {
      throw new Error('El número de registros espaciales no coincide con la tabla segura de ' + (kind === 'parcels' ? 'predios' : 'construcciones') + '.');
    }
    var groups = new Map();
    var label = kind === 'parcels' ? 'predios' : 'construcciones';
    for (var start = 0; start < geometries.length; start += 400) {
      var end = Math.min(start + 400, geometries.length);
      for (var index = start; index < end; index++) {
        var geometry = geometries[index];
        if (!geometry || !attributes[index]) continue;
        var record = readSafeAttributes(attributes[index], kind, neighborhoods);
        if (!record.geometryHash) throw new Error('Falta la huella geométrica segura del registro ' + (index + 1) + ' de ' + label + '. Regenera los atributos del dashboard.');
        var existing = groups.get(record.geometryHash);
        if (!existing) {
          record.geometry = geometry;
          record.neighborhood = neighborhoodFor(geometry, neighborhoods);
          record.kind = kind;
          record.sourceRows = 1;
          record.identifiers = new Set(record.identifier ? [record.identifier] : []);
          record.secondaryIdentifiers = new Set(record.secondaryId ? [record.secondaryId] : []);
          record._values = {};
          ['landType', 'destination', 'floors', 'area', 'risk', 'threat'].forEach(function (key) { record._values[key] = new Map([[record[key] == null ? '__NULL__' : String(record[key]), record[key]]]); });
          groups.set(record.geometryHash, record);
        } else {
          existing.sourceRows++;
          if (record.identifier) existing.identifiers.add(record.identifier);
          if (record.secondaryId) existing.secondaryIdentifiers.add(record.secondaryId);
          ['landType', 'destination', 'floors', 'area', 'risk', 'threat'].forEach(function (key) {
            var value = record[key]; existing._values[key].set(value == null ? '__NULL__' : String(value), value);
          });
        }
      }
      setLoading('Ubicando ' + label + ': ' + formatNumber(end) + ' de ' + formatNumber(geometries.length) + '…');
      await new Promise(function (resolve) { window.setTimeout(resolve, 0); });
    }
    return Array.from(groups.values()).map(function (record) {
      record.identifierCount = record.identifiers.size;
      record.secondaryIdentifierCount = record.secondaryIdentifiers.size;
      record.identifier = Array.from(record.identifiers).join(' | ');
      record.secondaryId = Array.from(record.secondaryIdentifiers).join(' | ');
      record.conflicts = {};
      Object.keys(record._values).forEach(function (key) {
        var values = record._values[key];
        if (values.size === 1) record[key] = values.values().next().value;
        else { record[key] = null; record.conflicts[key] = true; }
      });
      delete record._values; delete record.geometryHash;
      return record;
    });
  }

  function initMap() {
    map = L.map('dashboard-map', { zoomControl: true, scrollWheelZoom: true });
    var streets = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}', {
      maxZoom: 19, attribution: 'Tiles &copy; Esri, DeLorme, HERE, USGS, Intermap, NRCAN, Esri Japan, METI, Esri China (Hong Kong), TomTom'
    });
    var imagery = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
      maxZoom: 19, attribution: 'Tiles &copy; Esri, Maxar, Earthstar Geographics, and the GIS User Community'
    });
    streets.addTo(map);
    L.control.layers({ 'Calles': streets, 'Imagen satelital': imagery }, null, { collapsed: true }).addTo(map);
    selectionLayer = L.geoJSON(null, { style: { color: '#f03e68', weight: 3, opacity: 1, fillColor: '#f03e68', fillOpacity: 0.08 } }).addTo(map);
  }
  function initCharts() {
    ['risk-chart', 'threat-chart', 'landuse-chart', 'type-chart', 'floors-chart'].forEach(function (id) { charts[id] = echarts.init($(id), null, { renderer: 'canvas' }); });
    charts['risk-chart'].on('click', function (params) { if (params.data && params.data.category) toggleFilterValue('risks', params.data.category); });
    charts['threat-chart'].on('click', function (params) { if (params.data && params.data.category) toggleFilterValue('threats', params.data.category); });
    charts['landuse-chart'].on('click', function (params) { if (params.data && params.data.category) toggleFilterValue('destinations', params.data.category); });
    charts['type-chart'].on('click', function (params) { if (params.data && params.data.category) toggleFilterValue('types', params.data.category); });
    charts['floors-chart'].on('click', function (params) { if (params.data && params.data.category != null) toggleFilterValue('floors', String(params.data.category)); });
    window.addEventListener('resize', function () { Object.keys(charts).forEach(function (id) { charts[id].resize(); }); if (map) map.invalidateSize(); });
  }
  function createNeighborhoodLayer() {
    var featureCollection = { type: 'FeatureCollection', features: data.neighborhoods.map(function (item) { return item.feature; }) };
    neighborhoodLayer = L.geoJSON(featureCollection, {
      style: function (feature) { return neighborhoodStyle(neighborhoodName(feature)); },
      onEachFeature: function (feature, layer) {
        var name = neighborhoodName(feature);
        layer.on('click', function () { state.neighborhood = state.neighborhood === name ? 'all' : name; $('neighborhood-filter').value = state.neighborhood; state.page = 0; renderAll(); });
        layer.on('mouseover', function () { layer.setStyle({ weight: 3, color: '#124f62', fillOpacity: 0.78 }); });
        layer.on('mouseout', function () { layer.setStyle(neighborhoodStyle(name)); });
      }
    }).addTo(map);
    var bounds = neighborhoodLayer.getBounds();
    if (bounds.isValid()) map.fitBounds(bounds, { padding: [16, 16], maxZoom: 14 });
  }
  function neighborhoodValues() {
    var values = new Map();
    data.neighborhoods.forEach(function (item) { values.set(item.name, { parcelCount: 0, buildingCount: 0, parcelArea: 0, buildingArea: 0, parcelRisk: 0, buildingRisk: 0, parcelThreat: 0, buildingThreat: 0 }); });
    filteredRecords('parcels').forEach(function (record) { var m = values.get(record.neighborhood); if (!m) return; m.parcelCount++; m.parcelArea += record.area || 0; if (isHighRisk(record.risk)) m.parcelRisk++; if (isHighThreat(record.threat)) m.parcelThreat++; });
    filteredRecords('buildings').forEach(function (record) { var m = values.get(record.neighborhood); if (!m) return; m.buildingCount++; m.buildingArea += record.area || 0; if (isHighRisk(record.risk)) m.buildingRisk++; if (isHighThreat(record.threat)) m.buildingThreat++; });
    return values;
  }
  function selectedThemeValue(metric) {
    var recordValue = {
      'parcel-count': 'parcelCount', 'building-count': 'buildingCount', 'parcel-area': 'parcelArea', 'building-area': 'buildingArea',
      'parcel-risk': 'parcelRisk', 'building-risk': 'buildingRisk', 'parcel-threat': 'parcelThreat', 'building-threat': 'buildingThreat'
    }[state.mapTheme];
    return metric[recordValue] || 0;
  }
  function neighborhoodStyle(name) {
    var metric = metricsByNeighborhood.get(name);
    var value = metric ? selectedThemeValue(metric) : 0;
    var allValues = Array.from(metricsByNeighborhood.values()).map(selectedThemeValue);
    var max = Math.max.apply(null, allValues.concat([0]));
    var ratio = max > 0 ? Math.max(0, Math.min(1, value / max)) : 0;
    var color = ratio < 0.5 ? blend('#e4f1e9', '#72b7aa', ratio * 2) : blend('#72b7aa', '#bd4e5a', (ratio - 0.5) * 2);
    return { className: 'neighborhood-shape', color: name === state.neighborhood ? '#0d5566' : '#fff', weight: name === state.neighborhood ? 3 : 1.7, opacity: 1, fillColor: color, fillOpacity: 0.72 };
  }
  function blend(a, b, t) {
    function rgb(hex) { return [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)]; }
    var x = rgb(a), y = rgb(b);
    return '#' + x.map(function (v, i) { return Math.round(v + (y[i] - v) * t).toString(16).padStart(2, '0'); }).join('');
  }
  function renderMap() {
    metricsByNeighborhood = neighborhoodValues();
    if (!neighborhoodLayer) return;
    neighborhoodLayer.eachLayer(function (layer) {
      var name = neighborhoodName(layer.feature);
      var metric = metricsByNeighborhood.get(name) || {};
      var value = selectedThemeValue(metric);
      layer.setStyle(neighborhoodStyle(name));
      var pretty = state.mapTheme.indexOf('area') !== -1 ? formatArea(value) + ' m²' : formatNumber(value) + ' registros';
      var popup = '<div class="map-popup"><strong>' + escapeHtml(name) + '</strong><p>' + escapeHtml(themeLabel(state.mapTheme)) + ': <b>' + escapeHtml(pretty) + '</b></p><small>Haz clic en el barrio para filtrar. Asignación por punto representativo.</small></div>';
      layer.bindPopup(popup, { maxWidth: 250 });
    });
  }
  function themeLabel(theme) {
    var option = $('map-theme').selectedOptions[0];
    return option ? option.textContent : theme;
  }
  function escapeHtml(value) { return String(value).replace(/[&<>"']/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]; }); }

  function recordPasses(record, ignore) {
    var kind = record.kind;
    if (ignore !== 'selection' && state.selectedRecord && record !== state.selectedRecord) return false;
    if (ignore !== 'neighborhood' && state.neighborhood !== 'all' && record.neighborhood !== state.neighborhood) return false;
    if (ignore !== 'risks' && state.risks.size && !state.risks.has(record.risk)) return false;
    if (ignore !== 'threats' && state.threats.size && !state.threats.has(record.threat)) return false;
    if (kind === 'parcels' && ignore !== 'types' && state.types.size && !state.types.has(record.landType)) return false;
    if (kind === 'parcels' && ignore !== 'destinations' && state.destinations.size && !state.destinations.has(record.destination)) return false;
    if (kind === 'buildings' && ignore !== 'floors' && state.floors.size && !state.floors.has(String(record.floors))) return false;
    if (state.search) {
      var haystack = [record.identifier, record.secondaryId, record.landType, record.destination, record.neighborhood, record.risk, record.threat].join(' ').toLocaleLowerCase('es');
      if (haystack.indexOf(state.search) === -1) return false;
    }
    return true;
  }
  function filteredRecords(kind, ignore) { return data[kind].filter(function (record) { return recordPasses(record, ignore); }); }
  function allRecords() { return filteredRecords('parcels').concat(filteredRecords('buildings')); }
  function sumArea(records) { return records.reduce(function (sum, record) { return sum + (record.area || 0); }, 0); }
  function median(records) {
    var values = records.map(function (r) { return r.area; }).filter(function (n) { return n != null; }).sort(function (a, b) { return a - b; });
    if (!values.length) return null;
    var mid = Math.floor(values.length / 2);
    return values.length % 2 ? values[mid] : (values[mid - 1] + values[mid]) / 2;
  }
  function renderKpis(parcels, buildings) {
    $('kpi-parcels').textContent = formatNumber(parcels.length);
    $('kpi-buildings').textContent = formatNumber(buildings.length);
    $('table-parcel-count').textContent = formatNumber(parcels.length);
    $('table-building-count').textContent = formatNumber(buildings.length);
    $('kpi-parcels-note').textContent = formatNumber(parcels.filter(function (r) { return !!r.risk; }).length) + ' geometrías únicas con clasificación de riesgo';
    $('kpi-buildings-note').textContent = formatNumber(buildings.filter(function (r) { return !!r.risk; }).length) + ' geometrías únicas con clasificación de riesgo';
    $('kpi-parcel-area').textContent = formatArea(sumArea(parcels));
    $('kpi-building-area').textContent = formatArea(sumArea(buildings));
    var floorValues = buildings.map(function (r) { return r.floors; }).filter(function (n) { return n != null; });
    var mean = floorValues.length ? floorValues.reduce(function (sum, n) { return sum + n; }, 0) / floorValues.length : null;
    $('kpi-avg-floors').textContent = mean == null ? '—' : decimalFormatter.format(mean);
    var floorConflicts = buildings.filter(function (r) { return r.conflicts && r.conflicts.floors; }).length;
    $('kpi-height-note').textContent = floorValues.length ? formatNumber(floorValues.length) + ' huellas \u00FAnicas; ' + formatNumber(floorConflicts) + ' con valores en conflicto; altura en metros no disponible.' : 'N\u00FAmero de pisos no disponible.';
    var riskClassified = parcels.filter(function (r) { return !!r.risk; }).length + buildings.filter(function (r) { return !!r.risk; }).length;
    var threatClassified = parcels.filter(function (r) { return !!r.threat; }).length + buildings.filter(function (r) { return !!r.threat; }).length;
    $('summary-reading').textContent = 'En este corte hay ' + formatNumber(parcels.length) + ' predios y ' + formatNumber(buildings.length) + ' construcciones. ' + formatNumber(riskClassified) + ' registros tienen categoría de riesgo y ' + formatNumber(threatClassified) + ' tienen categoría de amenaza; las frecuencias usan solo registros clasificados.';
    $('print-filter-summary').textContent = 'Filtros y selecciones: ' + describeFilters() + '. Generado: ' + new Date().toLocaleString('es-CO') + '.';
  }

  function countValues(records, key, ignore) {
    var result = new Map();
    records.filter(function (r) { return recordPasses(r, ignore); }).forEach(function (record) {
      var value = safeText(record[key]).trim();
      if (value) result.set(value, (result.get(value) || 0) + 1);
    });
    return result;
  }
  function orderedValues(mapValues, order) {
    var known = order.filter(function (value) { return mapValues.has(value); });
    var extra = Array.from(mapValues.keys()).filter(function (value) { return order.indexOf(value) === -1; }).sort(function (a, b) { return a.localeCompare(b, 'es'); });
    return known.concat(extra);
  }
  function baseChartOption() {
    return { animationDuration: 350, textStyle: { fontFamily: 'Inter, Manrope, Arial, sans-serif', color: '#61788a' }, tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' }, confine: true, textStyle: { fontSize: 10 } }, grid: { left: 42, right: 14, top: 18, bottom: 50, containLabel: true } };
  }
  function renderRiskChart() {
    var parcelCounts = countValues(data.parcels, 'risk', 'risks');
    var buildingCounts = countValues(data.buildings, 'risk', 'risks');
    var categories = orderedValues(new Map(Array.from(parcelCounts.entries()).concat(Array.from(buildingCounts.entries()))), riskOrder);
    var labels = categories.map(function (value) { return riskLabels[value] || value; });
    var option = baseChartOption(); option.grid.bottom = 65;
    option.legend = { bottom: 0, itemWidth: 9, itemHeight: 9, textStyle: { fontSize: 9 } };
    option.xAxis = { type: 'category', data: labels, axisLabel: { fontSize: 8, interval: 0, rotate: categories.length > 3 ? 18 : 0 }, axisLine: { lineStyle: { color: '#ccd9e0' } }, axisTick: { show: false } };
    option.yAxis = { type: 'value', minInterval: 1, axisLabel: { fontSize: 8 }, splitLine: { lineStyle: { color: '#edf1f3' } } };
    option.series = [
      { name: 'Predios', type: 'bar', barMaxWidth: 22, itemStyle: { color: '#648eaa', borderRadius: [4, 4, 0, 0] }, data: categories.map(function (category) { return { value: parcelCounts.get(category) || 0, category: category }; }) },
      { name: 'Construcciones', type: 'bar', barMaxWidth: 22, itemStyle: { color: '#d48661', borderRadius: [4, 4, 0, 0] }, data: categories.map(function (category) { return { value: buildingCounts.get(category) || 0, category: category }; }) }
    ];
    charts['risk-chart'].setOption(option, true);
  }
  function renderThreatChart() {
    var parcelCounts = countValues(data.parcels, 'threat', 'threats');
    var buildingCounts = countValues(data.buildings, 'threat', 'threats');
    var categories = orderedValues(new Map(Array.from(parcelCounts.entries()).concat(Array.from(buildingCounts.entries()))), threatOrder);
    var labels = categories.map(function (value) { return threatLabels[value] || value; });
    var option = baseChartOption(); option.grid.bottom = 44;
    option.legend = { bottom: 0, itemWidth: 9, itemHeight: 9, textStyle: { fontSize: 9 } };
    option.xAxis = { type: 'category', data: labels, axisLabel: { fontSize: 9 }, axisLine: { lineStyle: { color: '#ccd9e0' } }, axisTick: { show: false } };
    option.yAxis = { type: 'value', minInterval: 1, axisLabel: { fontSize: 8 }, splitLine: { lineStyle: { color: '#edf1f3' } } };
    option.series = [
      { name: 'Predios', type: 'bar', barMaxWidth: 26, itemStyle: { color: '#628ea8', borderRadius: [4, 4, 0, 0] }, data: categories.map(function (category) { return { value: parcelCounts.get(category) || 0, category: category }; }) },
      { name: 'Construcciones', type: 'bar', barMaxWidth: 26, itemStyle: { color: '#dfab4c', borderRadius: [4, 4, 0, 0] }, data: categories.map(function (category) { return { value: buildingCounts.get(category) || 0, category: category }; }) }
    ];
    charts['threat-chart'].setOption(option, true);
  }
  function renderLandUseChart() {
    var counts = countValues(data.parcels, 'destination', 'destinations');
    var categories = Array.from(counts.keys()).sort(function (a, b) { return counts.get(b) - counts.get(a); });
    var colors = ['#0f7180', '#5c91a8', '#8caeaa', '#d5ad67', '#c97859', '#7c7197', '#a6bd82', '#8799a8'];
    charts['landuse-chart'].setOption({ animationDuration: 350, color: colors, tooltip: { trigger: 'item', confine: true, formatter: '{b}: {c} ({d}%)' }, legend: { type: 'scroll', orient: 'vertical', right: 1, top: 'middle', width: '46%', textStyle: { fontSize: 8 }, formatter: function (name) { return name.length > 23 ? name.slice(0, 21) + '…' : name; } }, series: [{ type: 'pie', radius: ['42%', '69%'], center: ['30%', '52%'], avoidLabelOverlap: true, label: { show: false }, emphasis: { label: { show: true, formatter: '{d}%', fontSize: 10, fontWeight: 700 } }, data: categories.map(function (category) { return { name: category, category: category, value: counts.get(category) }; }) }] }, true);
    var areas = filteredRecords('parcels').map(function (r) { return r.area; }).filter(function (v) { return v != null; });
    var mean = areas.length ? areas.reduce(function (sum, value) { return sum + value; }, 0) / areas.length : null;
    $('parcel-area-summary').innerHTML = '<strong>Área geométrica predial</strong> · n=' + formatNumber(areas.length) + ' · mín. ' + formatArea(areas.length ? Math.min.apply(null, areas) : null) + ' m² · mediana ' + formatArea(median(filteredRecords('parcels'))) + ' m² · promedio ' + formatArea(mean) + ' m² · máx. ' + formatArea(areas.length ? Math.max.apply(null, areas) : null) + ' m²';
  }
  function renderTypeChart() {
    var counts = countValues(data.parcels, 'landType', 'types');
    var categories = Array.from(counts.keys()).sort(function (a, b) { return counts.get(b) - counts.get(a); });
    var labels = { 'Predio.Privado': 'Predio privado', 'Predio.Publico.Uso_Publico': 'Predio público · uso público' };
    charts['type-chart'].setOption({ animationDuration: 350, color: ['#0f7180', '#d1a14b', '#8e779f'], tooltip: { trigger: 'item', confine: true, formatter: '{b}: {c} ({d}%)' }, legend: { orient: 'vertical', right: 8, top: 'middle', textStyle: { fontSize: 9 }, formatter: function (name) { return labels[name] || name; } }, series: [{ type: 'pie', radius: ['44%', '70%'], center: ['34%', '53%'], label: { show: true, position: 'center', formatter: '{d}%', fontSize: 11, fontWeight: 700, color: '#173b4f' }, emphasis: { scale: true }, data: categories.map(function (category) { return { name: category, category: category, value: counts.get(category) }; }) }] }, true);
  }
  function renderFloorsChart() {
    var counts = new Map();
    filteredRecords('buildings', 'floors').forEach(function (r) { if (r.floors == null) return; var key = String(r.floors); counts.set(key, (counts.get(key) || 0) + 1); });
    var categories = Array.from(counts.keys()).sort(function (a, b) { return Number(a) - Number(b); });
    charts['floors-chart'].setOption({ animationDuration: 350, color: ['#4c9b83'], tooltip: { trigger: 'axis', confine: true }, grid: { left: 42, right: 14, top: 18, bottom: 35, containLabel: true }, xAxis: { type: 'category', data: categories, name: 'Pisos', nameTextStyle: { fontSize: 8 }, axisLabel: { fontSize: 8 }, axisLine: { lineStyle: { color: '#ccd9e0' } }, axisTick: { show: false } }, yAxis: { type: 'value', minInterval: 1, axisLabel: { fontSize: 8 }, splitLine: { lineStyle: { color: '#edf1f3' } } }, series: [{ type: 'bar', barMaxWidth: 24, itemStyle: { borderRadius: [4, 4, 0, 0] }, data: categories.map(function (category) { return { value: counts.get(category), category: category }; }) }] }, true);
  }

  function activeFilterLabel(kind, value) {
    if (kind === 'risks') return riskLabels[value] || value;
    if (kind === 'threats') return threatLabels[value] || value;
    return value;
  }
  function updateFilterSummaries() {
    $('risk-summary').textContent = state.risks.size ? state.risks.size + ' seleccionada(s)' : 'Todas';
    $('threat-summary').textContent = state.threats.size ? state.threats.size + ' seleccionada(s)' : 'Todas';
    $('property-type-summary').textContent = state.types.size ? state.types.size + ' seleccionado(s)' : 'Todos';
    $('land-use-summary').textContent = state.destinations.size ? state.destinations.size + ' seleccionada(s)' : 'Todas';
    $('floors-summary').textContent = state.floors.size ? state.floors.size + ' seleccionado(s)' : 'Todos';
    var chips = $('active-filters'); chips.textContent = '';
    var values = [];
    if (state.neighborhood !== 'all') values.push({ key: 'neighborhood', value: state.neighborhood, label: state.neighborhood });
    [['risks', state.risks], ['threats', state.threats], ['types', state.types], ['destinations', state.destinations], ['floors', state.floors]].forEach(function (entry) {
      entry[1].forEach(function (value) { values.push({ key: entry[0], value: value, label: activeFilterLabel(entry[0], value) }); });
    });
    if (state.search) values.push({ key: 'search', value: state.search, label: 'Búsqueda: ' + state.search });
    if (state.selectedRecord) values.push({ key: 'selection', value: String(state.selectedRecord.sourceId), label: (state.selectedRecord.kind === 'parcels' ? 'Predio' : 'Construcción') + ' · registro ' + state.selectedRecord.sourceId });
    values.forEach(function (item) {
      var chip = document.createElement('span'); chip.className = 'filter-chip'; chip.textContent = item.label;
      var close = document.createElement('button'); close.type = 'button'; close.textContent = '×'; close.setAttribute('aria-label', 'Quitar filtro ' + item.label);
      close.addEventListener('click', function () {
        if (item.key === 'neighborhood') { state.neighborhood = 'all'; $('neighborhood-filter').value = 'all'; }
        else if (item.key === 'search') { state.search = ''; $('global-search').value = ''; }
        else if (item.key === 'selection') { state.selectedRecord = null; selectionLayer.clearLayers(); }
        else state[item.key].delete(item.value);
        syncChecks(); state.page = 0; renderAll();
      });
      chip.appendChild(close); chips.appendChild(chip);
    });
  }
  function syncChecks() {
    document.querySelectorAll('.filter-option input[type="checkbox"]').forEach(function (input) {
      var set = state[input.dataset.state]; input.checked = !!(set && set.has(input.value));
    });
    updateFilterSummaries();
  }
  function toggleFilterValue(key, value) {
    if (state[key].has(value)) state[key].delete(value); else state[key].add(value);
    syncChecks(); state.page = 0; renderAll();
  }
  function buildCheckboxGroup(containerId, stateKey, values, labelFunction, compact) {
    var container = $(containerId); container.textContent = '';
    values.forEach(function (value, index) {
      var label = document.createElement('label'); label.className = 'filter-option';
      var checkbox = document.createElement('input'); checkbox.type = 'checkbox'; checkbox.value = String(value); checkbox.dataset.state = stateKey; checkbox.id = containerId + '-' + index;
      var text = document.createElement('span'); text.textContent = labelFunction ? labelFunction(value) : String(value);
      label.append(checkbox, text); container.appendChild(label);
      checkbox.addEventListener('change', function () { if (checkbox.checked) state[stateKey].add(checkbox.value); else state[stateKey].delete(checkbox.value); updateFilterSummaries(); state.page = 0; renderAll(); });
    });
  }
  function initializeFilters() {
    var neighborhoodSelect = $('neighborhood-filter');
    data.neighborhoods.map(function (item) { return item.name; }).sort(function (a, b) { return a.localeCompare(b, 'es'); }).forEach(function (name) {
      var option = document.createElement('option'); option.value = name; option.textContent = name; neighborhoodSelect.appendChild(option);
    });
    var allParcels = data.parcels;
    var allBuildings = data.buildings;
    buildCheckboxGroup('risk-options', 'risks', orderedValues(new Map(allParcels.concat(allBuildings).filter(function (r) { return r.risk; }).map(function (r) { return [r.risk, 1]; })), riskOrder), function (v) { return riskLabels[v] || v; });
    buildCheckboxGroup('threat-options', 'threats', orderedValues(new Map(allParcels.concat(allBuildings).filter(function (r) { return r.threat; }).map(function (r) { return [r.threat, 1]; })), threatOrder), function (v) { return threatLabels[v] || v; });
    buildCheckboxGroup('property-type-options', 'types', Array.from(new Set(allParcels.map(function (r) { return r.landType; }).filter(Boolean))).sort(function (a, b) { return a.localeCompare(b, 'es'); }), function (value) { return value === 'Predio.Privado' ? 'Predio privado' : (value === 'Predio.Publico.Uso_Publico' ? 'Predio público · uso público' : value); });
    buildCheckboxGroup('land-use-options', 'destinations', Array.from(new Set(allParcels.map(function (r) { return r.destination; }).filter(Boolean))).sort(function (a, b) { return a.localeCompare(b, 'es'); }));
    buildCheckboxGroup('floors-options', 'floors', Array.from(new Set(allBuildings.map(function (r) { return r.floors; }).filter(function (v) { return v != null; }))).sort(function (a, b) { return a - b; }));
    document.querySelectorAll('.multi-filter details').forEach(function (details) {
      details.addEventListener('toggle', function () { if (details.open) document.querySelectorAll('.multi-filter details').forEach(function (other) { if (other !== details) other.open = false; }); });
    });
    neighborhoodSelect.addEventListener('change', function () { state.neighborhood = neighborhoodSelect.value; state.page = 0; renderAll(); });
    $('global-search').addEventListener('input', debounce(function () { state.search = norm($('global-search').value); state.page = 0; renderAll(); }, 180));
    $('table-search').addEventListener('input', debounce(function () { state.tableSearch = norm($('table-search').value); state.page = 0; renderTable(); }, 120));
    $('map-theme').addEventListener('change', function () { state.mapTheme = $('map-theme').value; renderMap(); });
    $('clear-filters').addEventListener('click', resetFilters);
    $('reset-filters').addEventListener('click', resetFilters);
    $('fullscreen-button').addEventListener('click', function () { if (!document.fullscreenElement) document.documentElement.requestFullscreen().catch(function () {}); else document.exitFullscreen(); });
    $('table-prev').addEventListener('click', function () { state.page = Math.max(0, state.page - 1); renderTable(); });
    $('table-next').addEventListener('click', function () { state.page++; renderTable(); });
    document.querySelectorAll('[data-record-tab]').forEach(function (button) { button.addEventListener('click', function () { state.tableKind = button.dataset.recordTab; state.page = 0; state.sortKey = 'sourceId'; state.sortDirection = 1; document.querySelectorAll('[data-record-tab]').forEach(function (other) { var active = other === button; other.classList.toggle('active', active); other.setAttribute('aria-selected', String(active)); }); renderTable(); }); });
    $('export-csv').addEventListener('click', exportCsv);
    $('export-xlsx').addEventListener('click', exportXlsx);
    $('export-pdf').addEventListener('click', function () { window.print(); });
    window.addEventListener('keydown', function (event) { if (event.key === 'Escape') document.querySelectorAll('.multi-filter details[open]').forEach(function (d) { d.open = false; }); });
  }
  function debounce(fn, delay) { var timer; return function () { window.clearTimeout(timer); timer = window.setTimeout(fn, delay); }; }
  function resetFilters() {
    state.neighborhood = 'all'; state.risks.clear(); state.threats.clear(); state.types.clear(); state.destinations.clear(); state.floors.clear(); state.search = ''; state.tableSearch = ''; state.page = 0; state.selectedRecord = null;
    $('neighborhood-filter').value = 'all'; $('global-search').value = ''; $('table-search').value = '';
    syncChecks(); renderAll();
  }

  function tableRecords() {
    var records = filteredRecords(state.tableKind);
    var query = state.tableSearch;
    if (query) records = records.filter(function (record) {
      return [record.identifier, record.secondaryId, record.landType, record.destination, record.neighborhood, record.risk, record.threat, record.floors, record.area].join(' ').toLocaleLowerCase('es').indexOf(query) !== -1;
    });
    return records.slice().sort(function (a, b) {
      var av = a[state.sortKey], bv = b[state.sortKey];
      var an = numeric(av), bn = numeric(bv);
      var comparison = an != null && bn != null ? an - bn : safeText(av).localeCompare(safeText(bv), 'es', { numeric: true, sensitivity: 'base' });
      return comparison * state.sortDirection;
    });
  }
  function tableColumns(kind) {
    return kind === 'parcels' ? [
      ['sourceId', 'Registro fuente'], ['sourceRows', 'Filas unidas'], ['identifier', 'N\u00FAmero predial'], ['landType', 'Tipo de predio'], ['destination', 'Destinaci\u00F3n'], ['area', '\u00C1rea geom\u00E9trica (m2)'], ['risk', 'Riesgo'], ['threat', 'Amenaza'], ['neighborhood', 'Barrio']
    ] : [
      ['sourceId', 'Registro fuente'], ['sourceRows', 'Filas unidas'], ['identifier', 'CBML'], ['secondaryId', 'ID construcci\u00F3n'], ['floors', 'N\u00FAmero de pisos'], ['area', '\u00C1rea geom\u00E9trica (m2)'], ['risk', 'Riesgo'], ['threat', 'Amenaza'], ['neighborhood', 'Barrio']
    ];
  }
  function tableCellValue(record, key) {
    if (record.conflicts && record.conflicts[key]) return 'Valores distintos en filas unidas';
    if ((key === 'identifier' && record.identifierCount > 1) || (key === 'secondaryId' && record.secondaryIdentifierCount > 1)) return record[key === 'identifier' ? 'identifierCount' : 'secondaryIdentifierCount'] + ' identificadores comparten geometr\u00EDa';
    if (key === 'area') return record.area == null ? 'Sin dato' : decimalFormatter.format(record.area);
    if (key === 'risk') return record.risk || 'Sin clasificación';
    if (key === 'threat') return record.threat || 'Sin clasificación';
    if (key === 'floors') return record.floors == null ? 'Sin dato' : formatNumber(record.floors);
    return safeText(record[key]) || '—';
  }
  function renderTable() {
    if (!data[state.tableKind].length) return;
    var records = tableRecords();
    var columns = tableColumns(state.tableKind);
    var head = $('records-head'); head.textContent = '';
    var headerRow = document.createElement('tr');
    columns.forEach(function (column) {
      var th = document.createElement('th'); var button = document.createElement('button'); button.type = 'button'; button.textContent = column[1] + (state.sortKey === column[0] ? (state.sortDirection > 0 ? ' ↑' : ' ↓') : '');
      button.addEventListener('click', function () { state.sortDirection = state.sortKey === column[0] ? -state.sortDirection : 1; state.sortKey = column[0]; renderTable(); });
      th.appendChild(button); headerRow.appendChild(th);
    });
    head.appendChild(headerRow);
    var body = $('records-body'); body.textContent = '';
    var pageCount = Math.max(1, Math.ceil(records.length / pageSize));
    state.page = Math.min(state.page, pageCount - 1);
    var pageRecords = records.slice(state.page * pageSize, (state.page + 1) * pageSize);
    if (!pageRecords.length) {
      var emptyRow = document.createElement('tr'); var emptyCell = document.createElement('td'); emptyCell.className = 'empty-cell'; emptyCell.colSpan = columns.length; emptyCell.textContent = 'No hay registros para los filtros seleccionados.'; emptyRow.appendChild(emptyCell); body.appendChild(emptyRow);
    }
    pageRecords.forEach(function (record) {
      var row = document.createElement('tr'); row.dataset.recordId = String(record.sourceId); row.classList.toggle('selected', state.selectedRecord === record);
      row.setAttribute('aria-label', 'Acercar al registro ' + record.sourceId);
      columns.forEach(function (column) { var cell = document.createElement('td'); cell.textContent = tableCellValue(record, column[0]); row.appendChild(cell); });
      row.addEventListener('click', function () { selectRecord(record); }); body.appendChild(row);
    });
    $('table-status').textContent = formatNumber(records.length) + ' registros en esta tabla · ' + formatNumber(filteredRecords(state.tableKind).length) + ' con filtros globales';
    $('table-page').textContent = (records.length ? state.page + 1 : 0) + ' de ' + (records.length ? pageCount : 0);
    $('table-prev').disabled = state.page <= 0;
    $('table-next').disabled = state.page >= pageCount - 1 || records.length === 0;
    $('table-prev').onclick = function () { state.page = Math.max(0, state.page - 1); renderTable(); };
    $('table-next').onclick = function () { state.page = Math.min(pageCount - 1, state.page + 1); renderTable(); };
  }
  function selectRecord(record) {
    state.selectedRecord = record;
    state.tableKind = record.kind;
    document.querySelectorAll('[data-record-tab]').forEach(function (button) { var active = button.dataset.recordTab === record.kind; button.classList.toggle('active', active); button.setAttribute('aria-selected', String(active)); });
    selectionLayer.clearLayers();
    var feature = { type: 'Feature', properties: {}, geometry: record.geometry };
    selectionLayer.addData(feature);
    var bounds = selectionLayer.getBounds();
    if (bounds.isValid()) map.fitBounds(bounds, { padding: [35, 35], maxZoom: 18, animate: true });
    state.page = 0; renderAll();
  }

  function exportableRows(kind, useTableSearch) {
    var records = filteredRecords(kind);
    if (useTableSearch && kind === state.tableKind && state.tableSearch) {
      var query = state.tableSearch;
      records = records.filter(function (r) { return [r.identifier, r.secondaryId, r.landType, r.destination, r.neighborhood, r.risk, r.threat, r.floors, r.area].join(' ').toLocaleLowerCase('es').indexOf(query) !== -1; });
    }
    return records;
  }
  function recordExportRow(record, kind) {
    if (kind === 'parcels') return { numero_pre: record.identifier, tipo_predi: record.landType, destinacio: record.destination, Shape_Area: record.area, riesgo: record.risk, categoria: record.threat, barrio: record.neighborhood };
    return { cbml: record.identifier, id_constru: record.secondaryId, numero_pis: record.floors, Shape_Area: record.area, riesgo: record.risk, categoria: record.threat, barrio: record.neighborhood };
  }
  function triggerDownload(blob, filename) {
    var url = URL.createObjectURL(blob); var link = document.createElement('a'); link.href = url; link.download = filename; document.body.appendChild(link); link.click(); link.remove(); window.setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }
  function exportCsv() {
    var kind = state.tableKind; var rows = exportableRows(kind, true).map(function (record) { return recordExportRow(record, kind); });
    if (!rows.length) { $('table-status').textContent = 'No hay filas para exportar con los filtros actuales.'; return; }
    var headers = Object.keys(rows[0]);
    var csv = [headers.map(csvCell).join(',')].concat(rows.map(function (row) { return headers.map(function (key) { return csvCell(row[key]); }).join(','); })).join('\r\n');
    triggerDownload(new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' }), 'geomanrique_' + kind + '_filtrados.csv');
  }
  function csvCell(value) { var text = value == null ? '' : String(value); return '"' + text.replace(/"/g, '""') + '"'; }
  function exportXlsx() {
    if (!window.XLSX || !window.XLSX.utils) { $('table-status').textContent = 'No se cargó SheetJS; revisa la conexión e inténtalo de nuevo.'; return; }
    var parcels = exportableRows('parcels', true).map(function (r) { return recordExportRow(r, 'parcels'); });
    var buildings = exportableRows('buildings', true).map(function (r) { return recordExportRow(r, 'buildings'); });
    var workbook = XLSX.utils.book_new();
    var indicators = [
      { Indicador: 'Predios filtrados', Valor: filteredRecords('parcels').length, Unidad: 'registros' },
      { Indicador: 'Construcciones filtradas', Valor: filteredRecords('buildings').length, Unidad: 'registros' },
      { Indicador: 'Área geométrica predial', Valor: sumArea(filteredRecords('parcels')), Unidad: 'm²' },
      { Indicador: 'Área geométrica construida', Valor: sumArea(filteredRecords('buildings')), Unidad: 'm²' },
      { Indicador: 'Filas fuente de predios', Valor: data.sourceRows.parcels, Unidad: 'antes de agrupar geometrias repetidas' },
      { Indicador: 'Filas fuente de construcciones', Valor: data.sourceRows.buildings, Unidad: 'antes de agrupar geometrias repetidas' },
      { Indicador: 'Filtros aplicados', Valor: describeFilters(), Unidad: '' },
      { Indicador: 'Generado', Valor: new Date().toLocaleString('es-CO'), Unidad: '' }
    ];
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(indicators), 'Indicadores');
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(categorySummary(filteredRecords('parcels'), filteredRecords('buildings'), 'risk')), 'Frecuencia riesgo');
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(categorySummary(filteredRecords('parcels'), filteredRecords('buildings'), 'threat')), 'Frecuencia amenaza');
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(parcels), 'Predios filtrados');
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(buildings), 'Construcciones filtradas');
    XLSX.writeFileXLSX(workbook, 'geomanrique_analisis_territorial.xlsx');
  }
  function categorySummary(parcels, buildings, key) {
    var categories = key === 'risk' ? riskOrder : threatOrder;
    var labelMap = key === 'risk' ? riskLabels : threatLabels;
    var pTotal = parcels.filter(function (r) { return !!r[key]; }).length;
    var bTotal = buildings.filter(function (r) { return !!r[key]; }).length;
    return categories.map(function (category) {
      var p = parcels.filter(function (r) { return r[key] === category; }).length;
      var b = buildings.filter(function (r) { return r[key] === category; }).length;
      return { Categoria: category, Etiqueta: labelMap[category] || category, Predios: p, 'Porcentaje predios clasificados': pTotal ? p * 100 / pTotal : 0, Construcciones: b, 'Porcentaje construcciones clasificadas': bTotal ? b * 100 / bTotal : 0 };
    });
  }
  function describeFilters() {
    var filters = [];
    if (state.neighborhood !== 'all') filters.push('Barrio: ' + state.neighborhood);
    if (state.risks.size) filters.push('Riesgo: ' + Array.from(state.risks).join('; '));
    if (state.threats.size) filters.push('Amenaza: ' + Array.from(state.threats).join('; '));
    if (state.types.size) filters.push('Tipo de predio: ' + Array.from(state.types).join('; '));
    if (state.destinations.size) filters.push('Destinación: ' + Array.from(state.destinations).join('; '));
    if (state.floors.size) filters.push('Pisos: ' + Array.from(state.floors).join('; '));
    if (state.search) filters.push('Búsqueda: ' + state.search);
    return filters.join(' | ') || 'Ninguno';
  }

  function renderAll() {
    if (!data.parcels.length || !data.buildings.length) return;
    var parcels = filteredRecords('parcels'); var buildings = filteredRecords('buildings');
    renderKpis(parcels, buildings);
    renderRiskChart(); renderThreatChart(); renderLandUseChart(); renderTypeChart(); renderFloorsChart();
    renderMap(); renderTable(); updateFilterSummaries();
    if (state.selectedRecord && !filteredRecords(state.selectedRecord.kind).includes(state.selectedRecord)) { state.selectedRecord = null; selectionLayer.clearLayers(); }
    if (state.selectedRecord) document.querySelectorAll('#records-body tr').forEach(function (row) { row.classList.toggle('selected', Number(row.dataset.recordId) === state.selectedRecord.sourceId); });
  }

  async function loadDashboard() {
    if (!window.L || !window.shp || !window.echarts) throw new Error('Falta una biblioteca de mapas, gráficos o lectura de shapefiles. Revisa tu conexión a internet y recarga.');
    setLoading('Leyendo la geometría de los cuatro barrios…');
    var tasks = [
      fetch('data/dashboard_attributes.json').then(function (response) { if (!response.ok) throw new Error('No se encontró el paquete seguro de atributos del dashboard.'); return response.json(); }),
      window.shp('data/BARRIOS_INFLUENCIA/Barrios'),
      loadGeometryOnly('data/Predios_Barrios_Estudio/Predios_Estudio', 'predios'),
      loadGeometryOnly('data/Construcciones_Barrios_Estudio/Construcciones', 'construcciones')
    ];
    var loaded = await Promise.all(tasks);
    var attributeData = loaded[0];
    var boundaryData = Array.isArray(loaded[1]) ? loaded[1][0] : loaded[1];
    if (!attributeData || attributeData.schemaVersion !== 1 || !Array.isArray(attributeData.parcels) || !Array.isArray(attributeData.buildings)) throw new Error('El paquete de atributos del dashboard tiene un formato no compatible.');
    if (!boundaryData || !Array.isArray(boundaryData.features)) throw new Error('No se pudo interpretar el límite de barrios.');
    data.neighborhoods = boundaryData.features.map(function (feature) { return { name: neighborhoodName(feature), geometry: feature.geometry, feature: feature }; }).filter(function (item) { return item.name && item.geometry; });
    if (data.neighborhoods.length !== 4) throw new Error('Se esperaban cuatro polígonos de barrio y se encontraron ' + data.neighborhoods.length + '.');
    setLoading('Organizando atributos y ubicando registros por barrio…');
    var combined = await Promise.all([
      combineGeometries(loaded[2], attributeData.parcels, 'parcels', data.neighborhoods),
      combineGeometries(loaded[3], attributeData.buildings, 'buildings', data.neighborhoods)
    ]);
    data.parcels = combined[0]; data.buildings = combined[1];
    data.sourceRows.parcels = attributeData.parcels.length; data.sourceRows.buildings = attributeData.buildings.length;
    initializeFilters(); initMap(); initCharts(); createNeighborhoodLayer(); renderAll();
    $('dedupe-note').textContent = formatNumber(data.sourceRows.parcels) + ' filas fuente prediales se agruparon en ' + formatNumber(data.parcels.length) + ' geometr\u00EDas \u00FAnicas (' + formatNumber(data.sourceRows.parcels - data.parcels.length) + ' copias exactas); ' + formatNumber(data.sourceRows.buildings) + ' filas fuente de construcciones en ' + formatNumber(data.buildings.length) + ' geometr\u00EDas \u00FAnicas (' + formatNumber(data.sourceRows.buildings - data.buildings.length) + ' copias exactas). Los atributos en conflicto se excluyen de los res\u00FAmenes de categor\u00EDa y valores num\u00E9ricos.';
    var generated = new Date(attributeData.generatedAt);
    $('data-stamp').textContent = 'Atributos preparados: ' + (Number.isNaN(generated.valueOf()) ? 'fuentes del proyecto' : generated.toLocaleDateString('es-CO', { day: 'numeric', month: 'short', year: 'numeric' }));
    setLoading(formatNumber(data.parcels.length) + ' predios y ' + formatNumber(data.buildings.length) + ' construcciones listos.');
    window.setTimeout(function () { $('loading-overlay').classList.add('hidden'); }, 300);
  }

  loadDashboard().catch(function (error) {
    console.error('Dashboard GEOMANRIQUE:', error);
    showError('No se pudo preparar el dashboard: ' + (error && error.message ? error.message : 'error desconocido') + ' Comprueba que los archivos del proyecto estén disponibles y recarga la página.');
  });
}());
