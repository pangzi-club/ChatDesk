const LOCAL_PREVIEW_HOSTS = new Set(["localhost", "127.0.0.1", "0.0.0.0", "[::1]"]);

export type LocalBrowserPreviewLink = {
  end: number;
  start: number;
  text: string;
  url: string;
};

export type BrowserNavigationState = {
  entries: string[];
  index: number;
};

type BrowserNavigationSource = {
  browserNavigation?: BrowserNavigationState;
  url?: string;
};

export function normalizeBrowserPreviewUrl(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;

  const isBareLocalAddress = /^(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])(?::|\/|$)/i.test(
    trimmed,
  );
  const hasHttpScheme = /^https?:\/\//i.test(trimmed);
  if (/^[a-z][a-z\d+.-]*:\/\//i.test(trimmed) && !hasHttpScheme) return null;
  const candidate = trimmed.startsWith("//")
    ? `https:${trimmed}`
    : hasHttpScheme
      ? trimmed
      : `${isBareLocalAddress ? "http" : "https"}://${trimmed}`;

  try {
    const url = new URL(candidate);
    if ((url.protocol !== "http:" && url.protocol !== "https:") || !url.hostname) return null;
    return url.toString();
  } catch {
    return null;
  }
}

export function getBrowserNavigationState({
  browserNavigation,
  url,
}: BrowserNavigationSource): BrowserNavigationState {
  if (
    browserNavigation &&
    browserNavigation.entries.length > 0 &&
    browserNavigation.index >= 0 &&
    browserNavigation.index < browserNavigation.entries.length &&
    browserNavigation.entries[browserNavigation.index] === url
  ) {
    return browserNavigation;
  }
  return url ? { entries: [url], index: 0 } : { entries: [], index: -1 };
}

export function pushBrowserNavigation(
  source: BrowserNavigationSource,
  url: string,
): BrowserNavigationState {
  const current = getBrowserNavigationState(source);
  if (current.entries[current.index] === url) return current;
  const entries = [...current.entries.slice(0, current.index + 1), url];
  return { entries, index: entries.length - 1 };
}

export function moveBrowserNavigation(
  source: BrowserNavigationSource,
  offset: -1 | 1,
): { browserNavigation: BrowserNavigationState; url: string } | null {
  const current = getBrowserNavigationState(source);
  const index = current.index + offset;
  const url = current.entries[index];
  if (!url) return null;
  return { browserNavigation: { ...current, index }, url };
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
