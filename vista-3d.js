import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { LineSegments2 } from "three/addons/lines/LineSegments2.js";
import { LineSegmentsGeometry } from "three/addons/lines/LineSegmentsGeometry.js";
import { LineMaterial } from "three/addons/lines/LineMaterial.js";
import { fromArrayBuffer } from "geotiff";

const CONFIG = Object.freeze({
  verticalScale: 1.0,
  demUrl: "data/Raster/DEM/DEM_5m.tif",
  worldFileUrl: "data/Raster/DEM/DEM_5m.tfw",
  slopeUrl: "data/Raster/Pendiente/5metros_Slope.tif",
  slopeWorldFileUrl: "data/Raster/Pendiente/5metros_Slope.tfw",
  buildingsUrl: "data/Construcciones_Barrios_Estudio/Construcciones.shp",
  buildingsIndexUrl: "data/Construcciones_Barrios_Estudio/Construcciones.shx",
  buildingsAttributesUrl: "data/Construcciones_Barrios_Estudio/Construcciones.dbf",
  buildingsEncodingUrl: "data/Construcciones_Barrios_Estudio/Construcciones.cpg",
  buildingsProjectionUrl: "data/Construcciones_Barrios_Estudio/Construcciones.prj",
  parcelsUrl: "data/Predios_Barrios_Estudio/Predios_Estudio.shp",
  parcelsIndexUrl: "data/Predios_Barrios_Estudio/Predios_Estudio.shx",
  parcelsProjectionUrl: "data/Predios_Barrios_Estudio/Predios_Estudio.prj",
  parcelsAttributesUrl: "data/Predios_Barrios_Estudio/Predios_Estudio.dbf",
  parcelsEncodingUrl: "data/Predios_Barrios_Estudio/Predios_Estudio.cpg",
  riskUrl: "data/RIESGO_MOV_MASA/RIESGO_MOV_MASA.shp",
  riskIndexUrl: "data/RIESGO_MOV_MASA/RIESGO_MOV_MASA.shx",
  riskAttributesUrl: "data/RIESGO_MOV_MASA/RIESGO_MOV_MASA.dbf",
  riskEncodingUrl: "data/RIESGO_MOV_MASA/RIESGO_MOV_MASA.cpg",
  riskProjectionUrl: "data/RIESGO_MOV_MASA/RIESGO_MOV_MASA.prj",
  threatUrl: "data/Amenaza_Mov_Masa/Amenaza_Mov_Masa.shp",
  threatIndexUrl: "data/Amenaza_Mov_Masa/Amenaza_Mov_Masa.shx",
  threatAttributesUrl: "data/Amenaza_Mov_Masa/Amenaza_Mov_Masa.dbf",
  threatEncodingUrl: "data/Amenaza_Mov_Masa/Amenaza_Mov_Masa.cpg",
  threatProjectionUrl: "data/Amenaza_Mov_Masa/Amenaza_Mov_Masa.prj",
  bufferUrl: "data/BARRIOS_INFLUENCIA/Barrios.shp",
  bufferIndexUrl: "data/BARRIOS_INFLUENCIA/Barrios.shx",
  bufferProjectionUrl: "data/BARRIOS_INFLUENCIA/Barrios.prj",
  estimatedHeightPerFloor: 2.1,
  terrainSkirtDepthMeters: 80,
  focusMarginMeters: 0,
  manifestUrl: "data/Raster/ortho_tiles_3d/tiles.json",
  textureFolderUrl: "data/Raster/ortho_tiles_3d/",
  extentToleranceMeters: 0.00001,
  maxPixelRatio: 0.9
});

const container = document.getElementById("threeContainer");
const statusEl = document.getElementById("load-state");
const compassNeedle = document.getElementById("compass-needle");
const compassCardinals = document.getElementById("compass-cardinals");
const northInView = new THREE.Vector3();
let renderer;
let rendererBackend = "";
let controls;
const wideLineMaterials = new Set();
let animationFrame;
let requestSceneRender = () => {};

function yieldToBrowser() {
  return new Promise(resolve => setTimeout(resolve, 0));
}

function addWideLineSegments(parent, sourceGeometry, { color, width = 2.5, opacity = 1, depthTest = true, renderOrder = 4 }) {
  const sourcePositions = sourceGeometry.getAttribute("position");
  if (!sourcePositions || !sourcePositions.count) return null;
  const geometry = new LineSegmentsGeometry();
  geometry.setPositions(sourcePositions.array);
  const sourceColors = sourceGeometry.getAttribute("color");
  if (sourceColors) geometry.setColors(sourceColors.array);
  const material = new LineMaterial({
    color,
    vertexColors: Boolean(sourceColors),
    linewidth: width,
    worldUnits: false,
    transparent: opacity < 1,
    opacity,
    depthTest,
    depthWrite: false,
    toneMapped: false
  });
  material.resolution.set(Math.max(1, container.clientWidth), Math.max(1, container.clientHeight));
  wideLineMaterials.add(material);
  const lines = new LineSegments2(geometry, material);
  lines.name = "wide_" + (parent.name || "layer") + "_outlines";
  lines.renderOrder = renderOrder;
  parent.add(lines);
  return lines;
}

function setStatus(message, kind = "info") {
  statusEl.textContent = message;
  statusEl.classList.toggle("is-error", kind === "error");
  statusEl.classList.toggle("is-warning", kind === "warning");
}

function closeEnough(a, b, tolerance = CONFIG.extentToleranceMeters) {
  return Math.abs(a - b) <= tolerance;
}

function formatNumber(value, digits = 2) {
  return new Intl.NumberFormat("es-CO", { maximumFractionDigits: digits }).format(value);
}

const RISK_SYMBOLS = Object.freeze([
  { key: "alto-no-mitigable", label: "Alto riesgo no mitigable", hex: 0xb42332, css: "#b42332" },
  { key: "alto-mitigable", label: "Alto riesgo mitigable", hex: 0xe87516, css: "#e87516" },
  { key: "medio", label: "Riesgo medio", hex: 0xd6a41d, css: "#d6a41d" },
  { key: "condiciones", label: "Con condiciones de riesgo", hex: 0x8b9d26, css: "#8b9d26" },
  { key: "bajo", label: "Riesgo bajo", hex: 0x21845b, css: "#21845b" },
  { key: "sin-clasificar", label: "Sin clasificación de riesgo", hex: 0x78879a, css: "#78879a" }
]);

const THREAT_SYMBOLS = Object.freeze([
  { key: "alta", label: "Amenaza alta", hex: 0xb42332, css: "#b42332" },
  { key: "media", label: "Amenaza media", hex: 0xe98b16, css: "#e98b16" },
  { key: "baja", label: "Amenaza baja", hex: 0x21845b, css: "#21845b" },
  { key: "sin-clasificar", label: "Amenaza sin clasificar", hex: 0x78879a, css: "#78879a" }
]);

function normalizeCategory(value) {
  return String(value == null ? "" : value).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

function riskSymbol(value) {
  const text = normalizeCategory(value);
  if (text.includes("nomitigable")) return RISK_SYMBOLS[0];
  if (text.includes("mitigable")) return RISK_SYMBOLS[1];
  if (text.includes("medio")) return RISK_SYMBOLS[2];
  if (text.includes("condiciones")) return RISK_SYMBOLS[3];
  if (text.includes("bajo")) return RISK_SYMBOLS[4];
  return RISK_SYMBOLS[5];
}

function threatSymbol(value) {
  const text = normalizeCategory(value);
  if (text.includes("alta")) return THREAT_SYMBOLS[0];
  if (text.includes("media")) return THREAT_SYMBOLS[1];
  if (text.includes("baja")) return THREAT_SYMBOLS[2];
  return THREAT_SYMBOLS[3];
}

function setFeatureRiskColors(layer, featureMap, enabled) {
  const neutral = new THREE.Color(0x8b9299);
  layer.traverse(object => {
    const ids = object.geometry && object.geometry.getAttribute("featureId");
    const colors = object.geometry && object.geometry.getAttribute("color");
    if (!ids || !colors) return;
    const color = new THREE.Color();
    for (let vertex = 0; vertex < ids.count; vertex++) {
      const feature = featureMap.get(Math.round(ids.getX(vertex)));
      const value = feature && (feature.riskCategory || feature.Cat_Riesgo || feature.cat_riesgo || feature.riesgo || feature.categoria);
      color.set(enabled && feature ? riskSymbol(value).hex : neutral);
      colors.setXYZ(vertex, color.r, color.g, color.b);
    }
    colors.needsUpdate = true;
  });
  requestSceneRender();
}

async function loadJson(url) {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) throw new Error("No se pudo leer " + url + " (HTTP " + response.status + ").");
  return response.json();
}

async function loadWorldFile(url) {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) throw new Error("No se pudo leer el archivo de georreferencia del DEM.");
  const values = (await response.text()).trim().split(/\s+/).map(Number);
  if (values.length !== 6 || values.some(value => !Number.isFinite(value))) {
    throw new Error("El archivo TFW no contiene seis valores numéricos válidos.");
  }
  return values;
}

async function loadDem(url) {
  let response;
  try {
    response = await fetch(url, { cache: "no-store" });
  } catch (error) {
    throw new Error("El navegador no pudo solicitar el GeoTIFF: " + (error && error.message ? error.message : error));
  }
  if (!response.ok) throw new Error("El GeoTIFF respondió HTTP " + response.status + ".");
  const data = await response.arrayBuffer();
  if (data.byteLength < 8) throw new Error("La respuesta del GeoTIFF está vacía o incompleta.");
  try {
    return await fromArrayBuffer(data);
  } catch (error) {
    throw new Error("El archivo llegó desde el servidor, pero geotiff.js no pudo interpretarlo: " + (error && error.message ? error.message : error));
  }
}

const SLOPE_CLASSES = Object.freeze([
  { code: 1, label: "Ligeramente plano · 0–3 %", color: [0, 97, 40] },
  { code: 2, label: "Ligeramente inclinado · >3–7 %", color: [85, 145, 0] },
  { code: 3, label: "Moderadamente inclinado · >7–12 %", color: [164, 196, 0] },
  { code: 4, label: "Fuertemente inclinado · >12–25 %", color: [0, 255, 197] },
  { code: 5, label: "Moderadamente escarpado · >25–50 %", color: [255, 186, 0] },
  { code: 6, label: "Escarpado · >50–75 %", color: [255, 0, 0] },
  { code: 7, label: "Muy escarpado · >75 %", color: [0, 0, 0] }
]);

function rasterClassTexture(values, width, height) {
  const canvas = document.createElement("canvas");
  canvas.width = width; canvas.height = height;
  const context = canvas.getContext("2d", { alpha: true });
  if (!context) throw new Error("No se pudo crear la textura de pendientes.");
  const image = context.createImageData(width, height);
  for (let i = 0; i < values.length; i++) {
    const code = Math.round(Number(values[i]));
    const category = SLOPE_CLASSES[code - 1];
    if (!category || category.code !== code) continue;
    const at = i * 4;
    image.data[at] = category.color[0]; image.data[at + 1] = category.color[1]; image.data[at + 2] = category.color[2];
    image.data[at + 3] = 224;
  }
  context.putImageData(image, 0, 0);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.NearestFilter;
  return texture;
}

function createHillshadeTexture(values, mask, width, height) {
  const canvas = document.createElement("canvas");
  canvas.width = width; canvas.height = height;
  const context = canvas.getContext("2d", { alpha: true });
  if (!context) throw new Error("No se pudo crear la textura de sombreado.");
  const image = context.createImageData(width, height);
  const azimuth = 315 * Math.PI / 180, altitude = 45 * Math.PI / 180;
  const light = [Math.sin(azimuth) * Math.cos(altitude), Math.cos(azimuth) * Math.cos(altitude), Math.sin(altitude)];
  for (let row = 1; row < height - 1; row++) for (let col = 1; col < width - 1; col++) {
    const i = row * width + col;
    if (mask[i] || mask[i - width - 1] || mask[i - width] || mask[i - width + 1] || mask[i - 1] || mask[i + 1] || mask[i + width - 1] || mask[i + width] || mask[i + width + 1]) continue;
    const a = values[i - width - 1], b = values[i - width], c = values[i - width + 1];
    const d = values[i - 1], f = values[i + 1];
    const g = values[i + width - 1], h = values[i + width], k = values[i + width + 1];
    const dzdx = (c + 2 * f + k - a - 2 * d - g) / 40;
    const dzdy = (g + 2 * h + k - a - 2 * b - c) / 40;
    const length = Math.hypot(dzdx, dzdy, 1);
    // Raster rows increase southward, so the north-facing normal uses +dzdy.
    const shade = Math.max(0, (-dzdx * light[0] + dzdy * light[1] + light[2]) / length);
    const gray = Math.round(45 + shade * 210), at = i * 4;
    image.data[at] = image.data[at + 1] = image.data[at + 2] = gray;
    image.data[at + 3] = 112;
  }
  context.putImageData(image, 0, 0);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  return texture;
}

function makeDrapedRasterLayer(name, tileMeshes, extent, texture, renderOrder) {
  const layer = new THREE.Group();
  layer.name = name;
  for (const source of tileMeshes) {
    const geometry = source.geometry.clone();
    const positions = geometry.getAttribute("position");
    for (let i = 1; i < positions.array.length; i += 3) positions.array[i] += 0.4;
    positions.needsUpdate = true;
    geometry.computeBoundingSphere();
    const map = texture.clone();
    map.repeat.set((source.userData.bbox.xmax - source.userData.bbox.xmin) / (extent.xmax - extent.xmin), (source.userData.bbox.ymax - source.userData.bbox.ymin) / (extent.ymax - extent.ymin));
    map.offset.set((source.userData.bbox.xmin - extent.xmin) / (extent.xmax - extent.xmin), (source.userData.bbox.ymin - extent.ymin) / (extent.ymax - extent.ymin));
    map.needsUpdate = true;
    const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ map, transparent: true, depthWrite: false, side: THREE.DoubleSide, toneMapped: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 }));
    mesh.renderOrder = renderOrder;
    mesh.name = name + "_" + source.userData.filename;
    layer.add(mesh);
  }
  layer.userData = { crs: "EPSG:9377", sourceResolutionMeters: 5, drawCalls: layer.children.length };
  return layer;
}

