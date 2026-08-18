import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { initializeChatServer } from "./lib/chat-server";

if (typeof window !== "undefined" && "__TAURI_INTERNALS__" in window) {
  const { installTauriBridge } = await import("chatdesk-tauri/renderer");
  installTauriBridge();
}

await initializeChatServer();

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
