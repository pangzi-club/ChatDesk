import Placeholder from "@tiptap/extension-placeholder";
import type { Editor, JSONContent } from "@tiptap/react";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef } from "react";
import {
  mapPlainOffsetToPmPos,
  parseComposerMarkdown,
  serializeComposerMarkdown,
} from "@/lib/chat-composer-markdown";

export type ChatComposerInputHandle = {
  focus: () => void;
  replaceRange: (start: number, end: number, text: string) => void;
  setCaret: (offset: number) => void;
};

export type ChatComposerChange = {
  markdown: string;
  plain: string;
  caret: number;
  fromEdit: boolean;
};

type ChatComposerInputProps = {
  value: string;
  disabled?: boolean;
  placeholder?: string;
  ariaControls: string;
  ariaExpanded: boolean;
  onChange: (next: ChatComposerChange) => void;
  onKeyDown: (event: KeyboardEvent) => boolean;
  onPasteFiles: (files: File[]) => void;
  onBlur?: () => void;
};

export const ChatComposerInput = forwardRef<ChatComposerInputHandle, ChatComposerInputProps>(
  function ChatComposerInput(
    {
      value,
      disabled = false,
      placeholder = "问问你的工作空间...",
      ariaControls,
      ariaExpanded,
      onChange,
      onKeyDown,
      onPasteFiles,
      onBlur,
    },
    ref,
  ) {
    const editorRef = useRef<Editor | null>(null);
    const onChangeRef = useRef(onChange);
    const onKeyDownRef = useRef(onKeyDown);
    const onPasteFilesRef = useRef(onPasteFiles);
    const onBlurRef = useRef(onBlur);
    const composingRef = useRef(false);
    const lastEmittedRef = useRef(value);
    const placeholderRef = useRef(placeholder);
    onChangeRef.current = onChange;
    onKeyDownRef.current = onKeyDown;
    onPasteFilesRef.current = onPasteFiles;
    onBlurRef.current = onBlur;
    placeholderRef.current = placeholder;

    const extensions = useMemo(
      () => [
        StarterKit.configure({
          heading: false,
          blockquote: false,
          codeBlock: false,
          italic: false,
          strike: false,
          horizontalRule: false,
          link: false,
          underline: false,
          hardBreak: false,
          trailingNode: false,
          bulletList: { keepMarks: true },
          orderedList: { keepMarks: true },
        }),
        Placeholder.configure({
          placeholder: () => placeholderRef.current,
          emptyEditorClass: "is-editor-empty",
        }),
      ],
      [],
    );

    const editor = useEditor({
      immediatelyRender: true,
      extensions,
      content: parseComposerMarkdown(value) as JSONContent,
      editable: !disabled,
      editorProps: {
        attributes: {
          role: "combobox",
          "aria-autocomplete": "list",
          "aria-label": "输入消息",
          autocapitalize: "none",
          autocorrect: "off",
          spellcheck: "false",
          class: "chat-composer-editor",
        },
        handlePaste(_view, event) {
          const current = editorRef.current;
          const files = Array.from(event.clipboardData?.files ?? []);
          if (files.length > 0) {
            event.preventDefault();
            onPasteFilesRef.current(files);
            return true;
          }
          const text = event.clipboardData?.getData("text/plain");
          if (!current || !text) return false;
          event.preventDefault();
          insertMarkdown(current, text);
          return true;
        },
        handleKeyDown(_view, event) {
          const current = editorRef.current;
          if (!current) return false;
          if (isComposingKey(event, composingRef.current || current.view.composing)) {
            return false;
          }
          if (onKeyDownRef.current(event)) return true;
          if (event.key === "Enter" && event.shiftKey) {
            event.preventDefault();
            insertComposerNewline(current);
            return true;
          }
          return false;
        },
        handleDOMEvents: {
          compositionstart: () => {
            composingRef.current = true;
            return false;
          },
          compositionend: () => {
            composingRef.current = false;
            const current = editorRef.current;
            if (current) emitEditorState(current, true, lastEmittedRef, onChangeRef);
            return false;
          },
          blur: () => {
            onBlurRef.current?.();
            return false;
          },
        },
      },
      onUpdate: ({ editor: next }) => {
        if (composingRef.current || next.view.composing) return;
        emitEditorState(next, true, lastEmittedRef, onChangeRef);
      },
      onSelectionUpdate: ({ editor: next }) => {
        if (composingRef.current || next.view.composing) return;
        emitEditorState(next, false, lastEmittedRef, onChangeRef);
      },
    });
    editorRef.current = editor;

    useEffect(() => {
      editor.setEditable(!disabled);
    }, [disabled, editor]);

    useEffect(() => {
      const root = editor.view.dom;
      root.setAttribute("aria-controls", ariaControls);
      root.setAttribute("aria-expanded", ariaExpanded ? "true" : "false");
    }, [ariaControls, ariaExpanded, editor]);

    useEffect(() => {
      if (editor.view.composing || composingRef.current) return;
      if (value === lastEmittedRef.current) return;
      editor.commands.setContent(parseComposerMarkdown(value) as JSONContent);
      lastEmittedRef.current = serializeComposerMarkdown(editor.getJSON());
    }, [editor, value]);

    useImperativeHandle(ref, () => ({
      focus() {
        editor.commands.focus();
      },
      replaceRange(start, end, text) {
        const { doc } = editor.state;
        const from = mapPlainOffsetToPmPos(doc, start);
        const to = mapPlainOffsetToPmPos(doc, end);
        if (text) {
          editor.chain().focus().insertContentAt({ from, to }, text).run();
          return;
        }
        editor.chain().focus().deleteRange({ from, to }).run();
      },
      setCaret(offset) {
        const pos = mapPlainOffsetToPmPos(editor.state.doc, offset);
        editor.chain().focus().setTextSelection(pos).run();
      },
    }));

    return <EditorContent className="chat-composer-input" editor={editor} />;
  },
);

function emitEditorState(
  editor: Editor,
  fromEdit: boolean,
  lastEmittedRef: { current: string },
  onChangeRef: { current: (next: ChatComposerChange) => void },
) {
  const markdown = serializeComposerMarkdown(editor.getJSON());
  lastEmittedRef.current = markdown;
  const { from } = editor.state.selection;
  onChangeRef.current({
    markdown,
    plain: editor.state.doc.textBetween(0, editor.state.doc.content.size, "\n"),
    caret: editor.state.doc.textBetween(0, from, "\n").length,
    fromEdit,
  });
}

function insertMarkdown(editor: Editor, text: string) {
  const parsed = parseComposerMarkdown(text);
  const blocks = parsed.content ?? [];
  if (blocks.length === 1 && blocks[0]?.type === "paragraph") {
    editor.commands.insertContent((blocks[0].content ?? []) as JSONContent);
    return;
  }
  editor.commands.insertContent(blocks as JSONContent);
}

function insertComposerNewline(editor: Editor) {
  const { $from } = editor.state.selection;
  const listItem = $from.node(-1);
  if (listItem?.type.name === "listItem") {
    if ($from.parent.content.size === 0) {
      editor.commands.liftListItem("listItem");
      return;
    }
    editor.commands.splitListItem("listItem");
    return;
  }
  editor.commands.splitBlock();
}

function isComposingKey(event: KeyboardEvent, composing: boolean) {
  return composing || event.isComposing || event.keyCode === 229;
}