// Reads only the three DBF fields needed for the explicitly authorized height estimate.
async function loadBuildingFootprints(url, indexUrl, projectionUrl) {
  const [shapeResponse, indexResponse, projectionResponse] = await Promise.all([
    fetch(url, { cache: "no-store" }), fetch(indexUrl, { cache: "no-store" }), fetch(projectionUrl, { cache: "no-store" })
  ]);
  if (!shapeResponse.ok) throw new Error("No se pudo leer " + url + " (HTTP " + shapeResponse.status + ").");
  if (!indexResponse.ok) throw new Error("No se pudo leer el índice " + indexUrl + ".");
  if (!projectionResponse.ok) throw new Error("No se pudo leer el .prj de las construcciones.");
  const projection = (await projectionResponse.text()).toLowerCase();
  if (!projection.includes("transverse_mercator") || !projection.includes("false_easting") || !projection.includes("central_meridian") || !projection.includes("meter")) {
    throw new Error("El .prj de las construcciones no confirma MAGNA-SIRGAS Origen Nacional en metros.");
  }
  const buffer = await shapeResponse.arrayBuffer();
  const indexBuffer = await indexResponse.arrayBuffer();
  const view = new DataView(buffer);
  if (buffer.byteLength < 100 || view.getInt32(0, false) !== 9994) throw new Error(url + " no es un shapefile válido.");
  if (view.getInt32(24, false) * 2 !== buffer.byteLength) throw new Error("La longitud declarada del SHP no coincide con el archivo.");
  const declaredType = view.getInt32(32, true);
  if (![5, 15, 25].includes(declaredType)) throw new Error("El SHP de construcciones no declara geometría poligonal (tipo " + declaredType + ").");
  const indexView = new DataView(indexBuffer);
  if (indexBuffer.byteLength < 100 || indexView.getInt32(0, false) !== 9994 || indexView.getInt32(24, false) * 2 !== indexBuffer.byteLength || indexView.getInt32(28, true) !== 1000 || indexView.getInt32(32, true) !== declaredType) {
    throw new Error("El SHX de construcciones no corresponde al encabezado del SHP.");
  }
  const features = [];
  let offset = 100, recordCount = 0, partCount = 0, pointCount = 0;
  while (offset < buffer.byteLength) {
    if (offset + 8 > buffer.byteLength) throw new Error("El SHP de construcciones termina en medio de un encabezado.");
    const contentBytes = view.getInt32(offset + 4, false) * 2;
    const start = offset + 8, end = start + contentBytes;
    if (contentBytes < 4 || end > buffer.byteLength) throw new Error("El SHP de construcciones contiene un registro incompleto.");
    const recordNumber = view.getInt32(offset, false);
    const indexEntry = 100 + recordCount * 8;
    if (indexEntry + 8 > indexBuffer.byteLength || indexView.getInt32(indexEntry, false) * 2 !== offset || indexView.getInt32(indexEntry + 4, false) * 2 !== contentBytes) {
      throw new Error("El índice SHX no coincide con el registro " + recordNumber + " del SHP.");
    }
    const type = view.getInt32(start, true);
    recordCount++;
    if (recordNumber !== recordCount) throw new Error("La numeración de registros SHP no es secuencial en " + recordNumber + ".");
    if (type !== 0) {
      if (![5, 15, 25].includes(type)) throw new Error("Tipo de geometría inesperado en construcción " + recordNumber + ": " + type + ".");
      const parts = view.getInt32(start + 36, true), points = view.getInt32(start + 40, true);
      const pointsOffset = start + 44 + parts * 4;
      if (parts < 1 || points < 4 || pointsOffset + points * 16 > end) throw new Error("Geometría incompleta en construcción " + recordNumber + ".");
      const starts = [];
      for (let p = 0; p < parts; p++) starts.push(view.getInt32(start + 44 + p * 4, true));
      starts.push(points);
      const rings = [];
      for (let p = 0; p < parts; p++) {
        const ring = [];
        for (let i = starts[p]; i < starts[p + 1]; i++) {
          const at = pointsOffset + i * 16;
          ring.push({ x: view.getFloat64(at, true), north: view.getFloat64(at + 8, true) });
        }
        if (ring.length >= 4) rings.push(ring);
      }
      if (rings.length) { features.push({ id: recordNumber, rings }); partCount += parts; pointCount += points; }
    }
    offset = end;
    if ((recordCount & 255) === 0) await yieldToBrowser();
  }
  if (indexBuffer.byteLength !== 100 + recordCount * 8) throw new Error("La cantidad de entradas del SHX no coincide con los registros SHP.");
  if (offset !== buffer.byteLength) throw new Error("El tamaño final del SHP no coincide con sus registros.");
  return { features, recordCount, partCount, pointCount, declaredType };
}

// Reads one thematic category field only; parcel owner DBFs are never requested.
async function loadCategoryAttributes(url, encodingUrl, fieldName, extraFields = []) {
  const [dbfResponse, encodingResponse] = await Promise.all([fetch(url, { cache: "no-store" }), fetch(encodingUrl, { cache: "no-store" })]);
  if (!dbfResponse.ok || !encodingResponse.ok) throw new Error("No se pudo leer DBF/CPG de " + fieldName + ".");
  const encoding = (await encodingResponse.text()).trim();
  if (!/^UTF-?8$/i.test(encoding)) throw new Error("Codificación DBF no compatible: " + encoding);
  const buffer = await dbfResponse.arrayBuffer(), view = new DataView(buffer), decoder = new TextDecoder("utf-8", { fatal: true });
  const recordCount = view.getUint32(4, true), headerLength = view.getUint16(8, true), recordLength = view.getUint16(10, true), fields = [];
  if (headerLength < 33 || headerLength + recordCount * recordLength > buffer.byteLength) throw new Error("DBF temático incompleto.");
  let at = 32, offset = 1, target = null;
  while (at < headerLength - 1 && view.getUint8(at) !== 0x0d) {
    const bytes = new Uint8Array(buffer, at, 11), end = bytes.indexOf(0), name = decoder.decode(end < 0 ? bytes : bytes.subarray(0, end)).trim().toLowerCase();
    const field = { name, type: String.fromCharCode(view.getUint8(at + 11)), length: view.getUint8(at + 16), offset };
    fields.push(field); if (name === fieldName.toLowerCase()) target = field;
    offset += field.length; at += 32;
  }
  if (!target || target.type !== "C") throw new Error("No se encontró el campo categórico " + fieldName + ".");
  if (offset !== recordLength) throw new Error("Longitud de campos DBF inconsistente.");
  const requestedFields = [fieldName, ...extraFields].map(name => fields.find(field => field.name === name.toLowerCase())).filter(Boolean);
  const values = new Array(recordCount), records = new Array(recordCount);
  for (let i = 0; i < recordCount; i++) {
    const base = headerLength + i * recordLength;
    if (view.getUint8(base) !== 0x20) throw new Error("Registro DBF temático eliminado o inválido.");
    records[i] = {};
    for (const field of requestedFields) {
      const raw = decoder.decode(new Uint8Array(buffer, base + field.offset, field.length)).trim();
      records[i][field.name] = field.type === "N" || field.type === "F" ? (raw === "" ? null : Number(raw)) : raw;
    }
    values[i] = records[i][fieldName.toLowerCase()];
    if ((i & 511) === 511) await yieldToBrowser();
  }
  return { recordCount, values, records, fieldName, encoding };
}

// Keep parcel inspection limited to cadastral/risk fields; owner identity and valuation fields are not exposed.
async function loadParcelAttributes(url, encodingUrl) {
  const [dbfResponse, encodingResponse] = await Promise.all([fetch(url, { cache: "no-store" }), fetch(encodingUrl, { cache: "no-store" })]);
  if (!dbfResponse.ok || !encodingResponse.ok) throw new Error("No se pudieron leer los atributos catastrales de lotes.");
  const encoding = (await encodingResponse.text()).trim();
  if (!/^UTF-?8$/i.test(encoding)) throw new Error("Codificacion DBF de lotes no compatible: " + encoding);
  const buffer = await dbfResponse.arrayBuffer(), view = new DataView(buffer), decoder = new TextDecoder("utf-8", { fatal: true });
  const recordCount = view.getUint32(4, true), headerLength = view.getUint16(8, true), recordLength = view.getUint16(10, true), fields = [];
  if (headerLength < 33 || headerLength + recordCount * recordLength > buffer.byteLength) throw new Error("DBF de lotes incompleto.");
  let at = 32, offset = 1;
  while (at < headerLength - 1 && view.getUint8(at) !== 0x0d) {
    const bytes = new Uint8Array(buffer, at, 11), end = bytes.indexOf(0), name = decoder.decode(end < 0 ? bytes : bytes.subarray(0, end)).trim().toLowerCase();
    const field = { name, type: String.fromCharCode(view.getUint8(at + 11)), length: view.getUint8(at + 16), offset };
    fields.push(field); offset += field.length; at += 32;
  }
  if (offset !== recordLength) throw new Error("Longitud de campos DBF de lotes inconsistente.");
  const safeNames = ["fid_", "cod_divipo", "numero_pre", "matricula_", "zona", "condicion_", "destinacio", "tipo_predi", "shape_area", "riesgo", "categoria"];
  const safeFields = fields.filter(field => safeNames.includes(field.name));
  const records = new Array(recordCount);
  for (let i = 0; i < recordCount; i++) {
    const base = headerLength + i * recordLength;
    if (view.getUint8(base) !== 0x20) throw new Error("Registro DBF de lote eliminado o invalido.");
    const record = {};
    for (const field of safeFields) {
      const raw = decoder.decode(new Uint8Array(buffer, base + field.offset, field.length)).trim();
      record[field.name] = field.type === "N" || field.type === "F" ? (raw === "" ? null : Number(raw)) : raw;
    }
    records[i] = record;
    if ((i & 511) === 511) await yieldToBrowser();
  }
  return { recordCount, records, encoding };
}

async function loadBuildingAttributes(url, encodingUrl) {
  const [dbfResponse, encodingResponse] = await Promise.all([
    fetch(url, { cache: "no-store" }), fetch(encodingUrl, { cache: "no-store" })
  ]);
  if (!dbfResponse.ok) throw new Error("No se pudo leer el DBF de construcciones (HTTP " + dbfResponse.status + ").");
  if (!encodingResponse.ok) throw new Error("No se pudo leer el CPG de construcciones.");
  const encoding = (await encodingResponse.text()).trim();
  if (!/^UTF-?8$/i.test(encoding)) throw new Error("El CPG declara " + encoding + "; se requiere decodificación explícita antes de leer sus atributos.");
  const buffer = await dbfResponse.arrayBuffer();
  const view = new DataView(buffer);
  if (buffer.byteLength < 33) throw new Error("El DBF de construcciones está incompleto.");
  const recordCount = view.getUint32(4, true);
  const headerLength = view.getUint16(8, true);
  const recordLength = view.getUint16(10, true);
  if (headerLength < 33 || recordLength < 2 || headerLength + recordCount * recordLength > buffer.byteLength) {
    throw new Error("La cabecera o longitud de registros del DBF no es válida.");
  }
  const decoder = new TextDecoder("utf-8", { fatal: true });
  const fields = new Map();
  let descriptorOffset = 32;
  while (descriptorOffset < headerLength - 1 && view.getUint8(descriptorOffset) !== 0x0d) {
    const nameBytes = new Uint8Array(buffer, descriptorOffset, 11);
    const zeroAt = nameBytes.indexOf(0);
    const name = decoder.decode(zeroAt >= 0 ? nameBytes.subarray(0, zeroAt) : nameBytes).trim().toLowerCase();
    const length = view.getUint8(descriptorOffset + 16);
    const type = String.fromCharCode(view.getUint8(descriptorOffset + 11));
    if (name) fields.set(name, { name, type, length });
    descriptorOffset += 32;
  }
  if (view.getUint8(descriptorOffset) !== 0x0d) throw new Error("El DBF no contiene el terminador de campos esperado.");
  if (!fields.has("numero_pis")) throw new Error("La capa de construcciones no incluye numero_pis.");
  for (const name of ["numero_pis", "numero_sot"]) if (fields.has(name) && !["N", "F"].includes(fields.get(name).type)) throw new Error("El campo " + name + " no es numérico en el DBF.");
  let recordFieldOffset = 1;
  for (const field of fields.values()) {
    field.offset = recordFieldOffset;
    recordFieldOffset += field.length;
  }
  if (recordFieldOffset !== recordLength) throw new Error("La suma de longitudes de campos no coincide con el tamaño de registro DBF.");
  const records = new Array(recordCount);
  let estimatedCount = 0;
  let zeroCount = 0;
  for (let index = 0; index < recordCount; index++) {
    const base = headerLength + index * recordLength;
    const deleted = view.getUint8(base);
    if (deleted !== 0x20) throw new Error("El registro DBF " + (index + 1) + " está eliminado o tiene una marca inválida.");
    const readNumber = name => {
      const field = fields.get(name);
      if (!field) return null;
      const start = base + field.offset;
      const raw = decoder.decode(new Uint8Array(buffer, start, field.length)).trim();
      if (!raw) return null;
      const value = Number(raw);
      if (!Number.isFinite(value)) throw new Error("Valor no numérico en " + name + ", registro DBF " + (index + 1) + ".");
      return value;
    };
    const readText = name => {
      const field = fields.get(name);
      if (!field) return "";
      const start = base + field.offset;
      return decoder.decode(new Uint8Array(buffer, start, field.length)).trim();
    };
    const floorValue = readNumber("numero_pis");
    const basementValue = readNumber("numero_sot");
    const floorCount = Number.isFinite(floorValue) && floorValue >= 0 ? floorValue : 0;
    const basementCount = Number.isFinite(basementValue) && basementValue >= 0 ? basementValue : 0;
    if (floorCount > 0) {
      const formulaHeight = floorCount * CONFIG.estimatedHeightPerFloor;
      estimatedCount++;
      records[index] = { recordId: index + 1, cbml: readText("cbml"), floorCount, basementCount, estimatedHeight: formulaHeight, heightStatus: "estimated", riskCategory: readText("cat_riesgo") || readText("riesgo"), threatCategory: readText("cat_amenza") || readText("categoria") };
    } else {
      zeroCount++;
      records[index] = { recordId: index + 1, cbml: readText("cbml"), floorCount, basementCount, estimatedHeight: null, heightStatus: "unknown", riskCategory: readText("cat_riesgo") || readText("riesgo"), threatCategory: readText("cat_amenza") || readText("categoria") };
    }
    if ((index & 511) === 511) await yieldToBrowser();
  }
  return { recordCount, records, estimatedCount, zeroCount, source: url, encoding };
}

function ringArea(ring) {
  if (ring.length < 3) return 0;
  const originX = ring[0].x, originNorth = ring[0].north;
  let area = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    const ax = ring[i].x - originX, an = ring[i].north - originNorth;
    const bx = ring[i + 1].x - originX, bn = ring[i + 1].north - originNorth;
    area += ax * bn - bx * an;
  }
  return area / 2;
}

function pointInRing(point, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i], b = ring[j];
    if ((a.north > point.north) !== (b.north > point.north) && point.x < (b.x - a.x) * (point.north - a.north) / (b.north - a.north) + a.x) inside = !inside;
  }
  return inside;
}

