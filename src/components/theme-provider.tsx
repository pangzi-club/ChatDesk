import { createContext, useContext, useEffect, useState } from "react";
import { settingsStore } from "@/lib/settings-store";
import { appendSystemLog } from "@/lib/system-log";

type Theme = "dark" | "light" | "system";

type ThemeProviderProps = {
  children: React.ReactNode;
  defaultTheme?: Theme;
  storageKey?: string;
};

type ThemeProviderState = {
  theme: Theme;
  setTheme: (theme: Theme) => void;
};

const initialState: ThemeProviderState = {
  theme: "system",
  setTheme: () => null,
};

const ThemeProviderContext = createContext<ThemeProviderState>(initialState);

const THEME_STORE_KEY = "theme";

function isTheme(value: unknown): value is Theme {
  return value === "light" || value === "dark" || value === "system";
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

    const stored = window.localStorage.getItem(storageKey);
    return isTheme(stored) ? stored : defaultTheme;
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

  // Apply theme class to <html> + listen for system theme changes
  useEffect(() => {
    const root = window.document.documentElement;

    root.classList.remove("light", "dark");

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
  }, [theme]);

  const value = {
    theme,
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

export type { Theme };
