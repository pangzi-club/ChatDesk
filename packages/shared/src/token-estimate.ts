export function estimateTokenCount(value: string) {
  return value.length > 0 ? Math.ceil(value.length / 4) : 0;
}