async function addBuildingFootprints(scene, source, values, mask, width, height, extent, originX, originNorth, baseElevation) {
  const fillPositions = [], boundaryPositions = [], featureIds = [], footprintColors = [], skippedFeatures = [];
  let polygonCount = 0, holeCount = 0, failedPolygons = 0;
  for (let featureIndex = 0; featureIndex < source.features.length; featureIndex++) {
    const feature = source.features[featureIndex];
    // Shapefile polygon winding: clockwise shells, counter-clockwise holes.
    // Use winding first; containment provides a fallback for imperfect rings.
    const shells = [], holes = [];
    for (const ring of feature.rings) {
      const openRing = ring.length > 1 && ring[0].x === ring[ring.length - 1].x && ring[0].north === ring[ring.length - 1].north ? ring.slice(0, -1) : ring;
      if (openRing.length < 3) continue;
      (ringArea(ring) < 0 ? shells : holes).push(openRing);
    }
    if (!shells.length && feature.rings.length) shells.push(feature.rings[0].slice(0, -1));
    const assignedHoles = new Map(shells.map(shell => [shell, []]));
    for (const hole of holes) {
      const parent = shells.find(shell => pointInRing(hole[0], shell));
      if (parent) { assignedHoles.get(parent).push(hole); holeCount++; }
      else if (shells.length && shells.length === 1) assignedHoles.get(shells[0]).push(hole);
    }
    let featureValid = false;
    for (const shell of shells) {
      const holeRings = assignedHoles.get(shell) || [];
      const flat = [shell, ...holeRings];
      const points = flat.flat();
      const elevations = points.map(p => sampleRenderedSurfaceElevation(p.x, p.north, values, mask, width, height, extent));
      const contour = shell.map(p => new THREE.Vector2(p.x, p.north));
      const holes2d = holeRings.map(ring => ring.map(p => new THREE.Vector2(p.x, p.north)));
      const triangles = THREE.ShapeUtils.triangulateShape(contour, holes2d);
      if (!triangles.length || elevations.some(e => e === null)) { failedPolygons++; continue; }
      for (const triangle of triangles) for (const index of triangle) {
        const p = points[index], elevation = elevations[index];
        fillPositions.push(p.x - originX, (elevation - baseElevation) * CONFIG.verticalScale + 1.2, p.north - originNorth);
        featureIds.push(feature.id);
        footprintColors.push(0.55, 0.57, 0.60);
      }
      for (const ring of flat) {
        for (let i = 0; i < ring.length; i++) {
          const a = ring[i], b = ring[(i + 1) % ring.length];
          const ea = sampleRenderedSurfaceElevation(a.x, a.north, values, mask, width, height, extent);
          const eb = sampleRenderedSurfaceElevation(b.x, b.north, values, mask, width, height, extent);
          if (ea === null || eb === null) continue;
          boundaryPositions.push(a.x - originX, (ea - baseElevation) * CONFIG.verticalScale + 1.45, a.north - originNorth,
            b.x - originX, (eb - baseElevation) * CONFIG.verticalScale + 1.45, b.north - originNorth);
        }
      }
      featureValid = true; polygonCount++;
    }
    if (!featureValid) skippedFeatures.push(feature.id);
    if ((featureIndex & 31) === 31) await yieldToBrowser();
  }
  const layer = new THREE.Group(); layer.name = "building_footprints_layer";
  const fillGeometry = new THREE.BufferGeometry();
  fillGeometry.setAttribute("position", new THREE.Float32BufferAttribute(fillPositions, 3));
  const idAttribute = new THREE.Float32BufferAttribute(featureIds, 1); idAttribute.setUsage(THREE.StaticDrawUsage);
  fillGeometry.setAttribute("featureId", idAttribute);
  fillGeometry.setAttribute("color", new THREE.Float32BufferAttribute(footprintColors, 3)); fillGeometry.computeVertexNormals();
  const fill = new THREE.Mesh(fillGeometry, new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.42, side: THREE.DoubleSide, depthTest: true, depthWrite: false, toneMapped: false }));
  fill.name = "building_footprints_fill"; fill.renderOrder = 3; fill.userData.featureIds = [...new Set(featureIds)]; layer.add(fill);
  const lineGeometry = new THREE.BufferGeometry();
  lineGeometry.setAttribute("position", new THREE.Float32BufferAttribute(boundaryPositions, 3));
  const outlineMaterial = new THREE.LineBasicMaterial({ color: 0x8b9299, depthTest: true, toneMapped: false });
  const outlines = new THREE.LineSegments(lineGeometry, outlineMaterial);
  outlines.name = "building_footprints_outlines"; outlines.renderOrder = 3; layer.add(outlines);
  addWideLineSegments(layer, lineGeometry, { color: 0x8b9299, width: 2.5, renderOrder: 4 });
  layer.userData = { featureCount: source.features.length - skippedFeatures.length, sourceFeatureCount: source.recordCount, polygonCount, holeCount, failedPolygons, skippedFeatureIds: skippedFeatures, features: source.features, source: CONFIG.buildingsUrl, crs: "EPSG:9377", ids: [...new Set(featureIds)] };
  scene.add(layer);
  return layer;
}

function buildingPolygonParts(feature) {
  const shells = [], holes = [];
  for (const ring of feature.rings) {
    const open = ring.length > 1 && ring[0].x === ring[ring.length - 1].x && ring[0].north === ring[ring.length - 1].north ? ring.slice(0, -1) : ring;
    if (open.length < 3) continue;
    (ringArea(ring) < 0 ? shells : holes).push(open);
  }
  if (!shells.length && feature.rings.length) shells.push(feature.rings[0].slice(0, -1));
  const parts = shells.map(shell => ({ shell, holes: [] }));
  for (const hole of holes) {
    const candidates = parts.filter(part => pointInRing(hole[0], part.shell)).sort((a, b) => Math.abs(ringArea(a.shell)) - Math.abs(ringArea(b.shell)));
    if (candidates.length) candidates[0].holes.push(hole);
    else if (parts.length === 1) parts[0].holes.push(hole);
  }
  return parts;
}

function addPolygonOverlay(scene, source, categoryValues, kind, values, mask, width, height, extent, originX, originNorth, baseElevation) {
  const positions = [], colors = [], indices = [], outlines = [], outlineColors = [], featureIds = [], counts = {};
  const maxTriangleEdge = kind === "buffer" ? 5 : 4;
  let skippedTriangles = 0;
  let currentFeatureId = 0;
  const pushDrapedTriangle = (points, color, lift) => {
    const ground = points.map(point => sampleRenderedSurfaceElevation(point.x, point.north, values, mask, width, height, extent));
    if (ground.some(value => value === null)) { skippedTriangles++; return; }
    const first = positions.length / 3;
    for (let vertex = 0; vertex < 3; vertex++) {
      positions.push(points[vertex].x - originX, (ground[vertex] - baseElevation) * CONFIG.verticalScale + lift, points[vertex].north - originNorth);
      colors.push(color.r, color.g, color.b);
      featureIds.push(currentFeatureId);
    }
    indices.push(first, first + 1, first + 2);
  };
  for (const feature of source.features) {
    currentFeatureId = feature.id;
    const symbol = categoryValues ? (kind === "risk" ? riskSymbol(categoryValues.values[feature.id - 1]) : threatSymbol(categoryValues.values[feature.id - 1])) : null;
    const color = symbol ? new THREE.Color(symbol.hex) : (kind === "buffer" ? new THREE.Color(0xff35d3) : new THREE.Color(0x78879a));
    if (symbol) counts[symbol.key] = (counts[symbol.key] || 0) + 1;
    for (const part of buildingPolygonParts(feature)) {
      const partPoints = part.shell.concat(...part.holes);
      const triangles = THREE.ShapeUtils.triangulateShape(part.shell.map(p => new THREE.Vector2(p.x,p.north)), part.holes.map(r => r.map(p => new THREE.Vector2(p.x,p.north))));
      const lift = kind === "risk" ? 2.0 : (kind === "buffer" ? 1.0 : 1.8);
      for (const triangle of triangles) {
        const corners = triangle.map(index => partPoints[index]);
        const [a, b, c] = corners;
        const steps = Math.max(1, Math.ceil(Math.max(Math.hypot(b.x-a.x,b.north-a.north), Math.hypot(c.x-b.x,c.north-b.north), Math.hypot(a.x-c.x,a.north-c.north)) / maxTriangleEdge));
        const pointAt = (i, j) => ({ x: a.x + (b.x-a.x)*i/steps + (c.x-a.x)*j/steps, north: a.north + (b.north-a.north)*i/steps + (c.north-a.north)*j/steps });
        for (let i = 0; i < steps; i++) for (let j = 0; j < steps - i; j++) {
          pushDrapedTriangle([pointAt(i,j),pointAt(i+1,j),pointAt(i,j+1)],color,lift);
          if (i + j < steps - 1) pushDrapedTriangle([pointAt(i+1,j),pointAt(i+1,j+1),pointAt(i,j+1)],color,lift);
        }
      }
      for (const ring of [part.shell, ...part.holes]) {
        for (let i=0;i<ring.length;i++) {
          const a=ring[i], b=ring[(i+1)%ring.length], steps=Math.max(1,Math.ceil(Math.hypot(b.x-a.x,b.north-a.north)/3));
          for(let step=0;step<steps;step++){
            const t0=step/steps,t1=(step+1)/steps;
            const p0={x:a.x+(b.x-a.x)*t0,north:a.north+(b.north-a.north)*t0},p1={x:a.x+(b.x-a.x)*t1,north:a.north+(b.north-a.north)*t1};
            const e0=sampleRenderedSurfaceElevation(p0.x,p0.north,values,mask,width,height,extent),e1=sampleRenderedSurfaceElevation(p1.x,p1.north,values,mask,width,height,extent);
            if(e0===null||e1===null)continue;
            outlines.push(p0.x-originX,(e0-baseElevation)*CONFIG.verticalScale+lift+0.45,p0.north-originNorth,p1.x-originX,(e1-baseElevation)*CONFIG.verticalScale+lift+0.45,p1.north-originNorth);
            for(let vertex=0;vertex<2;vertex++)outlineColors.push(color.r,color.g,color.b);
          }
        }
      }
    }
  }
  const layer = new THREE.Group(); layer.name = kind + "_polygon_layer";
  if (positions.length) {
    const geometry = new THREE.BufferGeometry(); geometry.setAttribute("position",new THREE.Float32BufferAttribute(positions,3)); geometry.setAttribute("color",new THREE.Float32BufferAttribute(colors,3)); geometry.setAttribute("featureId",new THREE.Float32BufferAttribute(featureIds,1)); geometry.setIndex(indices); geometry.computeBoundingSphere();
    const mesh = new THREE.Mesh(geometry,new THREE.MeshBasicMaterial({vertexColors:true,side:THREE.DoubleSide,transparent:true,opacity:kind === "risk" ? 0.58 : (kind === "buffer" ? 0.18 : 0.4),depthWrite:false,depthTest:true,toneMapped:false,polygonOffset:true,polygonOffsetFactor:-2,polygonOffsetUnits:-2}));
    mesh.renderOrder = 2;
    mesh.name = kind + "_fills"; layer.add(mesh);
  }
  if (outlines.length) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(outlines, 3));
    geometry.setAttribute("color", new THREE.Float32BufferAttribute(outlineColors, 3));
    geometry.computeBoundingSphere();
    const lineMaterial = new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 1, depthTest: true, depthWrite: false, toneMapped: false });
    const lines = new THREE.LineSegments(geometry, lineMaterial); lines.renderOrder = 3; layer.add(lines);
    addWideLineSegments(layer, geometry, { color: 0xffffff, width: kind === "buffer" ? 6 : 2.5, depthTest: true, renderOrder: 4 });
  }
  layer.userData={featureCount:source.features.length,sourceRecordCount:source.recordCount,categoryCounts:counts,features:source.features,vertexCount:positions.length/3,triangleCount:indices.length/3,skippedTriangles,drawCalls:(positions.length?1:0)+(outlines.length?1:0),source:kind === "risk" ? CONFIG.riskUrl : kind === "threat" ? CONFIG.threatUrl : (kind === "buffer" ? CONFIG.bufferUrl : CONFIG.parcelsUrl),crs:"EPSG:9377",dbfField:categoryValues && categoryValues.fieldName};
  scene.add(layer); return layer;
}

async function addParcelBoundaries(scene, source, values, mask, width, height, extent, originX, originNorth, baseElevation) {
  const positions = [], featureIds = [], lineColors = [], fillPositions = [], fillIds = [];
  let count = 0;
  const lineLift = 1.8;
  for (let featureIndex = 0; featureIndex < source.features.length; featureIndex++) {
    const feature = source.features[featureIndex];
    for (const part of buildingPolygonParts(feature)) {
    const flat = [part.shell, ...part.holes], points = flat.flat();
    for (const ring of flat) for (let i = 0; i < ring.length; i++) {
      const a = ring[i], b = ring[(i + 1) % ring.length];
      const steps = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.north - a.north) / 2.5));
      for (let step = 0; step < steps; step++) {
        const t0 = step / steps, t1 = (step + 1) / steps;
        const p0 = { x: a.x + (b.x - a.x) * t0, north: a.north + (b.north - a.north) * t0 };
        const p1 = { x: a.x + (b.x - a.x) * t1, north: a.north + (b.north - a.north) * t1 };
        const e0 = sampleRenderedSurfaceElevation(p0.x, p0.north, values, mask, width, height, extent);
        const e1 = sampleRenderedSurfaceElevation(p1.x, p1.north, values, mask, width, height, extent);
        if (e0 === null || e1 === null) continue;
        positions.push(p0.x - originX, (e0 - baseElevation) * CONFIG.verticalScale + lineLift, p0.north - originNorth,
          p1.x - originX, (e1 - baseElevation) * CONFIG.verticalScale + lineLift, p1.north - originNorth);
        featureIds.push(feature.id, feature.id);
        lineColors.push(0.55, 0.57, 0.60, 0.55, 0.57, 0.60);
      }
    }
    const triangles = THREE.ShapeUtils.triangulateShape(part.shell.map(p => new THREE.Vector2(p.x, p.north)), part.holes.map(r => r.map(p => new THREE.Vector2(p.x, p.north))));
    const elevations = points.map(p => sampleRenderedSurfaceElevation(p.x, p.north, values, mask, width, height, extent));
    if (elevations.some(e => e === null)) continue;
    for (const triangle of triangles) for (const index of triangle) {
      const p = points[index], e = elevations[index];
      fillPositions.push(p.x - originX, (e - baseElevation) * CONFIG.verticalScale + 0.44, p.north - originNorth);
      fillIds.push(feature.id);
    }
    count++;
    }
    if ((featureIndex & 31) === 31) await yieldToBrowser();
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("featureId", new THREE.Float32BufferAttribute(featureIds, 1));
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(lineColors, 3));
  const fillGeometry = new THREE.BufferGeometry();
  fillGeometry.setAttribute("position", new THREE.Float32BufferAttribute(fillPositions, 3));
  fillGeometry.setAttribute("featureId", new THREE.Float32BufferAttribute(fillIds, 1));
  const layer = new THREE.Group(); layer.name = "parcel_boundaries_layer";
  const selectableFill = new THREE.Mesh(fillGeometry, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, colorWrite: false, depthWrite: false, side: THREE.DoubleSide }));
  selectableFill.name = "parcel_selection_surface"; layer.add(selectableFill);
  const parcelLines = new THREE.LineSegments(geometry, new THREE.LineBasicMaterial({ color: 0xffffff, vertexColors: true, transparent: true, opacity: 1, depthTest: true, depthWrite: false, toneMapped: false }));
  parcelLines.renderOrder = 4; layer.add(parcelLines);
  addWideLineSegments(layer, geometry, { color: 0xffffff, width: 2.5, depthTest: true, renderOrder: 5 });
  layer.userData = { featureCount: source.features.length, sourceRecordCount: source.recordCount, ringCount: count, features: source.features, source: CONFIG.parcelsUrl, crs: "EPSG:9377", attributesLoaded: true };
  scene.add(layer); return layer;
}

