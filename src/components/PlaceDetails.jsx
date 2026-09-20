import { getPolygonRepresentativeCoordinate } from "../services/geojson.js";
import PlaceImages from "./PlaceImages.jsx";

export default function PlaceDetails({ feature, type, ownerId, disabled, onEdit, onDelete, onClose }) {
  const props = feature.properties; const isArea = feature.geometry.type === "Polygon";
  // ai coding：兼容旧 Polygon 数据按几何即时计算展示值，新建区域则优先展示已持久化的代表坐标。
  const areaCoordinate = isArea ? (Number.isFinite(props.longitude) && Number.isFinite(props.latitude) ? [props.longitude, props.latitude] : getPolygonRepresentativeCoordinate(feature.geometry)) : null;
  const rows = [["形态", isArea ? `区域（${feature.geometry.coordinates[0].length - 1} 个顶点）` : "点"], [isArea ? "近似坐标" : "坐标", isArea ? `${areaCoordinate[0].toFixed(6)}, ${areaCoordinate[1].toFixed(6)}` : `${feature.geometry.coordinates[0].toFixed(6)}, ${feature.geometry.coordinates[1].toFixed(6)}`], ["地址", props.address], ["电话", props.phone], ["备注", props.description]].filter(([, value]) => value);
  return <div className="editor-panel">
    <div className="editor-title"><div><h3 className="detail-name">{props.name}</h3><span className="detail-type"><i className="type-swatch" style={{ background: type?.color }} /><b>{type?.name || props.type}</b></span></div><button className="icon-button" type="button" onClick={onClose} aria-label="关闭详情">×</button></div>
    <dl className="detail-list">{rows.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
    {/* ai coding：私有预览只在已保存地点的 owner 管理界面请求，公开分享页不会挂载此组件。 */}
    <PlaceImages ownerId={ownerId} placeId={feature.id} disabled={disabled} />
    <div className="detail-actions"><button className="button primary" type="button" onClick={onEdit} disabled={disabled}>编辑</button><button className="button danger-text" type="button" onClick={onDelete} disabled={disabled}>删除</button></div>
  </div>;
}
