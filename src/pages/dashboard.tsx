import {
  Bug,
  FolderClosed,
  GitBranch,
  HardDrive,
  Plus,
  RotateCcw,
  Send,
  ShieldCheck,
  Sparkles,
  Wrench,
} from "lucide-react";

import { Button } from "@/components/ui/button";

const suggestionCards = [
  { label: "探索并理解代码", icon: Sparkles, color: "text-blue-500" },
  { label: "构建新功能、应用或工具", icon: Wrench, color: "text-violet-500" },
  { label: "审查代码并提出修改建议", icon: RotateCcw, color: "text-emerald-500" },
  { label: "修复问题和失败", icon: Bug, color: "text-orange-500" },
];

function DashboardPage() {
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-4 py-8 sm:px-10">
      <div className="flex flex-1 items-center justify-center pt-10 pb-8">
        <div className="w-full max-w-4xl text-center max-sm:max-w-[calc(100vw-6rem)]">
          <div className="mx-auto mb-8 flex size-14 items-center justify-center rounded-full border-2 border-zinc-300 text-zinc-400">
            <Sparkles className="size-7" />
          </div>
          <h1 className="font-semibold text-[22px] text-zinc-900 leading-tight tracking-normal sm:text-3xl md:text-4xl">
            <span className="block sm:inline">要在 m-dashboard</span>
            <span className="block sm:inline"> 内开发什么？</span>
          </h1>

          <div className="mt-9 grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-4">
            {suggestionCards.map((card) => {
              const Icon = card.icon;

              return (
                <button
                  className="group flex min-h-28 min-w-0 flex-col items-start justify-between rounded-lg border border-zinc-200 bg-white p-4 text-left shadow-sm transition hover:-translate-y-0.5 hover:border-zinc-300 hover:shadow-md sm:p-5"
                  key={card.label}
                  type="button"
                >
                  <Icon className={`size-5 ${card.color}`} />
                  <span className="font-semibold text-zinc-700 text-sm leading-6 group-hover:text-zinc-950">
                    {card.label}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      <PromptComposer />
    </div>
  );
}

function PromptComposer() {
  return (
    <div className="mx-auto w-full max-w-4xl">
      <div className="mx-2 flex h-12 items-center gap-4 overflow-x-auto rounded-t-2xl bg-zinc-100 px-4 text-sm text-zinc-600 sm:mx-6 sm:gap-7 sm:px-5">
        <span className="flex items-center gap-2">
          <FolderClosed className="size-4" />
          m-dashboard
        </span>
        <span className="flex items-center gap-2">
          <HardDrive className="size-4" />
          本地
        </span>
        <span className="flex items-center gap-2">
          <GitBranch className="size-4" />
          main
        </span>
      </div>
      <form
        className="-mt-1 rounded-2xl border border-zinc-200 bg-white p-3 shadow-lg shadow-zinc-200/60 sm:p-4"
        onSubmit={(event) => event.preventDefault()}
      >
        <label className="sr-only" htmlFor="prompt">
          输入任务
        </label>
        <textarea
          className="h-16 w-full resize-none bg-transparent text-sm outline-none placeholder:text-zinc-300"
          id="prompt"
          placeholder="随心输入"
        />
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-sm text-zinc-500 sm:gap-3">
            <Button
              aria-label="Add context"
              className="size-8"
              size="icon"
              type="button"
              variant="ghost"
            >
              <Plus className="size-5" />
            </Button>
            <button
              className="flex items-center gap-2 rounded-md px-2 py-1 hover:bg-zinc-100"
              type="button"
            >
              <ShieldCheck className="size-4" />
              替我审批
            </button>
          </div>
          <div className="flex items-center gap-3 text-zinc-400 text-sm">
            <span>5.5 高</span>
            <Button
              aria-label="Send"
              className="size-10 rounded-full bg-zinc-400 hover:bg-zinc-500"
              size="icon"
            >
              <Send className="size-4 text-white" />
            </Button>
          </div>
        </div>
      </form>
    </div>
  );
}

export { DashboardPage };
