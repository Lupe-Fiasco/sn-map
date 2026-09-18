export function serializePlaces(places) {
  return `${JSON.stringify(places, null, 2)}\n`;
}

// ai coding：文件句柄只保存在当前页面的 JavaScript 会话中，组件重渲染或卸载不会丢失，刷新后自然清空。
let sessionFileHandle = null;

export function getSessionFileHandle() {
  return sessionFileHandle;
}

export function rememberSessionFileHandle(fileHandle) {
  sessionFileHandle = fileHandle;
}

export function forgetSessionFileHandle() {
  sessionFileHandle = null;
}

export function isFileHandleUnavailable(error) {
  return ["NotAllowedError", "SecurityError", "NotFoundError", "InvalidStateError"].includes(error?.name);
}

export async function writePlacesFile({ places, fileHandle, pickFile, confirmWrite }) {
  let handle = fileHandle;
  let writable;
  if (!handle) {
    [handle] = await pickFile({
      multiple: false,
      types: [{ description: "GeoJSON 地点文件（请选择 places.geojson）", accept: { "application/geo+json": [".geojson"], "application/json": [".json"] } }],
    });
    // ai coding：选择器返回时保留用户激活：确认对话框之前立即获取 writable，且绝不读取文件。
    writable = await handle.createWritable();
    const confirmed = confirmWrite(`将当前 ${places.features.length} 个地点的完整 FeatureCollection 覆盖写入“${handle.name || "所选文件"}”吗？\n\n不会读取该文件，也不会替换或清除当前修改。`);
    if (!confirmed) {
      if (typeof writable.abort === "function") await writable.abort();
      return { cancelled: true, fileHandle };
    }
  } else {
    writable = await handle.createWritable();
  }
  try {
    await writable.write(serializePlaces(places));
    await writable.close();
    return { cancelled: false, fileHandle: handle };
  } catch (error) {
    if (typeof writable.abort === "function") {
      try { await writable.abort(); } catch { /* 写入失败后的 abort 可能也失败 */ }
    }
    throw error;
  }
}
