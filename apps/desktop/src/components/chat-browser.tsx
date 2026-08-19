import { ArrowLeft, ArrowRight, ExternalLink, Globe2, RefreshCw } from "lucide-react";
import { type FormEvent, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { normalizeBrowserPreviewUrl } from "@/lib/browser-preview";
import { openExternal } from "@/lib/platform";

type ChatBrowserProps = {
  canGoBack?: boolean;
  canGoForward?: boolean;
  frameName: string;
  loadUrl?: string;
  onBack: () => void;
  onForward: () => void;
  onNavigate: (url: string) => void;
  onRefresh: () => void;
  refreshToken?: number;
  url?: string;
};

export function ChatBrowser({
  canGoBack = false,
  canGoForward = false,
  frameName,
  loadUrl,
  onBack,
  onForward,
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
        <Button
          aria-label="后退"
          className="chat-browser-action"
          disabled={!canGoBack}
          onClick={onBack}
          size="icon"
          title="后退"
          type="button"
          variant="ghost"
        >
          <ArrowLeft className="size-4" />
        </Button>
        <Button
          aria-label="前进"
          className="chat-browser-action"
          disabled={!canGoForward}
          onClick={onForward}
          size="icon"
          title="前进"
          type="button"
          variant="ghost"
        >
          <ArrowRight className="size-4" />
        </Button>
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
        <Input
          aria-label="Browser 地址"
          aria-invalid={Boolean(error)}
          className="chat-browser-address"
          onChange={(event) => setDraft(event.target.value)}
          placeholder="输入网址"
          spellCheck={false}
          value={draft}
        />
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
            key={`${loadUrl ?? url}-${refreshToken}`}
            name={frameName}
            referrerPolicy="strict-origin-when-cross-origin"
            sandbox="allow-forms allow-modals allow-popups allow-same-origin allow-scripts"
            src={loadUrl ?? url}
            title={`Browser preview: ${url}`}
          />
        ) : (
          <div className="chat-browser-empty">
            <Globe2 aria-hidden="true" className="size-5" />
            <p>输入网址开始浏览</p>
          </div>
        )}
      </div>
    </div>
  );
}
