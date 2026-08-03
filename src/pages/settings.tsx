import { useTheme, type Theme } from "@/components/theme-provider";

const themes: Theme[] = ["light", "dark", "system"];

function SettingsPage() {
  const { theme, setTheme } = useTheme();

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col px-6 py-20 sm:px-10">
      <header className="mb-8">
        <p className="font-medium text-sm text-muted-foreground">Settings</p>
        <h1 className="mt-2 font-semibold text-3xl text-foreground tracking-normal">工作区设置</h1>
      </header>

      <section className="rounded-lg border border-border bg-muted/60 p-5">
        <h2 className="font-semibold text-foreground">主题</h2>
        <div className="mt-4 flex flex-wrap gap-2">
          {themes.map((item) => (
            <label
              className={`flex h-10 items-center gap-2 rounded-md border px-3 text-sm transition-colors ${
                theme === item
                  ? "border-foreground bg-foreground text-background"
                  : "border-border bg-background text-muted-foreground hover:bg-muted"
              }`}
              key={item}
            >
              <input
                checked={theme === item}
                className="sr-only"
                name="theme"
                onChange={() => setTheme(item)}
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

export { SettingsPage };
