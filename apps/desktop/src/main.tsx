import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { App } from "./App";
import { applyAppPreferences, loadAppPreferences } from "./stores/useAppPreferences";
import "./styles.css";

const root = document.getElementById("root");

applyAppPreferences(loadAppPreferences());

if (!root) {
  throw new Error("无法启动 Renderer：缺少 #root 容器");
}

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
