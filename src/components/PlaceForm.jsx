import { useState } from "react";
import TypeSelect from "./TypeSelect.jsx";
import { validatePolygonGeometry } from "../services/geojson.js";

const initialValues = (feature, coordinates) => ({
  name: feature?.properties.name ?? "", type: feature?.properties.type ?? "",
  longitude: String(coordinates?.[0] ?? (feature?.geometry.type === "Point" ? feature.geometry.coordinates[0] : "")), latitude: String(coordinates?.[1] ?? (feature?.geometry.type === "Point" ? feature.geometry.coordinates[1] : "")),
  address: feature?.properties.address ?? "", phone: feature?.properties.phone ?? "", description: feature?.properties.description ?? "",
});

export default function PlaceForm({ feature, initialCoordinates, geometry, types, bounds, disabled, onSave, onCancel, onCoordinatesChange }) {
  const areaGeometry = geometry ?? (feature?.geometry.type === "Polygon" ? feature.geometry : null);
  const [values, setValues] = useState(() => initialValues(feature, initialCoordinates));
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
    else if (!types.some((item) => item.id === values.type)) message = "请选择有效的地点类型。";
    else if (!areaGeometry && (!Number.isFinite(longitude) || !Number.isFinite(latitude))) message = "请填写有效的经纬度数值。";
    else if (!areaGeometry && (longitude < -180 || longitude > 180 || latitude < -90 || latitude > 90)) message = "经度须在 -180 至 180，纬度须在 -90 至 90。";
    else if (!areaGeometry && (longitude < bounds.west || longitude > bounds.east || latitude < bounds.south || latitude > bounds.north)) message = `地点须位于当前矩形范围：经度 ${bounds.west}–${bounds.east}，纬度 ${bounds.south}–${bounds.north}。`;
    if (message) return setError(message);
    try {
      if (areaGeometry) validatePolygonGeometry(areaGeometry, "区域");
      // ai coding：等待云端确认，失败时保留表单和 Polygon 编辑草稿并就地显示错误。
      await onSave({ ...values, name: values.name.trim(), address: values.address.trim(), phone: values.phone.trim(), description: values.description.trim(), longitude, latitude, ...(areaGeometry ? { geometry: areaGeometry } : {}) });
      setError("");
    } catch (saveError) {
      // ai coding：几何草稿校验或正式保存失败时保留当前表单和地图草稿，不触发数据层 mutation。
      setError(saveError instanceof Error ? saveError.message : "保存失败，请稍后重试。");
    }
  };
  return <form className="editor-panel" onSubmit={submit} noValidate aria-busy={disabled}>
    <div className="editor-title"><h3>{feature ? `编辑${areaGeometry ? "区域" : "地点"}` : `新增${areaGeometry ? "区域" : "地点"}`}</h3><button className="icon-button" type="button" onClick={onCancel} aria-label="关闭表单">×</button></div>
    <p className="form-help">{feature ? (areaGeometry ? `拖拽顶点或点击边线调整区域；保存后才会在本地暂存。当前 ${areaGeometry.coordinates[0].length - 1} 个顶点。` : "修改后将立即在本地暂存。") : areaGeometry ? `区域已闭合，共 ${areaGeometry.coordinates[0].length - 1} 个顶点；请填写地点信息。` : "可精确调整经纬度；坐标必须位于地图矩形范围内。"}</p>
    {error && <div className="form-error" role="alert">{error}</div>}
    <label>名称 <span aria-hidden="true">*</span><input autoFocus name="name" maxLength="80" value={values.name} onChange={update} required /></label>
    <div className="form-field"><label id="place-type-label" htmlFor="place-type">类型 <span aria-hidden="true">*</span></label><TypeSelect id="place-type" name="type" value={values.type} options={types} placeholder="请选择类型" disabled={disabled} required onChange={(value) => setValues((current) => ({ ...current, type: value }))} /></div>
    {!areaGeometry && <div className="coordinate-fields"><label>经度<input name="longitude" type="number" step="any" value={values.longitude} onChange={update} required /></label><label>纬度<input name="latitude" type="number" step="any" value={values.latitude} onChange={update} required /></label></div>}
    <label>地址<input name="address" maxLength="160" value={values.address} onChange={update} /></label>
    <label>电话<input name="phone" type="tel" maxLength="40" value={values.phone} onChange={update} /></label>
    <label>备注<textarea name="description" rows="3" maxLength="500" value={values.description} onChange={update} /></label>
    <div className="form-actions"><button className="button primary" type="submit" disabled={disabled}>保存{areaGeometry ? "区域" : "地点"}</button><button className="button" type="button" onClick={onCancel}>取消</button></div>
  </form>;
}
