import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPlace, emptyCollection, getUnsyncedChanges, normalizeCollection, validatePlaces } from "../services/geojson.js";
import { hasSeededCloud, markCloudSeeded, migrateLegacyPlacesStorage, readDraft, readSyncBaseline, writeDraft, writeSyncBaseline } from "../services/storage.js";
import { supabase, supabaseConfiguration } from "../services/supabaseClient.js";
import { deleteCloudPlace, fetchCloudPlaces, rowsToCollection, saveCloudPlaceToCollection, seedCloudPlaces } from "../services/supabasePlaces.js";
import { captureOwnerGeneration, createOwnerGeneration, invalidateOwnerGeneration, isOwnerGenerationCurrent, staleOwnerOperationError, updateOwnerGeneration } from "../services/ownerGeneration.js";

const getJson = async (url) => {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
};

const cloudStatus = (state, message, saving = false, ownerId = null) => ({ state, message, saving, ownerId });
const ownerIdForScope = (scope) => String(scope).split(":")[0];

export function usePlaces(session, authReady = true, mapConfig = null) {
  const [places, setPlaces] = useState(emptyCollection);
  const [baseline, setBaseline] = useState(emptyCollection);
  const [types, setTypes] = useState([]);
  const [status, setStatus] = useState({ loading: true, error: "", message: "正在加载…" });
  const [cloud, setCloud] = useState(() => cloudStatus("connecting", "正在连接云端…"));
  const cloudSessionRef = useRef(null);
  const mapId = mapConfig?.id || "loading-map";
  const renderOwnerId = `${session?.user?.id || "offline"}:${mapId}`;
  const ownerGenerationRef = useRef(createOwnerGeneration(renderOwnerId));
  const authReadyRef = useRef(authReady);
  const loadedGenerationRef = useRef(null);
  const operationRef = useRef(null);
  // ai coding：在 render 阶段立即使旧 owner 的异步结果失效，不等待 effect cleanup。
  const ownerChanged = updateOwnerGeneration(ownerGenerationRef.current, renderOwnerId);
  const authGenerationChanged = authReadyRef.current !== authReady;
  authReadyRef.current = authReady;
  if (authGenerationChanged && !ownerChanged) invalidateOwnerGeneration(ownerGenerationRef.current);
  if (ownerChanged || authGenerationChanged) {
    cloudSessionRef.current = null;
    loadedGenerationRef.current = null;
    operationRef.current = null;
  }

  useEffect(() => {
    let active = true;
    const ownerId = session?.user?.id ?? null;
    if (!mapConfig) return undefined;
    const localOwnerId = ownerId || "offline";
    const loadGeneration = captureOwnerGeneration(ownerGenerationRef.current);
    cloudSessionRef.current = null;
    loadedGenerationRef.current = null;
    setPlaces(emptyCollection());
    setBaseline(emptyCollection());
    setCloud(cloudStatus("connecting", ownerId ? "正在加载当前账号的云端地点…" : "正在等待登录…"));
    setStatus({ loading: true, error: "", message: "正在加载…" });
    const load = async () => {
      try {
        const [loadedTypes, filePlaces] = await Promise.all([getJson("/data/place-types.json"), getJson(mapConfig.seed_places_path)]);
        if (!active || !isOwnerGenerationCurrent(ownerGenerationRef.current, loadGeneration)) return;
        // ai coding：无论云端是否可用，先建立经过完整校验的本地回退与文件同步基线。
        if (!Array.isArray(loadedTypes) || !loadedTypes.length || loadedTypes.some((item) => !item.id || !item.name || !/^#[0-9a-f]{6}$/i.test(item.color) || !/^[a-z-]+$/.test(item.icon))) throw new Error("地点类型配置无效");
        const normalizedFile = normalizeCollection(validatePlaces(filePlaces, loadedTypes));
        let localCurrent = normalizedFile;
        try { if (ownerId) migrateLegacyPlacesStorage(ownerId); } catch { /* localStorage 可能不可用。 */ }
        try {
          const draft = readDraft(localOwnerId, localStorage, mapId);
          if (draft) {
            localCurrent = normalizeCollection(validatePlaces(draft, loadedTypes));
          }
        } catch { /* 无效或不可读的 owner 草稿不能阻止静态文件与云端继续加载。 */ }

        if (!active) return;
        setTypes(loadedTypes);
        let syncBaseline = normalizedFile;
        try {
          const savedBaseline = readSyncBaseline(localOwnerId, localStorage, mapId);
          if (savedBaseline) {
            syncBaseline = normalizeCollection(validatePlaces(savedBaseline, loadedTypes));
          }
        } catch { /* 无效同步基线回退到静态镜像。 */ }
        setBaseline(structuredClone(syncBaseline));

        if (!authReady) return;
        if (!supabaseConfiguration.configured || !supabase) {
          loadedGenerationRef.current = loadGeneration;
          setPlaces(localCurrent);
          setCloud(cloudStatus("fallback", supabaseConfiguration.error || "未配置 Supabase，当前使用本地回退"));
          setStatus({ loading: false, error: "", message: `已加载 ${localCurrent.features.length} 个本地用户地点` });
          return;
        }

        if (!ownerId) {
          loadedGenerationRef.current = loadGeneration;
          setPlaces(emptyCollection());
          setCloud(cloudStatus("failed", "请完成邮箱验证并登录后管理地点"));
          setStatus({ loading: false, error: "", message: "等待登录" });
          return;
        }

        try {
          if (!isOwnerGenerationCurrent(ownerGenerationRef.current, loadGeneration)) return;
          let rows = await fetchCloudPlaces(supabase, ownerId, mapId);
          if (!isOwnerGenerationCurrent(ownerGenerationRef.current, loadGeneration)) return;
          let seeded = false;
          let alreadySeeded = false;
          try { alreadySeeded = hasSeededCloud(ownerId, localStorage, mapId); } catch { /* 云端数据本身仍可作为初始化依据。 */ }

          if (!rows.length && !alreadySeeded) {
            if (!isOwnerGenerationCurrent(ownerGenerationRef.current, loadGeneration)) return;
            rows = await seedCloudPlaces(supabase, localCurrent.features, ownerId, mapId);
            if (!isOwnerGenerationCurrent(ownerGenerationRef.current, loadGeneration)) return;
            try { markCloudSeeded(ownerId, localStorage, mapId); } catch { /* localStorage 不可用不影响已完成的云端写入。 */ }
            seeded = localCurrent.features.length > 0;
          }

          const invalidRows = [];
          const cloudPlaces = normalizeCollection(rowsToCollection(rows, loadedTypes, (issue) => invalidRows.push(issue)));
          if (!active || !isOwnerGenerationCurrent(ownerGenerationRef.current, loadGeneration)) return;
          cloudSessionRef.current = { ownerId: renderOwnerId, userId: ownerId, mapId, generation: loadGeneration.generation };
          loadedGenerationRef.current = loadGeneration;
          setPlaces(cloudPlaces);
          try { writeDraft(ownerId, cloudPlaces, localStorage, mapId); } catch { /* 云端仍是主数据源。 */ }
          const isolationMessage = invalidRows.length ? `，已隔离 ${invalidRows.length} 条非法云端数据` : "";
          setCloud({ ...cloudStatus("connected", seeded ? `云端已连接，首次导入 ${cloudPlaces.features.length} 个地点${isolationMessage}` : `云端已连接${isolationMessage}`, false, ownerId), mapId });
          setStatus({ loading: false, error: "", message: `已从云端加载 ${cloudPlaces.features.length} 个用户地点${isolationMessage}` });
        } catch (error) {
          if (!active || !isOwnerGenerationCurrent(ownerGenerationRef.current, loadGeneration)) return;
          cloudSessionRef.current = null;
          loadedGenerationRef.current = loadGeneration;
          setPlaces(localCurrent);
          setCloud(cloudStatus("fallback", `${error.message}；当前使用本地回退`));
          setStatus({ loading: false, error: "", message: `已加载 ${localCurrent.features.length} 个本地用户地点` });
        }
      } catch (error) {
        if (active && isOwnerGenerationCurrent(ownerGenerationRef.current, loadGeneration)) {
          setCloud(cloudStatus("fallback", "地点基础数据不可用，无法连接云端"));
          setStatus({ loading: false, error: error.message, message: `加载失败（${error.message}）` });
        }
      }
    };
    load();
    return () => { active = false; };
  }, [session?.user?.id, authReady, mapConfig, mapId, renderOwnerId]);

  const storeDraft = useCallback((next, ownerId) => {
    try {
      writeDraft(ownerId, next, localStorage, mapId);
      return { draftSaved: true, draftError: null };
    } catch (error) {
      return { draftSaved: false, draftError: error instanceof Error ? error : new Error("浏览器本地存储不可用") };
    }
  }, [mapId]);

  const save = useCallback(async (values, existing) => {
    if (operationRef.current && isOwnerGenerationCurrent(ownerGenerationRef.current, operationRef.current)) throw new Error("云端操作正在进行，请稍候");
    if (!isOwnerGenerationCurrent(ownerGenerationRef.current, loadedGenerationRef.current)) throw new Error("当前账号数据正在加载，请稍候");
    const feature = createPlace(values, existing);
    // ai coding：正式保存前以当前 owner + map 集合解析线关联，拒绝跨范围、非 Point 或已删除地点 id。
    const candidate = { ...places, features: existing ? places.features.map((item) => item.id === existing.id ? feature : item) : [...places.features, feature] };
    validatePlaces(candidate, types);
    const session = cloudSessionRef.current;
    const operation = captureOwnerGeneration(ownerGenerationRef.current);

    if (session && session.ownerId === operation.ownerId && session.generation === operation.generation) {
      operationRef.current = operation;
      setCloud({ ...cloudStatus("connected", "正在保存到云端…", true, session.userId), mapId: session.mapId });
      try {
        // ai coding：云端确认成功后才提交正式内存集合，失败时完整保留表单与原集合。
        if (!isOwnerGenerationCurrent(ownerGenerationRef.current, operation)) throw staleOwnerOperationError();
        const { feature: savedFeature, collection: next } = await saveCloudPlaceToCollection(supabase, places, feature, session.userId, existing?.id, session.mapId);
        if (!isOwnerGenerationCurrent(ownerGenerationRef.current, operation)) throw staleOwnerOperationError();
        validatePlaces({ ...candidate, features: candidate.features.map((item) => item.id === savedFeature.id ? savedFeature : item) }, types);
        const draftResult = storeDraft(next, session.userId);
        setPlaces(next);
        setCloud({ ...cloudStatus("connected", "云端已连接，地点已保存", false, session.userId), mapId: session.mapId });
        return { feature: savedFeature, ...draftResult, cloudSaved: true };
      } catch (error) {
        if (isOwnerGenerationCurrent(ownerGenerationRef.current, operation)) setCloud(cloudStatus("failed", error.message));
        throw error;
      } finally {
        if (operationRef.current === operation) operationRef.current = null;
      }
    }

    if (!isOwnerGenerationCurrent(ownerGenerationRef.current, operation)) throw staleOwnerOperationError();
    const next = candidate;
    const draftResult = storeDraft(next, ownerIdForScope(operation.ownerId));
    setPlaces(next);
    return { feature, ...draftResult, cloudSaved: false };
  }, [places, storeDraft, types]);

  const remove = useCallback(async (id) => {
    if (operationRef.current && isOwnerGenerationCurrent(ownerGenerationRef.current, operationRef.current)) throw new Error("云端操作正在进行，请稍候");
    if (!isOwnerGenerationCurrent(ownerGenerationRef.current, loadedGenerationRef.current)) throw new Error("当前账号数据正在加载，请稍候");
    const session = cloudSessionRef.current;
    const operation = captureOwnerGeneration(ownerGenerationRef.current);
    if (session && session.ownerId === operation.ownerId && session.generation === operation.generation) {
      operationRef.current = operation;
      setCloud({ ...cloudStatus("connected", "正在从云端删除…", true, session.userId), mapId: session.mapId });
      try {
        if (!isOwnerGenerationCurrent(ownerGenerationRef.current, operation)) throw staleOwnerOperationError();
        await deleteCloudPlace(supabase, id, session.userId, session.mapId);
        if (!isOwnerGenerationCurrent(ownerGenerationRef.current, operation)) throw staleOwnerOperationError();
        const next = removePlaceFromCollection(places, id);
        const draftResult = storeDraft(next, session.userId);
        setPlaces(next);
        setCloud({ ...cloudStatus("connected", "云端已连接，地点已删除", false, session.userId), mapId: session.mapId });
        return { ...draftResult, cloudSaved: true };
      } catch (error) {
        if (isOwnerGenerationCurrent(ownerGenerationRef.current, operation)) setCloud(cloudStatus("failed", error.message));
        throw error;
      } finally {
        if (operationRef.current === operation) operationRef.current = null;
      }
    }

    if (!isOwnerGenerationCurrent(ownerGenerationRef.current, operation)) throw staleOwnerOperationError();
    const next = removePlaceFromCollection(places, id);
    const draftResult = storeDraft(next, ownerIdForScope(operation.ownerId));
    setPlaces(next);
    return { ...draftResult, cloudSaved: false };
  }, [places, storeDraft]);

  const getOwnerOperation = useCallback(() => isOwnerGenerationCurrent(ownerGenerationRef.current, loadedGenerationRef.current)
    ? captureOwnerGeneration(ownerGenerationRef.current)
    : null, []);
  const isOwnerOperationCurrent = useCallback((operation) => isOwnerGenerationCurrent(ownerGenerationRef.current, operation), []);
  const markSynced = useCallback((snapshot, operation) => {
    // ai coding：文件成功写入后才同时更新内存和 localStorage 同步基线。
    if (!isOwnerGenerationCurrent(ownerGenerationRef.current, operation)) return false;
    try { writeSyncBaseline(ownerIdForScope(operation.ownerId), snapshot, localStorage, mapId); } catch { /* 当前会话仍可准确显示同步状态。 */ }
    if (!isOwnerGenerationCurrent(ownerGenerationRef.current, operation)) return false;
    setBaseline(structuredClone(snapshot));
    return true;
  }, [mapId]);
  const unsynced = useMemo(() => getUnsyncedChanges(places, baseline), [places, baseline]);

  return { places, types, status, cloud, unsynced, save, remove, getOwnerOperation, isOwnerOperationCurrent, markSynced };
}

function removePlaceFromCollection(collection, id) {
  return {
    ...collection,
    features: collection.features.filter((item) => item.id !== id).map((item) => item.geometry.type === "LineString" && item.properties.contained_place_ids?.includes(id)
      ? { ...item, properties: { ...item.properties, contained_place_ids: item.properties.contained_place_ids.filter((placeId) => placeId !== id) } }
      : item),
  };
}
