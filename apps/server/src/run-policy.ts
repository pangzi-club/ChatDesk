import { createHash } from "node:crypto";
import path from "node:path";
import type { ChatPlanMode, ChatRunOutcome, ChatRunPhase, ChatRunStopReason } from "./protocol.ts";
import { MAX_AGENT_STEPS } from "./protocol.ts";

export const PLAN_WARNING_STEP = 90;
export const PLAN_FINALIZATION_STEP = 99;
export const PLAN_MAX_STEPS = 100;
export const READ_ONLY_LOOP_LIMIT = 3;

const READ_ONLY_TOOLS = new Set(["list_dir", "search_files", "read_file"]);

export type RunPolicyDecision = {
  phase: ChatRunPhase;
  instructions?: string;
  activeTools?: string[];
  toolChoice?: "auto" | "none" | "required";
};

export function decideRunStep(options: {
  planMode: ChatPlanMode;
  stepNumber: number;
  planWritten: boolean;
  requiredToolChoiceSupported?: boolean;
  forcedStopReason?: ChatRunStopReason;
}): RunPolicyDecision {
  const step = options.stepNumber + 1;
  const requiredToolChoice = options.requiredToolChoiceSupported === false ? "auto" : "required";
  if (options.forcedStopReason) {
    if (options.planMode === "plan" && !options.planWritten) {
      return {
        phase: "finalizing",
        instructions:
          "检测到重复调研。不得继续读取或搜索；现在只能调用 plan_write 写入完整计划，或调用 request_user_input 提交必须由用户回答的阻塞问题。",
        activeTools: ["plan_write", "request_user_input"],
        toolChoice: requiredToolChoice,
      };
    }
    return {
      phase: "finalizing",
      instructions:
        "运行已进入受控收尾。不得再调用工具；请简洁说明已完成内容、未完成内容和阻塞原因。",
      activeTools: [],
      toolChoice: "none",
    };
  }
  if (options.planMode !== "plan" && step >= MAX_AGENT_STEPS) {
    return {
      phase: "finalizing",
      instructions:
        "已达到运行步数上限。不得再调用工具；请简洁交接已完成内容、验证结果、未完成内容和阻塞原因。",
      activeTools: [],
      toolChoice: "none",
    };
  }
  if (options.planMode === "plan") {
    if (options.planWritten) {
      return {
        phase: "finalizing",
        instructions: "计划已写入。不得再调用工具；请向用户简洁说明计划已完成。",
        activeTools: [],
        toolChoice: "none",
      };
    }
    if (step >= PLAN_MAX_STEPS) {
      return {
        phase: "finalizing",
        instructions:
          "计划尚未写入且已达到最终步骤。必须立即调用 plan_write 写入完整计划，或调用 request_user_input 提交必须由用户回答的阻塞问题；不得输出普通文本问题。",
        activeTools: ["plan_write", "request_user_input"],
        toolChoice: requiredToolChoice,
      };
    }
    if (step >= PLAN_FINALIZATION_STEP) {
      return {
        phase: "finalizing",
        instructions:
          "已达到计划调研预算。不得继续读取或搜索；现在只能调用 plan_write 写入完整计划，或调用 request_user_input 提交必须由用户回答的阻塞问题。",
        activeTools: ["plan_write", "request_user_input"],
        toolChoice: requiredToolChoice,
      };
    }
    if (step === PLAN_WARNING_STEP) {
      return {
        phase: "working",
        instructions:
          "计划调研接近上限。只检查尚未确认且会改变实现方案的事实；准备调用 plan_write，或提出阻塞问题。",
        toolChoice: requiredToolChoice,
      };
    }
  }
  return {
    phase: "working",
    ...(options.planMode === "plan" ? { toolChoice: requiredToolChoice } : {}),
  };
}

export function evaluateRunCompletion(options: {
  planMode: ChatPlanMode;
  planWritten: boolean;
  userInputRequested?: boolean;
  finalText: string;
  finishReason?: string;
  terminalObserved: boolean;
  aborted: boolean;
  forcedStopReason?: ChatRunStopReason;
}): { outcome: ChatRunOutcome; stopReason?: ChatRunStopReason } {
  if (options.aborted) return { outcome: "stopped", stopReason: "user" };
  if (options.planMode === "plan" && options.userInputRequested) {
    return { outcome: "awaiting-user" };
  }
  if (!options.terminalObserved || !options.finalText.trim()) {
    return { outcome: "error", stopReason: options.forcedStopReason ?? "incomplete-response" };
  }
  if (options.finishReason && options.finishReason !== "stop") {
    return {
      outcome: "error",
      stopReason:
        options.forcedStopReason ??
        (options.finishReason === "length" ? "context-limit" : "incomplete-response"),
    };
  }
  if (options.forcedStopReason) {
    return { outcome: "error", stopReason: options.forcedStopReason };
  }
  if (options.planMode === "plan" && !options.planWritten) {
    return { outcome: "error", stopReason: "incomplete-response" };
  }
  return { outcome: "completed" };
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, stableValue(item)]),
  );
}

