import { LazyStore } from "@tauri-apps/plugin-store";
import { useEffect, useState } from "react";

type Theme = "light" | "dark" | "system";

const settingsStore = new LazyStore("settings.json");
const THEME_STORE_KEY = "theme";
const themes: Theme[] = ["light", "dark", "system"];

function SettingsPage() {
  const [theme, setTheme] = useState<Theme>("system");

  useEffect(() => {
    let isActive = true;

    void settingsStore.get(THEME_STORE_KEY).then((savedTheme) => {
      if (isActive && isTheme(savedTheme)) {
        setTheme(savedTheme);
      }
    });

    return () => {
      isActive = false;
    };
  }, []);

  async function changeTheme(nextTheme: Theme) {
    setTheme(nextTheme);
    await settingsStore.set(THEME_STORE_KEY, nextTheme);
    await settingsStore.save();
  }

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col px-6 py-20 sm:px-10">
      <header className="mb-8">
        <p className="font-medium text-sm text-zinc-500">Settings</p>
        <h1 className="mt-2 font-semibold text-3xl text-zinc-950 tracking-normal">工作区设置</h1>
      </header>

      <section className="rounded-lg border border-zinc-200 bg-zinc-50/60 p-5">
        <h2 className="font-semibold text-zinc-900">主题</h2>
        <div className="mt-4 flex flex-wrap gap-2">
          {themes.map((item) => (
            <label
              className={`flex h-10 items-center gap-2 rounded-md border px-3 text-sm ${
                theme === item
                  ? "border-zinc-950 bg-zinc-950 text-white"
                  : "border-zinc-200 bg-white text-zinc-700"
              }`}
              key={item}
            >
              <input
                checked={theme === item}
                className="sr-only"
                name="theme"
                onChange={() => void changeTheme(item)}
                type="radio"
                value={item}
              />
              {item}
            </label>
          ))}
        </div>
      </section>
    </div>
  );
}

function isTheme(value: unknown): value is Theme {
  return value === "light" || value === "dark" || value === "system";
}

export { SettingsPage };
