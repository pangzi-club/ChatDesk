const LOCAL_PREVIEW_HOSTS = new Set(["localhost", "127.0.0.1", "0.0.0.0", "[::1]"]);

export type LocalBrowserPreviewLink = {
  end: number;
  start: number;
  text: string;
  url: string;
};

export function normalizeBrowserPreviewUrl(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;

  const isBareLocalAddress = /^(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\]):/i.test(trimmed);
  const hasScheme = /^[a-z][a-z\d+.-]*:/i.test(trimmed);
  if (hasScheme && !isBareLocalAddress && !/^https?:/i.test(trimmed)) return null;
  const candidate = trimmed.startsWith("//")
    ? `http:${trimmed}`
    : hasScheme && !isBareLocalAddress
      ? trimmed
      : `http://${trimmed}`;

  try {
    const url = new URL(candidate);
    if ((url.protocol !== "http:" && url.protocol !== "https:") || !url.hostname) return null;
    return url.toString();
  } catch {
    return null;
  }
}

export function isLocalBrowserPreviewUrl(value: string): boolean {
  const normalized = normalizeBrowserPreviewUrl(value);
  if (!normalized) return false;
  return LOCAL_PREVIEW_HOSTS.has(new URL(normalized).hostname.toLowerCase());
}

export function getBrowserPreviewTitle(value: string): string {
  const normalized = normalizeBrowserPreviewUrl(value);
  if (!normalized) return "Browser";
  return new URL(normalized).host || "Browser";
}

export function findLocalBrowserPreviewLinks(text: string): LocalBrowserPreviewLink[] {
  const pattern =
    /(^|[^\p{L}\p{N}_@.-])((?:https?:\/\/)?(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\]):\d{1,5}(?:[/?#][^\s<>"'`]*)?)/giu;
  const links: LocalBrowserPreviewLink[] = [];

  for (const match of text.matchAll(pattern)) {
    const prefix = match[1] ?? "";
    const rawCandidate = match[2];
    if (!rawCandidate || match.index === undefined) continue;
    const candidate = trimTrailingPunctuation(rawCandidate);
    const url = normalizeBrowserPreviewUrl(candidate);
    if (!url || !isLocalBrowserPreviewUrl(url)) continue;
    const start = match.index + prefix.length;
    links.push({ start, end: start + candidate.length, text: candidate, url });
  }

  return links;
}

function trimTrailingPunctuation(value: string): string {
  let candidate = value.replace(/[.,;!?。，；！？]+$/u, "");
  const pairs = [
    ["(", ")"],
    ["[", "]"],
    ["{", "}"],
  ] as const;

  let changed = true;
  while (changed) {
    changed = false;
    for (const [open, close] of pairs) {
      if (!candidate.endsWith(close)) continue;
      const openCount = candidate.split(open).length - 1;
      const closeCount = candidate.split(close).length - 1;
      if (closeCount > openCount) {
        candidate = candidate.slice(0, -1);
        changed = true;
      }
    }
  }
  return candidate;
}
