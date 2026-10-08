import { defineStore } from 'pinia';
import { ref } from 'vue';
import { fileFromUrl } from '../utils/imageFiles';

export type TransferTarget = 'upscaler' | 'remove-background' | 'face-detailer';

export const TRANSFER_TARGET_LABELS: Record<TransferTarget, string> = {
  upscaler: 'Upscaler',
  'remove-background': 'Remove Background',
  'face-detailer': 'Face Detailer'
};

export const useImageTransferStore = defineStore('imageTransfer', () => {
  const pending = ref<Record<TransferTarget, File[]>>({
    upscaler: [],
    'remove-background': [],
    'face-detailer': []
  });

  async function send(target: TransferTarget, url: string, filename?: string) {
    pending.value[target].push(await fileFromUrl(url, filename));
  }

  function consume(target: TransferTarget): File[] {
    return pending.value[target].splice(0);
  }

  return { pending, send, consume };
});
