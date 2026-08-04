import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";
import { RefreshCw, Server, SquareTerminal, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";

interface ViteProcess {
  pid: number;
  name: string;
  command: string;
  ports: number[];
}

function VitePortsPage() {
  const queryClient = useQueryClient();
  const processesQuery = useQuery({
    queryKey: ["vite-processes"],
    queryFn: () => invoke<ViteProcess[]>("list_vite_processes"),
    staleTime: 0,
  });
  const killMutation = useMutation({
    mutationFn: (pid: number) => invoke<void>("kill_vite_process", { pid }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["vite-processes"] }),
  });
  const processes = processesQuery.data ?? [];
  const isInitialLoading = processesQuery.isPending && !processesQuery.data;

  return (
    <div className="flex w-full flex-1 flex-col gap-6 px-6 pt-14 pb-10 sm:px-10">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="font-medium text-sm text-muted-foreground">VitePorts</p>
          <h1 className="mt-2 font-semibold text-3xl text-foreground tracking-normal">
            Vite 进程与端口
          </h1>
          <p className="mt-2 max-w-2xl text-muted-foreground text-sm leading-6">
            查看本机进程名或命令中包含 vite 的开发服务，并快速释放占用的端口。
          </p>
        </div>
        <Button
          disabled={processesQuery.isFetching}
          onClick={() => void processesQuery.refetch()}
          type="button"
          variant="ghost"
        >
          <RefreshCw className={`size-4 ${processesQuery.isFetching ? "animate-spin" : ""}`} />
          刷新
        </Button>
      </header>

      {processesQuery.isError ? (
        <section className="rounded-lg border border-destructive/40 bg-destructive/10 p-5">
          <p className="text-destructive text-sm">
            加载失败：{describeError(processesQuery.error)}
          </p>
        </section>
      ) : null}

      {isInitialLoading ? <ProcessTableSkeleton /> : null}

      {!isInitialLoading && !processesQuery.isError ? (
        <section className="overflow-hidden rounded-lg border border-border bg-muted/60">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[680px] text-left text-sm">
              <thead>
                <tr className="border-border border-b text-muted-foreground">
                  <th className="px-4 py-3 font-medium">进程</th>
                  <th className="px-4 py-3 font-medium">PID</th>
                  <th className="px-4 py-3 font-medium">监听端口</th>
                  <th className="px-4 py-3 text-right font-medium">操作</th>
                </tr>
              </thead>
              <tbody>
                {processes.map((process) => {
                  return (
                    <tr
                      className="border-border border-b last:border-b-0 hover:bg-muted/80"
                      key={process.pid}
                    >
                      <td className="max-w-[460px] px-4 py-3">
                        <div className="flex min-w-0 items-center gap-2">
                          <SquareTerminal className="size-4 shrink-0 text-muted-foreground" />
                          <span
                            className="break-all font-medium text-foreground leading-5"
                            title={process.command}
                          >
                            {process.name}
                          </span>
                        </div>
                        <p
                          className="mt-1 truncate font-mono text-muted-foreground text-xs"
                          title={process.command}
                        >
                          {process.command}
                        </p>
                      </td>
                      <td className="px-4 py-3 font-mono tabular-nums text-foreground">
                        {process.pid}
                      </td>
                      <td className="px-4 py-3">
                        {process.ports.length > 0 ? (
                          <div className="flex flex-wrap gap-1.5">
                            {process.ports.map((port) => (
                              <span
                                className="inline-flex items-center gap-1 rounded-md bg-background px-2 py-1 font-mono text-foreground text-xs"
                                key={port}
                              >
                                <Server className="size-3 text-muted-foreground" />
                                {port}
                              </span>
                            ))}
                          </div>
                        ) : (
                          <span className="text-muted-foreground">未发现监听端口</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <Button
                          className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                          disabled={killMutation.isPending}
                          onClick={() => killMutation.mutate(process.pid)}
                          type="button"
                          variant="ghost"
                        >
                          <Trash2 className="size-4" />
                          终止
                        </Button>
                      </td>
                    </tr>
                  );
                })}
                {processes.length === 0 ? (
                  <tr>
                    <td className="px-4 py-10 text-center text-muted-foreground" colSpan={4}>
                      当前没有发现 Vite 进程。
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      {killMutation.isError ? (
        <p className="text-destructive text-sm">终止失败：{describeError(killMutation.error)}</p>
      ) : null}
    </div>
  );
}

function ProcessTableSkeleton() {
  return (
    <section className="overflow-hidden rounded-lg border border-border bg-muted/60">
      <div className="animate-pulse divide-y divide-border">
        {["one", "two", "three"].map((row) => (
          <div
            className="grid grid-cols-[minmax(220px,2fr)_100px_minmax(180px,1fr)_100px] gap-4 px-4 py-4"
            key={row}
          >
            <div className="space-y-2">
              <div className="h-4 w-32 rounded bg-muted" />
              <div className="h-3 w-64 rounded bg-muted" />
            </div>
            <div className="h-4 w-12 rounded bg-muted" />
            <div className="h-6 w-20 rounded bg-muted" />
            <div className="ml-auto h-8 w-16 rounded bg-muted" />
          </div>
        ))}
      </div>
    </section>
  );
}

function describeError(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

export { VitePortsPage };
