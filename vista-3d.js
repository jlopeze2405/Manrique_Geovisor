import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { fromArrayBuffer } from "geotiff";

const CONFIG = Object.freeze({
  verticalScale: 1.0,
  demUrl: "data/Raster/ZONA_ESTUDIO.tif",
  worldFileUrl: "data/Raster/ZONA_ESTUDIO.tfw",
  buildingsUrl: "data/Construcciones_Area_Estudio/Construcciones_Area_Estudio.shp",
  buildingsIndexUrl: "data/Construcciones_Area_Estudio/Construcciones_Area_Estudio.shx",
  buildingsAttributesUrl: "data/Construcciones_Area_Estudio/Construcciones_Area_Estudio.dbf",
  buildingsEncodingUrl: "data/Construcciones_Area_Estudio/Construcciones_Area_Estudio.cpg",
  buildingsProjectionUrl: "data/Construcciones_Area_Estudio/Construcciones_Area_Estudio.prj",
  parcelsUrl: "data/Predios/Predios_Influencia.shp",
  parcelsIndexUrl: "data/Predios/Predios_Influencia.shx",
  parcelsProjectionUrl: "data/Predios/Predios_Influencia.prj",
  riskUrl: "data/RIESGO_MOV_MASA/RIESGO_MOV_MASA.shp",
  riskIndexUrl: "data/RIESGO_MOV_MASA/RIESGO_MOV_MASA.shx",
  riskAttributesUrl: "data/RIESGO_MOV_MASA/RIESGO_MOV_MASA.dbf",
  riskEncodingUrl: "data/RIESGO_MOV_MASA/RIESGO_MOV_MASA.cpg",
  riskProjectionUrl: "data/RIESGO_MOV_MASA/RIESGO_MOV_MASA.prj",
  threatUrl: "data/recorte/Amenaza_Mov_Masa.shp",
  threatIndexUrl: "data/recorte/Amenaza_Mov_Masa.shx",
  threatAttributesUrl: "data/recorte/Amenaza_Mov_Masa.dbf",
  threatEncodingUrl: "data/recorte/Amenaza_Mov_Masa.CPG",
  threatProjectionUrl: "data/recorte/Amenaza_Mov_Masa.prj",
  bufferUrl: "data/Buffer_Area_Estudio/Bff_Uva.shp",
  bufferIndexUrl: "data/Buffer_Area_Estudio/Bff_Uva.shx",
  bufferProjectionUrl: "data/Buffer_Area_Estudio/Bff_Uva.prj",
  estimatedHeightPerFloor: 2.1,
  terrainSkirtDepthMeters: 80,
  focusMarginMeters: 180,
  manifestUrl: "data/Raster/ortho_tiles_fast/tiles.json",
  textureFolderUrl: "data/Raster/ortho_tiles_fast/",
  extentToleranceMeters: 0.00001,
  maxPixelRatio: 1.25
});

const container = document.getElementById("threeContainer");
const statusEl = document.getElementById("load-state");
const diagnosticsEl = document.getElementById("terrain-diagnostics");
const compassNeedle = document.getElementById("compass-needle");
const compassCardinals = document.getElementById("compass-cardinals");
const northInView = new THREE.Vector3();
let renderer;
let rendererBackend = "";
let controls;
let animationFrame;

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
  }
  if (indexBuffer.byteLength !== 100 + recordCount * 8) throw new Error("La cantidad de entradas del SHX no coincide con los registros SHP.");
  if (offset !== buffer.byteLength) throw new Error("El tamaño final del SHP no coincide con sus registros.");
  return { features, recordCount, partCount, pointCount, declaredType };
}

// Reads one thematic category field only; parcel owner DBFs are never requested.
async function loadCategoryAttributes(url, encodingUrl, fieldName) {
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
  const values = new Array(recordCount);
  for (let i = 0; i < recordCount; i++) {
    const base = headerLength + i * recordLength;
    if (view.getUint8(base) !== 0x20) throw new Error("Registro DBF temático eliminado o inválido.");
    values[i] = decoder.decode(new Uint8Array(buffer, base + target.offset, target.length)).trim();
  }
  return { recordCount, values, fieldName, encoding };
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
  const required = ["altura", "numero_pis", "numero_sot", "cat_riesgo", "cat_amenza"];
  for (const name of required) if (!fields.has(name)) throw new Error("Falta el campo " + name + " en el DBF.");
  for (const name of ["altura", "numero_pis", "numero_sot"]) if (!["N", "F"].includes(fields.get(name).type)) throw new Error("El campo " + name + " no es numérico en el DBF.");
  for (const name of ["cat_riesgo", "cat_amenza"]) if (fields.get(name).type !== "C") throw new Error("El campo " + name + " no es texto en el DBF.");
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
      const start = base + field.offset;
      const raw = decoder.decode(new Uint8Array(buffer, start, field.length)).trim();
      if (!raw) return null;
      const value = Number(raw);
      if (!Number.isFinite(value)) throw new Error("Valor no numérico en " + name + ", registro DBF " + (index + 1) + ".");
      return value;
    };
    const readText = name => {
      const field = fields.get(name);
      const start = base + field.offset;
      return decoder.decode(new Uint8Array(buffer, start, field.length)).trim();
    };
    const floorCount = readNumber("numero_pis");
    const sourceHeight = readNumber("altura");
    const basementCount = readNumber("numero_sot");
    if (floorCount === null || sourceHeight === null || basementCount === null || floorCount < 0 || basementCount < 0) {
      throw new Error("Hay valores nulos o negativos en atributos de altura del registro DBF " + (index + 1) + ".");
    }
    if (!Number.isInteger(floorCount)) throw new Error("numero_pis no es entero en el registro DBF " + (index + 1) + ".");
    if (floorCount > 0) {
      const formulaHeight = floorCount * CONFIG.estimatedHeightPerFloor;
      if (Math.abs(sourceHeight - formulaHeight) > 1e-7) throw new Error("Altura no coincide con numero_pis × 2,10 en el registro " + (index + 1) + ".");
      estimatedCount++;
      records[index] = { recordId: index + 1, floorCount, basementCount, estimatedHeight: formulaHeight, heightStatus: "estimated", riskCategory: readText("cat_riesgo"), threatCategory: readText("cat_amenza") };
    } else {
      if (sourceHeight !== 0) throw new Error("El registro " + (index + 1) + " tiene numero_pis=0 y Altura distinta de cero.");
      zeroCount++;
      records[index] = { recordId: index + 1, floorCount, basementCount, estimatedHeight: null, heightStatus: "unknown", riskCategory: readText("cat_riesgo"), threatCategory: readText("cat_amenza") };
    }
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