function appendBuildingExtrusion(feature, parts, positions, featureIds, floorCounts, estimatedHeights, outlines, vertexColors,
  values, mask, width, height, extent, originX, originNorth, baseElevation) {
  const estimatedHeight = feature.estimatedHeight;
  if (feature.heightStatus !== "estimated" || !(estimatedHeight > 0)) return { valid: false, polygons: 0, holes: 0, triangles: 0, vertices: 0 };
  const startVertex = positions.length / 3;
  let polygonCount = 0, holeCount = 0, triangleCount = 0;
  const pushVertex = (x, y, north) => {
    positions.push(x - originX, y, north - originNorth);
    featureIds.push(feature.id);
    floorCounts.push(feature.floorCount);
    estimatedHeights.push(estimatedHeight);
    const color = new THREE.Color(riskSymbol(feature.riskCategory).hex);
    vertexColors.push(color.r, color.g, color.b);
  };
  const pushTriangle = (a, b, c) => {
    pushVertex(...a); pushVertex(...b); pushVertex(...c);
    triangleCount++;
  };
  for (const part of parts) {
    const rings = [part.shell, ...part.holes];
    const points = rings.flat();
    const elevations = points.map(point => sampleRenderedSurfaceElevation(point.x, point.north, values, mask, width, height, extent));
    if (elevations.some(value => value === null)) return { valid: false, polygons: polygonCount, holes: holeCount, triangles: triangleCount, vertices: positions.length / 3 - startVertex };
    const contour = part.shell.map(point => new THREE.Vector2(point.x, point.north));
    const holeContours = part.holes.map(ring => ring.map(point => new THREE.Vector2(point.x, point.north)));
    const triangles = THREE.ShapeUtils.triangulateShape(contour, holeContours);
    if (!triangles.length) return { valid: false, polygons: polygonCount, holes: holeCount, triangles: triangleCount, vertices: positions.length / 3 - startVertex };
    let expectedArea = Math.abs(ringArea([...part.shell, part.shell[0]]));
    for (const ring of part.holes) expectedArea -= Math.abs(ringArea([...ring, ring[0]]));
    let triangulatedArea = 0;
    for (const triangle of triangles) {
      const a = points[triangle[0]], b = points[triangle[1]], c = points[triangle[2]];
      triangulatedArea += Math.abs((b.x - a.x) * (c.north - a.north) - (b.north - a.north) * (c.x - a.x)) / 2;
    }
    if (!(expectedArea > 0) || Math.abs(expectedArea - triangulatedArea) > Math.max(1e-5, expectedArea * 1e-7)) {
      return { valid: false, polygons: polygonCount, holes: holeCount, triangles: triangleCount, vertices: positions.length / 3 - startVertex, areaError: Math.abs(expectedArea - triangulatedArea) };
    }
    for (const triangle of triangles) {
      const indices = [...triangle];
      const a = points[indices[0]], b = points[indices[1]], c = points[indices[2]];
      const normalY = (b.north - a.north) * (c.x - a.x) - (b.x - a.x) * (c.north - a.north);
      if (normalY < 0) [indices[1], indices[2]] = [indices[2], indices[1]];
      const roof = indices.map(index => {
        const point = points[index];
        return [point.x, (elevations[index] - baseElevation) * CONFIG.verticalScale + 1.2 + estimatedHeight * CONFIG.verticalScale, point.north];
      });
      pushTriangle(roof[0], roof[1], roof[2]);
    }
    for (let ringIndex = 0; ringIndex < rings.length; ringIndex++) {
      const ring = rings[ringIndex];
      const ringOffset = rings.slice(0, ringIndex).reduce((sum, current) => sum + current.length, 0);
      for (let i = 0; i < ring.length; i++) {
        const next = (i + 1) % ring.length;
        const a = ring[i], b = ring[next];
        const baseA = (elevations[ringOffset + i] - baseElevation) * CONFIG.verticalScale + 1.2;
        const baseB = (elevations[ringOffset + next] - baseElevation) * CONFIG.verticalScale + 1.2;
        const topA = baseA + estimatedHeight * CONFIG.verticalScale;
        const topB = baseB + estimatedHeight * CONFIG.verticalScale;
        const bottomStart = [a.x, baseA, a.north], bottomEnd = [b.x, baseB, b.north];
        const topStart = [a.x, topA, a.north], topEnd = [b.x, topB, b.north];
        pushTriangle(bottomStart, bottomEnd, topEnd);
        pushTriangle(bottomStart, topEnd, topStart);
        const lineLift = 0.015;
        outlines.push(...[bottomStart[0] - originX, bottomStart[1] + lineLift, bottomStart[2] - originNorth,
          bottomEnd[0] - originX, bottomEnd[1] + lineLift, bottomEnd[2] - originNorth,
          topStart[0] - originX, topStart[1] + lineLift, topStart[2] - originNorth,
          topEnd[0] - originX, topEnd[1] + lineLift, topEnd[2] - originNorth,
          bottomStart[0] - originX, bottomStart[1] + lineLift, bottomStart[2] - originNorth,
          topStart[0] - originX, topStart[1] + lineLift, topStart[2] - originNorth]);
      }
    }
    polygonCount++;
    holeCount += part.holes.length;
  }
  return { valid: polygonCount > 0, polygons: polygonCount, holes: holeCount, triangles: triangleCount, vertices: positions.length / 3 - startVertex };
}

function validateExtrusionSample(source, values, mask, width, height, extent, originX, originNorth, baseElevation) {
  let multipart = null, holeSample = null, slopeSample = null;
  for (const feature of source.features) {
    if (feature.heightStatus !== "estimated") continue;
    const parts = buildingPolygonParts(feature);
    const points = parts.flatMap(part => [part.shell, ...part.holes].flat());
    const samples = points.map(point => sampleRenderedSurfaceElevation(point.x, point.north, values, mask, width, height, extent));
    if (samples.some(value => value === null)) continue;
    if (!multipart && parts.length > 1) multipart = { feature, parts };
    if (!holeSample && parts.some(part => part.holes.length)) holeSample = { feature, parts };
    let slope = 0;
    for (const part of parts) for (const ring of [part.shell, ...part.holes]) {
      for (let i = 0; i < ring.length; i++) {
        const next = (i + 1) % ring.length;
        const ea = sampleRenderedSurfaceElevation(ring[i].x, ring[i].north, values, mask, width, height, extent);
        const eb = sampleRenderedSurfaceElevation(ring[next].x, ring[next].north, values, mask, width, height, extent);
        const distance = Math.hypot(ring[next].x - ring[i].x, ring[next].north - ring[i].north);
        if (ea !== null && eb !== null && distance > 0) slope = Math.max(slope, Math.abs(eb - ea) / distance);
      }
    }
    if (!slopeSample || slope > slopeSample.slope) slopeSample = { feature, parts, slope };
  }
  if (!multipart) throw new Error("La prueba de extrusión no encontró una construcción multipartes con altura estimada.");
  if (!holeSample) throw new Error("La prueba de extrusión no encontró una construcción con hueco y altura estimada.");
  if (!slopeSample || !(slopeSample.slope > 0)) throw new Error("La prueba no encontró una construcción estimada sobre variación de pendiente del DEM.");
  const selected = new Map([[multipart.feature.id, multipart], [holeSample.feature.id, holeSample], [slopeSample.feature.id, slopeSample]]);
  const sampleResults = [];
  for (const { feature, parts, slope } of selected.values()) {
    const positions = [], featureIds = [], floors = [], heights = [], outlines = [], colors = [];
    const result = appendBuildingExtrusion(feature, parts, positions, featureIds, floors, heights, outlines, colors,
      values, mask, width, height, extent, originX, originNorth, baseElevation);
    if (!result.valid || result.vertices === 0 || positions.length !== featureIds.length * 3 || floors.length !== featureIds.length || heights.length !== featureIds.length) {
      throw new Error("Falló la prueba geométrica de la construcción " + feature.id + ".");
    }
    const allowedCoordinates = new Map();
    for (const part of parts) for (const ring of [part.shell, ...part.holes]) for (const point of ring) {
      const ground = sampleRenderedSurfaceElevation(point.x, point.north, values, mask, width, height, extent);
      allowedCoordinates.set((point.x - originX).toFixed(4) + ":" + (point.north - originNorth).toFixed(4),
        (ground - baseElevation) * CONFIG.verticalScale + 1.2);
    }
    for (let vertex = 0; vertex < positions.length / 3; vertex++) {
      if (featureIds[vertex] !== feature.id || floors[vertex] !== feature.floorCount || heights[vertex] !== feature.estimatedHeight) {
        throw new Error("Los atributos estimados no se conservaron en el volumen de muestra " + feature.id + ".");
      }
      const x = positions[vertex * 3], y = positions[vertex * 3 + 1], north = positions[vertex * 3 + 2];
      const baseY = allowedCoordinates.get(x.toFixed(4) + ":" + north.toFixed(4));
      if (baseY === undefined || (Math.abs(y - baseY) > 1e-4 && Math.abs(y - baseY - feature.estimatedHeight) > 1e-4)) {
        throw new Error("Desplazamiento XY o altura de extrusión incorrectos en la construcción " + feature.id + ".");
      }
    }
    sampleResults.push({ recordId: feature.id, polygons: result.polygons, holes: result.holes, triangles: result.triangles, vertices: result.vertices, maxEdgeSlope: slope || 0 });
  }
  return { records: sampleResults, count: sampleResults.length };
}

async function addEstimatedBuildingVolumes(scene, source, values, mask, width, height, extent, originX, originNorth, baseElevation) {
  const started = performance.now();
  const positions = [], featureIds = [], floorCounts = [], estimatedHeights = [], outlines = [], colors = [];
  const records = new Array(source.recordCount + 1);
  let volumeCount = 0, polygonCount = 0, holeCount = 0, triangleCount = 0;
  const riskCounts = {};
  const omitted = [];
  for (let featureIndex = 0; featureIndex < source.features.length; featureIndex++) {
    const feature = source.features[featureIndex];
    if (feature.heightStatus !== "estimated") continue;
    const parts = buildingPolygonParts(feature);
    const result = appendBuildingExtrusion(feature, parts, positions, featureIds, floorCounts, estimatedHeights, outlines, colors,
      values, mask, width, height, extent, originX, originNorth, baseElevation);
    if (!result.valid) { omitted.push(feature.id); continue; }
    volumeCount++;
    const riskKey = riskSymbol(feature.riskCategory).key;
    riskCounts[riskKey] = (riskCounts[riskKey] || 0) + 1;
    polygonCount += result.polygons;
    holeCount += result.holes;
    triangleCount += result.triangles;
    records[feature.id] = { recordId: feature.id, floorCount: feature.floorCount, basementCount: feature.basementCount, estimatedHeight: feature.estimatedHeight, heightStatus: feature.heightStatus, riskCategory: feature.riskCategory, threatCategory: feature.threatCategory, riskSymbol: riskSymbol(feature.riskCategory).key, polygons: result.polygons, holes: result.holes };
    if ((featureIndex & 31) === 31) await yieldToBrowser();
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("featureId", new THREE.Float32BufferAttribute(featureIds, 1));
  geometry.setAttribute("floorCount", new THREE.Float32BufferAttribute(floorCounts, 1));
  geometry.setAttribute("estimatedHeight", new THREE.Float32BufferAttribute(estimatedHeights, 1));
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  const volume = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92, metalness: 0, side: THREE.DoubleSide }));
  volume.name = "estimated_building_volumes_mesh";
  volume.userData.estimated = true;
  volume.userData.estimatedCount = volumeCount;
  volume.userData.omittedCount = omitted.length;
  const outlineGeometry = new THREE.BufferGeometry();
  outlineGeometry.setAttribute("position", new THREE.Float32BufferAttribute(outlines, 3));
  const outline = new THREE.LineSegments(outlineGeometry, new THREE.LineBasicMaterial({ color: 0x402b25, depthTest: true, toneMapped: false }));
  outline.name = "estimated_building_volume_outlines";
  const layer = new THREE.Group();
  layer.name = "estimated_buildings_layer";
  layer.add(volume, outline);
  addWideLineSegments(layer, outlineGeometry, { color: 0x402b25, width: 2.5, depthTest: true, renderOrder: 4 });
  layer.userData = {
    featureCount: volumeCount,
    sourceFeatureCount: source.recordCount,
    flatFootprintCount: source.features.filter(feature => feature.heightStatus === "unknown").length,
    riskCounts,
    estimatedPerFloor: CONFIG.estimatedHeightPerFloor,
    triangleCount,
    polygonCount,
    holeCount,
    vertexCount: positions.length / 3,
    drawCalls: 2,
    buildMilliseconds: performance.now() - started,
    geometryBytes: positions.length * 4 + featureIds.length * 12 + outlines.length * 4,
    records,
    features: source.features,
    recordIds: source.features.filter(feature => feature.heightStatus === "estimated").map(feature => feature.id),
    source: CONFIG.buildingsUrl,
    crs: "EPSG:9377",
    baseSampler: "same rendered DEM triangle interpolation as footprints",
    baseOffsetMeters: 1.2
  };
  scene.add(layer);
  return layer;
}

function sampleTerrainElevation(x, north, values, mask, width, height, extent) {
  const column = (x - extent.xmin) / extent.pixelX - 0.5;
  const row = (extent.ymax - north) / extent.pixelY - 0.5;
  const c0 = Math.floor(column), r0 = Math.floor(row);
  const dc = column - c0, dr = row - r0;
  const candidates = [
    [r0, c0, (1 - dc) * (1 - dr)], [r0, c0 + 1, dc * (1 - dr)],
    [r0 + 1, c0, (1 - dc) * dr], [r0 + 1, c0 + 1, dc * dr]
  ].filter(([r, c]) => r >= 0 && r < height && c >= 0 && c < width && !mask[r * width + c]);
  const totalWeight = candidates.reduce((sum, [,, weight]) => sum + weight, 0);
  if (totalWeight > 1e-8) return candidates.reduce((sum, [r, c, weight]) => sum + values[r * width + c] * weight, 0) / totalWeight;
  const nearestColumn = Math.max(0, Math.min(width - 1, Math.round(column)));
  const nearestRow = Math.max(0, Math.min(height - 1, Math.round(row)));
  for (let radius = 0; radius <= 15; radius++) {
    for (let r = Math.max(0, nearestRow - radius); r <= Math.min(height - 1, nearestRow + radius); r++) {
      for (let c = Math.max(0, nearestColumn - radius); c <= Math.min(width - 1, nearestColumn + radius); c++) {
        if (!mask[r * width + c]) return values[r * width + c];
      }
    }
  }
  return null;
}

// Match buildTileGeometry's b-c diagonal exactly so footprint vertices sit on its triangles.
function sampleRenderedSurfaceElevation(x, north, values, mask, width, height, extent) {
  const gx = Math.max(0, Math.min(width + 1, (x - extent.xmin) / extent.pixelX + 0.5));
  const gy = Math.max(0, Math.min(height + 1, (extent.ymax - north) / extent.pixelY + 0.5));
  const c = Math.min(width, Math.floor(gx)), r = Math.min(height, Math.floor(gy));
  const u = gx - c, v = gy - r;
  const at = (row, col) => {
    const rr = Math.max(0, Math.min(height - 1, row - 1));
    const cc = Math.max(0, Math.min(width - 1, col - 1));
    const index = rr * width + cc;
    return mask[index] ? null : values[index];
  };
  const a = at(r, c), b = at(r, c + 1), d = at(r + 1, c + 1), lowerLeft = at(r + 1, c);
  if ([a, b, lowerLeft, d].some(value => value === null)) return null;
  return u + v <= 1
    ? a * (1 - u - v) + b * u + lowerLeft * v
    : d * (u + v - 1) + lowerLeft * (1 - u) + b * (1 - v);
}

function focusBoundsFromFeatures(source, margin, extent) {
  const bounds = { xmin: Infinity, ymin: Infinity, xmax: -Infinity, ymax: -Infinity };
  for (const feature of source.features) for (const ring of feature.rings) for (const point of ring) {
    bounds.xmin = Math.min(bounds.xmin, point.x);
    bounds.ymin = Math.min(bounds.ymin, point.north);
    bounds.xmax = Math.max(bounds.xmax, point.x);
    bounds.ymax = Math.max(bounds.ymax, point.north);
  }
  if (![bounds.xmin, bounds.ymin, bounds.xmax, bounds.ymax].every(Number.isFinite)) {
    throw new Error("No se pudo calcular el encuadre del buffer del área de estudio.");
  }
  const focused = {
    xmin: Math.max(extent.xmin, bounds.xmin - margin),
    ymin: Math.max(extent.ymin, bounds.ymin - margin),
    xmax: Math.min(extent.xmax, bounds.xmax + margin),
    ymax: Math.min(extent.ymax, bounds.ymax + margin)
  };
  if (focused.xmin >= focused.xmax || focused.ymin >= focused.ymax) {
    throw new Error("El buffer de estudio no intersecta la extensión del DEM.");
  }
  return focused;
}

function applySceneFocusClip(scene, bounds, originX, originNorth, alreadyClippedObject = null) {
  const localXMin = bounds.xmin - originX;
  const localXMax = bounds.xmax - originX;
  const localZMin = originNorth - bounds.ymax;
  const localZMax = originNorth - bounds.ymin;
  const planes = [
    new THREE.Plane(new THREE.Vector3(1, 0, 0), -localXMin),
    new THREE.Plane(new THREE.Vector3(-1, 0, 0), localXMax),
    new THREE.Plane(new THREE.Vector3(0, 0, 1), -localZMin),
    new THREE.Plane(new THREE.Vector3(0, 0, -1), localZMax)
  ];
  scene.traverse(object => {
    if (!object.material) return;
    // Terrain and skirt vertices are clipped while their geometry is built.
    // Applying GPU clipping to those same boundary vertices can cause depth
    // precision artifacts along the vertical curtain.
    let ancestor = object;
    while (ancestor && ancestor !== alreadyClippedObject) ancestor = ancestor.parent;
    if (alreadyClippedObject && ancestor === alreadyClippedObject) return;
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    for (const material of materials) {
      material.clippingPlanes = planes;
      material.needsUpdate = true;
    }
  });
  return planes;
}

