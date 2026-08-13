import Editor, { DiffEditor, loader } from "@monaco-editor/react";
import { AlertTriangle, Columns2, FileCode2 } from "lucide-react";
import * as monaco from "monaco-editor";
import editorWorker from "monaco-editor/esm/vs/editor/editor.worker?worker";
import cssWorker from "monaco-editor/esm/vs/language/css/css.worker?worker";
import htmlWorker from "monaco-editor/esm/vs/language/html/html.worker?worker";
import jsonWorker from "monaco-editor/esm/vs/language/json/json.worker?worker";
import tsWorker from "monaco-editor/esm/vs/language/typescript/ts.worker?worker";
import { useEffect, useState } from "react";

export type FileViewerMode = "source" | "diff";

export type FileViewerProps = {
  path: string;
  mode: FileViewerMode;
  content: string;
  originalContent?: string;
  modifiedContent?: string;
  language?: string;
  truncated?: boolean;
  binary?: boolean;
};

const workerConstructors = {
  css: cssWorker,
  html: htmlWorker,
  json: jsonWorker,
  javascript: tsWorker,
  typescript: tsWorker,
};

if (typeof self !== "undefined") {
  self.MonacoEnvironment = {
    getWorker(_, label) {
      const WorkerConstructor = workerConstructors[label as keyof typeof workerConstructors];
      return WorkerConstructor ? new WorkerConstructor() : new editorWorker();
    },
  };
}
loader.config({ monaco });

function languageFromPath(path: string) {
  const extension = path.split(".").pop()?.toLowerCase();
  if (!extension) return "plaintext";
  const aliases: Record<string, string> = {
    ts: "typescript",
    tsx: "typescript",
    js: "javascript",
    jsx: "javascript",
    rs: "rust",
    py: "python",
    json: "json",
    css: "css",
    html: "html",
    md: "markdown",
    sh: "shell",
    yml: "yaml",
    yaml: "yaml",
  };
  return aliases[extension] ?? extension;
}

function useDarkTheme() {
  const [dark, setDark] = useState(
    () => typeof document !== "undefined" && document.documentElement.classList.contains("dark"),
  );
  useEffect(() => {
    const root = document.documentElement;
    const update = () => setDark(root.classList.contains("dark"));
    update();
    const observer = new MutationObserver(update);
    observer.observe(root, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, []);
  return dark;
}

const editorOptions: monaco.editor.IStandaloneEditorConstructionOptions = {
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
  ...editorOptions,
  originalEditable: false,
  renderIndicators: false,
  renderMarginRevertIcon: false,
  renderOverviewRuler: false,
  ignoreTrimWhitespace: false,
  splitViewDefaultRatio: 0.5,
};

export function FileViewer({
  path,
  mode,
  content,
  originalContent,
  modifiedContent,
  language,
  truncated = false,
  binary = false,
}: FileViewerProps) {
  const dark = useDarkTheme();
  const resolvedLanguage = language ?? languageFromPath(path);
  if (binary) {
    return (
      <div className="file-viewer-empty">
        <AlertTriangle className="size-5" />
        <span>二进制文件已修改，无法显示文本内容</span>
      </div>
    );
  }
  const original = originalContent ?? "";
  const modified = modifiedContent ?? content;
  const modelPath = `file:///chatdesk/${encodeURIComponent(path)}`;
  return (
    <section className="file-viewer" aria-label={`查看 ${path}`}>
      <header className="file-viewer-header">
        {mode === "diff" ? <Columns2 className="size-4" /> : <FileCode2 className="size-4" />}
        <span className="file-viewer-path" title={path}>
          {path}
        </span>
        <span className="file-viewer-language">{resolvedLanguage}</span>
        <span className="file-viewer-readonly">只读</span>
      </header>
      {truncated ? <div className="file-viewer-warning">内容过大，仅显示部分 diff</div> : null}
      <div className="file-viewer-editor">
        {mode === "diff" ? (
          <DiffEditor
            original={original}
            modified={modified}
            originalLanguage={resolvedLanguage}
            modifiedLanguage={resolvedLanguage}
            originalModelPath={`${modelPath}-head`}
            modifiedModelPath={`${modelPath}-worktree`}
            theme={dark ? "vs-dark" : "light"}
            height="100%"
            loading="正在加载 Diff 编辑器..."
            options={diffEditorOptions}
          />
        ) : (
          <Editor
            language={resolvedLanguage}
            path={modelPath}
            theme={dark ? "vs-dark" : "light"}
            value={content}
            height="100%"
            loading="正在加载文件..."
            options={editorOptions}
          />
        )}
      </div>
    </section>
  );
}
