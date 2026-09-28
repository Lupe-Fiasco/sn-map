// ai coding：使用 Vite 可静态分析的有限 query 入口；每次重试都会选择不同模块 URL，绕过浏览器缓存的失败模块记录。
export const CITY_3D_IMPORT_ATTEMPTS = [
  {
    specifier: "../components/City3DView.jsx?retry=0",
    load: () => import("../components/City3DView.jsx?retry=0"),
  },
  {
    specifier: "../components/City3DView.jsx?retry=1",
    load: () => import("../components/City3DView.jsx?retry=1"),
  },
  {
    specifier: "../components/City3DView.jsx?retry=2",
    load: () => import("../components/City3DView.jsx?retry=2"),
  },
  {
    specifier: "../components/City3DView.jsx?retry=3",
    load: () => import("../components/City3DView.jsx?retry=3"),
  },
];

export function getCity3DImportAttempt(index, attempts = CITY_3D_IMPORT_ATTEMPTS) {
  if (!Number.isInteger(index) || index < 0 || index >= attempts.length) {
    throw new RangeError("无效的 3D 模块加载次数");
  }
  return attempts[index];
}

export function hasNextCity3DImportAttempt(index, attempts = CITY_3D_IMPORT_ATTEMPTS) {
  return index + 1 < attempts.length;
}
