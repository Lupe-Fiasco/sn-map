import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Edges, MapControls } from "@react-three/drei";
import * as THREE from "three";
import { ui } from "../uiClassNames.js";
import { createLocalProjection, createProceduralBuildings, createRibbonGeometryData, projectRoadPaths, projectUserPlaces } from "../services/cityProjection.js";
import { CITY_3D_STYLE, classifyLinearPlace, classifyPlaceBuilding, getCity3DCameraConfig } from "../services/city3DStyle.js";
import { createPlaceHoverStrategy, createPointPlaceBuildings, createPolygonPlaceBuildings } from "../services/city3DPlaces.js";
import { applyCity3DPanBounds, clearTooltipForKey, getCity3DPanBounds, isUserPlaceHovered, retainInitialTooltipPosition } from "../services/city3DInteraction.js";
import { getVisualModeCapabilities, updateProceduralBuildingMaterial } from "../services/visualMode.js";
import { getCity3DSelectionView } from "../services/mapSelection.js";

function createRoadGeometry(paths, kind, width, elevation, thickness) {
  const style = CITY_3D_STYLE.baseRoads[kind];
  const { positions, hits } = createRibbonGeometryData(
    paths,
    kind,
    width ?? style.width,
    elevation ?? style.elevation,
    thickness ?? style.thickness,
  );
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return { geometry, hits };
}

function pointerPosition(event, containerRef) {
  const source = event.nativeEvent ?? event;
  const rect = containerRef.current?.getBoundingClientRect();
  return { x: source.clientX - (rect?.left ?? 0), y: source.clientY - (rect?.top ?? 0) };
}

function hoverHandlers(item, setHover, containerRef, onSelect) {
  return {
    onPointerOver(event) {
      event.stopPropagation();
      setHover((current) => retainInitialTooltipPosition(current, item, pointerPosition(event, containerRef)));
    },
    onPointerOut(event) {
      event.stopPropagation();
      setHover((current) => clearTooltipForKey(current, item.key));
    },
    onClick(event) {
      event.stopPropagation();
      onSelect?.(item.id, true);
    },
  };
}

function RoadMeshes({ paths, setHover, containerRef }) {
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
      onPointerOver={(event) => {
        event.stopPropagation();
        const path = hits[event.faceIndex];
        if (path) {
          const next = { key: `road:${path.id}`, type: "只读基础道路", name: path.name };
          hoveredKeys.current[kind] = next.key;
          setHover((current) => retainInitialTooltipPosition(current, next, pointerPosition(event, containerRef)));
        }
      }}
      onPointerMove={(event) => {
        event.stopPropagation();
        const path = hits[event.faceIndex];
        if (path) {
          const next = { key: `road:${path.id}`, type: "只读基础道路", name: path.name };
          hoveredKeys.current[kind] = next.key;
          setHover((current) => retainInitialTooltipPosition(current, next, pointerPosition(event, containerRef)));
        }
      }}
      onPointerOut={(event) => {
        event.stopPropagation();
        const leavingKey = hoveredKeys.current[kind];
        setHover((current) => clearTooltipForKey(current, leavingKey));
      }}
    >
      <meshBasicMaterial color={CITY_3D_STYLE.baseRoads[kind].color} side={THREE.DoubleSide} polygonOffset polygonOffsetFactor={-1} polygonOffsetUnits={-1} />
    </mesh>
  ));
}

