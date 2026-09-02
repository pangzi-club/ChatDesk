import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { createChatLayoutRuntime } from "./lib/chat-layout";
import { initializeChatServer } from "./lib/chat-server";
import { loadChatDisplaySettings } from "./lib/chat-settings";

await initializeChatServer();
const { layout } = await loadChatDisplaySettings();
const chatLayoutRuntime = await createChatLayoutRuntime(layout);

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App chatLayoutRuntime={chatLayoutRuntime} />
  </React.StrictMode>,
);

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    void chatLayoutRuntime.dispose();
  });
}
