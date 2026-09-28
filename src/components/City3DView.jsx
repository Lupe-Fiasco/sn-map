import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Canvas } from "@react-three/fiber";
import { Html, MapControls } from "@react-three/drei";
import * as THREE from "three";
import { createLocalProjection, createProceduralBuildings, createRibbonGeometryData, projectRoadPaths, projectUserPlaces } from "../services/cityProjection.js";
import { CITY_3D_STYLE, classifyLinearPlace, classifyPlaceBuilding, getCity3DCameraConfig } from "../services/city3DStyle.js";
import { createPlaceHoverStrategy, createPointPlaceBuildings, createPolygonPlaceBuildings } from "../services/city3DPlaces.js";

function createRoadGeometry(paths, kind, width = CITY_3D_STYLE.baseRoads[kind].width, elevation = 0.055) {
  const { positions, hits } = createRibbonGeometryData(paths, kind, width, elevation);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return { geometry, hits };
}

function hoverHandlers(item, setHover, position) {
  return {
    onPointerOver(event) {
      event.stopPropagation();
      setHover({ ...item, position });
    },
    onPointerOut(event) {
      event.stopPropagation();
      setHover((current) => current?.key === item.key ? null : current);
    },
  };
}

function pathAnchor(points, height = 0.8) {
  const point = points[Math.floor(points.length / 2)] ?? [0, 0];
  return [point[0], height, point[1]];
}

function RoadMeshes({ paths, setHover }) {
  const hoveredKeys = useRef({});
  const geometries = useMemo(() => Object.fromEntries(
    Object.keys(CITY_3D_STYLE.baseRoads).map((kind) => [kind, createRoadGeometry(paths, kind)]),
  ), [paths]);
  useEffect(() => () => Object.values(geometries).forEach(({ geometry }) => geometry.dispose()), [geometries]);
  return Object.entries(geometries).map(([kind, { geometry, hits }]) => (
    <mesh
      key={kind}
      geometry={geometry}
      receiveShadow
      onPointerMove={(event) => {
        event.stopPropagation();
        const path = hits[event.faceIndex];
        if (path) {
          const next = { key: `road:${path.id}`, type: "只读基础道路", name: path.name, position: pathAnchor(path.points) };
          hoveredKeys.current[kind] = next.key;
          setHover((current) => current?.key === next.key ? current : next);
        }
      }}
      onPointerOut={(event) => {
        event.stopPropagation();
        const leavingKey = hoveredKeys.current[kind];
        setHover((current) => current?.key === leavingKey ? null : current);
      }}
    >
      <meshBasicMaterial color={CITY_3D_STYLE.baseRoads[kind].color} side={THREE.DoubleSide} polygonOffset polygonOffsetFactor={-1} polygonOffsetUnits={-1} />
    </mesh>
  ));
}

function ProceduralBuildings({ buildings, setHover }) {
  const meshRef = useRef(null);
  useLayoutEffect(() => {
    if (!meshRef.current) return;
    const matrix = new THREE.Matrix4();
    const color = new THREE.Color();
    buildings.forEach((building, index) => {
      matrix.compose(
        new THREE.Vector3(building.x, building.height / 2, building.z),
        new THREE.Quaternion(),
        new THREE.Vector3(building.width, building.height, building.depth),
      );
      meshRef.current.setMatrixAt(index, matrix);
      color.setHSL(0.1, 0.13, 0.55 + building.shade * 0.18);
      meshRef.current.setColorAt(index, color);
    });
    meshRef.current.instanceMatrix.needsUpdate = true;
    if (meshRef.current.instanceColor) meshRef.current.instanceColor.needsUpdate = true;
  }, [buildings]);

  if (!buildings.length) return null;
  return (
    <instancedMesh
      ref={meshRef}
      args={[null, null, buildings.length]}
      castShadow
      receiveShadow
      onPointerOver={(event) => {
        event.stopPropagation();
        const building = buildings[event.instanceId];
        if (building) setHover({ key: building.id, type: "程序化建筑", name: building.name, position: [building.x, building.height + 0.8, building.z] });
      }}
      onPointerMove={(event) => event.stopPropagation()}
      onPointerOut={(event) => {
        event.stopPropagation();
        setHover((current) => current?.key.startsWith("procedural-building-") ? null : current);
      }}
    >
      <boxGeometry args={[1, 1, 1]} />
      <meshStandardMaterial roughness={0.76} vertexColors />
    </instancedMesh>
  );
}

function createPlaceLineGeometry(points, width, elevation) {
  return createRoadGeometry([{ kind: "local", points }], "local", width, elevation).geometry;
}

