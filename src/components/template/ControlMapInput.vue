<script setup lang="ts">
import { ImagePlus, Loader2, Trash2, Upload } from '@lucide/vue';
import { computed, ref, useTemplateRef } from 'vue';
import { Button } from '@/components/ui/button';
import { useImageDropZone } from '@/composables/useImageDropZone';
import { imageExtension, isImageFile } from '@/utils/imageFiles';
import WorkflowField from './WorkflowField.vue';
import { ComfyApi } from '../../services/comfyApi';
import { useLauncherStore } from '../../stores/launcherStore';

const imageName = defineModel<string>({ required: true });
defineProps<{ label: string; hint: string }>();

const launcherStore = useLauncherStore();
const fileInput = useTemplateRef<HTMLInputElement>('fileInput');
const isUploading = ref(false);
const errorMessage = ref('');

const imageUrl = computed(() =>
  imageName.value
    ? ComfyApi.getViewImageUrl(
        launcherStore.config.serverUrl,
        imageName.value,
        '',
        'input'
      )
    : ''
);

function showError(error: unknown) {
  errorMessage.value = error instanceof Error ? error.message : String(error);
}

async function upload(file?: File) {
  if (!file) return;
  if (!isImageFile(file)) {
    errorMessage.value = 'Please choose an image file.';
    return;
  }
  isUploading.value = true;
  errorMessage.value = '';
  try {
    const uploaded = await ComfyApi.uploadImage(
      launcherStore.config.serverUrl,
      file,
      `koharu-${crypto.randomUUID()}${imageExtension(file)}`
    );
    imageName.value = uploaded.name;
  } catch (error) {
    showError(error);
  } finally {
    isUploading.value = false;
  }
}

function uploadPicked(event: Event) {
  const input = event.target as HTMLInputElement;
  void upload(input.files?.[0]);
  input.value = '';
}

const isDragging = useImageDropZone(
  useTemplateRef<HTMLElement>('dropZone'),
  (files) => upload(files[0]),
  showError
);
</script>

<template>
  <WorkflowField :label="label">
    <div
      ref="dropZone"
      class="border-border bg-muted/10 relative aspect-square overflow-hidden rounded-xl border"
      :class="[
        !imageUrl && 'border-dashed',
        isDragging && 'border-primary bg-primary/10 ring-primary/30 ring-2'
      ]"
    >
      <input
        ref="fileInput"
        type="file"
        accept="image/*"
        class="sr-only"
        @change="uploadPicked"
      />

      <template v-if="imageUrl">
        <img
          :src="imageUrl"
          :alt="label"
          class="h-full w-full object-contain"
        />
        <div
          class="bg-background/80 absolute top-2 right-2 flex items-center gap-1 rounded-lg border p-1 shadow-sm backdrop-blur-xs"
        >
          <Button
            type="button"
            size="icon"
            variant="ghost"
            class="h-7 w-7"
            :title="`Replace ${label}`"
            @click="fileInput?.click()"
          >
            <Upload class="h-3.5 w-3.5" />
          </Button>
          <Button
            type="button"
            size="icon"
            variant="ghost"
            class="hover:text-destructive hover:bg-destructive/10 h-7 w-7"
            :title="`Remove ${label}`"
            @click="imageName = ''"
          >
            <Trash2 class="h-3.5 w-3.5" />
          </Button>
        </div>
      </template>

      <button
        v-else
        type="button"
        class="hover:bg-muted/30 flex h-full w-full cursor-pointer flex-col items-center justify-center gap-2 p-3 text-center transition-colors"
        @click="fileInput?.click()"
      >
        <ImagePlus class="text-muted-foreground h-5 w-5" />
        <span class="text-muted-foreground text-xs">{{ hint }}</span>
      </button>

      <div
        v-if="isUploading"
        class="bg-background/80 absolute inset-0 flex items-center justify-center backdrop-blur-xs"
      >
        <Loader2 class="text-primary h-5 w-5 animate-spin" />
      </div>
    </div>
    <p v-if="errorMessage" class="text-destructive text-xs">
      {{ errorMessage }}
    </p>
  </WorkflowField>
</template>
