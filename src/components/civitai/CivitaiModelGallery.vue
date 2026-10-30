<script setup lang="ts">
import {
  computed,
  onActivated,
  onMounted,
  ref,
  useTemplateRef,
  watch
} from 'vue';
import { useElementVisibility } from '@vueuse/core';
import { Heart, ImageOff, Loader2, RefreshCw, Video } from '@lucide/vue';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useCivitaiModelImagesQuery } from '@/composables/useCivitaiQueries';
import { loadAppData } from '@/services/appStorage';
import {
  civitaiPreviewUrl,
  isVideoMedia,
  type CivitaiGalleryImage
} from '@/services/civitai';

const props = defineProps<{ versionId: number }>();
const emit = defineEmits<{ open: [image: CivitaiGalleryImage] }>();

const settings = ref<{ apiKey: string; nsfw: boolean } | null>(null);

async function loadSettings() {
  const saved = await loadAppData<{ apiKey?: string; nsfw?: boolean }>(
    'civitai_settings'
  ).catch(() => null);
  settings.value = {
    apiKey: saved?.apiKey?.trim() ?? '',
    nsfw: saved?.nsfw ?? false
  };
}

onMounted(loadSettings);
onActivated(loadSettings);

const query = useCivitaiModelImagesQuery(() => props.versionId, settings);
const images = computed(
  () => query.data.value?.pages.flatMap((page) => page.items) ?? []
);

const sentinel = useTemplateRef<HTMLElement>('sentinel');
const sentinelVisible = useElementVisibility(sentinel, {
  rootMargin: '600px'
});

watch(
  [
    sentinelVisible,
    query.hasNextPage,
    query.isFetching,
    query.isFetchNextPageError
  ],
  ([visible, hasNext, fetching, failed]) => {
    if (visible && hasNext && !fetching && !failed) void query.fetchNextPage();
  }
);

const compactNumber = new Intl.NumberFormat('en', { notation: 'compact' });

function reactions(image: CivitaiGalleryImage) {
  return (image.stats?.likeCount ?? 0) + (image.stats?.heartCount ?? 0);
}
</script>

<template>
  <section class="border-border/60 flex flex-col gap-4 border-t pt-6">
    <div class="flex flex-wrap items-baseline justify-between gap-2">
      <h2 class="text-foreground text-xl font-bold tracking-tight">Gallery</h2>
      <span class="text-muted-foreground text-xs">
        Community images made with this version
      </span>
    </div>

    <div
      v-if="query.isPending.value"
      class="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5"
    >
      <Skeleton v-for="n in 10" :key="n" class="aspect-3/4 rounded-lg" />
    </div>

    <div
      v-else-if="query.isError.value"
      class="text-muted-foreground flex flex-col items-center gap-3 py-8 text-xs"
      role="alert"
    >
      <span>Couldn't load the gallery: {{ String(query.error.value) }}</span>
      <Button variant="outline" size="sm" @click="query.refetch()">
        <RefreshCw class="h-3.5 w-3.5" />
        Try Again
      </Button>
    </div>

    <div
      v-else-if="images.length === 0"
      class="text-muted-foreground flex flex-col items-center gap-2 py-8 text-xs"
    >
      <ImageOff class="h-8 w-8 opacity-50" />
      <span>No community images for this version yet.</span>
    </div>

    <div
      v-else
      class="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5"
    >
      <button
        v-for="image in images"
        :key="image.id"
        type="button"
        class="group border-border/60 bg-muted relative aspect-3/4 cursor-pointer overflow-hidden rounded-lg border"
        :aria-label="`Open image by ${image.username || 'unknown creator'}`"
        @click="emit('open', image)"
      >
        <video
          v-if="isVideoMedia(image)"
          :src="civitaiPreviewUrl(image.url, 450)"
          muted
          loop
          playsinline
          preload="metadata"
          class="h-full w-full object-cover"
        />
        <img
          v-else
          :src="civitaiPreviewUrl(image.url, 450)"
          alt=""
          loading="lazy"
          draggable="false"
          class="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
        />
        <Video
          v-if="isVideoMedia(image)"
          class="pointer-events-none absolute top-2 right-2 h-4 w-4 text-white drop-shadow"
        />
        <div
          class="pointer-events-none absolute inset-x-0 bottom-0 flex items-center justify-between gap-2 bg-linear-to-t from-black/85 via-black/40 to-transparent px-2 pt-6 pb-1.5 text-xs text-white"
        >
          <span class="truncate">{{ image.username }}</span>
          <span class="flex shrink-0 items-center gap-1">
            <Heart class="h-3 w-3" />
            {{ compactNumber.format(reactions(image)) }}
          </span>
        </div>
      </button>
    </div>

    <div ref="sentinel" class="flex justify-center py-2">
      <Loader2
        v-if="query.isFetchingNextPage.value"
        class="text-muted-foreground h-5 w-5 animate-spin"
      />
      <Button
        v-else-if="query.isFetchNextPageError.value"
        variant="outline"
        size="sm"
        @click="query.fetchNextPage()"
      >
        <RefreshCw class="h-3.5 w-3.5" />
        Load more
      </Button>
    </div>
  </section>
</template>
