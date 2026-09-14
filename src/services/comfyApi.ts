import type {
  BridgeModelsResponse,
  BridgeSystemResponse,
  ComfyHistoryEntry,
  ComfyObjectInfo,
  ComfyPromptResponse
} from '../types/comfy';
import { http, type RequestProgressCallback } from './httpClient';

export interface AutocompleteItem {
  label: string;
  insert_text: string;
  category: number | string;
  total_post: number;
  kind?: 'wildcard';
}

export type AutocompleteSearchMode = 'tag' | 'artist' | 'wildcard';

export interface TagAutocompleteSettings {
  search_algorithm: 'fuzzy' | 'contains' | 'prefix';
  search_limit: number;
}

export interface ModelMetadata {
  name: string;
  base_model: string | null;
}

export interface UploadedImage {
  name: string;
  subfolder: string;
  type: string;
}

export interface WdTaggerSettings {
  modelName: string;
  generalThreshold: number;
  characterThreshold: number;
  addRating: boolean;
  excludeTags: string;
}

export const ComfyApi = {
  cleanUrl(serverUrl: string): string {
    return serverUrl.trim().replace(/\/+$/u, '');
  },

  async checkHealth(serverUrl: string): Promise<boolean> {
    const base = this.cleanUrl(serverUrl);
    try {
      await http.get(`${base}/system_stats`, { timeout: 2500 });
      return true;
    } catch {}

    try {
      await http.get(`${base}/prompt`, { timeout: 2500 });
      return true;
    } catch {}

    return false;
  },

  async fetchObjectInfo(serverUrl: string): Promise<ComfyObjectInfo> {
    const url = `${this.cleanUrl(serverUrl)}/object_info`;
    return await http.get<ComfyObjectInfo>(url);
  },

  async queuePrompt(
    serverUrl: string,
    prompt: Record<string, unknown>,
    clientId: string
  ): Promise<ComfyPromptResponse> {
    const url = `${this.cleanUrl(serverUrl)}/prompt`;
    return await http.post<ComfyPromptResponse>(url, {
      prompt,
      client_id: clientId
    });
  },

  async fetchHistory(
    serverUrl: string,
    promptId: string
  ): Promise<Record<string, ComfyHistoryEntry>> {
    const url = `${this.cleanUrl(serverUrl)}/history/${promptId}`;
    return await http.get<Record<string, ComfyHistoryEntry>>(url);
  },

  async interrupt(serverUrl: string): Promise<void> {
    const url = `${this.cleanUrl(serverUrl)}/interrupt`;
    await http.post(url);
  },

  async shutdown(serverUrl: string): Promise<boolean> {
    try {
      await http.post(
        `${this.cleanUrl(serverUrl)}/koharu/shutdown`,
        undefined,
        {
          timeout: 3000
        }
      );
      return true;
    } catch {
      return false;
    }
  },

  async uploadImage(
    serverUrl: string,
    file: Blob,
    name: string,
    onProgress?: RequestProgressCallback
  ): Promise<UploadedImage> {
    const form = new FormData();
    form.append('image', file, name);
    form.append('type', 'input');
    form.append('overwrite', 'true');
    return await http.upload<UploadedImage>(
      `${this.cleanUrl(serverUrl)}/upload/image`,
      form,
      onProgress
    );
  },

  async fetchNodeInfo(serverUrl: string, classType: string) {
    try {
      const data = await http.get<ComfyObjectInfo>(
        `${this.cleanUrl(serverUrl)}/object_info/${encodeURIComponent(classType)}`
      );
      return data[classType] ?? null;
    } catch {
      return null;
    }
  },

  async runWdTagger(
    serverUrl: string,
    imageName: string,
    settings: WdTaggerSettings
  ): Promise<string> {
    const prompt = {
      '1': {
        inputs: {
          model_name: settings.modelName,
          dtype: 'auto',
          general_threshold: settings.generalThreshold,
          character_threshold: settings.characterThreshold,
          add_rating: settings.addRating,
          exclude_tags: settings.excludeTags,
          batch_size: 1,
          image: ['2', 0]
        },
        class_type: 'WDTimmTagger'
      },
      '2': {
        inputs: { image: imageName },
        class_type: 'LoadImage'
      },
      '4': {
        inputs: { source: ['1', 0] },
        class_type: 'PreviewAny'
      }
    };
    const clientId = `koharu-tagger-${crypto.randomUUID()}`;
    const queued = await this.queuePrompt(serverUrl, prompt, clientId);
    for (let attempt = 0; attempt < 240; attempt++) {
      await new Promise<void>((resolve) => {
        setTimeout(resolve, 500);
      });
      const entry = (await this.fetchHistory(serverUrl, queued.prompt_id))[
        queued.prompt_id
      ];
      const output = entry?.outputs?.['4']?.text;
      if (output) {
        const text = (
          Array.isArray(output) ? output.join(', ') : output
        ).trim();
        try {
          const parsed = JSON.parse(text) as unknown;
          if (Array.isArray(parsed)) return parsed.join(', ');
        } catch {
          // The tagger may already return a plain prompt string.
        }
        return text;
      }
      if (entry?.status?.status_str === 'error') {
        throw new Error('WD Tagger execution failed.');
      }
      if (entry?.status?.completed) break;
    }
    throw new Error('WD Tagger did not return tags.');
  },

  async fetchBridgeModels(
    serverUrl: string
  ): Promise<BridgeModelsResponse | null> {
    const url = `${this.cleanUrl(serverUrl)}/koharu/models`;
    try {
      return await http.get<BridgeModelsResponse>(url, { timeout: 3000 });
    } catch {
      // Bridge not installed or server not ready
      return null;
    }
  },

  async fetchBridgeSystem(
    serverUrl: string
  ): Promise<BridgeSystemResponse | null> {
    const url = `${this.cleanUrl(serverUrl)}/koharu/system`;
    try {
      return await http.get<BridgeSystemResponse>(url, { timeout: 3000 });
    } catch {
      // Bridge not installed
      return null;
    }
  },

  async refreshBridgeModels(serverUrl: string): Promise<boolean> {
    const url = `${this.cleanUrl(serverUrl)}/koharu/refresh`;
    try {
      await http.post(url, undefined, { timeout: 3000 });
      return true;
    } catch {
      return false;
    }
  },

  async searchTags(
    serverUrl: string,
    query: string,
    limit: number,
    mode: AutocompleteSearchMode = 'tag',
    signal?: AbortSignal
  ): Promise<AutocompleteItem[]> {
    const base = this.cleanUrl(serverUrl);
    const params = new URLSearchParams({ q: query, limit: String(limit) });
    if (mode === 'artist') params.set('category', '1');
    if (mode === 'wildcard') params.set('mode', 'wildcard');
    try {
      const payload = await http.get<{ items?: AutocompleteItem[] }>(
        `${base}/yet_essential/autocomplete/search?${params.toString()}`,
        { signal }
      );
      return payload.items ?? [];
    } catch {
      return [];
    }
  },

  async updateTagAutocompleteSettings(
    serverUrl: string,
    algorithm: 'fuzzy' | 'contains' | 'prefix',
    limit: number
  ): Promise<boolean> {
    try {
      await http.post(
        `${this.cleanUrl(serverUrl)}/yet_essential/settings/update`,
        {
          search_algorithm: algorithm,
          search_limit: limit
        }
      );
      return true;
    } catch {
      return false;
    }
  },

  async fetchTagAutocompleteSettings(
    serverUrl: string
  ): Promise<TagAutocompleteSettings | null> {
    try {
      const settings = await http.get<Partial<TagAutocompleteSettings>>(
        `${this.cleanUrl(serverUrl)}/yet_essential/settings/get`,
        { timeout: 2500 }
      );
      if (
        !['fuzzy', 'contains', 'prefix'].includes(
          settings.search_algorithm ?? ''
        ) ||
        !Number.isFinite(settings.search_limit)
      ) {
        return null;
      }
      return settings as TagAutocompleteSettings;
    } catch {
      return null;
    }
  },

  async checkTagAutocomplete(serverUrl: string): Promise<boolean> {
    return (await this.fetchTagAutocompleteSettings(serverUrl)) !== null;
  },

  async fetchModelMetadata(
    serverUrl: string,
    folderType: string
  ): Promise<ModelMetadata[]> {
    try {
      const params = new URLSearchParams({ type: folderType });
      return await http.get<ModelMetadata[]>(
        `${this.cleanUrl(serverUrl)}/yet_essential/model/metadata?${params}`
      );
    } catch {
      return [];
    }
  },

  getViewImageUrl(
    serverUrl: string,
    filename: string,
    subfolder = '',
    type = 'output'
  ): string {
    const base = this.cleanUrl(serverUrl);
    const params = new URLSearchParams({
      filename,
      subfolder,
      type
    });
    return `${base}/view?${params.toString()}`;
  },

  getModelPreviewUrl(
    serverUrl: string,
    category:
      'checkpoints' | 'unet' | 'diffusion_models' | 'loras' | 'vae' | 'clip',
    name: string,
    res = 300
  ): string {
    const base = this.cleanUrl(serverUrl);
    const params = new URLSearchParams({
      type: category,
      name,
      res: String(res)
    });
    return `${base}/koharu/model_preview?${params.toString()}`;
  }
};
