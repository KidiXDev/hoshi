import { invoke } from '@tauri-apps/api/core';

export interface DownloadRecord {
  gid: string;
  versionId: number;
  name: string;
  fileName: string;
  modelType: string;
  baseModel: string;
  modelPath: string;
  previewUrl?: string;
  status: 'active' | 'waiting' | 'paused' | 'complete' | 'error' | 'removed';
  completedLength: number;
  totalLength: number;
  downloadSpeed: number;
  errorMessage?: string;
  createdAt: number;
  fileExists?: boolean;
}

export function listDownloads() {
  return invoke<DownloadRecord[]>('list');
}

export function pauseDownload(gid: string) {
  return invoke('pause', { gid });
}

export function resumeDownload(gid: string) {
  return invoke('resume', { gid });
}

export function cancelDownload(gid: string) {
  return invoke('cancel', { gid });
}

export function clearDownloadHistory(gid?: string) {
  return invoke('clear_history', { gid });
}

export function retryDownload(gid: string) {
  return invoke('retry', { gid });
}

export function queueCivitaiDownload(options: {
  versionId: number;
  fileId?: number;
  workingDir: string;
  apiKey: string;
}) {
  return invoke<DownloadRecord>('download', options);
}

export function queueUrlDownload(options: {
  url: string;
  category: string;
  fileName: string;
  workingDir: string;
  args: string[];
}) {
  return invoke<DownloadRecord>('download_url', options);
}

export function normalizeDownloadUrl(url: string) {
  const trimmed = url.trim();
  return trimmed.startsWith('https://huggingface.co/')
    ? trimmed.replace('/blob/', '/resolve/')
    : trimmed;
}

export function fileNameFromUrl(url: string) {
  try {
    return decodeURIComponent(new URL(url).pathname.split('/').pop() ?? '');
  } catch {
    return '';
  }
}
