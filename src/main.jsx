import React from "react";
import ReactDOM from "react-dom/client";
import "leaflet/dist/leaflet.css";
import "./styles.css";
import App from "./App.jsx";
import { applyVisualModeTheme, readVisualMode } from "./services/visualMode.js";

// ai coding：React 分流前恢复主题，使审核页、公开快照页和管理端首帧使用同一视觉模式。
applyVisualModeTheme(readVisualMode());

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode><App /></React.StrictMode>,
);
