import {
  ArrowLeft,
  Check,
  ExternalLink,
  Eye,
  EyeOff,
  KeyRound,
  Package,
  Palette,
  Pencil,
  Plus,
  Search,
  Trash2,
  X,
} from "lucide-react";
import { type FormEvent, useEffect, useState } from "react";
import { NavLink, Outlet, useNavigate } from "react-router-dom";

import { type Theme, useTheme } from "@/components/theme-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { clearCommitApiKey, loadCommitApiKey, saveCommitApiKey } from "@/lib/commit";
import { clearDataerApiKey, loadDataerApiKey, saveDataerApiKey } from "@/lib/dataer";
import { clearLookerApiKey, loadLookerApiKey, saveLookerApiKey } from "@/lib/looker";
import { loadModels, type ModelConfig, saveModels } from "@/lib/models";

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
          <SettingsNavItem to="/settings/models" icon={Package} label="模型" />
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
              <Input
                autoComplete="off"
                className="h-9 min-w-0 flex-1 font-mono text-xs sm:max-w-md"
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

const emptyModel: Omit<ModelConfig, "id"> = {
  name: "",
  provider: "自定义 / Custom",
  baseUrl: "",
  apiKey: "",
  supportsTools: true,
  supportsImages: false,
  supportsReasoning: false,
  customProtocol: false,
  inputContext: undefined,
  outputContext: undefined,
  isDefault: false,
};

const providerPresets = {
  custom: {
    label: "自定义 / Custom",
    baseUrl: "",
    models: [],
  },
  deepseek: {
    label: "深度求索 / DeepSeek",
    baseUrl: "https://api.deepseek.com/v1/chat/completions",
    models: [
      {
        name: "DeepSeek-V4 Flash",
        supportsTools: true,
        supportsImages: false,
        supportsReasoning: false,
        inputContext: 128_000,
        outputContext: 8_000,
      },
      {
        name: "DeepSeek-V4 Pro",
        supportsTools: true,
        supportsImages: false,
        supportsReasoning: true,
        inputContext: 128_000,
        outputContext: 64_000,
      },
      {
        name: "deepseek-chat",
        supportsTools: true,
        supportsImages: false,
        supportsReasoning: false,
        inputContext: 64_000,
        outputContext: 8_000,
      },
      {
        name: "deepseek-reasoner",
        supportsTools: false,
        supportsImages: false,
        supportsReasoning: true,
        inputContext: 64_000,
        outputContext: 64_000,
      },
    ],
  },
} as const;

type ProviderKey = keyof typeof providerPresets;

