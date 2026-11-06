export type ImageBatchStatus =
  | 'ready'
  | 'uploading'
  | 'queued'
  | 'done'
  | 'error';

export interface ImageBatchItem {
  id: string;
  file: File;
  previewUrl: string;
  status: ImageBatchStatus;
  resultUrl?: string;
  savedFilename?: string;
  subfolder?: string;
  type?: string;
  error?: string;
  width?: number;
  height?: number;
  resultWidth?: number;
  resultHeight?: number;
  durationMs?: number;
}

export type ImageComparisonMode =
  | 'split'
  | 'side-by-side'
  | 'result'
  | 'original';
