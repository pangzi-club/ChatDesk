import { useMutation, useQuery } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";
import { CheckCircle2, Shield, ShieldOff, Terminal, XCircle } from "lucide-react";
import { useState } from "react";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";

type SandboxMode = "full" | "sandbox";
type DemoId = "write-inside" | "write-outside" | "network";

interface SandboxInfo {
  available: boolean;
  defaultCwd: string;
}

interface ShellCommandResult {
  code: number;
  out: string;
}

interface DemoCase {
  id: DemoId;
  label: string;
  command: string;
  expectExitZero: (mode: SandboxMode, networkGranted: boolean) => boolean;
  expectedHint: (mode: SandboxMode, networkGranted: boolean) => string;
  interpret: (mode: SandboxMode, networkGranted: boolean, exitOk: boolean) => string;
}

const DEMO_CASES: DemoCase[] = [
  {
    id: "write-inside",
    label: "① 工作区内写入",
    command: 'echo "ok from sandbox demo" > ./ok.txt && cat ./ok.txt',
    expectExitZero: () => true,
    expectedHint: () => "预期：成功（退出码 0，能读到 ok from sandbox demo）",
    interpret: (_mode, _network, exitOk) =>
      exitOk
        ? "工作区内写入未被拦截，符合预期。"
        : "工作区内写入失败了，不符合预期（沙箱本应允许写当前工作目录）。",
  },
  {
    id: "write-outside",
    label: "② 工作区外写入",
    command: 'echo "blocked" > "$HOME/m-dashboard-sandbox-blocked.txt"',
    expectExitZero: (mode) => mode === "full",
    expectedHint: (mode) =>
      mode === "sandbox"
        ? "预期：失败（退出码非 0，沙箱拦住写家目录）—— 失败才算演示成功"
        : "预期：成功（完全访问不限制写路径）",
    interpret: (mode, _network, exitOk) => {
      if (mode === "sandbox") {
        return exitOk
          ? "沙箱没有拦住工作区外写入，不符合预期。"
          : "沙箱正确拦住了工作区外写入，这就是沙箱在起作用。";
      }
      return exitOk ? "完全访问下可以写家目录，符合预期。" : "完全访问下写入失败了，不符合预期。";
    },
  },
  {
    id: "network",
    label: "③ 网络请求",
    command: "curl -sS -m 5 -o /dev/null -w 'HTTP %{http_code}\\n' https://example.com",
    expectExitZero: (mode, networkGranted) => mode === "full" || networkGranted,
    expectedHint: (mode, networkGranted) => {
      if (mode === "full") {
        return "预期：成功（完全访问允许网络）";
      }
      if (networkGranted) {
        return "预期：成功（你已同意网络权限）";
      }
      return "预期：失败（沙箱默认禁网）—— 失败才算演示成功；打开上方「网络权限」后再跑应成功";
    },
    interpret: (mode, networkGranted, exitOk) => {
      if (mode === "full") {
        return exitOk ? "完全访问下网络可用，符合预期。" : "完全访问下网络失败，不符合预期。";
      }
      if (networkGranted) {
        return exitOk
          ? "授权后网络可用，符合预期。"
          : "已授权但仍失败，不符合预期（也可能是本机网络问题）。";
      }
      return exitOk
        ? "未授权网络却成功了，不符合预期（沙箱应禁网）。"
        : "未授权时网络被拦住，符合预期。可打开「网络权限」后再跑一次对比。";
    },
  },
];

interface RunRecord {
  demoId: DemoId;
  mode: SandboxMode;
  networkGranted: boolean;
  result: ShellCommandResult;
  matched: boolean;
  summary: string;
  detail: string;
}

