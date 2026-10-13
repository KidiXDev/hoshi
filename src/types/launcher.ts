export type ProcessStatus =
  'stopped' | 'starting' | 'stopping' | 'running' | 'error';

export interface LauncherConfig {
  workingDir: string;
  pythonPath: string;
  args: string;
  serverUrl: string;
  autoStart: boolean;
  closeToTray: boolean;
  autocompleteEnabled: boolean;
  autocompleteAlgorithm: 'fuzzy' | 'contains' | 'prefix';
  autocompleteLimit: number;
  autocompleteReplaceUnderscores: boolean;
  autocompleteIncludeArtistPrefix: boolean;
  autocompleteEscapeParentheses: boolean;
  promptEditorMode: boolean;
}

export interface ComfyCommit {
  id: string;
  summary: string;
  author: string;
  timestamp: number;
}

export interface ComfyUpdateStatus {
  version: string;
  branch: string;
  commit: string;
  remoteCommit: string;
  ahead: number;
  behind: number;
  commits: ComfyCommit[];
}

export interface LogEntry {
  id: string;
  stream: 'stdout' | 'stderr' | 'system';
  message: string;
  timestamp: number;
}
