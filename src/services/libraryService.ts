import { invoke } from '@tauri-apps/api/core';
import type {
  LibraryCategory,
  LibraryItem,
  LibraryListEntry,
  SaveLibraryItemPayload
} from '../types/library';

// Internal raw shape returned by Rust (camelCase from serde rename_all)

interface RawItem<T = unknown> {
  id: string;
  category: string;
  name: string;
  description?: string;
  thumbnailId?: string;
  createdAt: number;
  updatedAt: number;
  data: T;
}

// Thumbnail URL builder

function thumbnailUrl(thumbnailId: string): string {
  const id = encodeURIComponent(thumbnailId);
  return typeof navigator !== 'undefined' &&
    navigator.userAgent.includes('Windows')
    ? `http://koharu-library.localhost/thumb/${id}`
    : `koharu-library://localhost/thumb/${id}`;
}

function hydrateThumbnail(entry: {
  thumbnailId?: string;
  thumbnailUrl?: string;
}) {
  if (entry.thumbnailId) {
    entry.thumbnailUrl = thumbnailUrl(entry.thumbnailId);
  }
}

export function isBooruMediaUrl(url: string): boolean {
  const parsedUrl = new URL(url);
  return (
    parsedUrl.hostname === 'booru-image.localhost' ||
    parsedUrl.protocol === 'booru-image:'
  );
}

/** Custom-scheme URLs only the webview can fetch (Rust's reqwest cannot). */
function isWebviewOnlyUrl(url: string): boolean {
  const parsedUrl = new URL(url);
  return (
    isBooruMediaUrl(url) ||
    parsedUrl.hostname === 'koharu-library.localhost' ||
    parsedUrl.protocol === 'koharu-library:'
  );
}

// LibraryService

export const LibraryService = {
  async listItems<T = unknown>(
    category: LibraryCategory
  ): Promise<LibraryListEntry<T>[]> {
    try {
      const raw = await invoke<RawItem<T>[]>('library_list_items', {
        category
      });
      return raw.map((entry) => {
        const item: LibraryListEntry<T> = { ...entry };
        hydrateThumbnail(item);
        return item;
      });
    } catch (err) {
      console.warn(`[LibraryService] listItems(${category}) error:`, err);
      return [];
    }
  },

  async getItem<T>(
    id: string,
    category: LibraryCategory
  ): Promise<LibraryItem<T>> {
    const raw = await invoke<RawItem<T>>('library_get_item', { id, category });
    const item: LibraryItem<T> = { ...raw } as LibraryItem<T>;
    hydrateThumbnail(item);
    return item;
  },

  /**
   * Create or update a library item. Pass id='' or omit to let the backend generate one.
   */
  async saveItem<T>(item: SaveLibraryItemPayload<T>): Promise<LibraryItem<T>> {
    const payload = {
      id: item.id ?? '',
      category: item.category,
      name: item.name,
      description: item.description,
      thumbnailId: item.thumbnailId,
      data: item.data,
      createdAt: item.createdAt ?? 0,
      updatedAt: item.updatedAt ?? 0
    };
    const raw = await invoke<RawItem<T>>('library_save_item', {
      item: payload
    });
    const saved: LibraryItem<T> = { ...raw } as LibraryItem<T>;
    hydrateThumbnail(saved);
    return saved;
  },

  async deleteItem(id: string, category: LibraryCategory): Promise<void> {
    await invoke('library_delete_item', { id, category });
  },

  /**
   * Copy an image file from disk into the thumbnails folder (re-encoded as JPEG).
   * Returns the thumbnail_id which should be stored on the LibraryItem.
   */
  async saveThumbnailFromPath(
    itemId: string,
    sourcePath: string
  ): Promise<string> {
    return await invoke<string>('library_save_thumbnail_from_path', {
      itemId,
      sourcePath
    });
  },

  /**
   * Save a base64 data-URL image as the thumbnail for an item.
   * Returns the thumbnail_id.
   */
  async saveThumbnailFromDataUrl(
    itemId: string,
    dataUrl: string
  ): Promise<string> {
    return await invoke<string>('library_save_thumbnail_from_data_url', {
      itemId,
      dataUrl
    });
  },

  /**
   * Fetch an image from a URL and store as item thumbnail.
   * Uses native Rust download to bypass any browser CORS restrictions.
   * Returns the thumbnail_id.
   */
  async saveThumbnailFromUrl(itemId: string, url: string): Promise<string> {
    if (url.startsWith('data:')) {
      return this.saveThumbnailFromDataUrl(itemId, url);
    }
    if (isWebviewOnlyUrl(url)) {
      const response = await fetch(url);
      if (!response.ok)
        throw new Error(`Server returned HTTP ${response.status}`);
      const blob = await response.blob();
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(blob);
      });
      return this.saveThumbnailFromDataUrl(itemId, dataUrl);
    }
    return await invoke<string>('library_save_thumbnail_from_url', {
      itemId,
      url
    });
  },

  async openFolder(category?: LibraryCategory): Promise<void> {
    try {
      await invoke('library_open_folder', {
        category: category ?? null
      });
    } catch (err) {
      console.warn('[LibraryService] openFolder error:', err);
    }
  },

  getThumbnailUrl(thumbnailId: string): string {
    return thumbnailUrl(thumbnailId);
  }
};
