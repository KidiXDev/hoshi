import { invoke } from '@tauri-apps/api/core';
import type { HistoryItem } from '../types/workflow';

export function dragHistoryImage(event: DragEvent, item: HistoryItem) {
  if (!event.dataTransfer || !item.imageUrl) return;
  event.dataTransfer.effectAllowed = 'copy';
  event.dataTransfer.setData('text/uri-list', item.imageUrl);
  event.dataTransfer.setData('text/plain', item.imageUrl);
}

/** Custom MIME type carrying a gallery image's `localId` during HTML5 drag. */
export const GALLERY_IMAGE_MIME = 'application/x-koharu-gallery-image';

/**
 * Starts dragging a gallery card. Sets `text/uri-list` (so Upscaler/RMBG/Face
 * Detailer dropzones can fetch the image) plus our own type for A/B compare.
 */
export function dragOutputImage(event: DragEvent, image: OutputImage) {
  if (!event.dataTransfer) return;
  const url = localImageUrl(image.localId, false);
  event.dataTransfer.effectAllowed = 'copyLink';
  event.dataTransfer.setData(GALLERY_IMAGE_MIME, image.localId);
  event.dataTransfer.setData('text/uri-list', url);
  event.dataTransfer.setData('text/plain', url);
}

export function localImageUrl(localId: string, thumbnail = false): string {
  const kind = thumbnail ? 'thumb' : 'full';
  return navigator.userAgent.includes('Windows')
    ? `http://koharu-image.localhost/${kind}/${localId}`
    : `koharu-image://localhost/${kind}/${localId}`;
}

export function resolveHistoryImages(
  workingDir: string,
  args: string[],
  images: HistoryItem[]
) {
  return invoke<Record<string, string>>('resolve_history_images', {
    workingDir,
    args,
    images: images.map(({ id, filename, subfolder, type }) => ({
      id,
      filename,
      subfolder,
      type
    }))
  });
}

export interface OutputImage {
  localId: string;
  path: string;
  filename: string;
  subfolder: string;
  extension: string;
  fileSize: number;
  modifiedMs: number;
  prompt: string;
  model: string;
}

export interface OutputImageMetadata {
  width: number;
  height: number;
  prompt: string;
  negativePrompt: string;
  model: string;
  sampler: string;
  scheduler: string;
  seed: string;
  steps: string;
  cfg: string;
  rawPrompt: string;
  rawWorkflow: string;
}

export function listOutputImages(workingDir: string): Promise<OutputImage[]> {
  return invoke('list_output_images', { workingDir });
}

export function prepareOutputGallery(
  workingDir: string
): Promise<OutputImage[]> {
  return invoke('prepare_output_gallery', { workingDir });
}

export function clearGalleryCache(): Promise<void> {
  return invoke('clear_gallery_cache');
}

export function getGalleryCacheDirectory(): Promise<string> {
  return invoke('gallery_cache_directory');
}

export function refreshOutputImages(
  workingDir: string
): Promise<OutputImage[]> {
  return invoke('refresh_output_images', { workingDir });
}

export function readOutputImageMetadata(
  workingDir: string,
  path: string
): Promise<OutputImageMetadata> {
  return invoke('read_output_image_metadata', { workingDir, path });
}