function ProceduralBuildings({ buildings, setHover, containerRef, cyberEffects }) {
  const meshRef = useRef(null);
  const materialRef = useRef(null);
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
  useLayoutEffect(() => {
    updateProceduralBuildingMaterial(materialRef.current, cyberEffects ? "cyberpunk" : "normal");
    return () => updateProceduralBuildingMaterial(materialRef.current, "normal");
  }, [cyberEffects]);
  useFrame(({ clock }) => {
    if (!materialRef.current) return;
    // ai coding：每帧统一应用模式材质；普通模式持续为零自发光，再次进入赛博模式则恢复动态流光。
    updateProceduralBuildingMaterial(materialRef.current, cyberEffects ? "cyberpunk" : "normal", clock.elapsedTime);
  });

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
        if (building) {
          const item = { key: building.id, type: "程序化建筑", name: building.name };
          setHover((current) => retainInitialTooltipPosition(current, item, pointerPosition(event, containerRef)));
        }
      }}
      onPointerMove={(event) => event.stopPropagation()}
      onPointerOut={(event) => {
        event.stopPropagation();
        setHover((current) => current?.key.startsWith("procedural-building-") ? null : current);
      }}
    >
      <boxGeometry args={[1, 1, 1]} />
      <meshStandardMaterial ref={materialRef} roughness={cyberEffects ? 0.42 : 0.76} vertexColors />
    </instancedMesh>
  );
}

