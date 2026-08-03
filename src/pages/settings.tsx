import { KeyRound, Trash2 } from "lucide-react";
import { type FormEvent, useEffect, useState } from "react";

import { type Theme, useTheme } from "@/components/theme-provider";
import { Button } from "@/components/ui/button";
import { clearDataerApiKey, loadDataerApiKey, saveDataerApiKey } from "@/lib/dataer";

const themes: Theme[] = ["light", "dark", "system"];

function SettingsPage() {
  const { theme, setTheme } = useTheme();

  return (
    <div className="flex w-full flex-1 flex-col gap-6 px-6 pt-14 pb-10 sm:px-10">
      <header>
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
      <ApiKeySection />
    </div>
  );
}

function ApiKeySection() {
  const [draftKey, setDraftKey] = useState("");
  const [hasSavedKey, setHasSavedKey] = useState(false);
  const [notice, setNotice] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    let isActive = true;

    void loadDataerApiKey().then((savedKey) => {
      if (isActive) {
        setHasSavedKey(savedKey.trim().length > 0);
      }
    });

    return () => {
      isActive = false;
    };
  }, []);

  async function handleSave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const apiKey = draftKey.trim();
    if (!apiKey) {
      setNotice("请输入 DATAER_API_KEY。");
      return;
    }

    setIsSaving(true);
    setNotice("");
    try {
      await saveDataerApiKey(apiKey);
      setHasSavedKey(true);
      setDraftKey("");
      setNotice("已保存。密钥仅本地存储，不再回显。");
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
      await clearDataerApiKey();
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
    <section className="rounded-lg border border-border bg-muted/60 p-5">
      <h2 className="flex items-center gap-2 font-semibold text-foreground">
        <KeyRound className="size-4" />
        Tan Dataer
      </h2>
      <p className="mt-2 max-w-2xl text-muted-foreground text-sm leading-6">
        配置 tandataer.com 的 API Key 后，流量分析页面才能获取数据。
        密钥仅保存在本机，保存后不再显示，只能重新输入覆盖。
      </p>

      <form className="mt-4 flex flex-col gap-3" onSubmit={handleSave}>
        <div>
          <label
            className="block font-medium text-muted-foreground text-sm"
            htmlFor="dataer-api-key"
          >
            DATAER_API_KEY
          </label>
          <div className="mt-1.5 flex flex-wrap items-center gap-2">
            <input
              autoComplete="off"
              className="h-9 w-full max-w-sm rounded-md border border-border bg-background px-3 font-mono text-sm outline-none transition focus:border-ring focus:ring-3 focus:ring-ring/30"
              id="dataer-api-key"
              onChange={(event) => setDraftKey(event.target.value)}
              placeholder={hasSavedKey ? "已保存 ········（输入新值可覆盖）" : "输入 API Key"}
              type="password"
              value={draftKey}
            />
            <Button disabled={isSaving} type="submit">
              <KeyRound className="size-4" />
              {isSaving ? "保存中…" : hasSavedKey ? "覆盖保存" : "保存"}
            </Button>
            {hasSavedKey ? (
              <Button
                className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                disabled={isSaving}
                onClick={() => void handleClear()}
                type="button"
                variant="ghost"
              >
                <Trash2 className="size-4" />
                清除
              </Button>
            ) : null}
          </div>
        </div>

        {notice ? <p className="text-muted-foreground text-sm">{notice}</p> : null}
      </form>
    </section>
  );
}

export { SettingsPage };
