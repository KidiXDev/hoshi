import { invoke } from '@tauri-apps/api/core';
import { customSchemeUrl } from '../lib/customScheme';
import type { HistoryItem } from '../types/workflow';
import { withFileName } from '../utils/imageFiles';

export function dragHistoryImage(event: DragEvent, item: HistoryItem) {
  if (!event.dataTransfer || !item.imageUrl) return;
  const url = withFileName(item.imageUrl, item.filename);
  event.dataTransfer.effectAllowed = 'copy';
  event.dataTransfer.setData('text/uri-list', url);
  event.dataTransfer.setData('text/plain', url);
}

export const GALLERY_IMAGE_MIME = 'application/x-koharu-gallery-image';

export function dragOutputImage(event: DragEvent, image: OutputImage) {
  if (!event.dataTransfer) return;
  const url = withFileName(localImageUrl(image.localId), image.filename);
  event.dataTransfer.effectAllowed = 'copyLink';
  event.dataTransfer.setData(GALLERY_IMAGE_MIME, image.localId);
  event.dataTransfer.setData('text/uri-list', url);
  event.dataTransfer.setData('text/plain', url);
}

export function localImageUrl(localId: string, thumbnail = false): string {
  return customSchemeUrl(
    'koharu-image',
    `${thumbnail ? 'thumb' : 'full'}/${localId}`
  );
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

export function listOutputImages(
  workingDir: string,
  args: string[]
): Promise<OutputImage[]> {
  return invoke('list_output_images', { workingDir, args });
}

export function prepareOutputGallery(
  workingDir: string,
  args: string[]
): Promise<OutputImage[]> {
  return invoke('prepare_output_gallery', { workingDir, args });
}

export function refreshOutputImages(
  workingDir: string,
  args: string[]
): Promise<OutputImage[]> {
  return invoke('refresh_output_images', { workingDir, args });
}

export function clearGalleryCache(): Promise<void> {
  return invoke('clear_gallery_cache');
}

export function getGalleryCacheDirectory(): Promise<string> {
  return invoke('gallery_cache_directory');
}

export function readOutputImageMetadata(
  workingDir: string,
  args: string[],
  path: string
): Promise<OutputImageMetadata> {
  return invoke('read_output_image_metadata', { workingDir, args, path });
}

export function openComfyOutputFolder(
  workingDir: string,
  args: string[]
): Promise<void> {
  return invoke('open_comfy_output_folder', { workingDir, args });
}

export function saveImageAs(
  url: string,
  filename: string
): Promise<string | null> {
  return invoke('save_image_as', { url, filename });
}
