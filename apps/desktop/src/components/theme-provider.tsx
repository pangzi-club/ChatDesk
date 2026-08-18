import { createContext, useContext, useEffect, useState } from "react";
import { isDesktop } from "@/lib/desktop-bridge";
import { settingsStore } from "@/lib/settings-store";
import { appendSystemLog } from "@/lib/system-log";

type Theme = "dark" | "light" | "system";
const themeColorValues = [
  "ocean",
  "gray",
  "violet",
  "sunset",
  "forest",
  "solarized",
  "github",
  "nord",
  "tokyo-night",
  "doom",
  "zenburn",
  "tomorrow",
  "modus",
  "spacemacs",
  "monokai",
  "gruvbox",
  "dracula",
  "material",
  "moe",
  "cyberpunk",
  "kaolin",
  "mint",
  "ruby",
] as const;
type ThemeColor = (typeof themeColorValues)[number];

type ThemeProviderProps = {
  children: React.ReactNode;
  defaultTheme?: Theme;
  storageKey?: string;
};

type ThemeProviderState = {
  theme: Theme;
  themeColor: ThemeColor;
  setTheme: (theme: Theme) => void;
  setThemeColor: (themeColor: ThemeColor) => void;
};

const initialState: ThemeProviderState = {
  theme: "system",
  themeColor: "ocean",
  setTheme: () => null,
  setThemeColor: () => null,
};

const ThemeProviderContext = createContext<ThemeProviderState>(initialState);

const THEME_STORE_KEY = "theme";
const THEME_COLOR_STORE_KEY = "themeColor";
const LEGACY_PRIMARY_COLOR_STORE_KEY = "primaryColor";

function isTheme(value: unknown): value is Theme {
  return value === "light" || value === "dark" || value === "system";
}

function isThemeColor(value: unknown): value is ThemeColor {
  return themeColorValues.includes(value as ThemeColor);
}

function getSystemTheme(): "light" | "dark" {
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function ThemeProvider({
  children,
  defaultTheme = "system",
  storageKey = "vite-ui-theme",
  ...props
}: ThemeProviderProps) {
  const [theme, setTheme] = useState<Theme>(() => {
    if (typeof window === "undefined") {
      return defaultTheme;
    }

    const stored = isDesktop() ? null : window.localStorage.getItem(storageKey);
    return isTheme(stored) ? stored : defaultTheme;
  });
  const [themeColor, setThemeColorState] = useState<ThemeColor>(() => {
    if (typeof window === "undefined") return "ocean";
    const stored = isDesktop() ? null : window.localStorage.getItem("vite-ui-theme-color");
    return isThemeColor(stored) ? stored : "ocean";
  });

  // Sync with Tauri Store on mount (desktop app persistence)
  useEffect(() => {
    let isActive = true;

    settingsStore
      .get<string>(THEME_STORE_KEY)
      .then((savedTheme) => {
        if (!isActive || !isTheme(savedTheme)) {
          return;
        }

        setTheme(savedTheme);
      })
      .catch(() => {
        // Not running in Tauri, ignore
      });

    return () => {
      isActive = false;
    };
  }, []);

  useEffect(() => {
    let isActive = true;

    settingsStore
      .get<string>(THEME_COLOR_STORE_KEY)
      .then((savedColor) => {
        if (!isActive || !isThemeColor(savedColor)) return;
        setThemeColorState(savedColor);
      })
      .catch(() => {
        // Not running in Tauri, ignore
      });

    return () => {
      isActive = false;
    };
  }, []);

  useEffect(() => {
    if (!isDesktop()) {
      window.localStorage.removeItem("vite-ui-primary-color");
      return;
    }

    settingsStore
      .delete(LEGACY_PRIMARY_COLOR_STORE_KEY)
      .then((existed) => (existed ? settingsStore.save() : undefined))
      .catch(() => {
        // Not running in Tauri, ignore
      });
  }, []);

  // Apply theme class to <html> + listen for system theme changes
  useEffect(() => {
    const root = window.document.documentElement;

    root.classList.remove("light", "dark");
    root.classList.remove(...themeColorValues.map((color) => `theme-${color}`));
    root.classList.add(`theme-${themeColor}`);

    if (theme === "system") {
      const resolved = getSystemTheme();
      root.classList.add(resolved);
      root.style.colorScheme = resolved;

      const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
      const handler = () => {
        const next = getSystemTheme();
        root.classList.remove("light", "dark");
        root.classList.add(next);
        root.style.colorScheme = next;
      };
      mediaQuery.addEventListener("change", handler);
      return () => mediaQuery.removeEventListener("change", handler);
    }

    root.classList.add(theme);
    root.style.colorScheme = theme;
  }, [theme, themeColor]);

  const value = {
    theme,
    themeColor,
    setTheme: (theme: Theme) => {
      if (!isDesktop()) window.localStorage.setItem(storageKey, theme);
      setTheme(theme);
      void appendSystemLog({
        level: "success",
        source: "主题",
        message: `已切换为${theme === "system" ? "跟随系统" : theme === "dark" ? "深色" : "浅色"}主题`,
      }).catch(() => {
        // Logging must never prevent a theme change.
      });

      // Also persist to Tauri Store
      settingsStore
        .set(THEME_STORE_KEY, theme)
        .then(() => settingsStore.save())
        .catch(() => {
          // Not running in Tauri, ignore
        });
    },
    setThemeColor: (nextColor: ThemeColor) => {
      if (!isDesktop()) window.localStorage.setItem("vite-ui-theme-color", nextColor);
      setThemeColorState(nextColor);
      void appendSystemLog({
        level: "success",
        source: "主题",
        message: `已切换配色：${nextColor}`,
      }).catch(() => {
        // Logging must never prevent a theme change.
      });
      settingsStore
        .set(THEME_COLOR_STORE_KEY, nextColor)
        .then(() => settingsStore.save())
        .catch(() => {
          // Not running in Tauri, ignore
        });
    },
  };

  return (
    <ThemeProviderContext.Provider {...props} value={value}>
      {children}
    </ThemeProviderContext.Provider>
  );
}

export const useTheme = () => {
  const context = useContext(ThemeProviderContext);

  if (context === undefined) {
    throw new Error("useTheme must be used within a ThemeProvider");
  }

  return context;
};

export type { Theme, ThemeColor };
