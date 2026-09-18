import { TYPE_ICON_PATHS } from "./typeIconRegistry.js";

export { TYPE_ICON_PATHS } from "./typeIconRegistry.js";

export default function TypeIcon({ icon, color, className = "" }) {
  return (
    <svg className={`type-icon ${className}`} viewBox="0 0 24 24" aria-hidden="true" style={{ color }}>
      <path d={TYPE_ICON_PATHS[icon] || TYPE_ICON_PATHS.other} />
    </svg>
  );
}
