import { serve } from "@hono/node-server";
import { createChatServer } from "./app.ts";
import { loadServerConfig } from "./config.ts";

const config = await loadServerConfig();
const server = await createChatServer(config);
const httpServer = serve(
  { fetch: server.app.fetch, hostname: config.host, port: config.port },
  (info) => console.log(`Chat server listening on http://${info.address}:${info.port}`),
);

function shutdown() {
  httpServer.close();
}

process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
