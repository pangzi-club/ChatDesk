import { convertFileSrc, invoke, isTauri as tauriIsTauri } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { chatServerUrl, getChatServerToken } from "@/lib/chat-server";

export function isDesktop() {
  return tauriIsTauri() || (typeof window !== "undefined" && "__TAURI_INTERNALS__" in window);
}

export async function pickDirectory() {
  if (!isDesktop()) return window.prompt("输入 server 所在机器上的 workspace 路径")?.trim() || null;
  return invoke<string | null>("select_workspace_directory");
}

export async function openExternal(url: string) {
  if (isDesktop()) {
    await openUrl(url);
    return;
  }
  window.open(url, "_blank", "noopener,noreferrer");
}

export function assetUrl(path: string) {
  if (isDesktop()) {
    try {
      return convertFileSrc(path);
    } catch {
      return "";
    }
  }
  return `${chatServerUrl()}/v1/platform/file?path=${encodeURIComponent(path)}&token=${encodeURIComponent(getChatServerToken())}`;
}

export async function saveBlob(blob: Blob, fileName: string) {
  const picker = (
    window as Window & {
      showSaveFilePicker?: (options?: { suggestedName?: string }) => Promise<{
        createWritable: () => Promise<{
          write: (value: Blob) => Promise<void>;
          close: () => Promise<void>;
        }>;
      }>;
    }
  ).showSaveFilePicker;
  if (!isDesktop() && picker) {
    const handle = await picker({ suggestedName: fileName });
    const writable = await handle.createWritable();
    await writable.write(blob);
    await writable.close();
    return true;
  }
  if (!isDesktop()) {
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = fileName;
    anchor.click();
    URL.revokeObjectURL(url);
    return true;
  }
  const bytes = Array.from(new Uint8Array(await blob.arrayBuffer()));
  return invoke<boolean>("save_image_file", { bytes, fileName });
}
