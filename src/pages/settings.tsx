import { ArrowLeft, KeyRound, Palette, Search, Trash2 } from "lucide-react";
import { type FormEvent, useEffect, useState } from "react";
import { NavLink, Outlet, useNavigate } from "react-router-dom";

import { type Theme, useTheme } from "@/components/theme-provider";
import { Button } from "@/components/ui/button";
import { clearCommitApiKey, loadCommitApiKey, saveCommitApiKey } from "@/lib/commit";
import { clearDataerApiKey, loadDataerApiKey, saveDataerApiKey } from "@/lib/dataer";
import { clearLookerApiKey, loadLookerApiKey, saveLookerApiKey } from "@/lib/looker";

const themes: Array<{ value: Theme; label: string; description: string }> = [
  { value: "system", label: "跟随系统", description: "根据操作系统自动切换" },
  { value: "light", label: "浅色", description: "明亮、清晰的工作界面" },
  { value: "dark", label: "深色", description: "适合夜间和低光环境" },
];

function SettingsLayout() {
  const navigate = useNavigate();

  return (
    <div className="flex min-h-full w-full bg-background">
      <aside className="flex w-[272px] shrink-0 flex-col border-border border-r bg-card/80 px-4 pt-10 max-md:w-[220px] max-sm:w-[76px] max-sm:px-2">
        <Button
          aria-label="返回应用"
          className="mb-5 justify-start gap-2 px-2 text-muted-foreground hover:text-foreground max-sm:justify-center max-sm:px-0"
          onClick={() => navigate("/dashboard")}
          type="button"
          variant="ghost"
        >
          <ArrowLeft className="size-4" />
          <span className="max-sm:hidden">返回应用</span>
        </Button>
        <div className="mb-7 flex h-10 items-center gap-2 rounded-md border border-border bg-background px-3 text-sm text-muted-foreground shadow-xs">
          <Search className="size-4 shrink-0" />
          <span className="max-sm:hidden">搜索设置...</span>
        </div>
        <p className="px-2 pb-2 font-medium text-muted-foreground text-xs uppercase tracking-wider max-sm:hidden">
          工作区
        </p>
        <nav className="space-y-1" aria-label="设置导航">
          <SettingsNavItem to="/settings/theme" icon={Palette} label="主题" />
          <SettingsNavItem to="/settings/keys" icon={KeyRound} label="API Keys" />
        </nav>
        <div className="mt-auto border-border border-t py-5 text-muted-foreground text-xs max-sm:hidden">
          m-dashboard
          <span className="mt-1 block opacity-60">本地工作区设置</span>
        </div>
      </aside>
      <main className="min-w-0 flex-1 px-8 pt-16 pb-14 sm:px-12 lg:px-20">
        <div className="mx-auto w-full max-w-3xl">
          <Outlet />
        </div>
      </main>
    </div>
  );
}

function SettingsNavItem({
  to,
  icon: Icon,
  label,
}: {
  to: string;
  icon: typeof Palette;
  label: string;
}) {
  return (
    <NavLink
      className={({ isActive }) =>
        `flex h-10 items-center gap-3 rounded-md px-3 text-sm transition-colors max-sm:justify-center max-sm:px-0 ${isActive ? "bg-accent text-accent-foreground font-medium" : "text-muted-foreground hover:bg-accent/70 hover:text-foreground"}`
      }
      to={to}
    >
      <Icon className="size-4" />
      <span className="max-sm:hidden">{label}</span>
    </NavLink>
  );
}

function SettingsHeading({
  eyebrow,
  title,
  description,
}: {
  eyebrow: string;
  title: string;
  description: string;
}) {
  return (
    <header className="mb-8">
      <p className="font-medium text-muted-foreground text-xs uppercase tracking-[0.16em]">
        {eyebrow}
      </p>
      <h1 className="mt-2 font-semibold text-3xl tracking-tight">{title}</h1>
      <p className="mt-2 max-w-xl text-muted-foreground text-sm leading-6">{description}</p>
    </header>
  );
}

function ThemeSettingsPage() {
  const { theme, setTheme } = useTheme();
  return (
    <>
      <SettingsHeading
        eyebrow="Appearance"
        title="主题"
        description="选择 m-dashboard 的显示方式，设置会在所有页面立即生效。"
      />
      <section className="overflow-hidden rounded-lg border border-border bg-card">
        <div className="border-border border-b px-5 py-4">
          <h2 className="font-medium text-sm">界面主题</h2>
          <p className="mt-1 text-muted-foreground text-xs">
            你可以随时切换，也可以让它跟随系统偏好。
          </p>
        </div>
        <div className="divide-y divide-border">
          {themes.map((item) => (
            <label
              className="flex cursor-pointer items-center justify-between gap-4 px-5 py-4 transition-colors hover:bg-accent/40"
              key={item.value}
            >
              <span className="min-w-0">
                <span className="block font-medium text-sm">{item.label}</span>
                <span className="mt-1 block text-muted-foreground text-xs">{item.description}</span>
              </span>
              <input
                checked={theme === item.value}
                className="size-4 accent-primary"
                name="theme"
                onChange={() => setTheme(item.value)}
                type="radio"
                value={item.value}
              />
            </label>
          ))}
        </div>
      </section>
    </>
  );
}

