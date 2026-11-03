import type {
  BridgeModelsResponse,
  BridgeSystemResponse,
  ComfyHistoryEntry,
  ComfyHistoryOutput,
  ComfyObjectInfo,
  ComfyPromptResponse,
  ComfyQueueResponse
} from '../types/comfy';
import { http, type RequestProgressCallback } from './httpClient';

class PromptLostError extends Error {
  constructor() {
    super(
      'ComfyUI no longer has this job; it was cleared or the server restarted.'
    );
  }
}

function abortableDelay(ms: number, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    signal?.throwIfAborted();
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        reject(signal.reason);
      },
      { once: true }
    );
  });
}

export function historyEntryError(entry: ComfyHistoryEntry): string | null {
  if (entry.status?.status_str !== 'error') return null;
  const failure = entry.status.messages.find(
    ([type]) => type === 'execution_error'
  )?.[1];
  return typeof failure?.exception_message === 'string'
    ? failure.exception_message
    : 'Execution failed in ComfyUI.';
}

export function firstOutputImage(
  outputs: Record<string, ComfyHistoryOutput> | undefined,
  nodeId?: string
) {
  const candidates = nodeId
    ? [outputs?.[nodeId]]
    : Object.values(outputs ?? {});
  const images = candidates.flatMap((output) => output?.images ?? []);
  return images.find((image) => image.type === 'output') ?? images[0];
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

  async fetchQueuedPromptIds(serverUrl: string): Promise<Set<string>> {
    const queue = await http.get<ComfyQueueResponse>(
      `${this.cleanUrl(serverUrl)}/queue`
    );
    return new Set(
      [...queue.queue_running, ...queue.queue_pending].map((item) => item[1])
    );
  },

  async waitForHistory(
    serverUrl: string,
    promptId: string,
    signal?: AbortSignal
  ): Promise<ComfyHistoryEntry> {
    let failures = 0;
    for (let poll = 1; ; poll++) {
      await abortableDelay(500, signal);
      try {
        const entry = (await this.fetchHistory(serverUrl, promptId))[promptId];
        if (entry) return entry;
        if (
          poll % 10 === 0 &&
          !(await this.fetchQueuedPromptIds(serverUrl)).has(promptId)
        ) {
          const late = (await this.fetchHistory(serverUrl, promptId))[promptId];
          if (late) return late;
          throw new PromptLostError();
        }
        failures = 0;
      } catch (error) {
        if (error instanceof PromptLostError) throw error;
        if (++failures >= 60)
          throw new Error(
            'Lost connection to ComfyUI while waiting for the result.',
            { cause: error }
          );
      }
    }
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
    const entry = await this.waitForHistory(serverUrl, queued.prompt_id);
    const failure = historyEntryError(entry);
    if (failure) throw new Error(`WD Tagger failed: ${failure}`);
    const output = entry.outputs?.['4']?.text;
    if (!output) throw new Error('WD Tagger did not return tags.');
    const text = (Array.isArray(output) ? output.join(', ') : output).trim();
    try {
      const parsed = JSON.parse(text) as unknown;
      return Array.isArray(parsed) ? parsed.join(', ') : text;
    } catch {
      return text;
    }
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
