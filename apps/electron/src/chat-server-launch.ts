import { dirname } from "node:path";

export function chatServerLaunchArgs(worker: string, watch: boolean) {
  return watch ? ["--watch", "--experimental-strip-types", worker] : [worker];
}

export function chatServerRuntimeRoot(worker: string, configuredRoot?: string) {
  return configuredRoot || dirname(dirname(worker));
}
