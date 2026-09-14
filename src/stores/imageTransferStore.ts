import { defineStore } from 'pinia';
import { ref } from 'vue';

export interface PendingTransferImage {
  id: string;
  url: string;
  filename: string;
  file?: File;
}

async function urlToFile(url: string, filename: string): Promise<File> {
  try {
    const res = await fetch(url);
    const blob = await res.blob();
    const mime = blob.type || 'image/png';
    const cleanFilename =
      filename && filename.includes('.')
        ? filename
        : `${filename || 'image'}.png`;
    return new File([blob], cleanFilename, { type: mime });
  } catch {
    const cleanFilename =
      filename && filename.includes('.')
        ? filename
        : `${filename || 'image'}.png`;
    return new File([], cleanFilename, { type: 'image/png' });
  }
}

export const useImageTransferStore = defineStore('imageTransfer', () => {
  const pendingUpscaler = ref<PendingTransferImage[]>([]);
  const pendingRmbg = ref<PendingTransferImage[]>([]);
  const pendingFaceDetailer = ref<PendingTransferImage[]>([]);

  async function sendToUpscaler(url: string, filename = 'upscale_input.png') {
    const file = await urlToFile(url, filename);
    pendingUpscaler.value.push({
      id: crypto.randomUUID(),
      url,
      filename,
      file
    });
  }

  async function sendToRmbg(url: string, filename = 'rmbg_input.png') {
    const file = await urlToFile(url, filename);
    pendingRmbg.value.push({
      id: crypto.randomUUID(),
      url,
      filename,
      file
    });
  }

  async function sendToFaceDetailer(
    url: string,
    filename = 'face_detailer_input.png'
  ) {
    const file = await urlToFile(url, filename);
    pendingFaceDetailer.value.push({
      id: crypto.randomUUID(),
      url,
      filename,
      file
    });
  }

  function consumeUpscaler(): PendingTransferImage[] {
    const items = [...pendingUpscaler.value];
    pendingUpscaler.value = [];
    return items;
  }

  function consumeRmbg(): PendingTransferImage[] {
    const items = [...pendingRmbg.value];
    pendingRmbg.value = [];
    return items;
  }

  function consumeFaceDetailer(): PendingTransferImage[] {
    const items = [...pendingFaceDetailer.value];
    pendingFaceDetailer.value = [];
    return items;
  }

  return {
    pendingUpscaler,
    pendingRmbg,
    pendingFaceDetailer,
    sendToUpscaler,
    sendToRmbg,
    sendToFaceDetailer,
    consumeUpscaler,
    consumeRmbg,
    consumeFaceDetailer
  };
});
