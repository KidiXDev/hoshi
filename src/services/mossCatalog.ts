import { customSchemeUrl } from '@/lib/customScheme';
import type {
  MossCatalogEntry,
  MossCatalogFacets,
  MossCatalogPage,
  MossCatalogQuery
} from '@/types/mossCatalog';
import { invoke } from '@tauri-apps/api/core';

export const MOSS_CATALOG_URL =
  'https://huggingface.co/datasets/hide1/MOSS-Image-Character-Catalog';

export const MOSS_CATALOG_NOTE =
  'MOSS Catalog entries are uncurated synthetic samples. Tags and captions describe the reusable prompt, not verified canon appearance, and may be incomplete.';

export function searchMossCatalog(
  query: MossCatalogQuery
): Promise<MossCatalogPage> {
  return invoke<MossCatalogPage>('moss_catalog_search', { query });
}

export function getMossCatalogFacets(
  forceRefresh = false
): Promise<MossCatalogFacets> {
  return invoke<MossCatalogFacets>('moss_catalog_facets', { forceRefresh });
}

function mediaPath(folder: 'images' | 'thumbnails', id: string): string {
  return `${folder}/${id.slice(0, 2)}/${id}.webp`;
}

function mediaUrl(folder: 'images' | 'thumbnails', id: string): string {
  return customSchemeUrl('koharu-moss', mediaPath(folder, id));
}

export function mossRemoteImageUrl(entry: MossCatalogEntry): string {
  return `${MOSS_CATALOG_URL}/resolve/main/${mediaPath('images', entry.id)}`;
}

export function mossThumbnailUrl(entry: MossCatalogEntry): string {
  return mediaUrl('thumbnails', entry.id);
}

export function mossImageUrl(entry: MossCatalogEntry): string {
  return mediaUrl('images', entry.id);
}
