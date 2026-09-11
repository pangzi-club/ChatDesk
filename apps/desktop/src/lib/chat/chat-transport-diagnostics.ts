export function isRecoverableChatTransportError(error: Error | undefined) {
  if (!error) return false;
  return /load failed|failed to fetch|network(?: request)? failed|networkerror/i.test(
    error.message,
  );
}

export function serializeChatTransportError(error: Error, depth = 0): unknown {
  if (depth >= 3) return error.message;
  const value = error as Error & { cause?: unknown; code?: unknown };
  return {
    name: value.name,
    message: value.message,
    ...(value.code !== undefined ? { code: value.code } : {}),
    ...(value.cause instanceof Error
      ? { cause: serializeChatTransportError(value.cause, depth + 1) }
      : {}),
  };
}
