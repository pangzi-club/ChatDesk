import type * as monaco from "monaco-editor";

export type DiffViewerLayout = "split" | "unified";

export const fileViewerEditorOptions: monaco.editor.IStandaloneEditorConstructionOptions = {
  automaticLayout: true,
  contextmenu: false,
  folding: true,
  glyphMargin: false,
  lineNumbers: "on",
  minimap: { enabled: false },
  padding: { top: 8, bottom: 8 },
  readOnly: true,
  renderLineHighlight: "none",
  renderWhitespace: "selection",
  scrollbar: { horizontalScrollbarSize: 10, verticalScrollbarSize: 10 },
  smoothScrolling: true,
  tabSize: 2,
  wordWrap: "off",
};

const diffEditorOptions: monaco.editor.IDiffEditorConstructionOptions = {
  ...fileViewerEditorOptions,
  originalEditable: false,
  renderIndicators: false,
  renderMarginRevertIcon: false,
  renderOverviewRuler: false,
  ignoreTrimWhitespace: false,
  splitViewDefaultRatio: 0.5,
};

export function createDiffEditorOptions({
  hideUnchangedRegions,
  layout = "split",
}: {
  hideUnchangedRegions: boolean;
  layout?: DiffViewerLayout;
}): monaco.editor.IDiffEditorConstructionOptions {
  return {
    ...diffEditorOptions,
    renderSideBySide: layout === "split",
    hideUnchangedRegions: {
      contextLineCount: 3,
      enabled: hideUnchangedRegions,
      minimumLineCount: 3,
      revealLineCount: 1,
    },
  };
}
