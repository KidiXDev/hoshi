import { carriesImage, imageFilesFromDataTransfer } from '@/utils/imageFiles';
import { useDropZone } from '@vueuse/core';
import type { MaybeRefOrGetter } from 'vue';

export function useImageDropZone(
  target: MaybeRefOrGetter<HTMLElement | null | undefined>,
  onImages: (files: File[]) => unknown,
  onError: (error: unknown) => void = console.error
) {
  const { isOverDropZone } = useDropZone(target, {
    checkValidity: carriesImage,
    onDrop: (_files, event) => {
      imageFilesFromDataTransfer(event.dataTransfer)
        .then(onImages)
        .catch(onError);
    }
  });
  return isOverDropZone;
}
