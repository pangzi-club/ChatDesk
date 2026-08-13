import { AlertTriangle, FileCode2 } from "lucide-react";

export type FileViewerMode = "source" | "diff";

export type FileViewerProps = {
  path: string;
  mode: FileViewerMode;
  content: string;
  language?: string;
  truncated?: boolean;
  binary?: boolean;
};

function languageFromPath(path: string) {
  const extension = path.split(".").pop()?.toLowerCase();
  if (!extension) return "text";
  const aliases: Record<string, string> = {
    ts: "typescript",
    tsx: "tsx",
    js: "javascript",
    jsx: "jsx",
    rs: "rust",
    py: "python",
    json: "json",
    css: "css",
    html: "html",
    md: "markdown",
  };
  return aliases[extension] ?? extension;
}

function renderSourceLine(line: string) {
  const parts = line.split(
    /(\/\/.*|#.*|\b\d+(?:\.\d+)?\b|"[^"\\]*(?:\\.[^"\\]*)*"|'[^'\\]*(?:\\.[^'\\]*)*'|\b(?:const|let|var|function|return|if|else|for|while|import|from|export|async|await|class|new|type|interface|pub|fn|struct|use)\b)/g,
  );
  return parts.map((part) => {
    if (!part) return null;
    const className = /^\/\/|^#/.test(part)
      ? "file-viewer-token-comment"
      : /^\d/.test(part)
        ? "file-viewer-token-number"
        : /^(?:const|let|var|function|return|if|else|for|while|import|from|export|async|await|class|new|type|interface|pub|fn|struct|use)$/.test(
              part,
            )
          ? "file-viewer-token-keyword"
          : /^(?:"|')/.test(part)
            ? "file-viewer-token-string"
            : undefined;
    return (
      <span className={className} key={`${part}-${part.length}`}>
        {part}
      </span>
    );
  });
}

function DiffLine({ line }: { line: string }) {
  const marker = line[0] ?? " ";
  const className =
    marker === "+" && !line.startsWith("+++")
      ? "is-added"
      : marker === "-" && !line.startsWith("---")
        ? "is-removed"
        : line.startsWith("@@")
          ? "is-hunk"
          : "";
  return <div className={`file-viewer-line ${className}`}>{line || " "}</div>;
}

export function FileViewer({
  path,
  mode,
  content,
  language,
  truncated = false,
  binary = false,
}: FileViewerProps) {
  const resolvedLanguage = language ?? languageFromPath(path);
  if (binary) {
    return (
      <div className="file-viewer-empty">
        <AlertTriangle className="size-5" />
        <span>二进制文件已修改，无法显示文本内容</span>
      </div>
    );
  }
  const lines = content.split(/\r?\n/);
  return (
    <section className="file-viewer" aria-label={`查看 ${path}`}>
      <header className="file-viewer-header">
        <FileCode2 className="size-4" />
        <span className="file-viewer-path" title={path}>
          {path}
        </span>
        <span className="file-viewer-language">{resolvedLanguage}</span>
      </header>
      {truncated ? <div className="file-viewer-warning">内容过大，仅显示部分 diff</div> : null}
      <section className={`file-viewer-code is-${mode}`} aria-label="文件内容">
        {lines.map((line, index) => (
          <div className="file-viewer-row" key={`${line}-${line.length}`}>
            <span className="file-viewer-line-number">{index + 1}</span>
            {mode === "diff" ? (
              <DiffLine line={line} />
            ) : (
              <div className="file-viewer-line">{renderSourceLine(line)}</div>
            )}
          </div>
        ))}
      </section>
    </section>
  );
}