function createPlaceLineGeometry(points, width, elevation, thickness) {
  return createRoadGeometry([{ kind: "local", points }], "local", width, elevation, thickness).geometry;
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

function UserPlaces({ places, hover, setHover, containerRef, onSelect, cyberEffects }) {
  const geometries = useMemo(() => places.map((place) => {
    if (place.geometryType === "Polygon") return {
      visible: createPlacePolygonGeometry(place.points),
      highlight: createPlaceLineGeometry(
        place.points,
        CITY_3D_STYLE.polygon.highlightWidth,
        CITY_3D_STYLE.polygon.elevation + 0.025,
        CITY_3D_STYLE.polygon.highlightThickness,
      ),
    };
    if (place.geometryType === "LineString") {
      const lineClass = classifyLinearPlace(place);
      const style = CITY_3D_STYLE.userLines[lineClass];
      return {
        lineClass,
        visible: createPlaceLineGeometry(place.points, style.visibleWidth, style.elevation, style.thickness),
        highlight: createPlaceLineGeometry(place.points, style.highlightWidth, style.elevation - 0.004, style.thickness),
        hit: createPlaceLineGeometry(place.points, style.hitWidth, style.elevation, style.thickness),
      };
    }
    return null;
  }), [places]);
  useEffect(() => () => geometries.forEach((geometry) => {
    geometry?.visible.dispose();
    geometry?.highlight?.dispose();
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
    const typeLabel = place.geometryType === "LineString"
      ? `用户地点 · ${lineClass === "water" ? "河流/水系" : "道路/线"}`
      : `用户地点 · ${profile.label}`;
    const interaction = createPlaceHoverStrategy(place);
    const highlighted = isUserPlaceHovered(hover, interaction.hoverKey);
    // ai coding：3D 用户几何只传回稳定地点 id，复用 App 与 2D 地图共用的详情状态和 PlaceDetails。
    const handlers = hoverHandlers({ id: place.id, key: interaction.hoverKey, type: typeLabel, name: place.name }, setHover, containerRef, onSelect);
    if (place.geometryType === "Point") return (
      <PlaceBuildingGroup key={place.key} buildings={buildings} handlers={handlers} highlighted={highlighted} cyberEffects={cyberEffects} />
    );
    if (place.geometryType === "LineString") return (
      <group key={place.key}>
        <mesh geometry={geometries[index].hit} {...handlers}>
          <meshBasicMaterial transparent opacity={0} depthWrite={false} colorWrite={false} />
        </mesh>
        {highlighted && (
          <mesh geometry={geometries[index].highlight} renderOrder={3} raycast={() => null}>
            <meshBasicMaterial color={CITY_3D_STYLE.userLines[lineClass].highlightColor} side={THREE.DoubleSide} polygonOffset polygonOffsetFactor={-2} polygonOffsetUnits={-2} />
          </mesh>
        )}
        <mesh geometry={geometries[index].visible} renderOrder={3} raycast={() => null}>
          {/* ai coding：保留正常深度遮挡，仅用薄实体侧面和轻微 polygon offset 稳定低视角道路，不让道路穿透建筑。 */}
          <meshStandardMaterial color={CITY_3D_STYLE.userLines[lineClass].color} roughness={lineClass === "water" ? 0.34 : 0.8} side={THREE.DoubleSide} polygonOffset polygonOffsetFactor={-1} polygonOffsetUnits={-1} />
        </mesh>
      </group>
    );
    return (
      <group key={place.key}>
        <mesh geometry={geometries[index].visible} renderOrder={2} raycast={() => null}>
          <meshStandardMaterial color={profile.color} transparent opacity={CITY_3D_STYLE.polygon.opacity} roughness={0.8} depthWrite={false} side={THREE.DoubleSide} />
        </mesh>
        <PlaceBuildingGroup buildings={buildings} disableRaycast={interaction.disableBuildingRaycast} cyberEffects={cyberEffects} />
        {highlighted && (
          <mesh geometry={geometries[index].highlight} renderOrder={4} raycast={() => null}>
            <meshBasicMaterial color={CITY_3D_STYLE.polygon.highlightColor} side={THREE.DoubleSide} depthWrite={false} polygonOffset polygonOffsetFactor={-2} polygonOffsetUnits={-2} />
          </mesh>
        )}
        {/* ai coding：整片区域只保留一个透明命中面，tooltip 在同一 Polygon 的多栋楼之间移动时维持同一 hover key。 */}
        <mesh geometry={geometries[index].visible} {...handlers}>
          <meshBasicMaterial transparent opacity={0} depthWrite={false} colorWrite={false} side={THREE.DoubleSide} />
        </mesh>
      </group>
    );
  });
}

function PlaceBuildingGroup({ buildings, handlers = {}, disableRaycast = false, highlighted = false, cyberEffects = false }) {
  return (
    <group {...handlers}>
      {/* ai coding：用户地点由分类后的独立建筑数据驱动；主体与屋顶拆分，便于后续增加窗户和牌匾。 */}
      {buildings.map((building) => (
        <group key={building.id} position={[building.x, 0, building.z]}>
          <mesh position={[0, building.height / 2, 0]} castShadow receiveShadow raycast={disableRaycast ? () => null : undefined}>
            <boxGeometry args={[building.width, building.height, building.depth]} />
            <meshStandardMaterial color={building.color} roughness={0.72} />
            {cyberEffects && <Edges color="#00f5ff" lineWidth={1.6} raycast={() => null} />}
            {highlighted && <Edges color={CITY_3D_STYLE.pointHighlight.color} lineWidth={CITY_3D_STYLE.pointHighlight.lineWidth} raycast={() => null} />}
          </mesh>
          <mesh position={[0, building.height + 0.035, 0]} castShadow raycast={disableRaycast ? () => null : undefined}>
            <boxGeometry args={[building.width * 1.04, 0.07, building.depth * 1.04]} />
            <meshStandardMaterial color={building.roof} roughness={0.78} />
            {cyberEffects && <Edges color="#ff4fd8" lineWidth={1.4} raycast={() => null} />}
            {highlighted && <Edges color={CITY_3D_STYLE.pointHighlight.color} lineWidth={CITY_3D_STYLE.pointHighlight.lineWidth} raycast={() => null} />}
          </mesh>
        </group>
      ))}
    </group>
  );
}

function CyberGroundWaves({ extent }) {
  const rings = useRef([]);
  useFrame(({ clock }) => {
    rings.current.forEach((ring, index) => {
      if (!ring) return;
      const progress = (clock.elapsedTime * 0.16 + index / 3) % 1;
      ring.scale.setScalar(0.7 + progress * 4.5);
      ring.material.opacity = (1 - progress) * 0.48;
    });
  });
  return (
    <group position={[0, 0.045, 0]} raycast={() => null}>
      {[0, 1, 2].map((index) => <mesh key={index} ref={(node) => { rings.current[index] = node; }} rotation={[-Math.PI / 2, 0, 0]} raycast={() => null}>
        <ringGeometry args={[extent * 0.035, extent * 0.041, 64]} />
        <meshBasicMaterial color={index % 2 ? "#ff37cf" : "#00eaff"} transparent opacity={0.4} depthWrite={false} side={THREE.DoubleSide} />
      </mesh>)}
    </group>
  );
}

function BoundedMapControls({ projection, cameraConfig, selectedPlace }) {
  const controlsRef = useRef(null);
  const camera = useThree((state) => state.camera);
  const panBounds = useMemo(() => getCity3DPanBounds(projection), [projection]);
  // ai coding：保持 onChange 引用稳定，避免 drei 在 hover 重渲染时 dispose/reconnect controls，导致当前 pointerup 丢失并锁住后续手势。
  const enforceBounds = useCallback(() => {
    const controls = controlsRef.current;
    if (!controls) return;
    applyCity3DPanBounds(controls, panBounds);
  }, [panBounds]);
  useEffect(() => {
    const controls = controlsRef.current;
    const view = getCity3DSelectionView(selectedPlace, Math.max(projection.width, projection.height));
    if (!controls || !view) return;
    // ai coding：3D 列表选中使用稳定 target/distance，并继续经既有边界约束校正 target 与 camera。
    const direction = camera.position.clone().sub(controls.target);
    if (!direction.lengthSq()) direction.set(1, 1, 1);
    const distance = Math.min(cameraConfig.maxDistance, Math.max(cameraConfig.minDistance, view.distance));
    controls.target.set(...view.target);
    camera.position.copy(controls.target).add(direction.normalize().multiplyScalar(distance));
    applyCity3DPanBounds(controls, panBounds);
    controls.update();
  }, [camera, cameraConfig, panBounds, projection.height, projection.width, selectedPlace]);
  // 仅在越界时同步平移 target 与 camera；默认 target 已是原点，不传易在重渲染时重置的数组 prop。
  useFrame(enforceBounds);
  return <MapControls ref={controlsRef} makeDefault enableDamping dampingFactor={0.08} maxPolarAngle={Math.PI / 2.08} minDistance={cameraConfig.minDistance} maxDistance={cameraConfig.maxDistance} onChange={enforceBounds} />;
}

function CityScene({ projection, roadPaths, buildings, userPlaces, selectedId, hover, setHover, containerRef, onSelect, visualMode }) {
  const extent = Math.max(projection.width, projection.height);
  const cameraConfig = useMemo(() => getCity3DCameraConfig(extent), [extent]);
  const capabilities = getVisualModeCapabilities(visualMode);
  const cyber = capabilities.cyberEffects;
  return (
    <>
      <color attach="background" args={[cyber ? "#060817" : "#dce8e1"]} />
      <fog attach="fog" args={[cyber ? "#080b20" : "#dce8e1", extent * 0.8, extent * 2.1]} />
      <hemisphereLight args={[cyber ? "#83eeff" : "#f5fbf7", cyber ? "#29194f" : "#829a8d", 1.5]} />
      <directionalLight position={[-35, 70, 30]} intensity={2.1} castShadow shadow-mapSize={[1024, 1024]} />
      <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[projection.width + 8, projection.height + 8]} />
        <meshStandardMaterial color={cyber ? "#101932" : capabilities.mode === "minimal" ? "#e8ece8" : "#a9bea9"} roughness={1} />
      </mesh>
      {capabilities.mode !== "minimal" && <gridHelper args={[extent, 20, cyber ? "#e42ad5" : "#759486", cyber ? "#143f65" : "#9bb1a4"]} position={[0, 0.025, 0]} />}
      {cyber && <CyberGroundWaves extent={extent} />}
      {capabilities.showBaseRoads && <RoadMeshes paths={roadPaths} setHover={setHover} containerRef={containerRef} />}
      {capabilities.showProceduralBuildings && <ProceduralBuildings buildings={buildings} setHover={setHover} containerRef={containerRef} cyberEffects={cyber} />}
      <UserPlaces places={userPlaces} hover={hover} setHover={setHover} containerRef={containerRef} onSelect={onSelect} cyberEffects={cyber} />
      <BoundedMapControls projection={projection} cameraConfig={cameraConfig} selectedPlace={userPlaces.find((place) => place.id === selectedId)} />
    </>
  );
}

export default function City3DView({ mapId, mapName, bounds, baseRoadsPath, places, selectedId, onRoadStatus, onSelect, onFallbackTo2D, readOnly = false, visualMode = "normal" }) {
  const [loadState, setLoadState] = useState({ loading: true, error: "", data: null });
  const [retry, setRetry] = useState(0);
  const projection = useMemo(() => createLocalProjection(bounds), [bounds]);
  const containerRef = useRef(null);
  const [hover, setHover] = useState(null);
  const capabilities = getVisualModeCapabilities(visualMode);

  useEffect(() => {
    if (!capabilities.showBaseRoads) {
      setLoadState({ loading: false, error: "", data: [] });
      onRoadStatus?.("ready", "极简模式已隐藏基础道路");
      return undefined;
    }
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
  }, [baseRoadsPath, projection, retry, onRoadStatus, capabilities.showBaseRoads]);

  const userPlaces = useMemo(() => projectUserPlaces(places, projection), [places, projection]);
  const buildings = useMemo(() => loadState.data
    ? createProceduralBuildings(projection, loadState.data, mapId, 180, userPlaces)
    : [], [projection, loadState.data, mapId, userPlaces]);

  if (loadState.loading) return <div className="city3d-message" role="status">正在构建 3D 城市视图…</div>;
  if (loadState.error) return (
    <div className="city3d-message error" role="alert">
      <strong>3D 城市数据加载失败</strong>
      <span>{loadState.error}</span>
      {/* ai coding：公开页可安全降级到仍在内存中的只读 2D 快照；管理端缺省时保持原重试入口。 */}
      {onFallbackTo2D ? <div className="city3d-actions">
        <button className={`${ui.button} ${ui.primaryButton}`} type="button" onClick={onFallbackTo2D}>返回 2D 地图</button>
        <button className={ui.button} type="button" onClick={() => setRetry((value) => value + 1)}>重新加载</button>
      </div> : <button className={ui.button} type="button" onClick={() => setRetry((value) => value + 1)}>重新加载</button>}
    </div>
  );

  const extent = Math.max(projection.width, projection.height);
  return (
    <div ref={containerRef} id="city-3d" className={`city3d-view city3d-${capabilities.mode}`} role="region" aria-label={`${mapName}${readOnly ? "公开快照只读" : ""} 3D 城市浏览视图`}>
      <Canvas
        shadows
        dpr={[1, 1.5]}
        camera={{ position: [extent * 0.52, extent * 0.58, extent * 0.52], fov: 42, near: 0.1, far: extent * 5 }}
        gl={{ antialias: true, powerPreference: "high-performance" }}
      >
        <CityScene projection={projection} roadPaths={loadState.data} buildings={buildings} userPlaces={userPlaces} selectedId={selectedId} hover={hover} setHover={setHover} containerRef={containerRef} onSelect={onSelect} visualMode={visualMode} />
      </Canvas>
      <div className="city3d-guide" aria-hidden="true">左键拖拽平移 · 右键拖拽调整视角 · 滚轮缩放</div>
      {hover && <div className="city3d-tooltip" role="tooltip" style={{ left: hover.position.x, top: hover.position.y }}><span>{hover.type}</span><strong>{hover.name}</strong></div>}
    </div>
  );
}
