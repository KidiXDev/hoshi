export type ProcessStatus =
  'stopped' | 'starting' | 'stopping' | 'running' | 'error';

export interface LauncherConfig {
  workingDir: string;
  pythonPath: string;
  args: string;
  serverUrl: string;
  autoStart: boolean;
  autocompleteEnabled: boolean;
  autocompleteAlgorithm: 'fuzzy' | 'contains' | 'prefix';
  autocompleteLimit: number;
  autocompleteReplaceUnderscores: boolean;
  autocompleteIncludeArtistPrefix: boolean;
  autocompleteEscapeParentheses: boolean;
}

export interface LogEntry {
  id: string;
  stream: 'stdout' | 'stderr' | 'system';
  message: string;
  timestamp: number;
}