function addBuildingFootprints(scene, source, values, mask, width, height, extent, originX, originNorth, baseElevation) {
  const fillPositions = [], boundaryPositions = [], featureIds = [], skippedFeatures = [];
  let polygonCount = 0, holeCount = 0, failedPolygons = 0;
  for (const feature of source.features) {
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
        fillPositions.push(p.x - originX, (elevation - baseElevation) * CONFIG.verticalScale + 0.25, p.north - originNorth);
        featureIds.push(feature.id);
      }
      for (const ring of flat) {
        for (let i = 0; i < ring.length; i++) {
          const a = ring[i], b = ring[(i + 1) % ring.length];
          const ea = sampleRenderedSurfaceElevation(a.x, a.north, values, mask, width, height, extent);
          const eb = sampleRenderedSurfaceElevation(b.x, b.north, values, mask, width, height, extent);
          if (ea === null || eb === null) continue;
          boundaryPositions.push(a.x - originX, (ea - baseElevation) * CONFIG.verticalScale + 0.55, a.north - originNorth,
            b.x - originX, (eb - baseElevation) * CONFIG.verticalScale + 0.55, b.north - originNorth);
        }
      }
      featureValid = true; polygonCount++;
    }
    if (!featureValid) skippedFeatures.push(feature.id);
  }
  const layer = new THREE.Group(); layer.name = "building_footprints_layer";
  const fillGeometry = new THREE.BufferGeometry();
  fillGeometry.setAttribute("position", new THREE.Float32BufferAttribute(fillPositions, 3));
  const idAttribute = new THREE.Float32BufferAttribute(featureIds, 1); idAttribute.setUsage(THREE.StaticDrawUsage);
  fillGeometry.setAttribute("featureId", idAttribute); fillGeometry.computeVertexNormals();
  const fill = new THREE.Mesh(fillGeometry, new THREE.MeshBasicMaterial({ color: 0xc87945, transparent: true, opacity: 0.42, side: THREE.DoubleSide, depthTest: true, depthWrite: false, toneMapped: false }));
  fill.name = "building_footprints_fill"; fill.userData.featureIds = [...new Set(featureIds)]; layer.add(fill);
  const lineGeometry = new THREE.BufferGeometry();
  lineGeometry.setAttribute("position", new THREE.Float32BufferAttribute(boundaryPositions, 3));
  const outlines = new THREE.LineSegments(lineGeometry, new THREE.LineBasicMaterial({ color: 0x5c321e, depthTest: true, toneMapped: false }));
  outlines.name = "building_footprints_outlines"; layer.add(outlines);
  layer.userData = { featureCount: source.features.length - skippedFeatures.length, sourceFeatureCount: source.recordCount, polygonCount, holeCount, failedPolygons, skippedFeatureIds: skippedFeatures, source: CONFIG.buildingsUrl, crs: "EPSG:9377", ids: [...new Set(featureIds)] };
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
  const positions = [], colors = [], indices = [], outlines = [], outlineColors = [], counts = {};
  const maxTriangleEdge = kind === "buffer" ? 5 : 8;
  let skippedTriangles = 0;
  const pushDrapedTriangle = (points, color, lift) => {
    const ground = points.map(point => sampleRenderedSurfaceElevation(point.x, point.north, values, mask, width, height, extent));
    if (ground.some(value => value === null)) { skippedTriangles++; return; }
    const first = positions.length / 3;
    for (let vertex = 0; vertex < 3; vertex++) {
      positions.push(points[vertex].x - originX, (ground[vertex] - baseElevation) * CONFIG.verticalScale + lift, points[vertex].north - originNorth);
      colors.push(color.r, color.g, color.b);
    }
    indices.push(first, first + 1, first + 2);
  };
  for (const feature of source.features) {
    const symbol = categoryValues ? (kind === "risk" ? riskSymbol(categoryValues.values[feature.id - 1]) : threatSymbol(categoryValues.values[feature.id - 1])) : null;
    const color = symbol ? new THREE.Color(symbol.hex) : (kind === "buffer" ? new THREE.Color(0xf5b335) : new THREE.Color(0x78879a));
    if (symbol) counts[symbol.key] = (counts[symbol.key] || 0) + 1;
    for (const part of buildingPolygonParts(feature)) {
      const partPoints = part.shell.concat(...part.holes);
      const triangles = THREE.ShapeUtils.triangulateShape(part.shell.map(p => new THREE.Vector2(p.x,p.north)), part.holes.map(r => r.map(p => new THREE.Vector2(p.x,p.north))));
      const lift = kind === "risk" ? 0.12 : (kind === "buffer" ? 0.1 : 0.14);
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
            outlines.push(p0.x-originX,(e0-baseElevation)*CONFIG.verticalScale+lift+0.04,p0.north-originNorth,p1.x-originX,(e1-baseElevation)*CONFIG.verticalScale+lift+0.04,p1.north-originNorth);
            for(let vertex=0;vertex<2;vertex++)outlineColors.push(color.r,color.g,color.b);
          }
        }
      }
    }
  }
  const layer = new THREE.Group(); layer.name = kind + "_polygon_layer";
  if (positions.length) {
    const geometry = new THREE.BufferGeometry(); geometry.setAttribute("position",new THREE.Float32BufferAttribute(positions,3)); geometry.setAttribute("color",new THREE.Float32BufferAttribute(colors,3)); geometry.setIndex(indices); geometry.computeBoundingSphere();
    const mesh = new THREE.Mesh(geometry,new THREE.MeshBasicMaterial({vertexColors:true,side:THREE.DoubleSide,transparent:true,opacity:kind === "risk" ? 0.42 : (kind === "buffer" ? 0.12 : 0.2),depthWrite:false,depthTest:true,toneMapped:false,polygonOffset:true,polygonOffsetFactor:-1,polygonOffsetUnits:-1}));
    mesh.name = kind + "_fills"; layer.add(mesh);
  }
  if (outlines.length) { const geometry=new THREE.BufferGeometry(); geometry.setAttribute("position",new THREE.Float32BufferAttribute(outlines,3)); geometry.setAttribute("color",new THREE.Float32BufferAttribute(outlineColors,3)); geometry.computeBoundingSphere(); layer.add(new THREE.LineSegments(geometry,new THREE.LineBasicMaterial({vertexColors:true,transparent:true,opacity:1,depthTest:true,toneMapped:false}))); }
  layer.userData={featureCount:source.features.length,sourceRecordCount:source.recordCount,categoryCounts:counts,vertexCount:positions.length/3,triangleCount:indices.length/3,skippedTriangles,drawCalls:(positions.length?1:0)+(outlines.length?1:0),source:kind === "risk" ? CONFIG.riskUrl : kind === "threat" ? CONFIG.threatUrl : (kind === "buffer" ? CONFIG.bufferUrl : CONFIG.parcelsUrl),crs:"EPSG:9377",dbfField:categoryValues && categoryValues.fieldName};
  scene.add(layer); return layer;
}