function createTerrainSkirt(values, mask, width, height, extent, originX, originNorth, baseElevation, depthMeters = 80, bounds = extent) {
  const gridWidth = width + 2, gridHeight = height + 2;
  const nodes = new Array(gridWidth * gridHeight);
  for (let row = 0; row < gridHeight; row++) for (let column = 0; column < gridWidth; column++) {
    const sourceColumn = Math.max(0, Math.min(width - 1, column - 1));
    const sourceRow = Math.max(0, Math.min(height - 1, row - 1));
    const sourceIndex = sourceRow * width + sourceColumn;
    nodes[row * gridWidth + column] = {
      x: column === 0 ? extent.xmin : column === width + 1 ? extent.xmax : extent.xmin + (column - 0.5) * extent.pixelX,
      north: row === 0 ? extent.ymax : row === height + 1 ? extent.ymin : extent.ymax - (row - 0.5) * extent.pixelY,
      elevation: values[sourceIndex], valid: !mask[sourceIndex]
    };
  }
  const edgeMap = new Map();
  const vertexKey = point => Math.round(point.x * 1000) + ":" + Math.round(point.north * 1000);
  const addFaceEdges = points => {
    for (let i = 0; i < 3; i++) {
      const a = points[i], b = points[(i + 1) % 3], ka = vertexKey(a), kb = vertexKey(b);
      const key = ka < kb ? ka + "|" + kb : kb + "|" + ka;
      const edge = edgeMap.get(key);
      if (edge) edge.count++;
      else edgeMap.set(key, { a, b, count: 1 });
    }
  };
  for (let row = 0; row < gridHeight - 1; row++) for (let column = 0; column < gridWidth - 1; column++) {
    const a = nodes[row * gridWidth + column], b = nodes[row * gridWidth + column + 1];
    const c = nodes[(row + 1) * gridWidth + column], d = nodes[(row + 1) * gridWidth + column + 1];
    if (!(a.valid && b.valid && c.valid && d.valid)) continue;
    for (const triangle of [[a, b, c], [c, b, d]]) {
      const clipped = clipToTile(triangle, bounds);
      for (let i = 1; i < clipped.length - 1; i++) addFaceEdges([clipped[0], clipped[i], clipped[i + 1]]);
    }
  }
  const positions = [];
  const bottomY = -depthMeters*CONFIG.verticalScale;
  const localPoint = (point,elevation) => [point.x-originX,(elevation-baseElevation)*CONFIG.verticalScale,point.north-originNorth];
  let wallSegments = 0;
  for (const edge of edgeMap.values()) {
    if (edge.count !== 1) continue;
    const a = edge.a, b = edge.b, ta = localPoint(a,a.elevation), tb = localPoint(b,b.elevation);
    const ba = [ta[0],bottomY,ta[2]], bb = [tb[0],bottomY,tb[2]];
    positions.push(...ta,...tb,...ba,...tb,...bb,...ba);
    wallSegments++;
  }
  const bottom=[
    [bounds.xmin-originX,bottomY,bounds.ymax-originNorth],
    [bounds.xmax-originX,bottomY,bounds.ymax-originNorth],
    [bounds.xmax-originX,bottomY,bounds.ymin-originNorth],
    [bounds.xmin-originX,bottomY,bounds.ymin-originNorth]
  ];
  positions.push(...bottom[0],...bottom[2],...bottom[1],...bottom[0],...bottom[3],...bottom[2]);
  const geometry=new THREE.BufferGeometry();
  geometry.setAttribute("position",new THREE.Float32BufferAttribute(positions,3));
  geometry.computeVertexNormals(); geometry.computeBoundingSphere();
  const skirt=new THREE.Mesh(geometry,new THREE.MeshStandardMaterial({color:0x51483d,roughness:1,metalness:0,side:THREE.DoubleSide}));
  skirt.name="terrain_perimeter_skirt";
  skirt.userData={depthMeters,wallSegments,perimeterEdges:edgeMap.size,bottomElevation:baseElevation-depthMeters,bounds,crs:"EPSG:9377"};
  return skirt;
}

function enableLayerToggle(id, object, buildOnDemand) {
  const input = document.getElementById(id);
  if (!input) return;
  input.disabled = false;
  object.visible = input.checked;
  input.addEventListener("change", async () => {
    if (input.checked && buildOnDemand && !object.userData.ready) {
      input.disabled = true;
      setStatus("Preparando geometría 3D de esta capa…");
      try {
        await buildOnDemand();
        object.userData.ready = true;
      } catch (error) {
        input.checked = false;
        setStatus("No se pudo preparar esta capa: " + (error.message || error), "error");
      } finally {
        input.disabled = false;
      }
    }
    object.visible = input.checked;
    requestSceneRender();
  });
}

function setupNavigationButtons(camera, controls) {
  const homePosition = camera.position.clone();
  const homeTarget = controls.target.clone();
  const zoom = factor => {
    const offset = camera.position.clone().sub(controls.target);
    const distance = THREE.MathUtils.clamp(offset.length() * factor, controls.minDistance, controls.maxDistance);
    camera.position.copy(controls.target).add(offset.normalize().multiplyScalar(distance));
    controls.update();
  };
  const reset = () => { camera.position.copy(homePosition); controls.target.copy(homeTarget); controls.update(); };
  document.getElementById("nav-zoom-in")?.addEventListener("click", () => zoom(0.62));
  document.getElementById("nav-zoom-out")?.addEventListener("click", () => zoom(1.5));
  document.getElementById("nav-reset")?.addEventListener("click", reset);
  document.getElementById("touch-zoom-in")?.addEventListener("click", () => zoom(0.62));
  document.getElementById("touch-zoom-out")?.addEventListener("click", () => zoom(1.5));
  document.getElementById("touch-reset")?.addEventListener("click", reset);
  window.addEventListener("keydown", event => { if (event.key === "Home" && !event.altKey && !event.ctrlKey && !event.metaKey) reset(); });
}

function setupFeatureSelection(scene, camera, renderer, controls, layers, surface) {
  const canvas = renderer.domElement;
  const toolButton = document.getElementById("select-feature-tool");
  const hint = document.getElementById("select-tool-hint");
  const inspector = document.getElementById("feature-inspector-3d");
  const title = document.getElementById("feature-inspector-title");
  const subtitle = document.getElementById("feature-inspector-subtitle");
  const rows = document.getElementById("feature-inspector-rows");
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  const highlight = new THREE.Group();
  highlight.name = "selected_feature_highlight";
  scene.add(highlight);
  let active = false, pointerStart = null;
  const layerLabels = { buildings: "Construcción", volumes: "Construcción 3D (altura estimada)", parcels: "Predio", risk: "Zona de riesgo", threat: "Zona de amenaza", buffer: "Área de estudio" };
  const fieldLabels = {
    fid_: "FID", cod_divipo: "Codigo DIVIPOLA", numero_pre: "Numero predial", matricula_: "Matricula", zona: "Zona", condicion_: "Condicion", destinacio: "Destinacion", tipo_predi: "Tipo de predio", shape_area: "Area registrada (m2)", cat_amenza: "Categoria de amenaza", cat_riesgo: "Categoria de riesgo",
    codigo: "Codigo", nombre: "Nombre", descripcio: "Descripcion", tipo_amena: "Tipo de amenaza", categoria_: "Categoria", subcategor: "Subcategoria", fecha_adop: "Fecha de adopcion", fecha_actu: "Fecha de actualizacion", objectid: "ObjectID", categoria: "Categoria", grado_amen: "Grado de amenaza",
    recordId: "Registro", cbml: "CBML", floorCount: "Numero de pisos", basementCount: "Numero de sotanos", estimatedHeight: "Altura estimada (m)", heightStatus: "Estado de altura", riskCategory: "Categoria de riesgo", threatCategory: "Categoria de amenaza"
  };
  const clearHighlight = () => {
    while (highlight.children.length) {
      const child = highlight.children[0];
      highlight.remove(child);
      child.geometry.dispose(); child.material.dispose();
    }
    requestSceneRender();
  };
  const clearSelection = () => { clearHighlight(); inspector.hidden = true; rows.textContent = ""; hint.textContent = active ? "Pulsa otra entidad visible para consultar sus atributos." : "Activa la herramienta y pulsa una entidad visible para consultar sus atributos."; };
  const drawHighlight = feature => {
    clearHighlight();
    if (!feature || !Array.isArray(feature.rings)) return;
    const positions = [];
    for (const ring of feature.rings) for (let index = 0; index < ring.length; index++) {
      const a = ring[index], b = ring[(index + 1) % ring.length];
      const ea = sampleRenderedSurfaceElevation(a.x, a.north, ...surface.sampleArgs);
      const eb = sampleRenderedSurfaceElevation(b.x, b.north, ...surface.sampleArgs);
      if (ea === null || eb === null) continue;
      positions.push(a.x - surface.originX, (ea - surface.baseElevation) * CONFIG.verticalScale + 1.1, a.north - surface.originNorth,
        b.x - surface.originX, (eb - surface.baseElevation) * CONFIG.verticalScale + 1.1, b.north - surface.originNorth);
    }
    if (!positions.length) return;
    const geometry = new THREE.BufferGeometry(); geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    const material = new THREE.LineBasicMaterial({ color: 0x00e5ff, depthTest: false, toneMapped: false });
    highlight.add(new THREE.LineSegments(geometry, material));
    requestSceneRender();
  };
  const showFeature = (layerConfig, feature) => {
    clearHighlight(); drawHighlight(feature);
    title.textContent = layerLabels[layerConfig.key] || "Entidad seleccionada";
    const identifier = feature.numero_pre || feature.cbml || feature.id || feature.fid_ || feature.objectid || "No disponible";
    subtitle.textContent = "Identificador: " + identifier + " · " + layerConfig.source;
    rows.textContent = "";
    const attributes = { "id": feature.id, ...feature };
    for (const [key, value] of Object.entries(attributes)) {
      if (key === "rings" || key === "id" || value == null || typeof value === "object" || String(value).trim() === "") continue;
      const row = document.createElement("div"); row.className = "feature-inspector-row";
      const label = document.createElement("span"); label.textContent = fieldLabels[key] || key;
      const text = document.createElement("strong"); text.textContent = typeof value === "number" ? formatNumber(value, 3) : String(value);
      row.append(label, text); rows.appendChild(row);
    }
    if (!rows.childElementCount) {
      const row = document.createElement("div"); row.className = "feature-inspector-row"; row.textContent = "El registro no contiene atributos disponibles."; rows.appendChild(row);
    }
    inspector.hidden = false;
    hint.textContent = "Entidad resaltada. Pulsa otra entidad para cambiar la seleccion.";
  };
  const onPointerDown = event => { if (event.button !== 0) return; pointerStart = { x: event.clientX, y: event.clientY, id: event.pointerId }; };
  const onPointerUp = event => {
    if (!active || !pointerStart || pointerStart.id !== event.pointerId) return;
    const moved = Math.hypot(event.clientX - pointerStart.x, event.clientY - pointerStart.y);
    pointerStart = null;
    if (moved > 5) return;
    const rect = canvas.getBoundingClientRect();
    pointer.set((event.clientX - rect.left) / rect.width * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1);
    raycaster.setFromCamera(pointer, camera);
    raycaster.params.Line.threshold = Math.max(1.5, camera.position.distanceTo(controls.target) * 0.006);
    const candidates = layers.filter(item => item.layer.visible && item.enabled()).flatMap(item =>
      raycaster.intersectObject(item.layer, true).map(hit => ({ ...hit, item }))
    ).sort((a, b) => a.distance - b.distance);
    for (const hit of candidates) {
      const idAttribute = hit.object.geometry && hit.object.geometry.getAttribute("featureId");
      if (!idAttribute) continue;
      const vertexIndex = hit.face ? hit.face.a : (Number.isInteger(hit.index) ? hit.index : -1);
      if (vertexIndex < 0 || vertexIndex >= idAttribute.count) continue;
      const featureId = Math.round(idAttribute.getX(vertexIndex));
      const feature = hit.item.features.get(featureId);
      if (feature) { showFeature(hit.item, feature); return; }
    }
    clearSelection();
    hint.textContent = "No se detecto una entidad de las capas activadas en ese punto.";
  };
  toolButton.addEventListener("click", () => {
    active = !active;
    toolButton.setAttribute("aria-pressed", String(active));
    toolButton.textContent = active ? "Desactivar seleccion" : "Activar seleccion";
    controls.enabled = !active;
    canvas.style.cursor = active ? "crosshair" : "grab";
    hint.textContent = active ? "Pulsa una entidad visible. La camara queda fija mientras seleccionas." : "Activa la herramienta y pulsa una entidad visible para consultar sus atributos.";
  });
  canvas.addEventListener("pointerdown", onPointerDown);
  window.addEventListener("pointerup", onPointerUp);
  document.getElementById("clear-feature-selection").addEventListener("click", clearSelection);
  document.getElementById("close-feature-inspector").addEventListener("click", () => { inspector.hidden = true; clearHighlight(); });
  return { get active() { return active; }, get selectedFeature() { return inspector.hidden ? null : title.textContent; } };
}

function getDemExtent(width, height, world) {
  const [pixelX, rotationY, rotationX, pixelY, centerX, centerY] = world;
  if (Math.abs(rotationY) > 1e-9 || Math.abs(rotationX) > 1e-9 || pixelX <= 0 || pixelY >= 0) {
    throw new Error("El TFW no describe una cuadrícula norte-arriba compatible con este visor.");
  }
  return {
    xmin: centerX - pixelX / 2,
    xmax: centerX + (width - 0.5) * pixelX,
    ymin: centerY + (height - 0.5) * pixelY,
    ymax: centerY - pixelY / 2,
    pixelX,
    pixelY: Math.abs(pixelY)
  };
}

function validateManifest(manifest, extent) {
  if (manifest.crs !== "EPSG:9377") throw new Error("El manifiesto no declara EPSG:9377.");
  const rows = manifest.grid && manifest.grid.rows;
  const columns = manifest.grid && manifest.grid.columns;
  if (!Number.isInteger(rows) || !Number.isInteger(columns) || !Array.isArray(manifest.tiles) || manifest.tiles.length !== rows * columns) throw new Error("Incomplete ortho tile grid.");
  const imageExtent = manifest.sourceExtent;
  for (const tile of manifest.tiles) {
    if (!/^ortho_r\d{2}_c\d{2}\.(?:jpg|tif)$/i.test(tile.filename)) throw new Error("Unexpected ortho tile filename: " + tile.filename);
    if (!Number.isInteger(tile.width) || !Number.isInteger(tile.height) || tile.width < 1 || tile.height < 1) throw new Error("Invalid ortho tile dimensions: " + tile.filename);
    if (tile.bboxSR !== 9377 || tile.imageSR !== 9377) throw new Error("CRS incorrecto en el manifiesto: " + tile.filename);
    if (![tile.bbox.xmin, tile.bbox.ymin, tile.bbox.xmax, tile.bbox.ymax].every(Number.isFinite)) throw new Error("bbox inválido: " + tile.filename);
  }
  for (let row = 1; row <= rows; row++) {
    const tiles = manifest.tiles.filter(tile => tile.row === row).sort((a, b) => a.column - b.column);
    if (tiles.length !== columns) throw new Error("Incomplete ortho tile row: " + row);
    if (!closeEnough(tiles[0].bbox.xmin, imageExtent.xmin) || !closeEnough(tiles[tiles.length - 1].bbox.xmax, imageExtent.xmax)) throw new Error("La fila " + row + " no cubre la extensión de las texturas oeste-este.");
    for (let i = 0; i < tiles.length - 1; i++) {
      if (!closeEnough(tiles[i].bbox.xmax, tiles[i + 1].bbox.xmin)) throw new Error("Hay un hueco o solapamiento entre columnas en la fila " + row + ".");
    }
  }
  for (let column = 1; column <= columns; column++) {
    const tiles = manifest.tiles.filter(tile => tile.column === column).sort((a, b) => a.row - b.row);
    if (tiles.length !== rows) throw new Error("Incomplete ortho tile column: " + column);
    if (!closeEnough(tiles[0].bbox.ymax, imageExtent.ymax) || !closeEnough(tiles[tiles.length - 1].bbox.ymin, imageExtent.ymin)) throw new Error("La columna " + column + " no cubre la extensión de las texturas norte-sur.");
    for (let i = 0; i < tiles.length - 1; i++) {
      if (!closeEnough(tiles[i].bbox.ymin, tiles[i + 1].bbox.ymax)) throw new Error("Hay un hueco o solapamiento entre filas en la columna " + column + ".");
    }
  }
  const intersection = {
    xmin: Math.max(extent.xmin, imageExtent.xmin),
    ymin: Math.max(extent.ymin, imageExtent.ymin),
    xmax: Math.min(extent.xmax, imageExtent.xmax),
    ymax: Math.min(extent.ymax, imageExtent.ymax)
  };
  if (intersection.xmin >= intersection.xmax || intersection.ymin >= intersection.ymax) throw new Error("El DEM de Manrique no se cruza con la extensión de las ortofotos disponibles.");
  const demArea = (extent.xmax - extent.xmin) * (extent.ymax - extent.ymin);
  const coveredArea = (intersection.xmax - intersection.xmin) * (intersection.ymax - intersection.ymin);
  return { imageExtent, intersection, coverageRatio: coveredArea / demArea };
}

