import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { createDesktopUiRuntime } from "./lib/plugins/desktop-ui";
import { initializeChatServer } from "./lib/server/chat-server";
import { loadChatDisplaySettings } from "./lib/settings/chat-settings";

await initializeChatServer();
const { layout } = await loadChatDisplaySettings();
const desktopUiRuntime = await createDesktopUiRuntime(layout);

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App desktopUiRuntime={desktopUiRuntime} />
  </React.StrictMode>,
);

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    void desktopUiRuntime.dispose();
  });
}
