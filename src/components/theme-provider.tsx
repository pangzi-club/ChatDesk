import { createContext, useContext, useEffect, useState } from "react";
import { settingsStore } from "@/lib/settings-store";
import { appendSystemLog } from "@/lib/system-log";

type Theme = "dark" | "light" | "system";
type ThemeColor = "ocean" | "violet" | "sunset" | "forest" | "solarized" | "github";
type PrimaryColor = "blue" | "indigo" | "cyan" | "emerald" | "orange" | "rose";

type ThemeProviderProps = {
  children: React.ReactNode;
  defaultTheme?: Theme;
  storageKey?: string;
};

type ThemeProviderState = {
  theme: Theme;
  themeColor: ThemeColor;
  primaryColor: PrimaryColor;
  setTheme: (theme: Theme) => void;
  setThemeColor: (themeColor: ThemeColor) => void;
  setPrimaryColor: (primaryColor: PrimaryColor) => void;
};

const initialState: ThemeProviderState = {
  theme: "system",
  themeColor: "ocean",
  primaryColor: "blue",
  setTheme: () => null,
  setThemeColor: () => null,
  setPrimaryColor: () => null,
};

const ThemeProviderContext = createContext<ThemeProviderState>(initialState);

const THEME_STORE_KEY = "theme";
const THEME_COLOR_STORE_KEY = "themeColor";
const PRIMARY_COLOR_STORE_KEY = "primaryColor";

function isTheme(value: unknown): value is Theme {
  return value === "light" || value === "dark" || value === "system";
}

function isThemeColor(value: unknown): value is ThemeColor {
  return (
    value === "ocean" ||
    value === "violet" ||
    value === "sunset" ||
    value === "forest" ||
    value === "solarized" ||
    value === "github"
  );
}

function isPrimaryColor(value: unknown): value is PrimaryColor {
  return ["blue", "indigo", "cyan", "emerald", "orange", "rose"].includes(value as string);
}

const primaryColorValues: Record<PrimaryColor, { primary: string; ring: string }> = {
  blue: { primary: "oklch(0.52 0.19 252)", ring: "oklch(0.62 0.18 250)" },
  indigo: { primary: "oklch(0.51 0.21 275)", ring: "oklch(0.62 0.2 275)" },
  cyan: { primary: "oklch(0.58 0.16 210)", ring: "oklch(0.68 0.15 210)" },
  emerald: { primary: "oklch(0.52 0.15 160)", ring: "oklch(0.62 0.16 160)" },
  orange: { primary: "oklch(0.62 0.19 45)", ring: "oklch(0.7 0.18 45)" },
  rose: { primary: "oklch(0.58 0.2 10)", ring: "oklch(0.67 0.19 10)" },
};

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

    const stored = window.localStorage.getItem(storageKey);
    return isTheme(stored) ? stored : defaultTheme;
  });
  const [themeColor, setThemeColorState] = useState<ThemeColor>(() => {
    if (typeof window === "undefined") return "ocean";
    const stored = window.localStorage.getItem("vite-ui-theme-color");
    return isThemeColor(stored) ? stored : "ocean";
  });
  const [primaryColor, setPrimaryColorState] = useState<PrimaryColor>(() => {
    if (typeof window === "undefined") return "blue";
    const stored = window.localStorage.getItem("vite-ui-primary-color");
    return isPrimaryColor(stored) ? stored : "blue";
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

        const localTheme = window.localStorage.getItem(storageKey);
        if (savedTheme !== localTheme) {
          setTheme(savedTheme);
          window.localStorage.setItem(storageKey, savedTheme);
        }
      })
      .catch(() => {
        // Not running in Tauri, ignore
      });

    return () => {
      isActive = false;
    };
  }, [storageKey]);

  useEffect(() => {
    let isActive = true;

    settingsStore
      .get<string>(THEME_COLOR_STORE_KEY)
      .then((savedColor) => {
        if (!isActive || !isThemeColor(savedColor)) return;
        setThemeColorState(savedColor);
        window.localStorage.setItem("vite-ui-theme-color", savedColor);
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
      .get<string>(PRIMARY_COLOR_STORE_KEY)
      .then((savedColor) => {
        if (!isActive || !isPrimaryColor(savedColor)) return;
        setPrimaryColorState(savedColor);
        window.localStorage.setItem("vite-ui-primary-color", savedColor);
      })
      .catch(() => {
        // Not running in Tauri, ignore
      });
    return () => {
      isActive = false;
    };
  }, []);

  // Apply theme class to <html> + listen for system theme changes
  useEffect(() => {
    const root = window.document.documentElement;

    root.classList.remove("light", "dark");
    root.classList.remove(
      "theme-ocean",
      "theme-violet",
      "theme-sunset",
      "theme-forest",
      "theme-solarized",
      "theme-github",
    );
    root.classList.add(`theme-${themeColor}`);
    const colors = primaryColorValues[primaryColor];
    root.style.setProperty("--primary", colors.primary);
    root.style.setProperty("--ring", colors.ring);

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
  }, [theme, themeColor, primaryColor]);

  const value = {
    theme,
    themeColor,
    primaryColor,
    setTheme: (theme: Theme) => {
      window.localStorage.setItem(storageKey, theme);
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
      window.localStorage.setItem("vite-ui-theme-color", nextColor);
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
    setPrimaryColor: (nextColor: PrimaryColor) => {
      window.localStorage.setItem("vite-ui-primary-color", nextColor);
      setPrimaryColorState(nextColor);
      void appendSystemLog({
        level: "success",
        source: "主题",
        message: `已切换 Primary 主色：${nextColor}`,
      }).catch(() => {
        // Logging must never prevent a theme change.
      });
      settingsStore
        .set(PRIMARY_COLOR_STORE_KEY, nextColor)
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

export type { PrimaryColor, Theme, ThemeColor };