function analyzeNoData(values, nodata, width, height) {
  const missing = new Uint8Array(width * height);
  let validCount = 0;
  let minimum = Infinity;
  let maximum = -Infinity;
  for (let i = 0; i < values.length; i++) {
    const value = values[i];
    const valid = Number.isFinite(value) && (nodata === null || value !== nodata);
    if (valid) {
      validCount++;
      if (value < minimum) minimum = value;
      if (value > maximum) maximum = value;
    } else missing[i] = 1;
  }
  const visited = new Uint8Array(missing.length);
  const queue = new Int32Array(missing.length);
  let components = 0;
  let largest = { size: 0, minRow: 0, maxRow: 0, minColumn: 0, maxColumn: 0 };
  for (let start = 0; start < missing.length; start++) {
    if (!missing[start] || visited[start]) continue;
    components++;
    let head = 0;
    let tail = 0;
    const startRow = Math.floor(start / width);
    const startColumn = start % width;
    let minRow = startRow, maxRow = startRow, minColumn = startColumn, maxColumn = startColumn;
    queue[tail++] = start;
    visited[start] = 1;
    while (head < tail) {
      const current = queue[head++];
      const row = Math.floor(current / width);
      const column = current % width;
      minRow = Math.min(minRow, row); maxRow = Math.max(maxRow, row);
      minColumn = Math.min(minColumn, column); maxColumn = Math.max(maxColumn, column);
      const neighbors = [column > 0 ? current - 1 : -1, column + 1 < width ? current + 1 : -1, row > 0 ? current - width : -1, row + 1 < height ? current + width : -1];
      for (const next of neighbors) {
        if (next >= 0 && missing[next] && !visited[next]) {
          visited[next] = 1;
          queue[tail++] = next;
        }
      }
    }
    if (tail > largest.size) largest = { size: tail, minRow, maxRow, minColumn, maxColumn };
  }
  return { validCount, missingCount: missing.length - validCount, components, largest, minimum, maximum, mask: missing };
}

// Fill DEM NoData cells for rendering only. Source elevations and analysis masks
// remain untouched for all overlays, measurements, and validation.
function createDisplaySurface(values, sourceMask, width, height) {
  const displayValues = Float64Array.from(values);
  const filledMask = new Uint8Array(sourceMask.length);
  const queue = new Int32Array(sourceMask.length);
  let missingCount = 0;
  let head = 0;
  let tail = 0;
  for (let index = 0; index < sourceMask.length; index++) {
    if (!sourceMask[index]) queue[tail++] = index;
    else missingCount++;
  }
  if (!tail) throw new Error("No hay elevaciones válidas para completar visualmente el DEM.");

  // Propagate the nearest valid edge elevation into each missing cell.
  while (head < tail) {
    const current = queue[head++];
    const row = Math.floor(current / width);
    const column = current % width;
    const neighbors = [column > 0 ? current - 1 : -1, column + 1 < width ? current + 1 : -1, row > 0 ? current - width : -1, row + 1 < height ? current + width : -1];
    for (const next of neighbors) {
      if (next >= 0 && sourceMask[next] && !filledMask[next]) {
        filledMask[next] = 1;
        displayValues[next] = displayValues[current];
        queue[tail++] = next;
      }
    }
  }

  // Smooth only interpolated cells so large NoData patches do not form plateaus.
  const iterations = Math.min(180, Math.max(24, Math.ceil(Math.sqrt(missingCount) * 2)));
  let currentValues = displayValues;
  let nextValues = Float64Array.from(displayValues);
  for (let iteration = 0; iteration < iterations; iteration++) {
    for (let row = 0; row < height; row++) {
      for (let column = 0; column < width; column++) {
        const index = row * width + column;
        if (!sourceMask[index]) continue;
        let sum = 0;
        let count = 0;
        if (column > 0) { sum += currentValues[index - 1]; count++; }
        if (column + 1 < width) { sum += currentValues[index + 1]; count++; }
        if (row > 0) { sum += currentValues[index - width]; count++; }
        if (row + 1 < height) { sum += currentValues[index + width]; count++; }
        if (count) nextValues[index] = sum / count;
      }
    }
    const swap = currentValues; currentValues = nextValues; nextValues = swap;
  }
  return { values: currentValues, mask: new Uint8Array(sourceMask.length), filledCount: missingCount };
}

function sampleAt(values, mask, width, height, row, column) {
  if (row < 0 || row >= height || column < 0 || column >= width) return null;
  const index = row * width + column;
  return mask[index] ? null : values[index];
}

function smoothNormal(values, mask, width, height, row, column, pixelX, pixelY) {
  const center = sampleAt(values, mask, width, height, row, column);
  if (center === null) return new THREE.Vector3(0, 1, 0);
  const west = sampleAt(values, mask, width, height, row, column - 1);
  const east = sampleAt(values, mask, width, height, row, column + 1);
  const north = sampleAt(values, mask, width, height, row - 1, column);
  const south = sampleAt(values, mask, width, height, row + 1, column);
  const dx = west !== null && east !== null ? (east - west) / (2 * pixelX) : east !== null ? (east - center) / pixelX : west !== null ? (center - west) / pixelX : 0;
  const dz = north !== null && south !== null ? (north - south) / (2 * pixelY) : north !== null ? (north - center) / pixelY : south !== null ? (center - south) / pixelY : 0;
  return new THREE.Vector3(-dx * CONFIG.verticalScale, 1, -dz * CONFIG.verticalScale).normalize();
}

function clipPolygon(polygon, axis, boundary, keepGreater) {
  if (!polygon.length) return polygon;
  const output = [];
  const coordinate = point => point[axis];
  const inside = point => keepGreater ? coordinate(point) >= boundary - 1e-9 : coordinate(point) <= boundary + 1e-9;
  for (let i = 0; i < polygon.length; i++) {
    const current = polygon[i];
    const previous = polygon[(i + polygon.length - 1) % polygon.length];
    const currentInside = inside(current);
    const previousInside = inside(previous);
    if (currentInside !== previousInside) {
      const denominator = coordinate(current) - coordinate(previous);
      const t = denominator === 0 ? 0 : (boundary - coordinate(previous)) / denominator;
      output.push({
        x: previous.x + (current.x - previous.x) * t,
        north: previous.north + (current.north - previous.north) * t,
        elevation: previous.elevation + (current.elevation - previous.elevation) * t,
        nx: previous.nx + (current.nx - previous.nx) * t,
        ny: previous.ny + (current.ny - previous.ny) * t,
        nz: previous.nz + (current.nz - previous.nz) * t
      });
    }
    if (currentInside) output.push(current);
  }
  return output;
}

function clipToTile(polygon, bbox) {
  let clipped = clipPolygon(polygon, "x", bbox.xmin, true);
  clipped = clipPolygon(clipped, "x", bbox.xmax, false);
  clipped = clipPolygon(clipped, "north", bbox.ymin, true);
  clipped = clipPolygon(clipped, "north", bbox.ymax, false);
  return clipped;
}

function buildTileGeometry(tile, values, mask, width, height, extent, originX, originNorth, baseElevation, focusBounds) {
  const gridWidth = width + 2;
  const gridHeight = height + 2;
  const bounds = {
    xmin: Math.max(tile.bbox.xmin, focusBounds.xmin, extent.xmin),
    xmax: Math.min(tile.bbox.xmax, focusBounds.xmax, extent.xmax),
    ymin: Math.max(tile.bbox.ymin, focusBounds.ymin, extent.ymin),
    ymax: Math.min(tile.bbox.ymax, focusBounds.ymax, extent.ymax)
  };
  const iStart = Math.max(0, Math.floor((bounds.xmin - extent.xmin) / extent.pixelX + 0.5) - 1);
  const iEnd = Math.min(gridWidth - 1, Math.ceil((bounds.xmax - extent.xmin) / extent.pixelX + 0.5) + 1);
  const jStart = Math.max(0, Math.floor((extent.ymax - bounds.ymax) / extent.pixelY + 0.5) - 1);
  const jEnd = Math.min(gridHeight - 1, Math.ceil((extent.ymax - bounds.ymin) / extent.pixelY + 0.5) + 1);
  const nodes = new Array(gridWidth * gridHeight);
  for (let j = jStart; j <= jEnd; j++) {
    for (let i = iStart; i <= iEnd; i++) {
      const column = Math.max(0, Math.min(width - 1, i - 1));
      const row = Math.max(0, Math.min(height - 1, j - 1));
      const sourceIndex = row * width + column;
      const valid = !mask[sourceIndex];
      const mapX = i === 0 ? extent.xmin : i === width + 1 ? extent.xmax : extent.xmin + (i - 0.5) * extent.pixelX;
      const north = j === 0 ? extent.ymax : j === height + 1 ? extent.ymin : extent.ymax - (j - 0.5) * extent.pixelY;
      const normal = valid ? smoothNormal(values, mask, width, height, row, column, extent.pixelX, extent.pixelY) : new THREE.Vector3(0, 1, 0);
      nodes[j * gridWidth + i] = { x: mapX, north, elevation: valid ? values[sourceIndex] : NaN, nx: normal.x, ny: normal.y, nz: normal.z, valid };
    }
  }
  const positions = [];
  const normals = [];
  const uvs = [];
  const pushTriangle = (a, b, c) => {
    for (const point of [a, b, c]) {
      positions.push(point.x - originX, (point.elevation - baseElevation) * CONFIG.verticalScale, point.north - originNorth);
      const normal = new THREE.Vector3(point.nx, point.ny, point.nz).normalize();
      normals.push(normal.x, normal.y, normal.z);
      uvs.push((point.x - tile.bbox.xmin) / (tile.bbox.xmax - tile.bbox.xmin), (point.north - tile.bbox.ymin) / (tile.bbox.ymax - tile.bbox.ymin));
    }
  };
  let sourceQuads = 0;
  const clipTriangle = triangle => {
    const withinFocus = clipToTile(triangle, focusBounds);
    const polygon = clipToTile(withinFocus, tile.bbox);
    if (polygon.length < 3) return;
    for (let index = 1; index < polygon.length - 1; index++) pushTriangle(polygon[0], polygon[index], polygon[index + 1]);
  };
  for (let j = jStart; j < jEnd; j++) {
    for (let i = iStart; i < iEnd; i++) {
      const a = nodes[j * gridWidth + i];
      const b = nodes[j * gridWidth + i + 1];
      const c = nodes[(j + 1) * gridWidth + i];
      const d = nodes[(j + 1) * gridWidth + i + 1];
      if (!(a.valid && b.valid && c.valid && d.valid)) continue;
      sourceQuads++;
      clipTriangle([a, b, c]);
      clipTriangle([c, b, d]);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geometry.computeBoundingSphere();
  return { geometry, sourceQuads, triangles: positions.length / 9 };
}

function buildManriqueTerrainGeometry(values, mask, width, height, extent, originX, originNorth, baseElevation, imageBounds) {
  const positions = [];
  const colors = [];
  const indices = [];
  let elevationMaximum = baseElevation;
  for (let index = 0; index < values.length; index++) if (!mask[index]) elevationMaximum = Math.max(elevationMaximum, values[index]);
  const elevationRange = Math.max(1, elevationMaximum - baseElevation);
  for (let row = 0; row < height; row++) {
    for (let column = 0; column < width; column++) {
      const index = row * width + column;
      const elevation = mask[index] ? baseElevation : values[index];
      const x = extent.xmin + column * extent.pixelX;
      const north = extent.ymax - row * extent.pixelY;
      positions.push(x - originX, (elevation - baseElevation) * CONFIG.verticalScale - 0.2, north - originNorth);
      const t = Math.max(0, Math.min(1, (elevation - baseElevation) / elevationRange));
      colors.push(0.28 + t * 0.20, 0.42 + t * 0.22, 0.30 + t * 0.12);
    }
  }
  for (let row = 0; row < height - 1; row++) {
    for (let column = 0; column < width - 1; column++) {
      const a = row * width + column, b = a + 1, c = a + width, d = c + 1;
      const centerX = extent.xmin + (column + 0.5) * extent.pixelX;
      const centerNorth = extent.ymax - (row + 0.5) * extent.pixelY;
      if (imageBounds.some(bounds => centerX >= bounds.xmin && centerX <= bounds.xmax && centerNorth >= bounds.ymin && centerNorth <= bounds.ymax)) continue;
      if (!mask[a] && !mask[b] && !mask[c]) indices.push(a, c, b);
      if (!mask[c] && !mask[b] && !mask[d]) indices.push(c, d, b);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}

async function loadTexture(loader, tile) {
  const url = new URL(tile.filename, new URL(CONFIG.textureFolderUrl, document.baseURI)).href;
  let texture;
  try {
    if (/\.tif$/i.test(tile.filename)) {
      const response = await fetch(url);
      if (!response.ok) throw new Error("HTTP " + response.status);
      const tiff = await fromArrayBuffer(await response.arrayBuffer());
      const image = await tiff.getImage();
      const rgb = await image.readRGB({ interleave: true });
      if (rgb.length !== image.getWidth() * image.getHeight() * 3) throw new Error("Unexpected TIFF RGB band layout.");
      const canvas = document.createElement("canvas");
      canvas.width = image.getWidth(); canvas.height = image.getHeight();
      const context = canvas.getContext("2d", { alpha: false });
      const pixels = context.createImageData(canvas.width, canvas.height);
      for (let source = 0, target = 0; source < rgb.length; source += 3, target += 4) {
        pixels.data[target] = rgb[source]; pixels.data[target + 1] = rgb[source + 1]; pixels.data[target + 2] = rgb[source + 2]; pixels.data[target + 3] = 255;
      }
      context.putImageData(pixels, 0, 0);
      texture = new THREE.CanvasTexture(canvas);
    } else texture = await loader.loadAsync(url);
  } catch (error) {
    throw new Error("Falló la textura " + tile.filename + " (" + url + "): " + (error && error.message ? error.message : error));
  }
  if (texture.image.width !== tile.width || texture.image.height !== tile.height) {
    texture.dispose();
    throw new Error("Dimensiones inesperadas en " + tile.filename + ".");
  }
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.flipY = true;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  const maxAnisotropy = renderer.capabilities && renderer.capabilities.getMaxAnisotropy ? renderer.capabilities.getMaxAnisotropy() : 1;
  texture.anisotropy = Math.min(4, maxAnisotropy);
  texture.needsUpdate = true;
  return texture;
}

async function initializeScene() {
  const scene = new THREE.Scene();
  // Convert projected east/north/up into Three.js east/up/south axes: north is -Z.
  scene.scale.set(1, 1, -1);
  scene.userData.axisConvention = "EPSG:9377; east +X, north -Z, up +Y";
  scene.background = new THREE.Color(0xdceaf1);
  const width = container.clientWidth;
  const height = container.clientHeight;
  const camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 20000);
  camera.up.set(0, 1, 0);
  let rendererError;
  try {
    renderer = new THREE.WebGLRenderer({
      antialias: false,
      alpha: false,
      powerPreference: "low-power",
      failIfMajorPerformanceCaveat: false
    });
    rendererBackend = "Three.js WebGL2";
  } catch (error) {
    rendererError = error;
    if (renderer) renderer.dispose();
    renderer = undefined;
  }
  if (rendererError) {
    const probe = contextName => {
      const canvas = document.createElement("canvas");
      let detail = "";
      canvas.addEventListener("webglcontextcreationerror", event => { detail = event.statusMessage || "error de creación informado por el navegador"; }, { once: true });
      const context = canvas.getContext(contextName, { failIfMajorPerformanceCaveat: false, antialias: false });
      if (context) {
        const loseContext = context.getExtension("WEBGL_lose_context");
        if (loseContext) loseContext.loseContext();
        return { available: true, detail };
      }
      return { available: false, detail };
    };
    const webgl2 = probe("webgl2");
    const webgl1 = probe("webgl");
    const cause = webgl2.available
      ? "Una prueba directa sí creó WebGL2; revisa la inicialización del renderer Three.js."
      : webgl1.available
        ? "Solo WebGL1 está disponible; esta versión de Three.js necesita WebGL2."
        : "El navegador no pudo crear un contexto WebGL2 para Three.js.";
    const browserDetail = webgl2.detail || webgl1.detail;
    throw new Error(cause + (browserDetail ? " Detalle del navegador: " + browserDetail + "." : "") + " Three.js: " + (rendererError.message || "sin detalle adicional"));
  }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, CONFIG.maxPixelRatio));
  renderer.setSize(width, height);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.localClippingEnabled = true;
  renderer.toneMapping = THREE.NoToneMapping;
  renderer.toneMappingExposure = 1.1;
  container.replaceChildren(renderer.domElement);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x78889a, 1.8));
  const sunlight = new THREE.DirectionalLight(0xffffff, 1.2);
  sunlight.position.set(-800, 1200, -900);
  scene.add(sunlight);
  controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.09;
  controls.enableRotate = true;
  controls.enablePan = true;
  controls.enableZoom = true;
  controls.touches = { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN };
  controls.mouseButtons = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN };
  controls.rotateSpeed = 0.8;
  controls.zoomSpeed = 1.5;
  controls.panSpeed = 0.9;
  controls.zoomToCursor = true;
  controls.screenSpacePanning = true;
  controls.minPolarAngle = 0.12;
  controls.maxPolarAngle = Math.PI / 2 - 0.015;
  controls.minDistance = 2;
  controls.maxDistance = 10000;
  const resize = () => {
    const w = container.clientWidth;
    const h = container.clientHeight;
    if (!w || !h) return;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, CONFIG.maxPixelRatio));
    renderer.setSize(w, h);
    for (const material of wideLineMaterials) material.resolution.set(w, h);
    requestSceneRender();
  };
  const observer = new ResizeObserver(resize);
  observer.observe(container);
  window.addEventListener("beforeunload", () => {
    observer.disconnect();
    cancelAnimationFrame(animationFrame);
    controls.dispose();
    renderer.dispose();
  }, { once: true });
  let frameQueued = false;
  const scheduleRender = () => {
    if (frameQueued) return;
    frameQueued = true;
    animationFrame = requestAnimationFrame(animate);
  };
  requestSceneRender = scheduleRender;
  controls.addEventListener("change", scheduleRender);
  const animate = () => {
    frameQueued = false;
    const cameraMoving = controls.update();
    camera.updateMatrixWorld();
    const north = northInView.set(0, 0, -1).transformDirection(camera.matrixWorldInverse);
    const northAngle = Math.atan2(north.x, north.y) * 180 / Math.PI;
    if (compassNeedle) compassNeedle.style.transform = "translate(-50%,-50%) rotate(" + northAngle + "deg)";
    if (compassCardinals) {
      compassCardinals.style.transform = "rotate(" + northAngle + "deg)";
      for (const label of compassCardinals.children) label.style.transform = "rotate(" + (-northAngle) + "deg)";
    }
    renderer.render(scene, camera);
    if (cameraMoving) scheduleRender();
  };
  scheduleRender();
  return { scene, camera, controls };
}

