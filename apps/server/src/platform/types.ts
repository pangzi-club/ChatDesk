import type {
  WorkspaceGitCommitResult,
  WorkspaceGitDiff,
  WorkspaceGitSummary,
  WorkspaceListResult,
  WorkspacePathSuggestionResult,
} from "@chatdesk/shared";
import type { SandboxMode } from "../protocol.ts";

export type PlatformCapabilities = {
  platform: NodeJS.Platform;
  git: boolean;
  shell: boolean;
  restrictedShell: boolean;
  processManagement: boolean;
};

export type {
  WorkspaceFileEntry,
  WorkspaceListResult,
  WorkspacePathSuggestion,
  WorkspacePathSuggestionResult,
} from "@chatdesk/shared";

export type WorkspaceReadResult = {
  path: string;
  content: string;
};

export type WorkspaceSearchResult = {
  query?: string;
  pattern?: string;
  matches: string[];
  truncated: boolean;
};

export type WorkspaceGitStatus = {
  isRepository: boolean;
  branch: string | null;
  ahead: number;
  behind: number;
  staged: number;
  modified: number;
  untracked: number;
  conflicted: number;
  clean: boolean;
};

export type WorkspaceCommit = {
  hash: string;
  shortHash: string;
  author: string;
  date: string;
  subject: string;
};

export type WorkspaceGitInfo = {
  pathExists: boolean;
  isRepository: boolean;
  status: WorkspaceGitStatus | null;
  commits: WorkspaceCommit[];
  error: string | null;
  summary: WorkspaceGitSummary | null;
};

export type ViteProcess = {
  pid: number;
  name: string;
  command: string;
  ports: number[];
};

export type PlatformAdapter = {
  capabilities(): PlatformCapabilities;
  resolveWorkspace(path: string): string;
  listDir(root: string, relativePath?: string): Promise<WorkspaceListResult>;
  readFile(root: string, relativePath: string): Promise<WorkspaceReadResult>;
  writeFile(
    root: string,
    relativePath: string,
    content: string,
  ): Promise<{ path: string; bytes: number }>;
  editFile(
    root: string,
    relativePath: string,
    oldText: string,
    newText: string,
  ): Promise<{ path: string; changed: true }>;
  searchFiles(
    root: string,
    options: { path?: string; pattern?: string; query?: string; maxResults?: number },
  ): Promise<WorkspaceSearchResult>;
  suggestWorkspacePaths(
    root: string,
    query: string,
    maxResults?: number,
  ): Promise<WorkspacePathSuggestionResult>;
  inspectGit(root: string): Promise<WorkspaceGitInfo>;
  readGitDiff(root: string, relativePath: string): Promise<WorkspaceGitDiff>;
  restoreGit(root: string, relativePath?: string): Promise<void>;
  commitGit(root: string, message?: string, push?: boolean): Promise<WorkspaceGitCommitResult>;
  pushGit(root: string): Promise<WorkspaceGitCommitResult>;
  runShell(
    root: string,
    command: string,
    mode: SandboxMode,
    relativeCwd?: string,
    allowOutside?: boolean,
    developerToolPaths?: string[],
  ): Promise<{ code: number; out: string }>;
  listViteProcesses(): Promise<ViteProcess[]>;
  killViteProcess(pid: number): Promise<void>;
};
