import { extractDimensions } from '@/composables/useImageBatch';
import {
  ComfyApi,
  firstOutputImage,
  historyEntryError
} from '@/services/comfyApi';
import { useComfyStore } from '@/stores/comfyStore';
import {
  useImageTransferStore,
  type TransferTarget
} from '@/stores/imageTransferStore';
import { useLauncherStore } from '@/stores/launcherStore';
import type { ImageBatchItem } from '@/types/imageBatch';
import { imageExtension } from '@/utils/imageFiles';
import { onUnmounted, ref, watch, type ComputedRef } from 'vue';

export type PromptBuilder = (imageName: string) => Record<string, unknown>;

interface BatchRunnerOptions {
  target: TransferTarget;
  uploadPrefix: string;
  outputNode?: string;
  createBuilder: () => PromptBuilder;
}

interface BatchQueue {
  readyItems: ComputedRef<ImageBatchItem[]>;
  addFiles: (files: Iterable<File>) => void;
}

function startTimer() {
  const start = Date.now();
  return () => Date.now() - start;
}

export function useBatchRunner(batch: BatchQueue, options: BatchRunnerOptions) {
  const comfyStore = useComfyStore();
  const launcherStore = useLauncherStore();
  const transferStore = useImageTransferStore();
  const isSubmitting = ref(false);
  const disposal = new AbortController();

  function fail(item: ImageBatchItem, error: unknown) {
    if (disposal.signal.aborted) return;
    item.status = 'error';
    item.error = error instanceof Error ? error.message : String(error);
  }

  async function collect(
    item: ImageBatchItem,
    serverUrl: string,
    promptId: string,
    elapsed: () => number
  ) {
    try {
      const entry = await ComfyApi.waitForHistory(
        serverUrl,
        promptId,
        disposal.signal
      );
      const failure = historyEntryError(entry);
      if (failure) throw new Error(failure);
      const image = firstOutputImage(entry.outputs, options.outputNode);
      if (!image) throw new Error('ComfyUI finished without an output image.');
      item.savedFilename = image.filename;
      item.subfolder = image.subfolder;
      item.type = image.type;
      item.resultUrl = ComfyApi.getViewImageUrl(
        serverUrl,
        image.filename,
        image.subfolder,
        image.type
      );
      item.status = 'done';
      item.durationMs = elapsed();
      const { width, height } = await extractDimensions(item.resultUrl);
      if (width > 0 && height > 0) {
        item.resultWidth = width;
        item.resultHeight = height;
      }
    } catch (error) {
      fail(item, error);
    }
  }

  async function submit(item: ImageBatchItem, build: PromptBuilder) {
    const serverUrl = launcherStore.config.serverUrl;
    item.status = 'uploading';
    item.error = undefined;
    const elapsed = startTimer();
    try {
      const uploaded = await ComfyApi.uploadImage(
        serverUrl,
        item.file,
        `${options.uploadPrefix}-${item.id}${imageExtension(item.file)}`
      );
      const queued = await ComfyApi.queuePrompt(
        serverUrl,
        build(uploaded.name),
        `${options.uploadPrefix}-${crypto.randomUUID()}`
      );
      item.status = 'queued';
      void collect(item, serverUrl, queued.prompt_id, elapsed);
    } catch (error) {
      fail(item, error);
    }
  }

  async function queueBatch() {
    if (isSubmitting.value || !comfyStore.isConnected) return;
    isSubmitting.value = true;
    try {
      const build = options.createBuilder();
      for (const item of batch.readyItems.value) await submit(item, build);
    } finally {
      isSubmitting.value = false;
    }
  }

  function retryItem(item: ImageBatchItem) {
    if (!comfyStore.isConnected) return;
    void submit(item, options.createBuilder());
  }

  watch(
    () => transferStore.pending[options.target].length,
    (count) => {
      if (count > 0) batch.addFiles(transferStore.consume(options.target));
    },
    { immediate: true }
  );

  onUnmounted(() => disposal.abort());

  return { isSubmitting, queueBatch, retryItem };
}