function createPrintSnapshot(scene, camera, orbitControls) {
  const width = 2400;
  const height = 2520;
  const printAspect = width / height;
  const printCamera = camera.clone();
  const targetCenter = orbitControls.target.clone();
  const viewOffset = printCamera.position.clone().sub(targetCenter);
  viewOffset.multiplyScalar(Math.max(1, camera.aspect / printAspect));
  printCamera.position.copy(targetCenter).add(viewOffset);
  printCamera.aspect = printAspect;
  printCamera.lookAt(targetCenter);
  printCamera.updateProjectionMatrix();

  const target = new THREE.WebGLRenderTarget(width, height, {
    format: THREE.RGBAFormat,
    type: THREE.UnsignedByteType,
    depthBuffer: true,
    stencilBuffer: false,
    samples: 0
  });
  target.texture.colorSpace = THREE.SRGBColorSpace;
  target.texture.generateMipmaps = false;
  const previousTarget = renderer.getRenderTarget();
  const previousViewport = renderer.getViewport(new THREE.Vector4());
  const previousScissor = renderer.getScissor(new THREE.Vector4());
  const previousScissorTest = renderer.getScissorTest();
  const pixels = new Uint8Array(width * height * 4);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", { alpha: false });
  if (!context) {
    target.dispose();
    throw new Error("No fue posible crear la imagen de impresión.");
  }
  try {
    renderer.setRenderTarget(target);
    renderer.setViewport(0, 0, width, height);
    renderer.setScissorTest(false);
    renderer.render(scene, printCamera);
    renderer.readRenderTargetPixels(target, 0, 0, width, height, pixels);
    const imageData = context.createImageData(width, height);
    const rowSize = width * 4;
    for (let row = 0; row < height; row++) {
      const sourceStart = (height - 1 - row) * rowSize;
      imageData.data.set(pixels.subarray(sourceStart, sourceStart + rowSize), row * rowSize);
    }
    context.putImageData(imageData, 0, 0);
  } finally {
    renderer.setRenderTarget(previousTarget);
    renderer.setViewport(previousViewport);
    renderer.setScissor(previousScissor);
    renderer.setScissorTest(previousScissorTest);
    target.dispose();
    renderer.render(scene, camera);
  }
  return canvas.toDataURL("image/png");
}

function updatePrint3DComposition() {
  const camera = window.__terrain3d.camera;
  camera.updateMatrixWorld();
  const northDirection = new THREE.Vector3(0, 0, -1).transformDirection(camera.matrixWorldInverse);
  const northAngle = Math.atan2(northDirection.x, northDirection.y) * 180 / Math.PI;
  const printCardinals = document.getElementById("print-3d-cardinals");
  printCardinals.style.transform = "rotate(" + northAngle + "deg)";
  for (const label of printCardinals.children) label.style.transform = "rotate(" + (-northAngle) + "deg)";
  document.getElementById("print-3d-needle").style.transform = "translate(-50%,-50%) rotate(" + northAngle + "deg)";

  const layerList = document.getElementById("print-3d-layers");
  layerList.replaceChildren();
  const activeLayers = [...document.querySelectorAll(".layer-toggle input:checked")];
  for (const input of activeLayers) {
    const source = input.closest(".layer-toggle");
    const row = source.cloneNode(true);
    row.querySelector("input").remove();
    layerList.appendChild(row);
  }
  if (!activeLayers.length) layerList.textContent = "Sin capas activas.";

  const riskVisible = document.getElementById("layer-risk").checked;
  const threatVisible = document.getElementById("layer-threat").checked;
  const slopeVisible = document.getElementById("layer-slope").checked;
  const legend = document.getElementById("print-3d-legend");
  legend.replaceChildren();
  if (riskVisible || threatVisible || slopeVisible) {
    const sourceItems = [...document.querySelectorAll(".legend-grid .legend-item")];
    const filteredItems = sourceItems.filter(item => {
      const label = item.textContent.toLocaleLowerCase("es");
      if (label.includes("amenaza media")) return threatVisible;
      if (label.includes("alto no mitigable")) return riskVisible || threatVisible;
      if (label.includes("bajo / amenaza baja")) return riskVisible || threatVisible;
      return riskVisible;
    });
    const grid = document.createElement("div");
    grid.className = "legend-grid";
    filteredItems.forEach(item => grid.appendChild(item.cloneNode(true)));
    if (slopeVisible) {
      document.querySelectorAll(".slope-legend p").forEach(item => {
        const entry = document.createElement("span");
        entry.className = "legend-item";
        const swatch = item.querySelector("i").cloneNode();
        const label = item.textContent;
        entry.append(swatch, document.createTextNode(label));
        grid.appendChild(entry);
      });
    }
    legend.appendChild(grid);
  } else {
    legend.textContent = "Activa zonificación de riesgo o amenaza para incluir sus clases.";
  }

  const bounds = window.__terrain3d.focusBounds;
  const centerEasting = (bounds.xmin + bounds.xmax) / 2;
  const centerNorthing = (bounds.ymin + bounds.ymax) / 2;
  document.getElementById("print-3d-center").textContent = "E " + formatNumber(centerEasting, 0) + " m · N " + formatNumber(centerNorthing, 0) + " m";
  const date = new Intl.DateTimeFormat("es-CO", { year: "numeric", month: "long", day: "numeric" }).format(new Date());
  document.getElementById("print-3d-date").textContent = date;
  document.getElementById("print-3d-footer-date").textContent = date;
}

async function downloadTerrainPdf() {
  const button = document.getElementById("download-map-pdf");
  const terrain = window.__terrain3d;
  if (!terrain || !renderer) return;
  button.disabled = true;
  button.textContent = "Preparando PDF…";
  setStatus("Preparando una captura de alta resolución para impresión…");
  try {
    terrain.controls.update();
    const image = createPrintSnapshot(terrain.scene, terrain.camera, terrain.controls);
    updatePrint3DComposition();
    const imageElement = document.getElementById("print-3d-image");
    imageElement.src = image;
    await imageElement.decode();
    document.getElementById("print-sheet").setAttribute("aria-hidden", "false");
    setStatus("Composición lista. En el diálogo de impresión, elige Guardar como PDF.");
    window.print();
  } catch (error) {
    console.error("No se pudo preparar el mapa PDF 3D:", error);
    setStatus("No se pudo preparar la descarga PDF. " + (error && error.message ? error.message : "Vuelve a intentarlo."), "error");
  } finally {
    button.disabled = false;
    button.textContent = "Descargar mapa PDF";
  }
}

