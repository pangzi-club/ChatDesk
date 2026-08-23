import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { initializeChatServer } from "./lib/chat-server";

await initializeChatServer();

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
