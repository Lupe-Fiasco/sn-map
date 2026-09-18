#!/usr/bin/env node
import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const RELATION_ID = 3218568;
const OVERPASS_URL = "https://overpass-api.de/api/interpreter";
const MARGIN_METRES = 5000;
const ROUNDING_STEP = 0.005;
const MAJOR_ROADS = "motorway|trunk|primary|secondary|motorway_link|trunk_link|primary_link|secondary_link";
const LOCAL_ROADS = "tertiary|tertiary_link|unclassified|residential|living_street";

async function overpass(query) {
  const response = await fetch(OVERPASS_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", "user-agent": "sn-map-data-builder/3.0" },
    body: new URLSearchParams({ data: query }),
    signal: AbortSignal.timeout(300_000),
  });
  if (!response.ok) throw new Error(`Overpass HTTP ${response.status}`);
  return response.json();
}

function outward(value, direction) {
  const scaled = value / ROUNDING_STEP;
  return Number(((direction < 0 ? Math.floor(scaled) : Math.ceil(scaled)) * ROUNDING_STEP).toFixed(3));
}

function paddedBounds(source) {
  const middleLat = (source.minlat + source.maxlat) / 2;
  const latMargin = MARGIN_METRES / 111_320;
  const lonMargin = MARGIN_METRES / (111_320 * Math.cos(middleLat * Math.PI / 180));
  const south = outward(source.minlat - latMargin, -1); const west = outward(source.minlon - lonMargin, -1);
  const north = outward(source.maxlat + latMargin, 1); const east = outward(source.maxlon + lonMargin, 1);
  return { south, west, north, east, center: { lat: Number(((south + north) / 2).toFixed(6)), lon: Number(((west + east) / 2).toFixed(6)) } };
}

function clipSegment(a, b, bounds) {
  const [x1, y1] = a; const [x2, y2] = b; const dx = x2 - x1; const dy = y2 - y1;
  const p = [-dx, dx, -dy, dy]; const q = [x1 - bounds.west, bounds.east - x1, y1 - bounds.south, bounds.north - y1];
  let low = 0; let high = 1;
  for (let index = 0; index < p.length; index += 1) {
    if (p[index] === 0) { if (q[index] < 0) return null; continue; }
    const ratio = q[index] / p[index];
    if (p[index] < 0) low = Math.max(low, ratio); else high = Math.min(high, ratio);
    if (low > high) return null;
  }
  const round = (value) => Number(value.toFixed(7));
  return [[round(x1 + low * dx), round(y1 + low * dy)], [round(x1 + high * dx), round(y1 + high * dy)]];
}

function clipLine(points, bounds) {
  const parts = []; let current = [];
  for (let index = 0; index < points.length - 1; index += 1) {
    const clipped = clipSegment(points[index], points[index + 1], bounds);
    if (!clipped) { if (current.length >= 2) parts.push(current); current = []; continue; }
    const [start, end] = clipped;
    if (current.length && current.at(-1)[0] === start[0] && current.at(-1)[1] === start[1]) current.push(end);
    else { if (current.length >= 2) parts.push(current); current = [start, end]; }
  }
  if (current.length >= 2) parts.push(current);
  return parts;
}

function roadsGeoJson(payload, bounds, retrievedAt) {
  const features = (payload.elements ?? []).flatMap((way) => {
    const parts = clipLine((way.geometry ?? []).map(({ lon, lat }) => [lon, lat]), bounds);
    if (!parts.length) return [];
    const properties = { osm_id: way.id };
    for (const key of ["name", "highway", "ref"]) if (key in (way.tags ?? {})) properties[key] = way.tags[key];
    const geometry = parts.length === 1 ? { type: "LineString", coordinates: parts[0] } : { type: "MultiLineString", coordinates: parts };
    return [{ type: "Feature", id: `way/${way.id}`, properties, geometry }];
  });
  return { type: "FeatureCollection", name: "suining-base-roads-rectangle", source: "OpenStreetMap contributors via Overpass API", generated_at: retrievedAt, bbox: [bounds.west, bounds.south, bounds.east, bounds.north], filter: `major roads; named ${LOCAL_ROADS.replaceAll("|", "/")} roads; clipped to map rectangle`, features };
}

async function publish(dataDir, bounds, roads) {
  await mkdir(dataDir, { recursive: true });
  const nonce = `${process.pid}-${Date.now()}`;
  const outputs = [["map-bounds.json", `${JSON.stringify(bounds, null, 2)}\n`], ["base-roads.geojson", `${JSON.stringify(roads)}\n`]];
  const backedUp = [];
  const published = [];
  try {
    for (const [name, contents] of outputs) await writeFile(path.join(dataDir, `.${name}.${nonce}.tmp`), contents, "utf8");
    for (const [name] of outputs) {
      const target = path.join(dataDir, name); const backup = path.join(dataDir, `.${name}.${nonce}.backup`);
      try { await rename(target, backup); backedUp.push([target, backup]); } catch (error) { if (error.code !== "ENOENT") throw error; }
    }
    for (const [name] of outputs) {
      const target = path.join(dataDir, name);
      await rename(path.join(dataDir, `.${name}.${nonce}.tmp`), target); published.push(target);
    }
  } catch (error) {
    await Promise.all(published.map((target) => rm(target, { force: true })));
    for (const [target, backup] of backedUp) await rename(backup, target);
    throw error;
  } finally {
    await Promise.all(outputs.flatMap(([name]) => [rm(path.join(dataDir, `.${name}.${nonce}.tmp`), { force: true }), rm(path.join(dataDir, `.${name}.${nonce}.backup`), { force: true })]));
  }
}

const dataArg = process.argv.indexOf("--data-dir");
const dataDir = path.resolve(dataArg >= 0 ? process.argv[dataArg + 1] : "public/data");
const relationPayload = await overpass(`[out:json][timeout:90];relation(${RELATION_ID});out bb tags;`);
const relation = relationPayload.elements?.find((item) => item.id === RELATION_ID);
if (!relation?.bounds) throw new Error(`OSM relation ${RELATION_ID} did not return a bbox`);
const rectangle = paddedBounds(relation.bounds); const retrievedAt = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
const bounds = { crs: "WGS84 (EPSG:4326)", ...rectangle, description: "覆盖睢宁县行政边界并在四周保留约 5 公里余量的外接矩形；不是严格行政边界。", source: "OpenStreetMap 睢宁县行政边界关系的 bbox", sourceUrl: `https://www.openstreetmap.org/relation/${RELATION_ID}`, osmRelationId: RELATION_ID, sourceBbox: relation.bounds, marginApproxMetres: MARGIN_METRES, osmBaseTimestamp: relationPayload.osm3s?.timestamp_osm_base ?? null, retrievedAt };
const bbox = [bounds.south, bounds.west, bounds.north, bounds.east].join(",");
const query = `[out:json][timeout:240];(way(${bbox})["highway"~"^(${MAJOR_ROADS})$"];way(${bbox})["highway"~"^(${LOCAL_ROADS})$"]["name"];);out geom;`;
const roads = roadsGeoJson(await overpass(query), bounds, retrievedAt);
await publish(dataDir, bounds, roads);
console.log(`Map bounds: ${JSON.stringify(rectangle)}`); console.log(`Roads: ${roads.features.length}`);
