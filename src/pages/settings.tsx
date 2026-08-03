import { BarChart3, CheckCircle2, ShieldCheck, SlidersHorizontal } from "lucide-react";
import type { ComponentType } from "react";

function SettingsPage() {
  return (
    <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col px-6 py-20 sm:px-10">
      <header className="mb-8">
        <p className="font-medium text-sm text-zinc-500">Settings</p>
        <h1 className="mt-2 font-semibold text-3xl text-zinc-950 tracking-normal">工作区设置</h1>
      </header>

      <div className="grid gap-4 lg:grid-cols-[1fr_1fr]">
        <SettingsPanel
          description="管理当前工作区、运行环境和默认分支信息。"
          icon={SlidersHorizontal}
          title="Workspace"
        />
        <SettingsPanel
          description="查看自动审批、通知和本地执行偏好。"
          icon={CheckCircle2}
          title="Preferences"
        />
        <SettingsPanel
          description="保留最近任务和关键指标，方便从侧栏快速回到上下文。"
          icon={BarChart3}
          title="Activity"
        />
        <SettingsPanel
          description="配置失败重试、代码审查和修复建议的默认行为。"
          icon={ShieldCheck}
          title="Review"
        />
      </div>
    </div>
  );
}

function SettingsPanel({
  description,
  icon: Icon,
  title,
}: {
  description: string;
  icon: ComponentType<{ className?: string }>;
  title: string;
}) {
  return (
    <section className="rounded-lg border border-zinc-200 bg-zinc-50/60 p-5">
      <div className="mb-4 flex size-10 items-center justify-center rounded-md bg-white text-zinc-600 shadow-xs ring-1 ring-zinc-200">
        <Icon className="size-5" />
      </div>
      <h2 className="font-semibold text-zinc-900">{title}</h2>
      <p className="mt-2 text-sm text-zinc-500 leading-6">{description}</p>
    </section>
  );
}

export { SettingsPage };
