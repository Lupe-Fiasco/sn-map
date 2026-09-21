import { useState } from "react";
import TypeSelect from "./TypeSelect.jsx";
import { validateLineStringGeometry, validatePolygonGeometry } from "../services/geojson.js";
import PlaceImages from "./PlaceImages.jsx";
import { getTypeOptionsForGeometry, isTypeAllowedForGeometry } from "../services/placeTypes.js";
import { createInitialPlaceFormValues, resolveShapeGeometry } from "../services/placeFormState.js";

export default function PlaceForm({ feature, ownerId, mapId, initialCoordinates, geometry, containedPlaces = [], types, bounds, disabled, onSave, onCancel, onCoordinatesChange }) {
  // ai coding：新增流程只从 pending coordinates/geometry 建立表单；null feature/geometry 不再被解引用。
  const shapeGeometry = resolveShapeGeometry(feature, geometry);
  const isLine = shapeGeometry?.type === "LineString";
  const geometryType = shapeGeometry?.type ?? "Point";
  const typeOptions = getTypeOptionsForGeometry(types, geometryType);
  const [values, setValues] = useState(() => createInitialPlaceFormValues(feature, initialCoordinates, geometryType));
  const [error, setError] = useState("");
  // ai coding：表单实例由父级 key 划分新增/编辑生命周期，避免 marker 回传坐标后反向重置其余字段。
  const update = (event) => {
    const { name, value } = event.target;
    const next = { ...values, [name]: value };
    setValues(next);
    if ((name === "longitude" || name === "latitude") && onCoordinatesChange) {
      onCoordinatesChange(next.longitude, next.latitude);
    }
  };
  const submit = async (event) => {
    event.preventDefault();
    const longitude = Number(values.longitude); const latitude = Number(values.latitude); let message = "";
    if (!values.name.trim()) message = "请填写地点名称。";
    else if (!types.some((item) => item.id === values.type) || !isTypeAllowedForGeometry(values.type, geometryType)) message = "请选择适用于当前形态的地点类型。";
    else if (!shapeGeometry && (!Number.isFinite(longitude) || !Number.isFinite(latitude))) message = "请填写有效的经纬度数值。";
    else if (!shapeGeometry && (longitude < -180 || longitude > 180 || latitude < -90 || latitude > 90)) message = "经度须在 -180 至 180，纬度须在 -90 至 90。";
    else if (!shapeGeometry && bounds && (longitude < bounds.west || longitude > bounds.east || latitude < bounds.south || latitude > bounds.north)) message = `地点须位于当前矩形范围：经度 ${bounds.west}–${bounds.east}，纬度 ${bounds.south}–${bounds.north}。`;
    if (message) return setError(message);
    try {
      if (isLine) validateLineStringGeometry(shapeGeometry, "线");
      else if (shapeGeometry) validatePolygonGeometry(shapeGeometry, "区域");
      // ai coding：等待云端确认，失败时保留表单和几何编辑草稿并就地显示错误。
      await onSave({ ...values, name: values.name.trim(), address: values.address.trim(), phone: values.phone.trim(), description: values.description.trim(), longitude, latitude, ...(shapeGeometry ? { geometry: shapeGeometry } : {}), ...(isLine ? { contained_place_ids: containedPlaces.map((place) => place.id) } : {}) });
      setError("");
    } catch (saveError) {
      // ai coding：几何草稿校验或正式保存失败时保留当前表单和地图草稿，不触发数据层 mutation。
      setError(saveError instanceof Error ? saveError.message : "保存失败，请稍后重试。");
    }
  };
  return <form className="editor-panel" onSubmit={submit} noValidate aria-busy={disabled}>
    <div className="editor-title"><h3>{feature ? `编辑${isLine ? "线" : shapeGeometry ? "区域" : "地点"}` : `新增${isLine ? "线" : shapeGeometry ? "区域" : "地点"}`}</h3><button className="icon-button" type="button" onClick={onCancel} aria-label="关闭表单">×</button></div>
    <p className="form-help">{feature ? (shapeGeometry ? `拖拽顶点调整${isLine ? "开放线" : "区域"}；保存后才会在本地暂存。当前 ${isLine ? shapeGeometry.coordinates.length : shapeGeometry.coordinates[0].length - 1} 个顶点。` : "修改后将立即在本地暂存。") : shapeGeometry ? `${isLine ? "开放线" : "区域"}已完成，共 ${isLine ? shapeGeometry.coordinates.length : shapeGeometry.coordinates[0].length - 1} 个顶点；请填写地点信息。` : "可精确调整经纬度；坐标必须位于地图矩形范围内。"}</p>
    {error && <div className="form-error" role="alert">{error}</div>}
    <label>名称 <span aria-hidden="true">*</span><input autoFocus name="name" maxLength="80" value={values.name} onChange={update} required /></label>
    <div className="form-field"><label id="place-type-label" htmlFor="place-type">类型 <span aria-hidden="true">*</span></label><TypeSelect id="place-type" name="type" value={values.type} options={typeOptions} placeholder="请选择类型" disabled={disabled} required onChange={(value) => setValues((current) => ({ ...current, type: value }))} /></div>
    {!shapeGeometry && <div className="coordinate-fields"><label>经度<input name="longitude" type="number" step="any" value={values.longitude} onChange={update} required /></label><label>纬度<input name="latitude" type="number" step="any" value={values.latitude} onChange={update} required /></label></div>}
    {isLine && <div className="contained-places"><span>包含地点</span>{containedPlaces.length ? <ul>{containedPlaces.map((place) => <li key={place.id}>{place.properties.name}</li>)}</ul> : <small>未关联地点；绘制时点击已有点可建立关联。</small>}</div>}
    <label>地址<input name="address" maxLength="160" value={values.address} onChange={update} /></label>
    <label>电话<input name="phone" type="tel" maxLength="40" value={values.phone} onChange={update} /></label>
    <label>备注<textarea name="description" rows="3" maxLength="500" value={values.description} onChange={update} /></label>
    {feature ? <PlaceImages ownerId={ownerId} mapId={mapId} placeId={feature.id} disabled={disabled} /> : <p className="form-help">保存地点后即可上传实景图片。</p>}
    <div className="form-actions"><button className="button primary" type="submit" disabled={disabled}>保存{isLine ? "线" : shapeGeometry ? "区域" : "地点"}</button><button className="button" type="button" onClick={onCancel}>取消</button></div>
  </form>;
}
