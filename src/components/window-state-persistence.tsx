import { getCurrentWindow, LogicalSize } from "@tauri-apps/api/window";
import { useEffect } from "react";
import { settingsStore } from "@/lib/settings-store";

type WindowState = {
  width: number;
  height: number;
};

const WINDOW_STATE_STORE_KEY = "window-state";
const MIN_WINDOW_WIDTH = 320;
const MIN_WINDOW_HEIGHT = 240;
const SAVE_DEBOUNCE_MS = 250;

function isTauri() {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

function isValidWindowState(value: unknown): value is WindowState {
  if (!value || typeof value !== "object") {
    return false;
  }

  const state = value as Partial<WindowState>;
  return (
    typeof state.width === "number" &&
    typeof state.height === "number" &&
    Number.isFinite(state.width) &&
    Number.isFinite(state.height) &&
    state.width >= MIN_WINDOW_WIDTH &&
    state.height >= MIN_WINDOW_HEIGHT
  );
}

/** Restores the last desktop window size and persists subsequent changes. */
export function WindowStatePersistence() {
  useEffect(() => {
    if (!isTauri()) {
      return;
    }

    const appWindow = getCurrentWindow();
    let isActive = true;
    let saveTimer: ReturnType<typeof setTimeout> | undefined;
    let latestState: WindowState | undefined;

    async function readCurrentState(): Promise<WindowState | undefined> {
      const [size, scaleFactor] = await Promise.all([
        appWindow.innerSize(),
        appWindow.scaleFactor(),
      ]);
      const logicalSize = size.toLogical(scaleFactor);
      const state = {
        width: Math.round(logicalSize.width),
        height: Math.round(logicalSize.height),
      };
      if (!isValidWindowState(state)) {
        return undefined;
      }

      return state;
    }

    async function saveState(state: WindowState) {
      try {
        await settingsStore.set(WINDOW_STATE_STORE_KEY, state);
        await settingsStore.save();
      } catch (error) {
        console.error("Failed to save window state", error);
      }
    }

    function scheduleSave(state: WindowState) {
      latestState = state;
      if (saveTimer) {
        clearTimeout(saveTimer);
      }
      saveTimer = setTimeout(() => {
        saveTimer = undefined;
        if (latestState) {
          void saveState(latestState);
        }
      }, SAVE_DEBOUNCE_MS);
    }

    async function persistCurrentState() {
      try {
        if (saveTimer) {
          clearTimeout(saveTimer);
          saveTimer = undefined;
        }

        if (await appWindow.isMaximized()) {
          return;
        }

        const state = (await readCurrentState()) ?? latestState;
        if (state) {
          latestState = state;
          await saveState(state);
        }
      } catch (error) {
        // A failed persistence call must never prevent the native close action.
        console.error("Failed to persist window state before close", error);
      }
    }

    async function initialize() {
      let savedState: unknown;
      try {
        const storedState = await settingsStore.get<WindowState>(WINDOW_STATE_STORE_KEY);
        if (isValidWindowState(storedState)) {
          savedState = storedState;
        }
      } catch (error) {
        console.error("Failed to restore window state", error);
      }

      try {
        if (isActive && isValidWindowState(savedState) && !(await appWindow.isMaximized())) {
          await appWindow.setSize(new LogicalSize(savedState.width, savedState.height));
          latestState = savedState;
        }
      } catch (error) {
        console.error("Failed to apply saved window state", error);
      }

      if (!isActive) {
        return;
      }

      const unlistenResize = await appWindow.onResized(async ({ payload }) => {
        if (!isActive || (await appWindow.isMaximized())) {
          return;
        }

        const scaleFactor = await appWindow.scaleFactor();
        const logicalSize = payload.toLogical(scaleFactor);
        const state = {
          width: Math.round(logicalSize.width),
          height: Math.round(logicalSize.height),
        };
        if (isValidWindowState(state)) {
          scheduleSave(state);
        }
      });
      const unlistenClose = await appWindow.onCloseRequested(() => persistCurrentState());

      if (!isActive) {
        unlistenResize();
        unlistenClose();
      }
    }

    void initialize();

    return () => {
      isActive = false;
      if (saveTimer) {
        clearTimeout(saveTimer);
      }
    };
  }, []);

  return null;
}
