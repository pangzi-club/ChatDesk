import { ExternalLink, Globe2, RefreshCw } from "lucide-react";
import { type FormEvent, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { normalizeBrowserPreviewUrl } from "@/lib/browser-preview";
import { openExternal } from "@/lib/platform";

type ChatBrowserProps = {
  onNavigate: (url: string) => void;
  onRefresh: () => void;
  refreshToken?: number;
  url?: string;
};

export function ChatBrowser({
  onNavigate,
  onRefresh,
  refreshToken = 0,
  url = "",
}: ChatBrowserProps) {
  const [draft, setDraft] = useState(url);
  const [error, setError] = useState("");

  useEffect(() => {
    setDraft(url);
    setError("");
  }, [url]);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalized = normalizeBrowserPreviewUrl(draft);
    if (!normalized) {
      setError("请输入有效的 HTTP(S) 地址");
      return;
    }
    setDraft(normalized);
    setError("");
    onNavigate(normalized);
  }

  return (
    <div className="chat-browser-shell">
      <form className="chat-browser-toolbar" onSubmit={submit}>
        <Globe2 aria-hidden="true" className="size-3.5 shrink-0" />
        <Input
          aria-label="Browser 地址"
          aria-invalid={Boolean(error)}
          className="chat-browser-address"
          onChange={(event) => setDraft(event.target.value)}
          placeholder="localhost:5173"
          spellCheck={false}
          value={draft}
        />
        <Button
          aria-label="刷新页面"
          className="chat-browser-action"
          disabled={!url}
          onClick={onRefresh}
          size="icon"
          title="刷新"
          type="button"
          variant="ghost"
        >
          <RefreshCw className="size-4" />
        </Button>
        <Button
          aria-label="在系统浏览器打开"
          className="chat-browser-action"
          disabled={!url}
          onClick={() => void openExternal(url)}
          size="icon"
          title="在系统浏览器打开"
          type="button"
          variant="ghost"
        >
          <ExternalLink className="size-4" />
        </Button>
      </form>
      {error ? (
        <p className="chat-browser-error" role="alert">
          {error}
        </p>
      ) : null}
      <div className="chat-browser-content">
        {url ? (
          <iframe
            key={`${url}-${refreshToken}`}
            referrerPolicy="no-referrer"
            sandbox="allow-forms allow-modals allow-popups allow-same-origin allow-scripts"
            src={url}
            title={`Browser preview: ${url}`}
          />
        ) : null}
      </div>
    </div>
  );
}
