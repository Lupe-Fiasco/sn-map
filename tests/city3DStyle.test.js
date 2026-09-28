import test from "node:test";
import assert from "node:assert/strict";
import { CITY_3D_STYLE, CITY_BUILDING_HEIGHT_SCALE, classifyLinearPlace, classifyPlaceBuilding, getCity3DCameraConfig } from "../src/services/city3DStyle.js";

test("相机允许靠近模型并保留与场景尺度相关的最远距离", () => {
  const camera = getCity3DCameraConfig(160);
  assert.equal(camera.minDistance, 4);
  assert.equal(camera.maxDistance, 384);
  assert.ok(camera.minDistance < 18);
  assert.ok(camera.maxDistance > camera.minDistance * 20);
});

test("用户线优先采用类型字段并以金橙色道路区分蓝色水系和灰色基础道路", () => {
  const lakesideRoad = classifyLinearPlace({ properties: { type: "road", name: "湖滨路" } });
  const namedRiver = classifyLinearPlace({ properties: { type: "river", name: "人民路" } });
  assert.equal(lakesideRoad, "road");
  assert.equal(CITY_3D_STYLE.userLines[lakesideRoad].color, "#d88a1d");
  assert.equal(namedRiver, "water");
  assert.equal(CITY_3D_STYLE.userLines[namedRiver].color, "#3189bd");
  assert.equal(classifyLinearPlace({ properties: { type: "river" } }), "water");
  assert.equal(classifyLinearPlace({ properties: { label: "徐沙河水系" } }), "water");
  assert.equal(classifyLinearPlace({ properties: { type: { id: "river", name: "河流" } } }), "water");
  assert.equal(classifyLinearPlace({ properties: { type_id: "road", name: "人民路" } }), "road");
  assert.equal(classifyLinearPlace({ category: "highway" }), "road");
  assert.equal(CITY_3D_STYLE.userLines.water.color, "#3189bd");
  assert.equal(CITY_3D_STYLE.userLines.road.color, "#d88a1d");
  assert.ok(CITY_3D_STYLE.userLines.water.visibleWidth >= 0.24);
  assert.ok(Object.values(CITY_3D_STYLE.baseRoads).every(({ color, width }) => color.startsWith("#") && width >= 0.28));
  assert.ok(Object.values(CITY_3D_STYLE.baseRoads).every(({ color }) => color !== CITY_3D_STYLE.userLines.road.color));
  assert.ok(Object.values(CITY_3D_STYLE.baseRoads).every(({ elevation, thickness }) => elevation > thickness && thickness > 0));
  assert.ok(Object.values(CITY_3D_STYLE.userLines).every(({ elevation, thickness }) => elevation > thickness && thickness > 0));
  assert.ok(Object.values(CITY_3D_STYLE.userLines).every(({ visibleWidth, highlightWidth, hitWidth, highlightColor }) => visibleWidth < highlightWidth && highlightWidth < hitWidth && highlightColor.startsWith("#")));
  assert.ok(CITY_3D_STYLE.polygon.highlightWidth > 0);
  assert.ok(CITY_3D_STYLE.pointHighlight.lineWidth > 1);
});

test("地点分类提供不同建筑类型和高度档位", () => {
  const shop = classifyPlaceBuilding({ properties: { type: "shop" } });
  const company = classifyPlaceBuilding({ properties: { name: "科技公司总部" } });
  const school = classifyPlaceBuilding({ properties: { typeId: "school", label: "实验学校" } });
  const residential = classifyPlaceBuilding({ properties: { category: "residential" } });

  assert.equal(shop.category, "retail");
  assert.equal(shop.tier, "low");
  assert.equal(company.category, "civic");
  assert.equal(company.tier, "medium-high");
  assert.ok(company.height > shop.height * 3);
  assert.equal(school.category, "campus");
  assert.equal(residential.category, "residential");
  assert.notEqual(school.color, residential.color);
  assert.ok(school.groupCount >= 5 && residential.groupCount >= school.groupCount);
  assert.equal(CITY_BUILDING_HEIGHT_SCALE, 0.55);
  assert.equal(shop.height, 0.8 * CITY_BUILDING_HEIGHT_SCALE);
  assert.equal(company.height, 3.6 * CITY_BUILDING_HEIGHT_SCALE);
  assert.ok(company.height < 2);
});