type KeyConfig = {
  title: string;
  keyName: string;
  description: string;
  load: () => Promise<string>;
  save: (key: string) => Promise<void>;
  clear: () => Promise<void>;
};

const keyConfigs: KeyConfig[] = [
  {
    title: "Tan Dataer",
    keyName: "DATAER_API_KEY",
    description: "用于流量分析页面获取站点数据。",
    load: loadDataerApiKey,
    save: saveDataerApiKey,
    clear: clearDataerApiKey,
  },
  {
    title: "Looker",
    keyName: "LOOKER_API_KEY",
    description: "用于读取 Looker 监控和告警数据。",
    load: loadLookerApiKey,
    save: saveLookerApiKey,
    clear: clearLookerApiKey,
  },
  {
    title: "Commit Summary",
    keyName: "COMMIT_API_KEY",
    description: "用于读取提交活跃度和最近提交记录。",
    load: loadCommitApiKey,
    save: saveCommitApiKey,
    clear: clearCommitApiKey,
  },
];

function ApiKeysSettingsPage() {
  return (
    <>
      <SettingsHeading
        eyebrow="Connections"
        title="API Keys"
        description="密钥只保存在当前设备，不会回显。输入新的值即可覆盖已有配置。"
      />
      <div className="space-y-4">
        {keyConfigs.map((config) => (
          <ApiKeyCard config={config} key={config.keyName} />
        ))}
      </div>
    </>
  );
}

function ApiKeyCard({ config }: { config: KeyConfig }) {
  const [draftKey, setDraftKey] = useState("");
  const [hasSavedKey, setHasSavedKey] = useState(false);
  const [notice, setNotice] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    let active = true;
    void config.load().then((key) => {
      if (active) setHasSavedKey(Boolean(key.trim()));
    });
    return () => {
      active = false;
    };
  }, [config]);

  async function handleSave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const key = draftKey.trim();
    if (!key) {
      setNotice(`请输入 ${config.keyName}。`);
      return;
    }
    setIsSaving(true);
    setNotice("");
    try {
      await config.save(key);
      setHasSavedKey(true);
      setDraftKey("");
      setNotice("已保存，密钥不会在页面中回显。");
    } catch {
      setNotice("保存失败，请重试。");
    } finally {
      setIsSaving(false);
    }
  }

  async function handleClear() {
    setIsSaving(true);
    setNotice("");
    try {
      await config.clear();
      setHasSavedKey(false);
      setDraftKey("");
      setNotice("已清除保存的密钥。");
    } catch {
      setNotice("清除失败，请重试。");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <section className="rounded-lg border border-border bg-card px-5 py-4">
      <div className="flex items-start gap-3">
        <div className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-md bg-accent text-muted-foreground">
          <KeyRound className="size-4" />
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="font-medium text-sm">{config.title}</h2>
          <p className="mt-1 text-muted-foreground text-xs leading-5">{config.description}</p>
          <form className="mt-4" onSubmit={handleSave}>
            <label className="font-mono text-[11px] text-muted-foreground" htmlFor={config.keyName}>
              {config.keyName}
            </label>
            <div className="mt-1.5 flex flex-wrap gap-2">
              <input
                autoComplete="off"
                className="h-9 min-w-0 flex-1 rounded-md border border-border bg-background px-3 font-mono text-xs outline-none transition focus:border-ring focus:ring-3 focus:ring-ring/30 sm:max-w-md"
                id={config.keyName}
                onChange={(event) => setDraftKey(event.target.value)}
                placeholder={hasSavedKey ? "已保存 ········（输入新值可覆盖）" : "输入 API Key"}
                type="password"
                value={draftKey}
              />
              <Button disabled={isSaving} size="sm" type="submit">
                <KeyRound className="size-3.5" />
                {isSaving ? "保存中…" : hasSavedKey ? "覆盖保存" : "保存"}
              </Button>
              {hasSavedKey ? (
                <Button
                  className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                  disabled={isSaving}
                  onClick={() => void handleClear()}
                  size="sm"
                  type="button"
                  variant="ghost"
                >
                  <Trash2 className="size-3.5" />
                  清除
                </Button>
              ) : null}
            </div>
            {notice ? <p className="mt-2 text-muted-foreground text-xs">{notice}</p> : null}
          </form>
        </div>
      </div>
    </section>
  );
}

export { ApiKeysSettingsPage, SettingsLayout, ThemeSettingsPage };