function addParcelBoundaries(scene, source, values, mask, width, height, extent, originX, originNorth, baseElevation) {
  const positions=[]; let count=0;
  for(const feature of source.features) for(const part of buildingPolygonParts(feature)) for(const ring of [part.shell,...part.holes]) {
    for(let i=0;i<ring.length;i++){const a=ring[i],b=ring[(i+1)%ring.length],ea=sampleRenderedSurfaceElevation(a.x,a.north,values,mask,width,height,extent),eb=sampleRenderedSurfaceElevation(b.x,b.north,values,mask,width,height,extent);if(ea===null||eb===null)continue;positions.push(a.x-originX,(ea-baseElevation)*CONFIG.verticalScale+0.42,a.north-originNorth,b.x-originX,(eb-baseElevation)*CONFIG.verticalScale+0.42,b.north-originNorth);} count++;
  }
  const geometry=new THREE.BufferGeometry();geometry.setAttribute("position",new THREE.Float32BufferAttribute(positions,3));
  const layer=new THREE.Group();layer.name="parcel_boundaries_layer";layer.add(new THREE.LineSegments(geometry,new THREE.LineBasicMaterial({color:0x47c4d1,transparent:true,opacity:0.8,depthTest:true,toneMapped:false})));
  layer.userData={featureCount:source.features.length,sourceRecordCount:source.recordCount,ringCount:count,source:CONFIG.parcelsUrl,crs:"EPSG:9377",attributesLoaded:false};scene.add(layer);return layer;
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
        return [point.x, (elevations[index] - baseElevation) * CONFIG.verticalScale + 0.25 + estimatedHeight * CONFIG.verticalScale, point.north];
      });
      pushTriangle(roof[0], roof[1], roof[2]);
    }
    for (let ringIndex = 0; ringIndex < rings.length; ringIndex++) {
      const ring = rings[ringIndex];
      const ringOffset = rings.slice(0, ringIndex).reduce((sum, current) => sum + current.length, 0);
      for (let i = 0; i < ring.length; i++) {
        const next = (i + 1) % ring.length;
        const a = ring[i], b = ring[next];
        const baseA = (elevations[ringOffset + i] - baseElevation) * CONFIG.verticalScale + 0.25;
        const baseB = (elevations[ringOffset + next] - baseElevation) * CONFIG.verticalScale + 0.25;
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
        (ground - baseElevation) * CONFIG.verticalScale + 0.25);
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

function addEstimatedBuildingVolumes(scene, source, values, mask, width, height, extent, originX, originNorth, baseElevation) {
  const started = performance.now();
  const positions = [], featureIds = [], floorCounts = [], estimatedHeights = [], outlines = [], colors = [];
  const records = new Array(source.recordCount + 1);
  let volumeCount = 0, polygonCount = 0, holeCount = 0, triangleCount = 0;
  const riskCounts = {};
  const omitted = [];
  for (const feature of source.features) {
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
  }
  if (volumeCount !== 3268 || omitted.length) {
    throw new Error("Se generaron " + volumeCount + " de los 3.268 volúmenes esperados. Registros omitidos: " + omitted.slice(0, 20).join(", ") + (omitted.length > 20 ? "…" : ""));
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
  const outlineGeometry = new THREE.BufferGeometry();
  outlineGeometry.setAttribute("position", new THREE.Float32BufferAttribute(outlines, 3));
  const outline = new THREE.LineSegments(outlineGeometry, new THREE.LineBasicMaterial({ color: 0x402b25, depthTest: true, toneMapped: false }));
  outline.name = "estimated_building_volume_outlines";
  const layer = new THREE.Group();
  layer.name = "estimated_buildings_layer";
  layer.add(volume, outline);
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
    recordIds: source.features.filter(feature => feature.heightStatus === "estimated").map(feature => feature.id),
    source: CONFIG.buildingsUrl,
    crs: "EPSG:9377",
    baseSampler: "same rendered DEM triangle interpolation as footprints",
    baseOffsetMeters: 0.25
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

function applySceneFocusClip(scene, bounds, originX, originNorth) {
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

function enableLayerToggle(id, object) {
  const input = document.getElementById(id);
  if (!input) return;
  input.disabled = false;
  object.visible = input.checked;
  input.addEventListener("change", () => { object.visible = input.checked; });
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
  document.getElementById("nav-zoom-in")?.addEventListener("click", () => zoom(0.78));
  document.getElementById("nav-zoom-out")?.addEventListener("click", () => zoom(1.28));
  document.getElementById("nav-reset")?.addEventListener("click", reset);
  document.getElementById("touch-zoom-in")?.addEventListener("click", () => zoom(0.78));
  document.getElementById("touch-zoom-out")?.addEventListener("click", () => zoom(1.28));
  document.getElementById("touch-reset")?.addEventListener("click", reset);
  window.addEventListener("keydown", event => { if (event.key === "Home" && !event.altKey && !event.ctrlKey && !event.metaKey) reset(); });
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
  if (!Array.isArray(manifest.tiles) || manifest.tiles.length !== 12) throw new Error("El manifiesto debe contener los 12 tiles.");
  const imageExtent = manifest.sourceExtent;
  const expected = new Set();
  for (let row = 1; row <= 3; row++) {
    for (let column = 1; column <= 4; column++) expected.add("ortho_r" + String(row).padStart(2, "0") + "_c" + String(column).padStart(2, "0") + ".jpg");
  }
  for (const tile of manifest.tiles) {
    if (!expected.has(tile.filename)) throw new Error("Nombre inesperado en tiles.json: " + tile.filename);
    if (tile.width !== 1024 || tile.height !== 953) throw new Error("Dimensiones incorrectas en el manifiesto: " + tile.filename);
    if (tile.bboxSR !== 9377 || tile.imageSR !== 9377) throw new Error("CRS incorrecto en el manifiesto: " + tile.filename);
    if (![tile.bbox.xmin, tile.bbox.ymin, tile.bbox.xmax, tile.bbox.ymax].every(Number.isFinite)) throw new Error("bbox inválido: " + tile.filename);
  }
  for (let row = 1; row <= 3; row++) {
    const tiles = manifest.tiles.filter(tile => tile.row === row).sort((a, b) => a.column - b.column);
    if (tiles.length !== 4) throw new Error("La fila " + row + " no contiene cuatro tiles.");
    if (!closeEnough(tiles[0].bbox.xmin, imageExtent.xmin) || !closeEnough(tiles[3].bbox.xmax, imageExtent.xmax)) throw new Error("La fila " + row + " no cubre la extensión de las texturas oeste-este.");
    for (let i = 0; i < tiles.length - 1; i++) {
      if (!closeEnough(tiles[i].bbox.xmax, tiles[i + 1].bbox.xmin)) throw new Error("Hay un hueco o solapamiento entre columnas en la fila " + row + ".");
    }
  }
  for (let column = 1; column <= 4; column++) {
    const tiles = manifest.tiles.filter(tile => tile.column === column).sort((a, b) => a.row - b.row);
    if (tiles.length !== 3) throw new Error("La columna " + column + " no contiene tres tiles.");
    if (!closeEnough(tiles[0].bbox.ymax, imageExtent.ymax) || !closeEnough(tiles[2].bbox.ymin, imageExtent.ymin)) throw new Error("La columna " + column + " no cubre la extensión de las texturas norte-sur.");
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
  if (intersection.xmin >= intersection.xmax || intersection.ymin >= intersection.ymax) throw new Error("El DEM ZONA_ESTUDIO no se cruza con la extensión de las ortofotos.");
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

function reportNoData(result, width, height, pixelX, pixelY) {
  const total = width * height;
  const percent = result.missingCount / total * 100;
  const largestArea = result.largest.size * pixelX * pixelY;
  const rowRanges = [];
  for (let row = 0; row < height; row++) {
    let first = -1, last = -1, count = 0;
    for (let column = 0; column < width; column++) {
      if (result.mask[row * width + column]) {
        if (first < 0) first = column;
        last = column;
        count++;
      }
    }
    if (count > 0) rowRanges.push({ row, first, last, count });
  }
  const broadRows = rowRanges.filter(item => item.count >= Math.max(10, width * 0.1));
  const broadSummary = broadRows.length ? broadRows.length + " filas tienen al menos " + formatNumber(Math.max(10, width * 0.1), 0) + " celdas NoData; la mayor ocupa " + result.largest.size + " celdas (" + formatNumber(largestArea, 0) + " m²), filas " + (result.largest.minRow + 1) + "–" + (result.largest.maxRow + 1) + ", columnas " + (result.largest.minColumn + 1) + "–" + (result.largest.maxColumn + 1) + "." : "No se detectaron franjas NoData extensas por fila.";
  diagnosticsEl.innerHTML = "<strong>Diagnóstico DEM</strong><br>" + result.validCount.toLocaleString("es-CO") + " / " + total.toLocaleString("es-CO") + " celdas con elevación (" + formatNumber(result.minimum, 1) + "–" + formatNumber(result.maximum, 1) + " m).<br>" + result.missingCount.toLocaleString("es-CO") + " celdas NoData (" + formatNumber(percent, 1) + "%), en " + result.components + " zona(s) conectada(s). " + broadSummary + "<br>Las áreas NoData se dejan sin superficie.";
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
  const nodes = new Array(gridWidth * gridHeight);
  for (let j = 0; j < gridHeight; j++) {
    for (let i = 0; i < gridWidth; i++) {
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
  for (let j = 0; j < gridHeight - 1; j++) {
    for (let i = 0; i < gridWidth - 1; i++) {
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

async function loadTexture(loader, tile) {
  const url = new URL(tile.filename, new URL(CONFIG.textureFolderUrl, document.baseURI)).href;
  let texture;
  try {
    texture = await loader.loadAsync(url);
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
      antialias: true,
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
  controls.zoomSpeed = 1;
  controls.panSpeed = 0.9;
  controls.zoomToCursor = true;
  controls.screenSpacePanning = true;
  controls.minPolarAngle = 0.12;
  controls.maxPolarAngle = Math.PI / 2 - 0.015;
  controls.minDistance = 20;
  controls.maxDistance = 10000;
  const resize = () => {
    const w = container.clientWidth;
    const h = container.clientHeight;
    if (!w || !h) return;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, CONFIG.maxPixelRatio));
    renderer.setSize(w, h);
  };
  const observer = new ResizeObserver(resize);
  observer.observe(container);
  window.addEventListener("beforeunload", () => {
    observer.disconnect();
    cancelAnimationFrame(animationFrame);
    controls.dispose();
    renderer.dispose();
  }, { once: true });
  const animate = () => {
    animationFrame = requestAnimationFrame(animate);
    controls.update();
    camera.updateMatrixWorld();
    const north = northInView.set(0, 0, -1).transformDirection(camera.matrixWorldInverse);
    const northAngle = Math.atan2(north.x, north.y) * 180 / Math.PI;
    if (compassNeedle) compassNeedle.style.transform = "translate(-50%,-50%) rotate(" + northAngle + "deg)";
    if (compassCardinals) {
      compassCardinals.style.transform = "rotate(" + northAngle + "deg)";
      for (const label of compassCardinals.children) label.style.transform = "rotate(" + (-northAngle) + "deg)";
    }
    renderer.render(scene, camera);
  };
  animate();
  return { scene, camera, controls };
}

async function main() {
  if (!container || !statusEl || !diagnosticsEl) throw new Error("Faltan elementos requeridos en vista-3d.html.");
  const { scene, camera } = await initializeScene();
  const maxTextureSize = renderer.backend && renderer.backend.device && renderer.backend.device.limits
    ? renderer.backend.device.limits.maxTextureDimension2D
    : renderer.capabilities && Number.isFinite(renderer.capabilities.maxTextureSize) ? renderer.capabilities.maxTextureSize : Infinity;
  if (maxTextureSize < 1024) {
    throw new Error("La GPU admite texturas de hasta " + maxTextureSize + " px; se requieren al menos 1024 px.");
  }
  setStatus("Leyendo manifiesto y georreferencia del DEM…");
  const [manifest, world, tiff, buildingSource, buildingAttributes, parcelSource, riskSource, riskAttributes, threatSource, threatAttributes, bufferSource] = await Promise.all([
    loadJson(CONFIG.manifestUrl).catch(error => { throw new Error("Fallo al cargar el manifiesto de ortofotos: " + error.message); }),
    loadWorldFile(CONFIG.worldFileUrl).catch(error => { throw new Error("Fallo al cargar la georreferencia del DEM: " + error.message); }),
    loadDem(CONFIG.demUrl).catch(error => { throw new Error("Fallo al cargar el DEM " + CONFIG.demUrl + ": " + (error && error.message ? error.message : error)); }),
    loadBuildingFootprints(CONFIG.buildingsUrl, CONFIG.buildingsIndexUrl, CONFIG.buildingsProjectionUrl).catch(error => { throw new Error("Fallo al cargar geometrías de construcciones: " + (error && error.message ? error.message : error)); }),
    loadBuildingAttributes(CONFIG.buildingsAttributesUrl, CONFIG.buildingsEncodingUrl).catch(error => { throw new Error("Fallo al cargar atributos de construcciones: " + (error && error.message ? error.message : error)); }),
    loadBuildingFootprints(CONFIG.parcelsUrl, CONFIG.parcelsIndexUrl, CONFIG.parcelsProjectionUrl).catch(error => { throw new Error("Fallo al cargar geometrías de lotes: " + error.message); }),
    loadBuildingFootprints(CONFIG.riskUrl, CONFIG.riskIndexUrl, CONFIG.riskProjectionUrl).catch(error => { throw new Error("Fallo al cargar geometrías de riesgo: " + error.message); }),
    loadCategoryAttributes(CONFIG.riskAttributesUrl, CONFIG.riskEncodingUrl, "riesgo").catch(error => { throw new Error("Fallo al cargar categorías de riesgo: " + error.message); }),
    loadBuildingFootprints(CONFIG.threatUrl, CONFIG.threatIndexUrl, CONFIG.threatProjectionUrl).catch(error => { throw new Error("Fallo al cargar geometrías de amenaza: " + error.message); }),
    loadCategoryAttributes(CONFIG.threatAttributesUrl, CONFIG.threatEncodingUrl, "grado_amen").catch(error => { throw new Error("Fallo al cargar categorías de amenaza: " + error.message); }),
    loadBuildingFootprints(CONFIG.bufferUrl, CONFIG.bufferIndexUrl, CONFIG.bufferProjectionUrl).catch(error => { throw new Error("Fallo al cargar el buffer del area de estudio: " + error.message); }),
  ]);
  if (buildingSource.recordCount !== 3308 || buildingSource.features.length !== 3308 || buildingAttributes.recordCount !== buildingSource.recordCount) {
    throw new Error("SHP/SHPX/DBF no tienen los mismos 3.308 registros activos: SHP " + buildingSource.recordCount + ", geometrías " + buildingSource.features.length + ", DBF " + buildingAttributes.recordCount + ".");
  }
  for (const feature of buildingSource.features) {
    const attributes = buildingAttributes.records[feature.id - 1];
    if (!attributes || attributes.recordId !== feature.id) throw new Error("No se pudo relacionar el registro geométrico " + feature.id + " con su fila DBF.");
    Object.assign(feature, attributes);
  }
  if (parcelSource.recordCount !== 1540 || parcelSource.features.length !== 1540) throw new Error("La capa de lotes no contiene los 1.540 polígonos esperados.");
  for (const [name, source, attributes, expected] of [["riesgo", riskSource, riskAttributes, 19], ["amenaza", threatSource, threatAttributes, 9]]) {
    if (source.recordCount !== expected || source.features.length !== expected || attributes.recordCount !== expected) throw new Error("SHP/SHX/DBF de " + name + " no coinciden con los " + expected + " registros esperados.");
  }
  if (buildingAttributes.estimatedCount !== 3268 || buildingAttributes.zeroCount !== 40) {
    throw new Error("La auditoría DBF encontró " + buildingAttributes.estimatedCount + " filas con pisos y " + buildingAttributes.zeroCount + " filas sin pisos; se esperaban 3.268 y 40.");
  }
  if (bufferSource.recordCount !== 1 || bufferSource.features.length !== 1) throw new Error("Bff_Uva debe contener un poligono de buffer.");
  const image = await tiff.getImage();
  const width = image.getWidth();
  const height = image.getHeight();
  if (width !== 205 || height !== 144) throw new Error("El DEM ZONA_ESTUDIO tiene dimensiones inesperadas: " + width + " × " + height + ".");
  const extent = getDemExtent(width, height, world);
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
  reportNoData(analysis, width, height, extent.pixelX, extent.pixelY);
  setStatus("DEM leído: " + width + " × " + height + " celdas. Analizando NoData antes de crear la superficie…", analysis.missingCount ? "warning" : "info");
  const worldCrs = Math.abs(extent.pixelX - 10) < 1e-6 && Math.abs(extent.pixelY - 10) < 1e-6;
  if (!worldCrs) throw new Error("La resolución del DEM no es 10 × 10 m según el TFW.");
  const originX = (extent.xmin + extent.xmax) / 2;
  const originNorth = (extent.ymin + extent.ymax) / 2;
  const baseElevation = analysis.minimum;
  const textureLoader = new THREE.TextureLoader();
  const tiles = manifest.tiles.filter(tile =>
    tile.bbox.xmax > focusBounds.xmin && tile.bbox.xmin < focusBounds.xmax &&
    tile.bbox.ymax > focusBounds.ymin && tile.bbox.ymin < focusBounds.ymax
  ).sort((a, b) => a.row - b.row || a.column - b.column);
  if (!tiles.length) throw new Error("Ninguna tesela de ortofoto intersecta el entorno del área de estudio.");
  const textures = new Map();
  let loadedTextures = 0;
  await Promise.all(tiles.map(async tile => {
    const texture = await loadTexture(textureLoader, tile);
    textures.set(tile.filename, texture);
    loadedTextures++;
    setStatus("Cargando ortofoto optimizada: " + loadedTextures + " de " + tiles.length + " teselas…");
  }));
  setStatus("Texturas cargadas. Construyendo malla y recortando los parches en sus límites geográficos…");
  const gridWidth = width + 2;
  const gridHeight = height + 2;
  let validSurfaceQuads = 0;
  for (let j = 0; j < gridHeight - 1; j++) {
    for (let i = 0; i < gridWidth - 1; i++) {
      const cells = [
        [Math.max(0, Math.min(height - 1, j - 1)), Math.max(0, Math.min(width - 1, i - 1))],
        [Math.max(0, Math.min(height - 1, j - 1)), Math.max(0, Math.min(width - 1, i))],
        [Math.max(0, Math.min(height - 1, j)), Math.max(0, Math.min(width - 1, i - 1))],
        [Math.max(0, Math.min(height - 1, j)), Math.max(0, Math.min(width - 1, i))]
      ];
      if (cells.every(([row, column]) => !analysis.mask[row * width + column])) validSurfaceQuads++;
    }
  }
  let renderedTriangles = 0;
  const materials = [];
  const terrainLayer = new THREE.Group();
  terrainLayer.name = "terrain_and_orthophoto_layer";
  for (const tile of tiles) {
    const result = buildTileGeometry(tile, elevations, analysis.mask, width, height, extent, originX, originNorth, baseElevation, focusBounds);
    renderedTriangles += result.triangles;
    const material = new THREE.MeshStandardMaterial({ map: textures.get(tile.filename), roughness: 1, metalness: 0, side: THREE.DoubleSide });
    const mesh = new THREE.Mesh(result.geometry, material);
    mesh.name = "terrain_" + tile.filename.replace(".jpg", "");
    mesh.userData = { filename: tile.filename, bbox: tile.bbox, row: tile.row, column: tile.column };
    terrainLayer.add(mesh);
    materials.push(material);
  }
  const terrainSkirt = createTerrainSkirt(elevations, analysis.mask, width, height, extent, originX, originNorth, baseElevation, CONFIG.terrainSkirtDepthMeters, focusBounds);
  terrainLayer.add(terrainSkirt);
  scene.add(terrainLayer);
  const bufferLayer = addPolygonOverlay(scene, bufferSource, null, "buffer", elevations, analysis.mask, width, height, extent, originX, originNorth, baseElevation);
  const extrusionSample = validateExtrusionSample(buildingSource, elevations, analysis.mask, width, height, extent, originX, originNorth, baseElevation);
  const buildingLayer = addBuildingFootprints(scene, buildingSource, elevations, analysis.mask, width, height, extent, originX, originNorth, baseElevation);
  const estimatedBuildingLayer = addEstimatedBuildingVolumes(scene, buildingSource, elevations, analysis.mask, width, height, extent, originX, originNorth, baseElevation);
  const parcelLayer = addParcelBoundaries(scene, parcelSource, elevations, analysis.mask, width, height, extent, originX, originNorth, baseElevation);
  const riskLayer = addPolygonOverlay(scene, riskSource, riskAttributes, "risk", elevations, analysis.mask, width, height, extent, originX, originNorth, baseElevation);
  const threatLayer = addPolygonOverlay(scene, threatSource, threatAttributes, "threat", elevations, analysis.mask, width, height, extent, originX, originNorth, baseElevation);
  const focusClipPlanes = applySceneFocusClip(scene, focusBounds, originX, originNorth);
  enableLayerToggle("layer-terrain", terrainLayer);
  enableLayerToggle("layer-buffer", bufferLayer);
  enableLayerToggle("layer-buildings", buildingLayer);
  enableLayerToggle("layer-building-volumes", estimatedBuildingLayer);
  enableLayerToggle("layer-parcels", parcelLayer);
  enableLayerToggle("layer-risk", riskLayer);
  enableLayerToggle("layer-threat", threatLayer);
  if (!renderedTriangles) throw new Error("No se generaron triángulos válidos; revise la máscara NoData del DEM.");
  const focusCenterX = (focusBounds.xmin + focusBounds.xmax) / 2;
  const focusCenterNorth = (focusBounds.ymin + focusBounds.ymax) / 2;
  const focusGround = sampleRenderedSurfaceElevation(focusCenterX, focusCenterNorth, elevations, analysis.mask, width, height, extent);
  const center = new THREE.Vector3(focusCenterX - originX, ((focusGround === null ? analysis.maximum : focusGround) - baseElevation) * CONFIG.verticalScale * 0.35, originNorth - focusCenterNorth);
  controls.target.copy(center);
  const span = Math.max(focusBounds.xmax - focusBounds.xmin, focusBounds.ymax - focusBounds.ymin);
  camera.position.set(center.x, center.y + span * 1.2, center.z + span * 1.2);
  camera.lookAt(center);
  camera.updateProjectionMatrix();
  controls.update();
  setupNavigationButtons(camera, controls);
  const dropped = (width + 1) * (height + 1) - validSurfaceQuads;
  const byteEstimate = tiles.reduce((total, tile) => total + tile.width * tile.height * 4, 0);
  const gpuEstimate = byteEstimate * 4 / 3;
  const coveragePercent = textureCoverage.coverageRatio * 100;
  const uncoveredNorth = Math.max(0, extent.ymax - textureCoverage.imageExtent.ymax);
  setStatus("Terreno listo: " + buildingLayer.userData.featureCount.toLocaleString("es-CO") + " huellas, " + estimatedBuildingLayer.userData.featureCount.toLocaleString("es-CO") + " volúmenes estimados y " + estimatedBuildingLayer.userData.flatFootprintCount + " huellas sin volumen.", uncoveredNorth > CONFIG.extentToleranceMeters ? "warning" : "info");
  diagnosticsEl.innerHTML += "<br><strong>Escenario enfocado</strong><br>Buffer de estudio con " + CONFIG.focusMarginMeters + " m de entorno visible. Extensión: " + formatNumber(focusBounds.xmax - focusBounds.xmin, 0) + " × " + formatNumber(focusBounds.ymax - focusBounds.ymin, 0) + " m. El recorte solo afecta la visualización; los archivos y validaciones usan sus extensiones completas.<br><strong>Superficie</strong><br>" + renderedTriangles.toLocaleString("es-CO") + " triángulos en los parches visibles; " + dropped.toLocaleString("es-CO") + " cuadrículas omitidas por NoData. Zócalo perimetral uniforme de " + terrainSkirt.userData.depthMeters + " m bajo la elevación mínima; " + terrainSkirt.userData.wallSegments.toLocaleString("es-CO") + " segmentos. Ortofoto cubre " + formatNumber(coveragePercent, 2) + "% del bbox DEM. Buffer geodésico de 270 m proyectado sobre la superficie del DEM. Origen local: E " + formatNumber(originX, 2) + " / N " + formatNumber(originNorth, 2) + " m. Factor vertical " + CONFIG.verticalScale.toFixed(1) + ".<br><strong>Construcciones</strong><br>" + buildingLayer.userData.featureCount.toLocaleString("es-CO") + " de " + buildingLayer.userData.sourceFeatureCount.toLocaleString("es-CO") + " registros, " + buildingLayer.userData.polygonCount.toLocaleString("es-CO") + " partes poligonales y " + buildingLayer.userData.holeCount.toLocaleString("es-CO") + " huecos. " + buildingLayer.userData.failedPolygons.toLocaleString("es-CO") + " polígonos omitidos por geometría o elevación incompleta. Huellas en gris rojizo con borde oscuro; cotas tomadas del DEM y desplazamiento visual de 0,25–0,55 m.<br><strong>Memoria estimada de texturas</strong><br>" + formatNumber(byteEstimate / (1024 ** 2), 0) + " MiB decodificadas; hasta " + formatNumber(gpuEstimate / (1024 ** 2), 0) + " MiB de GPU con mipmaps. El valor real depende del navegador y la GPU.";
  const estimateNote = document.querySelector(".estimate-note"); if (estimateNote) estimateNote.textContent = "Buffer de 270 m alrededor del area de influencia de la UVA La Armonia. Alturas estimadas: 2,10 m por piso; no son mediciones verificadas.";
  diagnosticsEl.innerHTML += "<br><strong>Volúmenes estimados</strong><br>" + estimatedBuildingLayer.userData.featureCount.toLocaleString("es-CO") + " volúmenes, " + estimatedBuildingLayer.userData.triangleCount.toLocaleString("es-CO") + " triángulos y " + estimatedBuildingLayer.userData.vertexCount.toLocaleString("es-CO") + " vértices en " + estimatedBuildingLayer.userData.drawCalls + " llamadas de dibujo. Geometría: " + formatNumber(estimatedBuildingLayer.userData.geometryBytes / (1024 ** 2), 1) + " MiB; preparación: " + formatNumber(estimatedBuildingLayer.userData.buildMilliseconds, 0) + " ms. Prueba previa: " + extrusionSample.count + " construcciones con multipartes, huecos y pendiente. Alturas derivadas de numero_pis × 2,10; no son mediciones verificadas.";
  window.__terrain3d = { scene, camera, controls, renderer, textureCount: textures.size, validElevationCount: analysis.validCount, nodataCount: analysis.missingCount, nodataComponents: analysis.components, renderedTriangles, patchCount: tiles.length, focusBounds, focusClipPlanes, terrainSkirt, buildingLayer, estimatedBuildingLayer, parcelLayer, riskLayer, threatLayer, buildingRecordCount: buildingSource.recordCount, buildingAttributeCount: buildingAttributes.recordCount, parcelRecordCount: parcelSource.recordCount, riskRecordCount: riskSource.recordCount, threatRecordCount: threatSource.recordCount, extrusionSample, verticalScale: CONFIG.verticalScale };
}

main().catch(error => {
  console.error("Fallo al preparar el terreno Three.js:", error);
  setStatus("No se pudo cargar el terreno 3D. " + (error && error.message ? error.message : "Revisa la consola."), "error");
  if (diagnosticsEl.textContent.startsWith("El análisis")) diagnosticsEl.textContent = "El diagnóstico no terminó. Comprueba que el módulo se abra desde Live Server y que los recursos estén disponibles.";
});


