#!/usr/bin/env node
import { copyFile, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { SUINING_MAIN_CITY_BOUNDS, clipLineToBounds, clipRoadCollection } from "../src/services/geoBounds.js";

const OVERPASS_URL = process.env.OVERPASS_URL || "https://overpass-api.de/api/interpreter";
const MARGIN_METRES = 5000;
const ROUNDING_STEP = 0.005;
const MAJOR_ROADS = "motorway|trunk|primary|secondary|motorway_link|trunk_link|primary_link|secondary_link";
const LOCAL_ROADS = "tertiary|tertiary_link|unclassified|residential|living_street";
const REGIONS = {
  suining: { name: "睢宁县", relationId: 3218568 },
  xuhui: { name: "上海市徐汇区", relationQuery: 'relation["boundary"="administrative"]["admin_level"="6"]["name"="徐汇区"]' },
};

async function overpass(query) {
  const response = await fetch(OVERPASS_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", "user-agent": "sn-map-data-builder/4.0" },
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

function roadsGeoJson(payload, bounds, retrievedAt, slug) {
  const features = (payload.elements ?? []).flatMap((way) => {
    const parts = clipLineToBounds((way.geometry ?? []).map(({ lon, lat }) => [lon, lat]), bounds);
    if (!parts.length) return [];
    const properties = { osm_id: way.id };
    for (const key of ["name", "highway", "ref"]) if (key in (way.tags ?? {})) properties[key] = way.tags[key];
    return [{ type: "Feature", id: `way/${way.id}`, properties, geometry: parts.length === 1 ? { type: "LineString", coordinates: parts[0] } : { type: "MultiLineString", coordinates: parts } }];
  });
  return { type: "FeatureCollection", name: `${slug}-base-roads-rectangle`, source: "OpenStreetMap contributors via Overpass API", generated_at: retrievedAt, bbox: [bounds.west, bounds.south, bounds.east, bounds.north], features };
}

async function atomicWrite(directory, outputs) {
  await mkdir(directory, { recursive: true });
  const nonce = `${process.pid}-${Date.now()}`; const backups = []; const published = [];
  try {
    for (const [name, contents] of outputs) await writeFile(path.join(directory, `.${name}.${nonce}.tmp`), contents, "utf8");
    for (const [name] of outputs) { const target = path.join(directory, name); const backup = `${target}.${nonce}.backup`; try { await rename(target, backup); backups.push([target, backup]); } catch (error) { if (error.code !== "ENOENT") throw error; } }
    for (const [name] of outputs) { const target = path.join(directory, name); await rename(path.join(directory, `.${name}.${nonce}.tmp`), target); published.push(target); }
  } catch (error) {
    await Promise.all(published.map((target) => rm(target, { force: true })));
    for (const [target, backup] of backups) await rename(backup, target);
    throw error;
  } finally {
    await Promise.all(outputs.flatMap(([name]) => [rm(path.join(directory, `.${name}.${nonce}.tmp`), { force: true }), rm(path.join(directory, `${name}.${nonce}.backup`), { force: true })]));
  }
}

async function buildRegion(slug, root) {
  const region = REGIONS[slug];
  if (!region) throw new Error(`Unknown region: ${slug}`);
  const relationQuery = region.relationId ? `relation(${region.relationId})` : region.relationQuery;
  const relationPayload = await overpass(`[out:json][timeout:90];${relationQuery};out bb tags;`);
  const matches = (relationPayload.elements ?? []).filter((item) => item.type === "relation" && item.bounds);
  if (matches.length !== 1) throw new Error(`${slug}: expected one OSM administrative relation, received ${matches.length}`);
  const relation = matches[0]; const rectangle = paddedBounds(relation.bounds);
  const retrievedAt = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
  const bbox = [rectangle.south, rectangle.west, rectangle.north, rectangle.east].join(",");
  const roads = roadsGeoJson(await overpass(`[out:json][timeout:240];(way(${bbox})["highway"~"^(${MAJOR_ROADS})$"];way(${bbox})["highway"~"^(${LOCAL_ROADS})$"]["name"];);out geom;`), rectangle, retrievedAt, slug);
  const directory = path.join(root, slug);
  let existing = {};
  try { existing = JSON.parse(await readFile(path.join(directory, "map-config.json"), "utf8")); } catch { /* first build */ }
  const mainCityBounds = slug === "suining" ? SUINING_MAIN_CITY_BOUNDS : null;
  const viewBounds = mainCityBounds ?? rectangle;
  const viewRoads = mainCityBounds ? clipRoadCollection(roads, viewBounds, `${slug}-base-roads-main-city`) : roads;
  const center = { lat: (viewBounds.south + viewBounds.north) / 2, lon: (viewBounds.west + viewBounds.east) / 2 };
  // ai coding：仅睢宁构建并固定主城区视图及裁剪道路；行政区原始道路继续保留，避免下次 Overpass 构建覆盖视图范围。
  const config = { ...existing, id: slug, slug, name: region.name, bounds: viewBounds, ...(mainCityBounds ? { main_city_bounds: viewBounds, administrative_bounds: rectangle } : {}), center, base_roads_path: `/data/regions/${slug}/${mainCityBounds ? "base-roads-main-city.geojson" : "base-roads.geojson"}`, seed_places_path: `/data/regions/${slug}/places.geojson`, is_active: true, source: mainCityBounds ? `睢宁主城区视图范围；道路裁剪自 OpenStreetMap ${region.name}行政边界数据` : `OpenStreetMap ${region.name}行政边界关系的 bbox`, source_url: `https://www.openstreetmap.org/relation/${relation.id}`, osm_relation_id: relation.id, source_bbox: relation.bounds, margin_approx_metres: MARGIN_METRES, retrieved_at: retrievedAt };
  const outputs = [["map-config.json", `${JSON.stringify(config, null, 2)}\n`], ["base-roads.geojson", `${JSON.stringify(roads)}\n`]];
  if (mainCityBounds) outputs.push(["base-roads-main-city.geojson", `${JSON.stringify(viewRoads)}\n`]);
  await atomicWrite(directory, outputs);
  console.log(`${region.name}: relation ${relation.id}, ${roads.features.length} roads`);
}

const root = path.resolve("public/data/regions");
const regionArg = process.argv.indexOf("--region");
const positionalRegion = process.argv.slice(2).find((value) => Object.hasOwn(REGIONS, value));
const selected = regionArg >= 0 ? process.argv[regionArg + 1] : (positionalRegion || "all");
// ai coding：兼容文件只作为睢宁首次整理来源；运行时始终读取 regions 下的单一地区路径。
await mkdir(path.join(root, "suining"), { recursive: true });
for (const name of ["base-roads.geojson", "places.geojson"]) {
  try { await copyFile(path.resolve("public/data", name), path.join(root, "suining", name)); } catch (error) { if (error.code !== "ENOENT") throw error; }
}
if (process.argv.includes("--prepare-only")) process.exit(0);
for (const slug of selected === "all" ? Object.keys(REGIONS) : [selected]) await buildRegion(slug, root);
