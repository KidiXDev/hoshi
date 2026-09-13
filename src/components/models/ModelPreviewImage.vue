<script setup lang="ts">
/**
 * Preview image with a shimmer placeholder while loading. Thumbnails are
 * generated on first request, so a blank frame could last a while.
 */
import { ref, watch, type Component } from 'vue';
import { Image as ImageIcon } from '@lucide/vue';
import { Skeleton } from '@/components/ui/skeleton';

const props = withDefaults(
  defineProps<{
    src: string;
    alt: string;
    /** Placeholder icon shown while loading. */
    icon?: Component;
    fit?: 'cover' | 'contain';
    imageClass?: string;
  }>(),
  { icon: ImageIcon, fit: 'cover', imageClass: '' }
);
const emit = defineEmits<{ load: []; error: [] }>();

const loaded = ref(false);
watch(
  () => props.src,
  () => {
    loaded.value = false;
  }
);

function onLoad() {
  loaded.value = true;
  emit('load');
}
</script>

<template>
  <div class="relative h-full w-full">
    <Skeleton
      v-if="!loaded"
      class="absolute inset-0 flex items-center justify-center rounded-none"
    >
      <component :is="icon" class="text-muted-foreground/50 h-8 w-8" />
    </Skeleton>
    <img
      :src="src"
      :alt="alt"
      class="h-full w-full transition-opacity duration-200"
      :class="[
        fit === 'cover' ? 'object-cover' : 'object-contain',
        loaded ? 'opacity-100' : 'opacity-0',
        imageClass
      ]"
      loading="lazy"
      decoding="async"
      draggable="false"
      @load="onLoad"
      @error="emit('error')"
    />
  </div>
</template>