function SandboxPage() {
  const infoQuery = useQuery({
    queryKey: ["sandbox-info"],
    queryFn: () => invoke<SandboxInfo>("get_sandbox_info"),
  });

  const [mode, setMode] = useState<SandboxMode>("sandbox");
  const [selectedDemoId, setSelectedDemoId] = useState<DemoId>("write-inside");
  const [networkGranted, setNetworkGranted] = useState(false);
  const [networkDialogOpen, setNetworkDialogOpen] = useState(false);
  const [lastRun, setLastRun] = useState<RunRecord | null>(null);

  const runMutation = useMutation({
    mutationFn: (payload: {
      demo: DemoCase;
      mode: SandboxMode;
      networkGranted: boolean;
      cwd: string;
    }) =>
      invoke<ShellCommandResult>("run_shell_command", {
        command: payload.demo.command,
        cwd: payload.cwd || null,
        mode: payload.mode,
        permissions: {
          network: payload.mode === "sandbox" ? payload.networkGranted : true,
        },
      }).then((result) => ({ ...payload, result })),
    onSuccess: ({ demo, mode: runMode, networkGranted: runNetwork, result }) => {
      const exitOk = result.code === 0;
      const expectZero = demo.expectExitZero(runMode, runNetwork);
      const matched = exitOk === expectZero;
      setLastRun({
        demoId: demo.id,
        mode: runMode,
        networkGranted: runNetwork,
        result,
        matched,
        summary: matched ? "符合预期" : "不符合预期",
        detail: demo.interpret(runMode, runNetwork, exitOk),
      });
    },
  });

  const available = infoQuery.data?.available ?? false;
  const isInitialLoading = infoQuery.isPending && !infoQuery.data;
  const cwd = infoQuery.data?.defaultCwd ?? "";

  function handleModeChange(next: SandboxMode) {
    setMode(next);
    if (next === "full") {
      setNetworkGranted(false);
    }
    setLastRun(null);
  }

  function revokeNetworkAccess() {
    setNetworkGranted(false);
    setLastRun(null);
  }

  function confirmNetworkAccess() {
    setNetworkGranted(true);
    setNetworkDialogOpen(false);
    setLastRun(null);
  }

  function runDemo(demo: DemoCase) {
    if (!available || runMutation.isPending) return;
    setSelectedDemoId(demo.id);
    setLastRun(null);
    runMutation.mutate({
      demo,
      mode,
      networkGranted,
      cwd,
    });
  }

  return (
    <div className="flex w-full flex-1 flex-col gap-6 px-6 pt-14 pb-10 sm:px-10">
      <header>
        <p className="font-medium text-sm text-muted-foreground">Sandbox</p>
        <h1 className="mt-2 font-semibold text-3xl text-foreground tracking-normal">
          Seatbelt 沙箱示例
        </h1>
        <p className="mt-2 max-w-2xl text-muted-foreground text-sm leading-6">
          用三条固定演示对比「完全访问」和「沙箱」。看结果时不要只看退出码：有些场景
          <span className="text-foreground">失败才算演示成功</span>
          （说明沙箱拦住了危险操作）。
        </p>
      </header>

      {infoQuery.isError ? (
        <section className="rounded-lg border border-destructive/40 bg-destructive/10 p-5">
          <p className="text-destructive text-sm">加载失败：{describeError(infoQuery.error)}</p>
        </section>
      ) : null}

      {isInitialLoading ? <SandboxSkeleton /> : null}

      {!isInitialLoading && !infoQuery.isError ? (
        <>
          {!available ? (
            <section className="rounded-lg border border-border bg-muted/60 p-5">
              <p className="text-sm text-muted-foreground">
                Seatbelt 沙箱仅在 macOS 上可用（依赖 <code>/usr/bin/sandbox-exec</code>
                ）。当前平台无法运行沙箱演示。
              </p>
            </section>
          ) : null}

          <section className="rounded-lg border border-border bg-muted/60 p-5">
            <h2 className="font-semibold text-foreground">1. 选择运行模式</h2>
            <div className="mt-4 flex flex-wrap gap-2">
              <ModeButton
                active={mode === "sandbox"}
                disabled={!available}
                icon={Shield}
                label="沙箱（推荐先试）"
                onClick={() => handleModeChange("sandbox")}
              />
              <ModeButton
                active={mode === "full"}
                disabled={!available}
                icon={ShieldOff}
                label="完全访问"
                onClick={() => handleModeChange("full")}
              />
            </div>

            {mode === "sandbox" ? (
              <div className="mt-5 flex items-start justify-between gap-4 rounded-md border border-border bg-background px-4 py-3">
                <div>
                  <p className="font-medium text-sm">网络权限</p>
                  <p className="mt-1 text-muted-foreground text-xs leading-5">
                    {networkGranted
                      ? "已授权。再跑演示 ③ 应变为成功；可随时撤销。"
                      : "默认拒绝。点右侧按钮 → 在弹窗里点「允许」后才会生效。"}
                  </p>
                </div>
                {networkGranted ? (
                  <Button
                    disabled={!available}
                    onClick={revokeNetworkAccess}
                    type="button"
                    variant="outline"
                  >
                    撤销
                  </Button>
                ) : (
                  <Button
                    disabled={!available}
                    onClick={() => setNetworkDialogOpen(true)}
                    type="button"
                  >
                    请求网络权限
                  </Button>
                )}
              </div>
            ) : (
              <p className="mt-4 text-muted-foreground text-xs leading-5">
                完全访问：三条演示通常都会成功（无 Seatbelt 限制）。
              </p>
            )}
          </section>

          <section className="rounded-lg border border-border bg-muted/60 p-5">
            <h2 className="flex items-center gap-2 font-semibold text-foreground">
              <Terminal className="size-4" />
              2. 一键跑演示
            </h2>
            <p className="mt-2 text-muted-foreground text-sm leading-6">
              当前是
              <span className="text-foreground">{mode === "sandbox" ? "沙箱" : "完全访问"}</span>
              {mode === "sandbox" ? `，网络${networkGranted ? "已授权" : "未授权"}` : null}
              。点按钮会立刻执行，并告诉你是否符合预期。
            </p>

            <div className="mt-4 grid gap-3">
              {DEMO_CASES.map((demo) => {
                const active = selectedDemoId === demo.id;
                return (
                  <div
                    className={`rounded-md border bg-background p-4 ${
                      active ? "border-foreground/30" : "border-border"
                    }`}
                    key={demo.id}
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <p className="font-medium text-sm">{demo.label}</p>
                        <p className="mt-1 text-muted-foreground text-xs leading-5">
                          {demo.expectedHint(mode, networkGranted)}
                        </p>
                      </div>
                      <Button
                        disabled={!available || runMutation.isPending}
                        onClick={() => runDemo(demo)}
                        type="button"
                      >
                        {runMutation.isPending && selectedDemoId === demo.id
                          ? "运行中…"
                          : "运行这条"}
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>

            {runMutation.isError ? (
              <p className="mt-4 text-destructive text-sm">
                运行失败：{describeError(runMutation.error)}
              </p>
            ) : null}
          </section>

          {lastRun ? <ResultCard record={lastRun} /> : null}
        </>
      ) : null}

      <AlertDialog open={networkDialogOpen} onOpenChange={setNetworkDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>允许网络访问？</AlertDialogTitle>
            <AlertDialogDescription>
              沙箱默认禁止网络。点「允许」后，本会话再跑「③ 网络请求」应变为成功。你可以随时撤销。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>拒绝</AlertDialogCancel>
            <AlertDialogAction onClick={confirmNetworkAccess}>允许</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function ResultCard({ record }: { record: RunRecord }) {
  const Icon = record.matched ? CheckCircle2 : XCircle;
  const tone = record.matched
    ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
    : "border-destructive/40 bg-destructive/10 text-destructive";
  const demoLabel = DEMO_CASES.find((demo) => demo.id === record.demoId)?.label ?? record.demoId;

  return (
    <section className={`rounded-lg border p-5 ${tone}`}>
      <div className="flex items-start gap-3">
        <Icon className="mt-0.5 size-5 shrink-0" />
        <div className="min-w-0 flex-1">
          <h2 className="font-semibold text-base">{record.summary}</h2>
          <p className="mt-1 text-sm leading-6 opacity-90">{record.detail}</p>
          <p className="mt-3 text-xs opacity-80">
            退出码 {record.result.code}
            {` · ${demoLabel}`}
            {" · "}
            {record.mode === "sandbox" ? "沙箱" : "完全访问"}
            {record.mode === "sandbox"
              ? ` · 网络${record.networkGranted ? "已授权" : "未授权"}`
              : null}
          </p>
          <pre className="mt-3 max-h-64 overflow-auto rounded-md border border-border/60 bg-background/80 p-3 font-mono text-foreground text-sm whitespace-pre-wrap">
            {record.result.out || "(无输出)"}
          </pre>
        </div>
      </div>
    </section>
  );
}

function ModeButton({
  active,
  disabled,
  icon: Icon,
  label,
  onClick,
}: {
  active: boolean;
  disabled?: boolean;
  icon: typeof Shield;
  label: string;
  onClick: () => void;
}) {
  return (
    <Button
      disabled={disabled}
      onClick={onClick}
      type="button"
      variant={active ? "default" : "outline"}
    >
      <Icon className="size-4" />
      {label}
    </Button>
  );
}

function SandboxSkeleton() {
  return (
    <div className="animate-pulse space-y-4">
      <div className="h-32 rounded-lg border border-border bg-muted/60" />
      <div className="h-48 rounded-lg border border-border bg-muted/60" />
    </div>
  );
}

function describeError(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

export { SandboxPage };
