import { serve } from "@hono/node-server";
import { createChatServer } from "./app.ts";
import { loadServerConfig } from "./config.ts";

async function main() {
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
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
