<script setup lang="ts">
/**
 * Left-column stage for a model without a Civitai page: the local preview
 * image (click to enlarge) or a category placeholder.
 */
import { computed, ref, watch } from 'vue';
import { Box, Layers, Maximize2 } from '@lucide/vue';
import { Button } from '@/components/ui/button';
import ImageLightboxModal from '@/components/common/ImageLightboxModal.vue';
import ModelPreviewImage from './ModelPreviewImage.vue';
import { modelPreviewUrl, type LocalModel } from '@/services/modelManager';

const props = defineProps<{ model: LocalModel }>();

const failed = ref(false);
const lightboxOpen = ref(false);
const src = computed(() =>
  props.model.previewPath && !failed.value
    ? modelPreviewUrl(props.model, false)
    : ''
);
const icon = computed(() => (props.model.category === 'loras' ? Layers : Box));

watch(
  () => [props.model.previewPath, props.model.previewModifiedMs],
  () => {
    failed.value = false;
  }
);
</script>

<template>
  <div
    class="border-border/60 group relative aspect-3/4 max-h-150 w-full overflow-hidden rounded-2xl border bg-black/40 shadow-md"
  >
    <ModelPreviewImage
      v-if="src"
      :key="src"
      :src="src"
      :alt="`${model.filename} preview`"
      :icon="icon"
      fit="contain"
      image-class="cursor-zoom-in"
      @error="failed = true"
      @click="lightboxOpen = true"
    />
    <div
      v-else
      class="text-muted-foreground flex h-full flex-col items-center justify-center gap-2"
    >
      <component :is="icon" class="h-12 w-12 opacity-60" />
      <span class="text-xs">No preview image</span>
      <span class="text-xs opacity-70">
        Use “Set preview” above to pick one, or sync with Civitai.
      </span>
    </div>
    <Button
      v-if="src"
      size="iconSm"
      variant="secondary"
      class="absolute top-3 right-3 h-8 w-8 rounded-full border border-white/20 bg-black/60 text-white opacity-0 shadow-md transition-opacity group-hover:opacity-100 hover:bg-black/80"
      title="Open fullscreen"
      @click="lightboxOpen = true"
    >
      <Maximize2 class="h-3.5 w-3.5" />
    </Button>

    <ImageLightboxModal
      v-model:open="lightboxOpen"
      :src="src"
      :alt="model.filename"
      :title="model.filename"
    />
  </div>
</template>
