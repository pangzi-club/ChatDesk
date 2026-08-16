import type { LogWarningsFunction, Warning } from "ai";

export const STATELESS_REASONING_WARNING =
  "Reasoning parts without encrypted content are not supported when store is false. Skipping reasoning parts.";

export function isSuppressedAiSdkWarning(warning: Warning) {
  return warning.type === "other" && warning.message === STATELESS_REASONING_WARNING;
}

export function filterAiSdkWarnings(warnings: Warning[]) {
  return warnings.filter((warning) => !isSuppressedAiSdkWarning(warning));
}

function formatAiSdkWarning(warning: Warning, provider?: string, model?: string) {
  const scope = provider != null && model != null ? ` (${provider} / ${model})` : "";
  const prefix = `AI SDK Warning${scope}:`;

  switch (warning.type) {
    case "unsupported": {
      return warning.details
        ? `${prefix} The feature "${warning.feature}" is not supported. ${warning.details}`
        : `${prefix} The feature "${warning.feature}" is not supported.`;
    }
    case "compatibility": {
      return warning.details
        ? `${prefix} The feature "${warning.feature}" is used in a compatibility mode. ${warning.details}`
        : `${prefix} The feature "${warning.feature}" is used in a compatibility mode.`;
    }
    case "deprecated": {
      return `${prefix} Deprecated: "${warning.setting}". ${warning.message}`;
    }
    case "other": {
      return `${prefix} ${warning.message}`;
    }
    default: {
      return `${prefix} ${JSON.stringify(warning)}`;
    }
  }
}

function logAiSdkWarningsDefault({
  warnings,
  provider,
  model,
}: Parameters<LogWarningsFunction>[0]) {
  for (const warning of warnings) {
    const message = formatAiSdkWarning(warning, provider, model);
    if (typeof process.emitWarning === "function") {
      process.emitWarning(message, {
        type: warning.type === "deprecated" ? "DeprecationWarning" : "Warning",
      });
      continue;
    }
    console.warn(message);
  }
}

export function createAiSdkWarningLogger(logRemaining: LogWarningsFunction): LogWarningsFunction {
  return (options) => {
    const warnings = filterAiSdkWarnings(options.warnings);
    if (warnings.length === 0) return;
    logRemaining({ ...options, warnings });
  };
}

let installedLogger: LogWarningsFunction | undefined;

export function installAiSdkWarningFilter() {
  if (globalThis.AI_SDK_LOG_WARNINGS === installedLogger) return;
  const previous = globalThis.AI_SDK_LOG_WARNINGS;
  const logger = createAiSdkWarningLogger((options) => {
    if (previous === false) return;
    if (typeof previous === "function") {
      previous(options);
      return;
    }
    logAiSdkWarningsDefault(options);
  });
  installedLogger = logger;
  globalThis.AI_SDK_LOG_WARNINGS = logger;
}