function createPlacePolygonGeometry(points) {
  const outline = points.at(-1)?.[0] === points[0]?.[0] && points.at(-1)?.[1] === points[0]?.[1] ? points.slice(0, -1) : points;
  const shape = outline.map(([x, z]) => new THREE.Vector2(x, z));
  const triangles = THREE.ShapeUtils.triangulateShape(shape, []);
  const positions = triangles.flatMap((triangle) => triangle.flatMap((index) => [
    shape[index].x,
    CITY_3D_STYLE.polygon.elevation,
    shape[index].y,
  ]));
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}

function UserPlaces({ places, setHover }) {
  const geometries = useMemo(() => places.map((place) => {
    if (place.geometryType === "Polygon") return { visible: createPlacePolygonGeometry(place.points) };
    if (place.geometryType === "LineString") {
      const lineClass = classifyLinearPlace(place);
      const style = CITY_3D_STYLE.userLines[lineClass];
      return {
        lineClass,
        visible: createPlaceLineGeometry(place.points, style.visibleWidth, style.elevation),
        hit: createPlaceLineGeometry(place.points, style.hitWidth, style.elevation),
      };
    }
    return null;
  }), [places]);
  useEffect(() => () => geometries.forEach((geometry) => {
    geometry?.visible.dispose();
    geometry?.hit?.dispose();
  }), [geometries]);
  const placeBuildings = useMemo(() => places.map((place) => (
    place.geometryType === "Point" ? createPointPlaceBuildings(place)
      : place.geometryType === "Polygon" ? createPolygonPlaceBuildings(place) : []
  )), [places]);
  return places.map((place, index) => {
    const buildings = placeBuildings[index];
    const lineClass = geometries[index]?.lineClass;
    const profile = classifyPlaceBuilding(place);
    const hoverHeight = buildings.length ? Math.max(...buildings.map(({ height }) => height)) + 0.65 : 0.72;
    const position = buildings.length
      ? [buildings.reduce((sum, item) => sum + item.x, 0) / buildings.length, hoverHeight, buildings.reduce((sum, item) => sum + item.z, 0) / buildings.length]
      : pathAnchor(place.points, hoverHeight);
    const typeLabel = place.geometryType === "LineString"
      ? `用户地点 · ${lineClass === "water" ? "河流/水系" : "道路/线"}`
      : `用户地点 · ${profile.label}`;
    const interaction = createPlaceHoverStrategy(place);
    const handlers = hoverHandlers({ key: interaction.hoverKey, type: typeLabel, name: place.name }, setHover, position);
    if (place.geometryType === "Point") return (
      <PlaceBuildingGroup key={place.key} buildings={buildings} handlers={handlers} />
    );
    if (place.geometryType === "LineString") return (
      <group key={place.key}>
        <mesh geometry={geometries[index].hit} {...handlers}>
          <meshBasicMaterial transparent opacity={0} depthWrite={false} colorWrite={false} />
        </mesh>
        <mesh geometry={geometries[index].visible} renderOrder={3} raycast={() => null}>
          <meshStandardMaterial color={CITY_3D_STYLE.userLines[lineClass].color} roughness={lineClass === "water" ? 0.34 : 0.8} side={THREE.DoubleSide} />
        </mesh>
      </group>
    );
    return (
      <group key={place.key}>
        <mesh geometry={geometries[index].visible} renderOrder={2} raycast={() => null}>
          <meshStandardMaterial color={profile.color} transparent opacity={CITY_3D_STYLE.polygon.opacity} roughness={0.8} depthWrite={false} side={THREE.DoubleSide} />
        </mesh>
        <PlaceBuildingGroup buildings={buildings} disableRaycast={interaction.disableBuildingRaycast} />
        {/* ai coding：整片区域只保留一个透明命中面，tooltip 在同一 Polygon 的多栋楼之间移动时维持同一 hover key。 */}
        <mesh geometry={geometries[index].visible} {...handlers}>
          <meshBasicMaterial transparent opacity={0} depthWrite={false} colorWrite={false} side={THREE.DoubleSide} />
        </mesh>
      </group>
    );
  });
}

function PlaceBuildingGroup({ buildings, handlers = {}, disableRaycast = false }) {
  return (
    <group {...handlers}>
      {/* ai coding：用户地点由分类后的独立建筑数据驱动；主体与屋顶拆分，便于后续增加窗户和牌匾。 */}
      {buildings.map((building) => (
        <group key={building.id} position={[building.x, 0, building.z]}>
          <mesh position={[0, building.height / 2, 0]} castShadow receiveShadow raycast={disableRaycast ? () => null : undefined}>
            <boxGeometry args={[building.width, building.height, building.depth]} />
            <meshStandardMaterial color={building.color} roughness={0.72} />
          </mesh>
          <mesh position={[0, building.height + 0.035, 0]} castShadow raycast={disableRaycast ? () => null : undefined}>
            <boxGeometry args={[building.width * 1.04, 0.07, building.depth * 1.04]} />
            <meshStandardMaterial color={building.roof} roughness={0.78} />
          </mesh>
        </group>
      ))}
    </group>
  );
}

