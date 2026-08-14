import {
  Camera,
  Check,
  Code2,
  GitPullRequest,
  Mic,
  Pencil,
  Plus,
  Search,
  ShieldCheck,
  Sparkles,
  Trash2,
  Wrench,
  X,
} from "lucide-react";
import { type FormEvent, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";

import { Button } from "@/components/ui/button";
import { openExternal as platformOpenExternal } from "@/lib/platform";
import { createUserDataStore } from "@/lib/settings-store";

type Bookmark = {
  id: string;
  title: string;
  url: string;
};

type BookmarkDraft = Pick<Bookmark, "title" | "url">;

const BOOKMARK_STORAGE_KEY = "m-dashboard-bookmarks-v1";
const BOOKMARK_STORE_KEY = "bookmarks";
const bookmarkStore = createUserDataStore("bookmarks.json");

const DEFAULT_BOOKMARKS: Bookmark[] = [
  {
    id: "twitter",
    title: "X",
    url: "https://x.com",
  },
];

const BOOKMARK_TONES = [1, 2, 3, 4, 5, 6] as const;

function DashboardPage() {
  const navigate = useNavigate();
  const [bookmarks, setBookmarks] = useState<Bookmark[]>(DEFAULT_BOOKMARKS);
  const [hasLoadedBookmarks, setHasLoadedBookmarks] = useState(false);
  const [query, setQuery] = useState("");
  const [editingBookmark, setEditingBookmark] = useState<Bookmark | null>(null);
  const [isAddingBookmark, setIsAddingBookmark] = useState(false);
  const [draft, setDraft] = useState<BookmarkDraft>({ title: "", url: "" });

  useEffect(() => {
    let isActive = true;

    void loadBookmarks().then((savedBookmarks) => {
      if (!isActive) {
        return;
      }

      setBookmarks(savedBookmarks);
      setHasLoadedBookmarks(true);
    });

    return () => {
      isActive = false;
    };
  }, []);

  useEffect(() => {
    if (!hasLoadedBookmarks) {
      return;
    }

    void saveBookmarks(bookmarks);
  }, [bookmarks, hasLoadedBookmarks]);

  const isEditorOpen = isAddingBookmark || editingBookmark !== null;

  function openAddBookmark() {
    setDraft({ title: "", url: "" });
    setEditingBookmark(null);
    setIsAddingBookmark(true);
  }

  function openEditBookmark(bookmark: Bookmark) {
    setDraft({ title: bookmark.title, url: bookmark.url });
    setEditingBookmark(bookmark);
    setIsAddingBookmark(false);
  }

  function closeEditor() {
    setDraft({ title: "", url: "" });
    setEditingBookmark(null);
    setIsAddingBookmark(false);
  }

  function saveBookmark(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const title = draft.title.trim();
    const normalizedUrl = normalizeUrl(draft.url);

    if (!title || !normalizedUrl) {
      return;
    }

    if (editingBookmark) {
      setBookmarks((currentBookmarks) =>
        currentBookmarks.map((bookmark) =>
          bookmark.id === editingBookmark.id
            ? { ...bookmark, title, url: normalizedUrl }
            : bookmark,
        ),
      );
    } else {
      setBookmarks((currentBookmarks) => [
        ...currentBookmarks,
        {
          id: crypto.randomUUID(),
          title,
          url: normalizedUrl,
        },
      ]);
    }

    closeEditor();
  }

  function deleteBookmark() {
    if (!editingBookmark) {
      return;
    }

    setBookmarks((currentBookmarks) =>
      currentBookmarks.filter((bookmark) => bookmark.id !== editingBookmark.id),
    );
    closeEditor();
  }

  function searchGoogle(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const target = buildSearchTarget(query);
    if (!target) {
      return;
    }

    void openExternal(target);
    setQuery("");
  }

  return (
    <div className="dashboard-home min-h-full overflow-y-auto">
      <main className="mx-auto flex min-h-full w-full max-w-5xl flex-col px-5 pt-16 pb-10 sm:px-10 sm:pt-20">
        <header className="max-w-2xl">
          <p className="page-eyebrow">ChatDesk / workspace</p>
          <h1 className="mt-3 font-semibold text-[clamp(2rem,4vw,3.25rem)] leading-tight tracking-[-0.04em]">
            今天想从哪里开始？
          </h1>
          <p className="mt-3 text-[15px] text-muted-foreground leading-7">
            连接你的模型、项目和自动化任务，把常用工作集中在一个安静的工作台里。
          </p>
        </header>

        <form
          className="dashboard-search mt-8 flex min-h-14 w-full items-center gap-2 px-4 text-foreground sm:px-5"
          onSubmit={searchGoogle}
        >
          <Search className="size-4 shrink-0 text-muted-foreground" />
          <label className="sr-only" htmlFor="dashboard-search">
            工作台搜索
          </label>
          <input
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            className="min-w-0 flex-1 bg-transparent text-[15px] text-foreground outline-none placeholder:text-muted-foreground"
            id="dashboard-search"
            onChange={(event) => setQuery(event.target.value)}
            placeholder="在工作台中搜索或输入网址"
            type="text"
            value={query}
          />
          <button
            aria-label="语音搜索"
            className="hidden size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition hover:bg-muted focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/40 sm:flex"
            type="button"
          >
            <Mic className="size-5" />
          </button>
          <button
            aria-label="图片搜索"
            className="hidden size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition hover:bg-muted focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/40 sm:flex"
            type="button"
          >
            <Camera className="size-5" />
          </button>
          <button
            aria-label="AI 模式"
            className="flex h-9 shrink-0 items-center gap-1.5 rounded-md bg-foreground px-3 font-medium text-sm text-background transition hover:bg-foreground/85 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/40 max-sm:px-2.5"
            type="button"
          >
            <Sparkles className="size-4" />
            <span className="hidden sm:inline">AI 模式</span>
          </button>
        </form>

        <section className="mt-10 grid gap-3 sm:grid-cols-2 lg:grid-cols-4" aria-label="常用操作">
          <DashboardAction
            icon={Code2}
            label="探索代码"
            detail="阅读项目并定位关键文件"
            onClick={() => navigate("/chat")}
          />
          <DashboardAction
            icon={GitPullRequest}
            label="构建功能"
            detail="从想法到可交付的改动"
            onClick={() => navigate("/chat")}
          />
          <DashboardAction
            icon={ShieldCheck}
            label="审查变更"
            detail="检查风险并提出修改建议"
            onClick={() => navigate("/chat")}
          />
          <DashboardAction
            icon={Wrench}
            label="修复问题"
            detail="诊断失败并快速恢复"
            onClick={() => navigate("/chat")}
          />
        </section>

        <section aria-label="快捷方式" className="mt-12 border-border border-t pt-6">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <h2 className="font-semibold text-sm">快捷方式</h2>
              <p className="mt-1 text-muted-foreground text-xs">打开你经常使用的站点</p>
            </div>
            <button
              aria-label="添加快捷方式"
              className="flex size-8 items-center justify-center rounded-md border border-border text-muted-foreground transition hover:bg-muted hover:text-foreground"
              onClick={openAddBookmark}
              title="添加快捷方式"
              type="button"
            >
              <Plus className="size-4" />
            </button>
          </div>
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-5 lg:grid-cols-7">
            {bookmarks.map((bookmark, index) => (
              <BookmarkTile
                bookmark={bookmark}
                tone={BOOKMARK_TONES[index % BOOKMARK_TONES.length]}
                key={bookmark.id}
                onEdit={() => openEditBookmark(bookmark)}
                onOpen={() => void openExternal(bookmark.url)}
              />
            ))}
          </div>
        </section>
      </main>

      {isEditorOpen ? (
        <BookmarkEditor
          draft={draft}
          isEditing={editingBookmark !== null}
          onChange={setDraft}
          onClose={closeEditor}
          onDelete={deleteBookmark}
          onSubmit={saveBookmark}
        />
      ) : null}
    </div>
  );
}

function DashboardAction({
  icon: Icon,
  label,
  detail,
  onClick,
}: {
  icon: typeof Code2;
  label: string;
  detail: string;
  onClick: () => void;
}) {
  return (
    <button
      className="dashboard-home-card flex min-h-28 flex-col items-start p-4 text-left"
      onClick={onClick}
      type="button"
    >
      <span className="dashboard-action-mark flex size-8 items-center justify-center rounded-md">
        <Icon className="size-4" />
      </span>
      <span className="mt-4 font-medium text-sm">{label}</span>
      <span className="mt-1 text-muted-foreground text-xs leading-5">{detail}</span>
    </button>
  );
}

function BookmarkTile({
  bookmark,
  tone,
  onEdit,
  onOpen,
}: {
  bookmark: Bookmark;
  tone: number;
  onEdit: () => void;
  onOpen: () => void;
}) {
  return (
    <div className="group relative min-w-0">
      <button
        className="flex w-full min-w-0 flex-col items-center gap-2 rounded-lg px-1.5 py-2 text-center outline-none transition hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/40"
        onClick={onOpen}
        title={bookmark.url}
        type="button"
      >
        <span className="flex size-10 items-center justify-center rounded-lg bg-muted">
          <span
            className={`bookmark-tile-swatch bookmark-tile-tone-${tone} relative flex size-9 items-center justify-center overflow-hidden rounded-md shadow-inner`}
          >
            <img
              alt=""
              className="relative z-10 size-6"
              onError={(event) => {
                event.currentTarget.style.display = "none";
              }}
              src={getFaviconUrl(bookmark.url)}
            />
            <span className="absolute font-semibold text-sm text-current">
              {bookmark.title.slice(0, 1).toUpperCase()}
            </span>
          </span>
        </span>
        <span className="max-w-full truncate font-medium text-xs leading-5">{bookmark.title}</span>
      </button>
      <button
        aria-label={`编辑 ${bookmark.title}`}
        className="absolute top-0 right-1 flex size-7 items-center justify-center rounded-full bg-card/95 text-foreground opacity-100 shadow-md transition hover:bg-card focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-foreground/45 sm:opacity-0 sm:group-hover:opacity-100"
        onClick={onEdit}
        type="button"
      >
        <Pencil className="size-3.5" />
      </button>
    </div>
  );
}

function BookmarkEditor({
  draft,
  isEditing,
  onChange,
  onClose,
  onDelete,
  onSubmit,
}: {
  draft: BookmarkDraft;
  isEditing: boolean;
  onChange: (draft: BookmarkDraft) => void;
  onClose: () => void;
  onDelete: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  return (
    <div
      aria-modal="true"
      className="fixed inset-0 z-20 flex items-center justify-center bg-black/40 px-4 backdrop-blur-sm"
      role="dialog"
    >
      <form
        className="w-full max-w-sm rounded-lg bg-card p-4 text-card-foreground shadow-2xl"
        onSubmit={onSubmit}
      >
        <div className="mb-4 flex items-center justify-between gap-4">
          <h2 className="font-semibold text-lg">{isEditing ? "编辑快捷方式" : "添加快捷方式"}</h2>
          <button
            aria-label="关闭"
            className="flex size-8 items-center justify-center rounded-full text-muted-foreground transition hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/30"
            onClick={onClose}
            type="button"
          >
            <X className="size-4" />
          </button>
        </div>

        <label className="block font-medium text-sm text-muted-foreground" htmlFor="bookmark-title">
          名称
        </label>
        <input
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          className="mt-1.5 h-9 w-full rounded-md border border-border bg-muted px-3 text-sm outline-none transition focus:border-ring focus:bg-background focus:ring-3 focus:ring-ring/30"
          id="bookmark-title"
          onChange={(event) => onChange({ ...draft, title: event.target.value })}
          required
          type="text"
          value={draft.title}
        />

        <label
          className="mt-3 block font-medium text-sm text-muted-foreground"
          htmlFor="bookmark-url"
        >
          网址
        </label>
        <input
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          className="mt-1.5 h-9 w-full rounded-md border border-border bg-muted px-3 text-sm outline-none transition focus:border-ring focus:bg-background focus:ring-3 focus:ring-ring/30"
          id="bookmark-url"
          onChange={(event) => onChange({ ...draft, url: event.target.value })}
          placeholder="https://example.com"
          required
          type="text"
          value={draft.url}
        />

        <div className="mt-5 flex items-center justify-between gap-3">
          {isEditing ? (
            <Button
              className="text-destructive hover:bg-destructive/10 hover:text-destructive"
              onClick={onDelete}
              type="button"
              variant="ghost"
            >
              <Trash2 className="size-4" />
              删除
            </Button>
          ) : (
            <span />
          )}
          <div className="flex items-center gap-2">
            <Button onClick={onClose} type="button" variant="ghost">
              取消
            </Button>
            <Button type="submit">
              <Check className="size-4" />
              保存
            </Button>
          </div>
        </div>
      </form>
    </div>
  );
}

async function loadBookmarks() {
  const localBookmarks = loadLocalBookmarks();

  if (!isTauri()) {
    return localBookmarks ?? DEFAULT_BOOKMARKS;
  }

  try {
    const storedBookmarks = parseBookmarks(await bookmarkStore.get(BOOKMARK_STORE_KEY));
    if (storedBookmarks) {
      return storedBookmarks;
    }

    const bookmarksToMigrate = localBookmarks ?? DEFAULT_BOOKMARKS;
    await saveBookmarksToStore(bookmarksToMigrate);
    window.localStorage.removeItem(BOOKMARK_STORAGE_KEY);
    return bookmarksToMigrate;
  } catch (error) {
    console.error("Failed to load bookmarks from Tauri Store", error);
    return localBookmarks ?? DEFAULT_BOOKMARKS;
  }
}

async function saveBookmarks(bookmarks: Bookmark[]) {
  if (isTauri()) {
    try {
      await saveBookmarksToStore(bookmarks);
      window.localStorage.removeItem(BOOKMARK_STORAGE_KEY);
      return;
    } catch (error) {
      console.error("Failed to save bookmarks to Tauri Store", error);
    }
  }

  window.localStorage.setItem(BOOKMARK_STORAGE_KEY, JSON.stringify(bookmarks));
}

async function saveBookmarksToStore(bookmarks: Bookmark[]) {
  await bookmarkStore.set(BOOKMARK_STORE_KEY, bookmarks);
  await bookmarkStore.save();
}

function loadLocalBookmarks() {
  if (typeof window === "undefined") {
    return null;
  }

  const savedBookmarks = window.localStorage.getItem(BOOKMARK_STORAGE_KEY);
  if (!savedBookmarks) {
    return null;
  }

  try {
    return parseBookmarks(JSON.parse(savedBookmarks));
  } catch {
    return null;
  }
}

function parseBookmarks(value: unknown) {
  if (!Array.isArray(value)) {
    return null;
  }

  return value.filter(isBookmark);
}

function isTauri() {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

function isBookmark(bookmark: unknown): bookmark is Bookmark {
  if (!bookmark || typeof bookmark !== "object") {
    return false;
  }

  const candidate = bookmark as Partial<Bookmark>;

  return (
    typeof candidate.id === "string" &&
    typeof candidate.title === "string" &&
    typeof candidate.url === "string"
  );
}

function buildSearchTarget(value: string) {
  const trimmedValue = value.trim();
  if (!trimmedValue) {
    return "";
  }

  if (isUrlLike(trimmedValue)) {
    return normalizeUrl(trimmedValue);
  }

  return `https://www.google.com/search?q=${encodeURIComponent(trimmedValue)}`;
}

function isUrlLike(value: string) {
  return (
    /^https?:\/\//i.test(value) ||
    /^localhost(:\d+)?(\/.*)?$/i.test(value) ||
    /^[\w-]+(\.[\w-]+)+/.test(value)
  );
}

function normalizeUrl(value: string) {
  const trimmedValue = value.trim();
  if (!trimmedValue) {
    return "";
  }

  return /^https?:\/\//i.test(trimmedValue) ? trimmedValue : `https://${trimmedValue}`;
}

function getFaviconUrl(value: string) {
  try {
    const url = new URL(normalizeUrl(value));
    return `https://www.google.com/s2/favicons?domain=${url.hostname}&sz=64`;
  } catch {
    return "";
  }
}

async function openExternal(value: string) {
  const targetUrl = normalizeUrl(value);
  if (!targetUrl) {
    return;
  }

  await platformOpenExternal(targetUrl);
}

export { DashboardPage };
