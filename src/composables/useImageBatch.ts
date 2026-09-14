import type { ImageBatchItem } from '@/types/imageBatch';
import {
  computed,
  onActivated,
  onDeactivated,
  onUnmounted,
  reactive,
  ref,
  watch
} from 'vue';
const IMAGE_FILE_NAME = /\.(?:avif|bmp|gif|jpe?g|png|tiff?|webp)$/iu;
export async function extractDimensions(
  url: string
): Promise<{ width: number; height: number }> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      resolve({ width: img.naturalWidth, height: img.naturalHeight });
    };
    img.onerror = () => {
      resolve({ width: 0, height: 0 });
    };
    img.src = url;
  });
}
export function useImageBatch() {
  let disposed = false;
  const fileInput = ref<HTMLInputElement>();
  const items = ref<ImageBatchItem[]>([]);
  const selectedItemId = ref<string | null>(null);
  const isDragging = ref(false);
  const isDraggingQueue = ref(false);
  watch(
    () => items.value.length,
    (newCount) => {
      if (newCount === 0) {
        selectedItemId.value = null;
      } else if (
        !selectedItemId.value ||
        !items.value.some((it) => it.id === selectedItemId.value)
      ) {
        selectedItemId.value = items.value[0]?.id ?? null;
      }
    }
  );

  const activeItem = computed(() =>
    items.value.find((item) => item.id === selectedItemId.value)
  );

  const readyItems = computed(() =>
    items.value.filter(
      (item) => item.status === 'ready' || item.status === 'error'
    )
  );

  const processingItems = computed(() =>
    items.value.filter(
      (item) => item.status === 'uploading' || item.status === 'queued'
    )
  );

  const completedItems = computed(() =>
    items.value.filter((item) => item.status === 'done')
  );

  const overallProgress = computed(() => {
    if (items.value.length === 0) return 0;
    return Math.round((completedItems.value.length / items.value.length) * 100);
  });

  function addFiles(files: Iterable<File>) {
    if (disposed) return;
    for (const file of files) {
      if (!file.type.startsWith('image/') && !IMAGE_FILE_NAME.test(file.name)) {
        continue;
      }
      const previewUrl = URL.createObjectURL(file);
      const item = reactive<ImageBatchItem>({
        id: crypto.randomUUID(),
        file,
        previewUrl,
        status: 'ready'
      });
      items.value.push(item);
      if (!selectedItemId.value) {
        selectedItemId.value = item.id;
      }

      void extractDimensions(previewUrl).then(({ width, height }) => {
        if (width > 0 && height > 0) {
          item.width = width;
          item.height = height;
        }
      });
    }
  }
  function handleFileInput(event: Event) {
    addFiles(Array.from((event.target as HTMLInputElement).files ?? []));
    if (fileInput.value) fileInput.value.value = '';
  }
  async function handleDrop(event: DragEvent) {
    isDragging.value = false;
    isDraggingQueue.value = false;
    const files = Array.from(event.dataTransfer?.files ?? []);
    if (files.length > 0) {
      addFiles(files);
      return;
    }
    const droppedUrl = event.dataTransfer
      ?.getData('text/uri-list')
      .split(/\r?\n/u)
      .find((url) => url && !url.startsWith('#'));
    if (!droppedUrl) return;
    try {
      const response = await fetch(droppedUrl);
      if (!response.ok) return;
      const blob = await response.blob();
      const name = droppedUrl.split('/').pop()?.split('?')[0] || 'image.png';
      addFiles([new File([blob], name, { type: blob.type })]);
    } catch {
      // Unsupported remote drops are ignored.
    }
  }
  function handleGlobalPaste(event: ClipboardEvent) {
    const clipboardItems = event.clipboardData?.items;
    if (!clipboardItems) return;
    const imageFiles: File[] = [];
    for (const item of Array.from(clipboardItems)) {
      if (item.type.startsWith('image/')) {
        const file = item.getAsFile();
        if (file) {
          const namedFile = new File(
            [file],
            `pasted_image_${Date.now()}.${item.type.split('/')[1] || 'png'}`,
            { type: file.type }
          );
          imageFiles.push(namedFile);
        }
      }
    }
    if (imageFiles.length > 0) {
      event.preventDefault();
      addFiles(imageFiles);
    }
  }
  function handleDragEnterViewport(e: DragEvent) {
    e.preventDefault();
    isDragging.value = true;
  }
  function handleDragLeaveViewport(e: DragEvent) {
    const currentTarget = e.currentTarget as HTMLElement | null;
    const relatedTarget = e.relatedTarget as Node | null;
    if (
      !currentTarget ||
      !relatedTarget ||
      !currentTarget.contains(relatedTarget)
    ) {
      isDragging.value = false;
    }
  }
  function removeItem(item: ImageBatchItem) {
    URL.revokeObjectURL(item.previewUrl);
    items.value = items.value.filter((candidate) => candidate.id !== item.id);
    if (selectedItemId.value === item.id) {
      selectedItemId.value = items.value[0]?.id ?? null;
    }
  }
  function clearItems() {
    for (const item of items.value) URL.revokeObjectURL(item.previewUrl);
    items.value = [];
    selectedItemId.value = null;
  }
  onActivated(() => window.addEventListener('paste', handleGlobalPaste));
  onDeactivated(() => window.removeEventListener('paste', handleGlobalPaste));
  onUnmounted(() => {
    disposed = true;
    window.removeEventListener('paste', handleGlobalPaste);
    clearItems();
  });
  return {
    fileInput,
    items,
    selectedItemId,
    isDragging,
    isDraggingQueue,
    activeItem,
    readyItems,
    processingItems,
    completedItems,
    overallProgress,
    addFiles,
    handleFileInput,
    handleDrop,
    handleDragEnterViewport,
    handleDragLeaveViewport,
    removeItem,
    clearItems
  };
}