function CityScene({ projection, roadPaths, buildings, userPlaces }) {
  const extent = Math.max(projection.width, projection.height);
  const cameraConfig = getCity3DCameraConfig(extent);
  const [hover, setHover] = useState(null);
  return (
    <>
      <color attach="background" args={["#dce8e1"]} />
      <fog attach="fog" args={["#dce8e1", extent * 0.8, extent * 2.1]} />
      <hemisphereLight args={["#f5fbf7", "#829a8d", 1.5]} />
      <directionalLight position={[-35, 70, 30]} intensity={2.1} castShadow shadow-mapSize={[1024, 1024]} />
      <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[projection.width + 8, projection.height + 8]} />
        <meshStandardMaterial color="#a9bea9" roughness={1} />
      </mesh>
      <gridHelper args={[extent, 20, "#759486", "#9bb1a4"]} position={[0, 0.025, 0]} />
      <RoadMeshes paths={roadPaths} setHover={setHover} />
      <ProceduralBuildings buildings={buildings} setHover={setHover} />
      <UserPlaces places={userPlaces} setHover={setHover} />
      {/* ai coding：场景内 Html 不接收指针，避免 tooltip 自身触发模型 pointer out 导致闪烁。 */}
      {hover && (
        <Html position={hover.position} center zIndexRange={[20, 10]} style={{ pointerEvents: "none" }}>
          <div className="city3d-tooltip" role="tooltip">
            <span>{hover.type}</span>
            <strong>{hover.name}</strong>
          </div>
        </Html>
      )}
      <MapControls
        makeDefault
        enableDamping
        dampingFactor={0.08}
        maxPolarAngle={Math.PI / 2.08}
        minDistance={cameraConfig.minDistance}
        maxDistance={cameraConfig.maxDistance}
        target={[0, 0, 0]}
      />
    </>
  );
}

export default function City3DView({ mapId, mapName, bounds, baseRoadsPath, places, onRoadStatus }) {
  const [loadState, setLoadState] = useState({ loading: true, error: "", data: null });
  const [retry, setRetry] = useState(0);
  const projection = useMemo(() => createLocalProjection(bounds), [bounds]);

  useEffect(() => {
    const controller = new AbortController();
    setLoadState({ loading: true, error: "", data: null });
    fetch(baseRoadsPath, { signal: controller.signal })
      .then((response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.json();
      })
      .then((data) => {
        const roadPaths = projectRoadPaths(data, projection);
        setLoadState({ loading: false, error: "", data: roadPaths });
        onRoadStatus?.("ready", `已加载 ${data.features.length} 个只读要素`);
      })
      .catch((error) => {
        if (error.name === "AbortError") return;
        console.error("加载 3D 基础道路失败：", error);
        setLoadState({ loading: false, error: error.message, data: null });
        onRoadStatus?.("error", `加载失败（${error.message}）`);
      });
    return () => controller.abort();
  }, [baseRoadsPath, projection, retry, onRoadStatus]);

  const userPlaces = useMemo(() => projectUserPlaces(places, projection), [places, projection]);
  const buildings = useMemo(() => loadState.data
    ? createProceduralBuildings(projection, loadState.data, mapId, 180, userPlaces)
    : [], [projection, loadState.data, mapId, userPlaces]);

  if (loadState.loading) return <div className="city3d-message" role="status">正在构建 3D 城市视图…</div>;
  if (loadState.error) return (
    <div className="city3d-message error" role="alert">
      <strong>3D 城市数据加载失败</strong>
      <span>{loadState.error}</span>
      <button className="button" type="button" onClick={() => setRetry((value) => value + 1)}>重新加载</button>
    </div>
  );

  const extent = Math.max(projection.width, projection.height);
  return (
    <div id="city-3d" className="city3d-view" role="region" aria-label={`${mapName} 3D 城市浏览视图`}>
      <Canvas
        shadows
        dpr={[1, 1.5]}
        camera={{ position: [extent * 0.52, extent * 0.58, extent * 0.52], fov: 42, near: 0.1, far: extent * 5 }}
        gl={{ antialias: true, powerPreference: "high-performance" }}
      >
        <CityScene projection={projection} roadPaths={loadState.data} buildings={buildings} userPlaces={userPlaces} />
      </Canvas>
      <div className="city3d-guide" aria-hidden="true">左键拖拽平移 · 右键拖拽调整视角 · 滚轮缩放</div>
      <div className="city3d-legend">
        <strong>3D 城市示意</strong>
        <span><i className="legend-road" />只读基础道路</span>
        <span><i className="legend-water" />用户河流 / 水系</span>
        <span><i className="legend-building" />地点建筑 / 建筑群</span>
        <span><i className="legend-city-building" />背景建筑示意</span>
        {!loadState.data.length && <small>当前道路数据为空，仅显示地面与建筑示意。</small>}
      </div>
    </div>
  );
}