function ModelsSettingsPage() {
  const [models, setModels] = useState<ModelConfig[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [notice, setNotice] = useState("");
  const [editing, setEditing] = useState<ModelConfig | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);

  useEffect(() => {
    let active = true;
    void loadModels()
      .then((stored) => {
        if (active) setModels(stored);
      })
      .catch(() => {
        if (active) setNotice("读取模型配置失败，请重试。");
      })
      .finally(() => {
        if (active) setIsLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  function openCreate() {
    setNotice("");
    setEditing({ ...emptyModel, id: crypto.randomUUID() });
    setIsModalOpen(true);
  }

  function openEdit(model: ModelConfig) {
    setNotice("");
    setEditing({ ...model });
    setIsModalOpen(true);
  }

  async function handleSave(model: ModelConfig) {
    const nextModels = models.some((item) => item.id === model.id)
      ? models.map((item) => (item.id === model.id ? model : item))
      : [...models, model];
    const normalized = model.isDefault
      ? nextModels.map((item) => ({ ...item, isDefault: item.id === model.id }))
      : nextModels;
    await saveModels(normalized);
    setModels(normalized);
    setIsModalOpen(false);
    setEditing(null);
  }

  async function handleDelete(model: ModelConfig) {
    if (!window.confirm(`确定删除模型“${model.name}”吗？`)) return;
    const remaining = models.filter((item) => item.id !== model.id);
    if (model.isDefault && remaining.length > 0)
      remaining[0] = { ...remaining[0], isDefault: true };
    try {
      await saveModels(remaining);
      setModels(remaining);
    } catch {
      setNotice("删除失败，请重试。");
    }
  }

  async function handleSetDefault(model: ModelConfig) {
    const nextModels = models.map((item) => ({ ...item, isDefault: item.id === model.id }));
    try {
      await saveModels(nextModels);
      setModels(nextModels);
    } catch {
      setNotice("设置默认模型失败，请重试。");
    }
  }

  return (
    <>
      <SettingsHeading
        eyebrow="Models"
        title="模型"
        description="管理可用的 OpenAI 兼容模型配置，密钥仅保存在当前设备。"
      />
      <section className="rounded-lg border border-border bg-card">
        <div className="flex items-center justify-between gap-4 border-border border-b px-5 py-4">
          <div>
            <h2 className="font-medium text-sm">自定义模型</h2>
            <p className="mt-1 text-muted-foreground text-xs">
              支持 OpenAI Chat Completions 兼容接口。
            </p>
          </div>
          <Button onClick={openCreate} size="sm" type="button">
            <Plus className="size-3.5" /> 添加模型
          </Button>
        </div>
        {notice ? <p className="px-5 pt-4 text-destructive text-xs">{notice}</p> : null}
        {isLoading ? (
          <div className="space-y-3 p-5">
            <div className="h-16 animate-pulse rounded-md bg-accent" />
            <div className="h-16 animate-pulse rounded-md bg-accent" />
          </div>
        ) : models.length === 0 ? (
          <div className="px-5 py-14 text-center">
            <Package className="mx-auto size-8 text-muted-foreground" />
            <p className="mt-3 font-medium text-sm">还没有模型配置</p>
            <p className="mt-1 text-muted-foreground text-xs">添加一个 OpenAI 兼容模型开始使用。</p>
          </div>
        ) : (
          <div className="space-y-3 p-5">
            {models.map((model) => (
              <div
                className="flex items-center gap-3 rounded-md border border-border bg-background px-4 py-3"
                key={model.id}
              >
                <div className="flex size-8 shrink-0 items-center justify-center rounded-md bg-accent text-muted-foreground">
                  <Package className="size-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="truncate font-medium text-sm">{model.name}</h3>
                    {model.isDefault ? (
                      <Badge className="px-2 py-0.5 text-[10px]">默认</Badge>
                    ) : null}
                  </div>
                  <p className="mt-1 truncate text-muted-foreground text-xs">
                    {model.provider} · {model.baseUrl}
                  </p>
                </div>
                {!model.isDefault ? (
                  <Button
                    aria-label={`设为 ${model.name} 的默认模型`}
                    onClick={() => void handleSetDefault(model)}
                    size="icon"
                    type="button"
                    variant="ghost"
                  >
                    <Check className="size-4" />
                  </Button>
                ) : null}
                <Button
                  aria-label={`编辑 ${model.name}`}
                  onClick={() => openEdit(model)}
                  size="icon"
                  type="button"
                  variant="ghost"
                >
                  <Pencil className="size-4" />
                </Button>
                <Button
                  aria-label={`删除 ${model.name}`}
                  className="text-destructive hover:text-destructive"
                  onClick={() => void handleDelete(model)}
                  size="icon"
                  type="button"
                  variant="ghost"
                >
                  <Trash2 className="size-4" />
                </Button>
              </div>
            ))}
          </div>
        )}
      </section>
      {isModalOpen && editing ? (
        <ModelDialog
          initialModel={editing}
          onClose={() => {
            setIsModalOpen(false);
            setEditing(null);
          }}
          onSave={handleSave}
        />
      ) : null}
    </>
  );
}

function ModelDialog({
  initialModel,
  onClose,
  onSave,
}: {
  initialModel: ModelConfig;
  onClose: () => void;
  onSave: (model: ModelConfig) => Promise<void>;
}) {
  const [model, setModel] = useState(initialModel);
  const [showKey, setShowKey] = useState(false);
  const [error, setError] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const providerKey: ProviderKey =
    model.provider === providerPresets.deepseek.label ? "deepseek" : "custom";
  const update = <K extends keyof ModelConfig>(key: K, value: ModelConfig[K]) =>
    setModel((current) => ({ ...current, [key]: value }));

  function handleProviderChange(nextProvider: ProviderKey) {
    const preset = providerPresets[nextProvider];
    const firstModel = preset.models[0];
    setModel((current) => ({
      ...current,
      provider: preset.label,
      baseUrl: nextProvider === "deepseek" ? preset.baseUrl : "",
      ...(nextProvider === "deepseek" && firstModel
        ? {
            name: firstModel.name,
            supportsTools: firstModel.supportsTools,
            supportsImages: firstModel.supportsImages,
            supportsReasoning: firstModel.supportsReasoning,
            customProtocol: false,
            inputContext: firstModel.inputContext,
            outputContext: firstModel.outputContext,
          }
        : {}),
    }));
  }

  function handleDeepSeekModelChange(name: string) {
    const preset = providerPresets.deepseek.models.find((item) => item.name === name);
    if (!preset) return;
    setModel((current) => ({
      ...current,
      name: preset.name,
      baseUrl: providerPresets.deepseek.baseUrl,
      supportsTools: preset.supportsTools,
      supportsImages: preset.supportsImages,
      supportsReasoning: preset.supportsReasoning,
      customProtocol: false,
      inputContext: preset.inputContext,
      outputContext: preset.outputContext,
    }));
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = model.name.trim();
    const baseUrl = model.baseUrl.trim();
    const apiKey = model.apiKey.trim();
    if (!name || !baseUrl || !apiKey) {
      setError("请填写模型名称、接口地址和 API Key。");
      return;
    }
    try {
      const url = new URL(baseUrl);
      if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error();
    } catch {
      setError("接口地址必须是合法的 http 或 https URL。");
      return;
    }
    if (
      (model.inputContext !== undefined &&
        (!Number.isInteger(model.inputContext) || model.inputContext <= 0)) ||
      (model.outputContext !== undefined &&
        (!Number.isInteger(model.outputContext) || model.outputContext <= 0))
    ) {
      setError("输入和输出上限必须是正整数。");
      return;
    }
    setIsSaving(true);
    setError("");
    try {
      await onSave({ ...model, name, baseUrl, apiKey });
    } catch {
      setError("保存失败，请重试。");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <form
        className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-lg border border-border bg-card shadow-xl"
        onSubmit={submit}
      >
        <div className="flex items-center justify-between border-border border-b px-6 py-4">
          <div className="flex items-center gap-3">
            <h2 className="font-semibold text-lg">{initialModel.name ? "编辑模型" : "添加模型"}</h2>
            <span className="rounded-full border border-border px-2 py-0.5 text-muted-foreground text-xs">
              仅支持 OpenAI 兼容协议
            </span>
          </div>
          <Button aria-label="关闭" onClick={onClose} size="icon" type="button" variant="ghost">
            <X className="size-4" />
          </Button>
        </div>
        <div className="space-y-5 px-6 py-5">
          <div className="flex items-end gap-3">
            <div className="block min-w-0 flex-1 text-sm">
              <span className="font-medium">提供商</span>
              <Select
                value={providerKey}
                onValueChange={(value) => handleProviderChange(value as ProviderKey)}
              >
                <SelectTrigger className="mt-2 h-10 w-full bg-background">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(providerPresets) as ProviderKey[]).map((key) => (
                    <SelectItem key={key} value={key}>
                      {providerPresets[key].label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {providerKey === "deepseek" ? (
              <a
                className="mb-2 inline-flex shrink-0 items-center gap-1 text-sm text-sky-500 hover:text-sky-400"
                href="https://platform.deepseek.com/api-docs"
                onClick={(event) => {
                  event.preventDefault();
                  window.open(
                    "https://platform.deepseek.com/api-docs",
                    "_blank",
                    "noopener,noreferrer",
                  );
                }}
                rel="noreferrer"
                target="_blank"
              >
                查看文档 <ExternalLink className="size-3.5" />
              </a>
            ) : null}
          </div>
          {providerKey === "custom" ? (
            <div className="block text-sm">
              <label className="font-medium" htmlFor="model-base-url">
                接口地址
              </label>
              <Input
                className="mt-2 h-10 bg-background"
                id="model-base-url"
                onChange={(event) => update("baseUrl", event.target.value)}
                placeholder="https://api.example.com/v1/chat/completions"
                value={model.baseUrl}
              />
            </div>
          ) : null}
          <div className="block text-sm">
            <label className="font-medium" htmlFor="model-api-key">
              API Key
            </label>
            <div className="relative mt-2">
              <Input
                className="h-10 bg-background pr-10"
                id="model-api-key"
                onChange={(event) => update("apiKey", event.target.value)}
                placeholder="输入你的 API Key"
                type={showKey ? "text" : "password"}
                value={model.apiKey}
              />
              <button
                aria-label={showKey ? "隐藏 API Key" : "显示 API Key"}
                className="absolute top-1/2 right-3 -translate-y-1/2 text-muted-foreground"
                onClick={() => setShowKey((visible) => !visible)}
                type="button"
              >
                {showKey ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
              </button>
            </div>
          </div>
          <div className="block text-sm">
            <label className="font-medium" htmlFor="model-name">
              模型名称
            </label>
            {providerKey === "deepseek" ? (
              <Select value={model.name} onValueChange={handleDeepSeekModelChange}>
                <SelectTrigger className="mt-2 h-10 w-full bg-background" id="model-name">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {providerPresets.deepseek.models.map((preset) => (
                    <SelectItem key={preset.name} value={preset.name}>
                      {preset.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <Input
                className="mt-2 h-10 bg-background"
                id="model-name"
                onChange={(event) => update("name", event.target.value)}
                placeholder="例如 gpt-4o 或 openai/gpt-4o"
                value={model.name}
              />
            )}
          </div>
          {providerKey === "custom" ? (
            <fieldset>
              <legend className="font-medium text-sm">高级配置</legend>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <Toggle
                  label="工具调用"
                  checked={model.supportsTools}
                  onChange={(value) => update("supportsTools", value)}
                />
                <Toggle
                  label="图片输入"
                  checked={model.supportsImages}
                  onChange={(value) => update("supportsImages", value)}
                />
                <Toggle
                  label="思考模式"
                  checked={model.supportsReasoning}
                  onChange={(value) => update("supportsReasoning", value)}
                />
                <Toggle
                  label="自定义协议"
                  checked={model.customProtocol}
                  onChange={(value) => update("customProtocol", value)}
                />
              </div>
            </fieldset>
          ) : null}
          {providerKey === "custom" ? (
            <div className="grid gap-4 sm:grid-cols-2">
              <NumberField
                label="输入上限"
                presets={[
                  { label: "32K", value: 32_000 },
                  { label: "64K", value: 64_000 },
                  { label: "128K", value: 128_000 },
                  { label: "256K", value: 256_000 },
                ]}
                value={model.inputContext}
                onChange={(value) => update("inputContext", value)}
              />
              <NumberField
                label="输出上限"
                presets={[
                  { label: "8K", value: 8_000 },
                  { label: "16K", value: 16_000 },
                  { label: "32K", value: 32_000 },
                  { label: "64K", value: 64_000 },
                ]}
                value={model.outputContext}
                onChange={(value) => update("outputContext", value)}
              />
            </div>
          ) : null}
          {error ? <p className="text-destructive text-xs">{error}</p> : null}
        </div>
        <div className="flex justify-end gap-2 border-border border-t px-6 py-4">
          <Button onClick={onClose} type="button" variant="outline">
            取消
          </Button>
          <Button disabled={isSaving} type="submit">
            {isSaving ? "保存中…" : "保存"}
          </Button>
        </div>
      </form>
    </div>
  );
}

function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  const inputId = `model-toggle-${label}`;

  return (
    <div className="flex items-center gap-2 text-sm">
      <Checkbox
        checked={checked}
        id={inputId}
        onCheckedChange={(value) => onChange(value === true)}
      />
      <label htmlFor={inputId}>{label}</label>
    </div>
  );
}

function NumberField({
  label,
  presets,
  value,
  onChange,
}: {
  label: string;
  presets: Array<{ label: string; value: number }>;
  value?: number;
  onChange: (value?: number) => void;
}) {
  return (
    <div className="block text-sm">
      <label className="font-medium" htmlFor={`model-${label}`}>
        {label}
      </label>
      <Input
        className="mt-2 h-10 bg-background"
        id={`model-${label}`}
        min="1"
        onChange={(event) => onChange(event.target.value ? Number(event.target.value) : undefined)}
        placeholder="使用提供商默认值"
        type="number"
        value={value ?? ""}
      />
      <div className="mt-2 flex flex-wrap gap-1.5">
        {presets.map((preset) => (
          <button
            aria-label={`设置${label}为 ${preset.label}`}
            className={`rounded-md px-2.5 py-1 text-xs transition-colors ${value === preset.value ? "bg-accent text-accent-foreground" : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"}`}
            key={preset.value}
            onClick={() => onChange(preset.value)}
            type="button"
          >
            {preset.label}
          </button>
        ))}
      </div>
    </div>
  );
}

export { ApiKeysSettingsPage, ModelsSettingsPage, SettingsLayout, ThemeSettingsPage };
