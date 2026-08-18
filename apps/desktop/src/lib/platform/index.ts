import { chatServerUrl, getChatServerToken } from "@/lib/chat-server";
import { getDesktopBridge, isDesktop } from "@/lib/desktop-bridge";

export { getDesktopBridge, isDesktop } from "@/lib/desktop-bridge";

export async function pickDirectory() {
  const bridge = getDesktopBridge();
  if (!bridge) return window.prompt("输入 server 所在机器上的 workspace 路径")?.trim() || null;
  return bridge.selectWorkspaceDirectory();
}

export async function openExternal(url: string) {
  const bridge = getDesktopBridge();
  if (bridge) {
    await bridge.openExternal(url);
    return;
  }
  window.open(url, "_blank", "noopener,noreferrer");
}

export function assetUrl(path: string) {
  const bridge = getDesktopBridge();
  if (bridge) {
    return bridge.assetUrl(path);
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
  const bridge = getDesktopBridge();
  if (!bridge) return false;
  const bytes = Array.from(new Uint8Array(await blob.arrayBuffer()));
  return bridge.saveImageFile(bytes, fileName);
}
