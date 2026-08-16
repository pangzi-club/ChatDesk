import {
  File,
  FileCode2,
  FileImage,
  FileJson,
  Files,
  FileText,
  Folder,
  FolderOpen,
  GitBranch,
} from "lucide-react";
import type { ExplorerFileIconKind } from "@/lib/explorer-file-icon";
import { cn } from "@/lib/utils";

const ICONS = {
  folder: Folder,
  "folder-open": FolderOpen,
  files: Files,
  git: GitBranch,
  "code-ts": FileCode2,
  "code-js": FileCode2,
  code: FileCode2,
  json: FileJson,
  style: FileCode2,
  markup: FileCode2,
  doc: FileText,
  image: FileImage,
  file: File,
} as const;

export function ExplorerFileIcon({
  kind,
  className,
}: {
  kind: ExplorerFileIconKind;
  className?: string;
}) {
  const Icon = ICONS[kind];
  return (
    <Icon aria-hidden="true" className={cn("chat-explorer-file-icon", `is-${kind}`, className)} />
  );
}