function normalizedPath(value: unknown, fallback: string) {
  if (typeof value !== "string" || !value.trim()) return fallback;
  const normalized = path.normalize(value.trim()).split(path.sep).join("/").replace(/^\.\//, "");
  return normalized || fallback;
}

function normalizeToolInput(toolName: string, input: unknown) {
  const value = input && typeof input === "object" ? (input as Record<string, unknown>) : {};
  if (toolName === "list_dir") return { path: normalizedPath(value.path, ".") };
  if (toolName === "read_file") {
    return {
      path: normalizedPath(value.path, "."),
      startLine: value.startLine ?? 1,
      endLine: value.endLine ?? null,
    };
  }
  if (toolName === "search_files") {
    return {
      path: normalizedPath(value.path, "."),
      pattern: typeof value.pattern === "string" ? value.pattern.trim() : "",
      query: typeof value.query === "string" ? value.query.trim() : "",
      maxResults: value.maxResults ?? 100,
    };
  }
  return input;
}

export function stableDigest(value: unknown) {
  return createHash("sha256")
    .update(JSON.stringify(stableValue(value)))
    .digest("hex");
}

export function toolFingerprint(toolName: string, input: unknown) {
  return `${toolName}:${stableDigest(normalizeToolInput(toolName, input))}`;
}

export type DuplicateToolReceipt = {
  duplicate: true;
  duplicateOf: string;
  resultDigest: string;
  message: string;
};

export class ReadOnlyToolResultDeduplicator {
  private readonly observations = new Map<
    string,
    { digest: string; toolCallId: string; output: unknown }
  >();

  compact(toolName: string, input: unknown, output: unknown, toolCallId: string) {
    if (!READ_ONLY_TOOLS.has(toolName)) return output;
    const fingerprint = toolFingerprint(toolName, input);
    const digest = stableDigest(output);
    const previous = this.observations.get(fingerprint);
    if (previous?.digest === digest) {
      return {
        duplicate: true,
        duplicateOf: previous.toolCallId,
        resultDigest: digest,
        message: "结果与先前调用相同；请复用已有信息，不要再次执行相同查询。",
      } satisfies DuplicateToolReceipt;
    }
    this.observations.set(fingerprint, { digest, toolCallId, output });
    return output;
  }
}

export class ReadOnlyToolLoopTracker {
  private readonly observations = new Map<string, { digest: string; count: number }>();
  private consecutiveDuplicateSteps = 0;
  duplicateToolCallCount = 0;

  recordStep(calls: Array<{ toolName: string; input: unknown; output: unknown }>): {
    loopDetected: boolean;
    duplicateCount: number;
  } {
    let readOnlyCount = 0;
    let duplicateCount = 0;
    for (const call of calls) {
      if (!READ_ONLY_TOOLS.has(call.toolName)) continue;
      readOnlyCount += 1;
      const fingerprint = toolFingerprint(call.toolName, call.input);
      if (
        call.output &&
        typeof call.output === "object" &&
        (call.output as { duplicate?: unknown }).duplicate === true
      ) {
        const current = this.observations.get(fingerprint);
        if (current) current.count += 1;
        else this.observations.set(fingerprint, { digest: "duplicate", count: 2 });
        duplicateCount += 1;
        this.duplicateToolCallCount += 1;
        continue;
      }
      const digest = stableDigest(call.output);
      const current = this.observations.get(fingerprint);
      if (current?.digest === digest) {
        current.count += 1;
        duplicateCount += 1;
        this.duplicateToolCallCount += 1;
      } else {
        this.observations.set(fingerprint, { digest, count: 1 });
      }
    }
    const duplicateOnly = readOnlyCount > 0 && duplicateCount === readOnlyCount;
    this.consecutiveDuplicateSteps = duplicateOnly ? this.consecutiveDuplicateSteps + 1 : 0;
    const repeatedFingerprint = [...this.observations.values()].some(
      (observation) => observation.count >= READ_ONLY_LOOP_LIMIT,
    );
    return {
      loopDetected: repeatedFingerprint || this.consecutiveDuplicateSteps >= READ_ONLY_LOOP_LIMIT,
      duplicateCount,
    };
  }
}