async function main() {
  if (!container || !statusEl) throw new Error("Faltan elementos requeridos en vista-3d.html.");
  const { scene, camera } = await initializeScene();
  const maxTextureSize = renderer.backend && renderer.backend.device && renderer.backend.device.limits
    ? renderer.backend.device.limits.maxTextureDimension2D
    : renderer.capabilities && Number.isFinite(renderer.capabilities.maxTextureSize) ? renderer.capabilities.maxTextureSize : Infinity;
  if (maxTextureSize < 1024) {
    throw new Error("La GPU admite texturas de hasta " + maxTextureSize + " px; se requieren al menos 1024 px.");
  }
  setStatus("Leyendo manifiesto y georreferencia del DEM…");
  const [manifest, world, tiff, slopeTiff, slopeWorld, buildingSource, buildingAttributes, parcelSource, parcelAttributes, riskSource, riskAttributes, threatSource, threatAttributes, bufferSource] = await Promise.all([
    loadJson(CONFIG.manifestUrl).catch(error => { throw new Error("Fallo al cargar el manifiesto de ortofotos: " + error.message); }),
    loadWorldFile(CONFIG.worldFileUrl).catch(error => { throw new Error("Fallo al cargar la georreferencia del DEM: " + error.message); }),
    loadDem(CONFIG.demUrl).catch(error => { throw new Error("Fallo al cargar el DEM " + CONFIG.demUrl + ": " + (error && error.message ? error.message : error)); }),
    loadDem(CONFIG.slopeUrl).catch(error => { throw new Error("Fallo al cargar la clasificación de pendientes: " + (error && error.message ? error.message : error)); }),
    loadWorldFile(CONFIG.slopeWorldFileUrl),
    Promise.resolve({ features: [], recordCount: 0 }),
    Promise.resolve({ records: [], recordCount: 0 }),
    Promise.resolve({ features: [], recordCount: 0 }),
    Promise.resolve({ records: [], recordCount: 0 }),
    loadBuildingFootprints(CONFIG.riskUrl, CONFIG.riskIndexUrl, CONFIG.riskProjectionUrl).catch(error => { throw new Error("Fallo al cargar geometrías de riesgo: " + error.message); }),
    loadCategoryAttributes(CONFIG.riskAttributesUrl, CONFIG.riskEncodingUrl, "riesgo", ["codigo", "nombre", "descripcio", "tipo_amena", "categoria_", "subcategor", "fecha_adop", "fecha_actu", "shape_area"]).catch(error => { throw new Error("Fallo al cargar categorías de riesgo: " + error.message); }),
    loadBuildingFootprints(CONFIG.threatUrl, CONFIG.threatIndexUrl, CONFIG.threatProjectionUrl).catch(error => { throw new Error("Fallo al cargar geometrías de amenaza: " + error.message); }),
    loadCategoryAttributes(CONFIG.threatAttributesUrl, CONFIG.threatEncodingUrl, "grado_amen", ["objectid", "codigo", "categoria", "categoria_", "subcategor", "fecha_adop", "fecha_actu"]).catch(error => { throw new Error("Fallo al cargar categorías de amenaza: " + error.message); }),
    loadBuildingFootprints(CONFIG.bufferUrl, CONFIG.bufferIndexUrl, CONFIG.bufferProjectionUrl).catch(error => { throw new Error("Fallo al cargar el buffer del area de estudio: " + error.message); }),
  ]);
  for (const [name, source, attributes] of [["riesgo", riskSource, riskAttributes], ["amenaza", threatSource, threatAttributes]]) {
    if (source.recordCount !== attributes.recordCount) throw new Error("SHP/SHX/DBF de " + name + " tienen diferente número de registros.");
    for (let index = 0; index < source.features.length; index++) Object.assign(source.features[index], attributes.records[index]);
  }
  if (!bufferSource.features.length) throw new Error("La capa de barrios no contiene polígonos para encuadrar Manrique.");
  const image = await tiff.getImage();
  const width = image.getWidth();
  const height = image.getHeight();
  if (width < 100 || height < 100) throw new Error("El DEM de Manrique tiene dimensiones inesperadas: " + width + " × " + height + ".");
  const extent = getDemExtent(width, height, world);
  const slopeImage = await slopeTiff.getImage();
  const slopeWidth = slopeImage.getWidth(), slopeHeight = slopeImage.getHeight();
  const slopeExtent = getDemExtent(slopeWidth, slopeHeight, slopeWorld);
  const slopeCrs = slopeImage.getGeoKeys ? slopeImage.getGeoKeys().ProjectedCSTypeGeoKey : null;
  if (slopeCrs !== 9377 || slopeWidth !== width || slopeHeight !== height ||
      Math.abs(slopeExtent.xmin - extent.xmin) > 0.01 || Math.abs(slopeExtent.ymin - extent.ymin) > 0.01 ||
      Math.abs(slopeExtent.xmax - extent.xmax) > 0.01 || Math.abs(slopeExtent.ymax - extent.ymax) > 0.01 ||
      Math.abs(slopeExtent.pixelX - extent.pixelX) > 1e-6 || Math.abs(slopeExtent.pixelY - extent.pixelY) > 1e-6) {
    throw new Error("El raster 5metros_Slope no coincide con la resolución, extensión o EPSG:9377 del DEM.");
  }
  const slopeBands = await slopeImage.readRasters({ interleave: false });
  const slopeValues = slopeBands[0];
  if (!slopeValues || slopeValues.length !== width * height) throw new Error("El raster de pendientes no contiene una banda válida.");
  const focusBounds = focusBoundsFromFeatures(bufferSource, CONFIG.focusMarginMeters, extent);
  const textureCoverage = validateManifest(manifest, extent);
  const geoKeys = image.getGeoKeys ? image.getGeoKeys() : {};
  const projectedCrs = geoKeys.ProjectedCSTypeGeoKey;
  if (projectedCrs !== 9377) throw new Error("El GeoTIFF no confirma EPSG:9377 (código detectado: " + projectedCrs + ").");
  let rasterBands;
  try {
    rasterBands = await image.readRasters({ interleave: false });
  } catch (error) {
    throw new Error("No se pudieron leer las bandas del DEM " + CONFIG.demUrl + ": " + (error && error.message ? error.message : error));
  }
  const elevations = rasterBands[0];
  if (!elevations || elevations.length !== width * height) throw new Error("No se pudieron leer los valores de elevación del DEM.");
  const nodataValue = image.getGDALNoData ? image.getGDALNoData() : null;
  const nodata = nodataValue === null || nodataValue === undefined ? null : Number(nodataValue);
  const analysis = analyzeNoData(elevations, nodata, width, height);
  if (analysis.validCount === 0) throw new Error("El DEM no contiene valores de elevación válidos.");
  const displaySurface = createDisplaySurface(elevations, analysis.mask, width, height);
  setStatus("DEM leído: " + width + " × " + height + " celdas. Analizando NoData antes de crear la superficie…", analysis.missingCount ? "warning" : "info");
  if (Math.abs(extent.pixelX - 5) > 1e-6 || Math.abs(extent.pixelY - 5) > 1e-6) throw new Error("La resolución del DEM de Manrique no es de 5 m según el TFW.");
  const originX = (extent.xmin + extent.xmax) / 2;
  const originNorth = (extent.ymin + extent.ymax) / 2;
  const baseElevation = analysis.minimum;
  const textureLoader = new THREE.TextureLoader();
  const tiles = manifest.tiles.filter(tile =>
    tile.bbox.xmax > extent.xmin && tile.bbox.xmin < extent.xmax &&
    tile.bbox.ymax > extent.ymin && tile.bbox.ymin < extent.ymax
  ).sort((a, b) => a.row - b.row || a.column - b.column);
  if (!tiles.length) throw new Error("Ninguna tesela de ortofoto intersecta el entorno del área de estudio.");
  const textures = new Map();
  const terrainTileMeshes = [];
  let loadedTextures = 0;
  for (const tile of tiles) {
    const texture = await loadTexture(textureLoader, tile);
    textures.set(tile.filename, texture);
    loadedTextures++;
    setStatus("Cargando ortofoto optimizada: " + loadedTextures + " de " + tiles.length + " teselas…");
  }
  setStatus("Texturas cargadas. Construyendo malla y recortando los parches en sus límites geográficos…");
  let renderedTriangles = 0;
  const materials = [];
  const terrainLayer = new THREE.Group();
  terrainLayer.name = "terrain_and_orthophoto_layer";
  const fullAreaGeometry = buildManriqueTerrainGeometry(displaySurface.values, displaySurface.mask, width, height, extent, originX, originNorth, baseElevation, tiles.map(tile => tile.bbox));
  const fullAreaMesh = new THREE.Mesh(fullAreaGeometry, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: 2, polygonOffsetUnits: 2 }));
  fullAreaMesh.name = "terrain_manrique_5m";
  terrainLayer.add(fullAreaMesh);
  renderedTriangles += fullAreaGeometry.index.count / 3;
  for (const tile of tiles) {
    const result = buildTileGeometry(tile, displaySurface.values, displaySurface.mask, width, height, extent, originX, originNorth, baseElevation, extent);
    renderedTriangles += result.triangles;
    const material = new THREE.MeshStandardMaterial({ map: textures.get(tile.filename), roughness: 1, metalness: 0, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    const mesh = new THREE.Mesh(result.geometry, material);
    mesh.renderOrder = 1;
    mesh.name = "terrain_" + tile.filename.replace(".jpg", "");
    mesh.userData = { filename: tile.filename, bbox: tile.bbox, row: tile.row, column: tile.column };
    terrainLayer.add(mesh);
    terrainTileMeshes.push(mesh);
    materials.push(material);
  }
  const terrainSkirt = createTerrainSkirt(displaySurface.values, displaySurface.mask, width, height, extent, originX, originNorth, baseElevation, CONFIG.terrainSkirtDepthMeters, extent);
  terrainLayer.add(terrainSkirt);
  scene.add(terrainLayer);
  const slopeTexture = rasterClassTexture(slopeValues, width, height);
  const hillshadeTexture = createHillshadeTexture(elevations, analysis.mask, width, height);
  const slopeLayer = makeDrapedRasterLayer("slope_classification_5m", terrainTileMeshes, extent, slopeTexture, 1.4);
  const hillshadeLayer = makeDrapedRasterLayer("hillshade_5m", terrainTileMeshes, extent, hillshadeTexture, 1.5);
  slopeTexture.dispose(); hillshadeTexture.dispose();
  scene.add(slopeLayer, hillshadeLayer);
  const bufferLayer = addPolygonOverlay(scene, bufferSource, null, "buffer", elevations, analysis.mask, width, height, extent, originX, originNorth, baseElevation);
  const extrusionSample = null;
  const buildingLayer = new THREE.Group(); buildingLayer.name = "building_footprints_layer"; scene.add(buildingLayer);
  const estimatedBuildingLayer = new THREE.Group(); estimatedBuildingLayer.name = "estimated_building_volumes_layer"; scene.add(estimatedBuildingLayer);
  const parcelLayer = new THREE.Group(); parcelLayer.name = "parcel_boundaries_layer"; scene.add(parcelLayer);
  const buildingFeatures = new Map(), parcelFeatures = new Map();
  let buildingLoadPromise = null, parcelLoadPromise = null;
  let constructionRiskSymbology = false, parcelRiskSymbology = false;
  const movePreparedLayer = (target, prepared) => {
    scene.remove(prepared);
    while (prepared.children.length) target.add(prepared.children[0]);
    target.userData = prepared.userData;
  };
  const ensureBuildings = async () => {
    if (!buildingLoadPromise) buildingLoadPromise = Promise.all([
      loadBuildingFootprints(CONFIG.buildingsUrl, CONFIG.buildingsIndexUrl, CONFIG.buildingsProjectionUrl),
      loadBuildingAttributes(CONFIG.buildingsAttributesUrl, CONFIG.buildingsEncodingUrl)
    ]).then(([source, attributes]) => {
      if (attributes.recordCount !== source.recordCount) throw new Error("El DBF y el SHP de construcciones tienen diferente número de registros.");
      for (const feature of source.features) {
        const row = attributes.records[feature.id - 1];
        if (!row || row.recordId !== feature.id) throw new Error("No se pudo relacionar la geometría de construcción " + feature.id + " con sus atributos.");
        Object.assign(feature, row); buildingFeatures.set(feature.id, feature);
      }
      buildingSource.features = source.features; buildingSource.recordCount = source.recordCount;
      buildingAttributes.records = attributes.records; buildingAttributes.recordCount = attributes.recordCount;
    });
    await buildingLoadPromise;
  };
  const buildFootprintsOnDemand = async () => {
    await ensureBuildings();
    const prepared = await addBuildingFootprints(scene, buildingSource, elevations, analysis.mask, width, height, extent, originX, originNorth, baseElevation);
    movePreparedLayer(buildingLayer, prepared);
    setFeatureRiskColors(buildingLayer, buildingFeatures, constructionRiskSymbology);
  };
  const buildVolumesOnDemand = async () => {
    await ensureBuildings();
    const prepared = await addEstimatedBuildingVolumes(scene, buildingSource, elevations, analysis.mask, width, height, extent, originX, originNorth, baseElevation);
    movePreparedLayer(estimatedBuildingLayer, prepared);
  };
  const buildParcelsOnDemand = async () => {
    if (!parcelLoadPromise) parcelLoadPromise = Promise.all([
      loadBuildingFootprints(CONFIG.parcelsUrl, CONFIG.parcelsIndexUrl, CONFIG.parcelsProjectionUrl),
      loadParcelAttributes(CONFIG.parcelsAttributesUrl, CONFIG.parcelsEncodingUrl)
    ]).then(([source, attributes]) => {
      if (attributes.recordCount !== source.recordCount) throw new Error("El DBF y el SHP predial tienen diferente número de registros.");
      for (let index = 0; index < source.features.length; index++) {
        Object.assign(source.features[index], attributes.records[index]); parcelFeatures.set(source.features[index].id, source.features[index]);
      }
      parcelSource.features = source.features; parcelSource.recordCount = source.recordCount;
      parcelAttributes.records = attributes.records; parcelAttributes.recordCount = attributes.recordCount;
    });
    await parcelLoadPromise;
    const prepared = await addParcelBoundaries(scene, parcelSource, elevations, analysis.mask, width, height, extent, originX, originNorth, baseElevation);
    movePreparedLayer(parcelLayer, prepared);
    setFeatureRiskColors(parcelLayer, parcelFeatures, parcelRiskSymbology);
  };
  const riskLayer = addPolygonOverlay(scene, riskSource, riskAttributes, "risk", elevations, analysis.mask, width, height, extent, originX, originNorth, baseElevation);
  const threatLayer = addPolygonOverlay(scene, threatSource, threatAttributes, "threat", elevations, analysis.mask, width, height, extent, originX, originNorth, baseElevation);
  const focusClipPlanes = applySceneFocusClip(scene, focusBounds, originX, originNorth, terrainLayer);
  enableLayerToggle("layer-terrain", terrainLayer);
  enableLayerToggle("layer-slope", slopeLayer);
  enableLayerToggle("layer-hillshade", hillshadeLayer);
  enableLayerToggle("layer-buffer", bufferLayer);
  enableLayerToggle("layer-buildings", buildingLayer, buildFootprintsOnDemand);
  enableLayerToggle("layer-building-volumes", estimatedBuildingLayer, buildVolumesOnDemand);
  enableLayerToggle("layer-parcels", parcelLayer, buildParcelsOnDemand);
  enableLayerToggle("layer-risk", riskLayer);
  enableLayerToggle("layer-threat", threatLayer);
  const riskLegend = document.querySelector(".legend");
  const connectSymbologyToggle = (buttonId, initial, setter, layer, features) => {
    const button = document.getElementById(buttonId);
    button.addEventListener("click", () => {
      const enabled = button.getAttribute("aria-pressed") !== "true";
      button.setAttribute("aria-pressed", String(enabled));
      button.textContent = enabled ? "Ocultar simbología" : "Mostrar simbología";
      setter(enabled);
      if (riskLegend) riskLegend.open = constructionRiskSymbology || parcelRiskSymbology;
      setFeatureRiskColors(layer, features, enabled);
    });
  };
  connectSymbologyToggle("layer-buildings-symbology", constructionRiskSymbology, value => { constructionRiskSymbology = value; }, buildingLayer, buildingFeatures);
  connectSymbologyToggle("layer-parcels-symbology", parcelRiskSymbology, value => { parcelRiskSymbology = value; }, parcelLayer, parcelFeatures);
  const selectionLayers = [
    { key: "buildings", layer: buildingLayer, source: "Construcciones_Barrios_Estudio", features: buildingFeatures, enabled: () => document.getElementById("layer-buildings").checked },
    { key: "volumes", layer: estimatedBuildingLayer, source: "Construcciones_Barrios_Estudio", features: buildingFeatures, enabled: () => document.getElementById("layer-building-volumes").checked },
    { key: "parcels", layer: parcelLayer, source: "Predios_Barrios_Estudio", features: parcelFeatures, enabled: () => document.getElementById("layer-parcels").checked },
    { key: "risk", layer: riskLayer, source: "RIESGO_MOV_MASA", features: new Map(riskSource.features.map(feature => [feature.id, feature])), enabled: () => document.getElementById("layer-risk").checked },
    { key: "threat", layer: threatLayer, source: "Amenaza_Mov_Masa", features: new Map(threatSource.features.map(feature => [feature.id, feature])), enabled: () => document.getElementById("layer-threat").checked },
    { key: "buffer", layer: bufferLayer, source: "BARRIOS_INFLUENCIA", features: new Map(bufferSource.features.map(feature => [feature.id, feature])), enabled: () => document.getElementById("layer-buffer").checked }
  ];
  setupFeatureSelection(scene, camera, renderer, controls, selectionLayers, { sampleArgs: [displaySurface.values, displaySurface.mask, width, height, extent], originX, originNorth, baseElevation });
  if (!renderedTriangles) throw new Error("No se generaron triángulos válidos; revise la máscara NoData del DEM.");
  const focusCenterX = (focusBounds.xmin + focusBounds.xmax) / 2;
  const focusCenterNorth = (focusBounds.ymin + focusBounds.ymax) / 2;
  const focusGround = sampleRenderedSurfaceElevation(focusCenterX, focusCenterNorth, displaySurface.values, displaySurface.mask, width, height, extent);
  const center = new THREE.Vector3(focusCenterX - originX, ((focusGround === null ? analysis.maximum : focusGround) - baseElevation) * CONFIG.verticalScale * 0.35, originNorth - focusCenterNorth);
  controls.target.copy(center);
  const span = Math.max(focusBounds.xmax - focusBounds.xmin, focusBounds.ymax - focusBounds.ymin);
  camera.position.set(center.x, center.y + span * 1.2, center.z + span * 1.2);
  camera.lookAt(center);
  camera.updateProjectionMatrix();
  controls.update();
  requestSceneRender();
  setupNavigationButtons(camera, controls);
  const uncoveredNorth = Math.max(0, extent.ymax - textureCoverage.imageExtent.ymax);
  const textureCoveragePercent = Math.round(textureCoverage.coverageRatio * 100);
  setStatus("Terreno listo. Ortofoto: " + textureCoveragePercent + "% del DEM. Las construcciones se cargan al activar su capa.", textureCoveragePercent < 99 ? "warning" : "info");
  const estimateNote = document.querySelector(".estimate-note"); if (estimateNote) estimateNote.textContent = "Alturas estimadas a 2,10 m por piso; son aproximaciones, no mediciones verificadas.";
  window.__terrain3d = { scene, camera, controls, renderer, textureCount: textures.size, validElevationCount: analysis.validCount, nodataCount: analysis.missingCount, nodataComponents: analysis.components, renderedTriangles, patchCount: tiles.length, focusBounds, focusClipPlanes, terrainSkirt, buildingLayer, estimatedBuildingLayer, parcelLayer, riskLayer, threatLayer, buildingRecordCount: buildingSource.recordCount, buildingAttributeCount: buildingAttributes.recordCount, parcelRecordCount: parcelSource.recordCount, riskRecordCount: riskSource.recordCount, threatRecordCount: threatSource.recordCount, extrusionSample, verticalScale: CONFIG.verticalScale };
  document.getElementById("download-map-pdf").disabled = false;
}

document.getElementById("download-map-pdf").addEventListener("click", downloadTerrainPdf);
window.addEventListener("afterprint", () => {
  document.getElementById("print-sheet").setAttribute("aria-hidden", "true");
  document.getElementById("print-3d-image").removeAttribute("src");
});

main().catch(error => {
  console.error("Fallo al preparar el terreno Three.js:", error);
  setStatus("No se pudo cargar el terreno 3D. " + (error && error.message ? error.message : "Revisa la consola."), "error");
});


