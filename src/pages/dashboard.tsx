import { openUrl } from "@tauri-apps/plugin-opener";
import { LazyStore } from "@tauri-apps/plugin-store";
import { Camera, Check, Mic, Pencil, Plus, Search, Sparkles, Trash2, X } from "lucide-react";
import { type FormEvent, useEffect, useState } from "react";

import { Button } from "@/components/ui/button";

type Bookmark = {
  color: string;
  id: string;
  title: string;
  url: string;
};

type BookmarkDraft = Pick<Bookmark, "title" | "url">;

const BOOKMARK_STORAGE_KEY = "m-dashboard-bookmarks-v1";
const BOOKMARK_STORE_KEY = "bookmarks";
const bookmarkStore = new LazyStore("bookmarks.json");

const DEFAULT_BOOKMARKS: Bookmark[] = [
  {
    id: "twitter",
    title: "X",
    url: "https://x.com",
    color: "from-zinc-950 to-zinc-800",
  },
];

const BOOKMARK_COLORS = [
  "from-sky-400 to-blue-600",
  "from-emerald-400 to-teal-700",
  "from-amber-300 to-orange-500",
  "from-rose-400 to-red-600",
  "from-indigo-400 to-violet-700",
  "from-zinc-700 to-zinc-950",
];

function DashboardPage() {
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
      const nextColor = BOOKMARK_COLORS[bookmarks.length % BOOKMARK_COLORS.length];
      setBookmarks((currentBookmarks) => [
        ...currentBookmarks,
        {
          color: nextColor,
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
    <div className="dashboard-wallpaper relative min-h-screen overflow-hidden text-white">
      <main className="relative z-10 flex min-h-screen flex-col items-center px-3 pt-[9vh] pb-6 sm:px-6 lg:px-10">
        <h1 className="select-none font-medium text-[clamp(3.25rem,7vw,5.25rem)] text-white/88 leading-none tracking-normal drop-shadow-md">
          Google
        </h1>

        <form
          className="mt-7 flex h-12 w-full max-w-3xl items-center gap-2 rounded-full bg-card px-4 text-foreground shadow-[0_6px_18px_rgba(55,55,55,0.22)] sm:h-13 sm:px-5"
          onSubmit={searchGoogle}
        >
          <Search className="size-5 shrink-0 text-muted-foreground" />
          <label className="sr-only" htmlFor="dashboard-search">
            Google 搜索
          </label>
          <input
            className="min-w-0 flex-1 bg-transparent font-medium text-[15px] text-foreground outline-none placeholder:text-muted-foreground sm:text-lg"
            id="dashboard-search"
            onChange={(event) => setQuery(event.target.value)}
            placeholder="在 Google 中搜索或输入网址"
            type="text"
            value={query}
          />
          <button
            aria-label="语音搜索"
            className="hidden size-8 shrink-0 items-center justify-center rounded-full text-muted-foreground transition hover:bg-muted focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/40 sm:flex"
            type="button"
          >
            <Mic className="size-5" />
          </button>
          <button
            aria-label="图片搜索"
            className="hidden size-8 shrink-0 items-center justify-center rounded-full text-muted-foreground transition hover:bg-muted focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/40 sm:flex"
            type="button"
          >
            <Camera className="size-5" />
          </button>
          <button
            aria-label="AI 模式"
            className="flex h-9 shrink-0 items-center gap-1.5 rounded-full bg-muted px-3 font-semibold text-sm text-foreground transition hover:bg-accent focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/40 max-sm:px-2.5"
            type="button"
          >
            <Sparkles className="size-4" />
            <span className="hidden sm:inline">AI 模式</span>
          </button>
        </form>

        <section
          aria-label="快捷方式"
          className="mt-8 grid w-full max-w-5xl grid-cols-3 gap-x-2 gap-y-4 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-9"
        >
          {bookmarks.map((bookmark) => (
            <BookmarkTile
              bookmark={bookmark}
              key={bookmark.id}
              onEdit={() => openEditBookmark(bookmark)}
              onOpen={() => void openExternal(bookmark.url)}
            />
          ))}
          <button
            className="group flex min-w-0 flex-col items-center gap-3 rounded-lg px-1.5 py-1.5 text-center outline-none transition hover:bg-foreground/10 focus-visible:ring-3 focus-visible:ring-foreground/45"
            onClick={openAddBookmark}
            type="button"
          >
            <span className="flex size-15 items-center justify-center rounded-full bg-foreground/80 text-background shadow-sm backdrop-blur">
              <Plus className="size-7" />
            </span>
            <span className="max-w-full truncate font-medium text-sm text-white leading-5 drop-shadow">
              添加快捷方式
            </span>
          </button>
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

function BookmarkTile({
  bookmark,
  onEdit,
  onOpen,
}: {
  bookmark: Bookmark;
  onEdit: () => void;
  onOpen: () => void;
}) {
  return (
    <div className="group relative min-w-0">
      <button
        className="flex w-full min-w-0 flex-col items-center gap-3 rounded-lg px-1.5 py-1.5 text-center outline-none transition hover:bg-foreground/10 focus-visible:ring-3 focus-visible:ring-foreground/45"
        onClick={onOpen}
        title={bookmark.url}
        type="button"
      >
        <span className="flex size-15 items-center justify-center rounded-full bg-foreground/80 shadow-sm backdrop-blur">
          <span
            className={`relative flex size-9 items-center justify-center overflow-hidden rounded-md bg-gradient-to-br ${bookmark.color} text-white shadow-inner`}
          >
            <img
              alt=""
              className="relative z-10 size-6"
              onError={(event) => {
                event.currentTarget.style.display = "none";
              }}
              src={getFaviconUrl(bookmark.url)}
            />
            <span className="absolute font-semibold text-sm text-white/90">
              {bookmark.title.slice(0, 1).toUpperCase()}
            </span>
          </span>
        </span>
        <span className="max-w-full truncate font-medium text-sm text-white leading-5 drop-shadow">
          {bookmark.title}
        </span>
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
          className="mt-1.5 h-9 w-full rounded-md border border-border bg-muted px-3 text-sm outline-none transition focus:border-ring focus:bg-background focus:ring-3 focus:ring-ring/30"
          id="bookmark-title"
          onChange={(event) => onChange({ ...draft, title: event.target.value })}
          required
          type="text"
          value={draft.title}
        />

        <label className="mt-3 block font-medium text-sm text-muted-foreground" htmlFor="bookmark-url">
          网址
        </label>
        <input
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

  return value.filter(isBookmark).map((bookmark, index) => ({
    ...bookmark,
    color: bookmark.color || BOOKMARK_COLORS[index % BOOKMARK_COLORS.length],
  }));
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

  try {
    if ("__TAURI_INTERNALS__" in window) {
      await openUrl(targetUrl);
      return;
    }
  } catch {
    window.open(targetUrl, "_blank", "noopener,noreferrer");
    return;
  }

  window.open(targetUrl, "_blank", "noopener,noreferrer");
}

export { DashboardPage };
