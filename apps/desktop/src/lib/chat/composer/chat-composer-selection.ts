export function appendComposerSelection(current: string, selection: string) {
  const snippet = selection.trim();
  if (!snippet) return current;
  const existing = current.replace(/\s+$/, "");
  return existing ? `${existing}\n\n${snippet}` : snippet;
}

export function readWindowSelectionText() {
  return window.getSelection()?.toString().trim() ?? "";
}
