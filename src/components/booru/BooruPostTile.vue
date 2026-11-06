<script setup lang="ts">
import { computed, onMounted, shallowRef, useTemplateRef, watch } from 'vue';
import {
  ArrowUp,
  Copy,
  ExternalLink,
  Heart,
  Image as ImageIcon,
  RotateCw,
  ZoomIn
} from '@lucide/vue';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger
} from '@/components/ui/context-menu';
import { getBooruMediaUrl, type BooruPost } from '@/services/booruGallery';
import type { PositionedBox } from '@/utils/booruGridLayout';
import { ratingColorClass } from '@/utils/booruPresentation';

const props = defineProps<{
  post: BooruPost;
  box: PositionedBox;
  initiallyLoaded?: boolean;
}>();

const emit = defineEmits<{
  select: [post: BooruPost];
  openExternal: [url: string];
  copyUrl: [url: string];
  imageLoaded: [
    payload: { key: string; naturalWidth: number; naturalHeight: number }
  ];
}>();

const imgRef = useTemplateRef<HTMLImageElement>('imgEl');
const isLoaded = shallowRef(Boolean(props.initiallyLoaded));
const hasError = shallowRef(false);
const useSampleFallback = shallowRef(false);
const retryNonce = shallowRef(0);

const activeSrc = computed(() => {
  const primary = props.post.previewUrl || props.post.sampleUrl;
  const fallback = props.post.sampleUrl || props.post.previewUrl;
  const rawUrl = useSampleFallback.value ? fallback : primary;
  const base = getBooruMediaUrl(props.post.source, rawUrl);
  return retryNonce.value > 0 ? `${base}&retry=${retryNonce.value}` : base;
});

const shortRating = computed(() => {
  const r = props.post.rating?.trim().toLowerCase();
  if (!r) return '';
  if (r === 'general' || r === 'g') return 'G';
  if (r === 'safe' || r === 's') return 'S';
  if (r === 'sensitive') return 'S';
  if (r === 'questionable' || r === 'q') return 'Q';
  if (r === 'explicit' || r === 'e') return 'E';
  return props.post.rating.slice(0, 3).toUpperCase();
});

const resolutionLabel = computed(() => {
  if (props.post.width > 0 && props.post.height > 0) {
    return `${props.post.width}×${props.post.height}`;
  }
  return '';
});

function markLoaded(img: HTMLImageElement | null) {
  isLoaded.value = true;
  hasError.value = false;
  emit('imageLoaded', {
    key: props.box.key,
    naturalWidth: img?.naturalWidth ?? 0,
    naturalHeight: img?.naturalHeight ?? 0
  });
}

function handleImgLoad(event: Event) {
  markLoaded(event.target as HTMLImageElement | null);
}

function handleImgError() {
  if (
    !useSampleFallback.value &&
    props.post.sampleUrl &&
    props.post.sampleUrl !== props.post.previewUrl
  ) {
    useSampleFallback.value = true;
    return;
  }
  hasError.value = true;
}

function retryLoad() {
  hasError.value = false;
  isLoaded.value = false;
  retryNonce.value += 1;
}

function syncCachedCompletion() {
  const el = imgRef.value;
  if (el && el.complete && el.naturalWidth > 0 && !isLoaded.value) {
    markLoaded(el);
  }
}

watch(
  () => `${props.post.source}:${props.post.postId}`,
  () => {
    isLoaded.value = Boolean(props.initiallyLoaded);
    hasError.value = false;
    useSampleFallback.value = false;
    retryNonce.value = 0;
  }
);

onMounted(() => {
  syncCachedCompletion();
});
</script>

<template>
  <ContextMenu>
    <ContextMenuTrigger as-child>
      <div
        role="button"
        tabindex="0"
        class="group border-border/60 bg-card/60 hover:border-primary/60 absolute overflow-hidden rounded-xl border text-left shadow-xs transition-[border-color,box-shadow] duration-200 hover:z-10 hover:shadow-xl hover:shadow-black/40"
        :style="{
          left: `${box.x}px`,
          top: `${box.y}px`,
          width: `${box.width}px`,
          height: `${box.height}px`
        }"
        @click="emit('select', post)"
        @keydown.enter="emit('select', post)"
        @keydown.space.prevent="emit('select', post)"
      >
        <img
          ref="imgEl"
          :src="activeSrc"
          :alt="`${post.source} post ${post.postId}`"
          class="block h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.02]"
          @load="handleImgLoad"
          @error="handleImgError"
        />

        <!-- Skeleton Overlay While Loading -->
        <div
          v-if="!isLoaded && !hasError"
          class="bg-card pointer-events-none absolute inset-0 z-1 overflow-hidden"
        >
          <div
            class="via-primary/6 absolute inset-0 animate-pulse bg-linear-to-br from-white/4 to-transparent"
          />
          <div class="absolute inset-0 flex items-center justify-center">
            <div
              class="border-border/50 bg-secondary/60 flex size-9 animate-pulse items-center justify-center rounded-xl border"
            >
              <ImageIcon class="text-muted-foreground/35 size-4" />
            </div>
          </div>
          <div
            class="absolute inset-x-2.5 bottom-2.5 flex items-center justify-between gap-2"
          >
            <span class="bg-muted/80 h-3.5 w-12 animate-pulse rounded-full" />
            <div class="flex items-center gap-1">
              <span class="bg-muted/80 size-6 animate-pulse rounded-lg" />
              <span class="bg-muted/80 size-6 animate-pulse rounded-lg" />
            </div>
          </div>
        </div>

        <!-- Error Fallback Overlay with Retry -->
        <div
          v-else-if="hasError"
          class="bg-muted/90 absolute inset-0 z-1 flex flex-col items-center justify-center gap-2 p-2 text-center"
        >
          <ImageIcon class="text-muted-foreground/50 size-6" />
          <button
            type="button"
            class="border-border bg-secondary text-foreground hover:bg-accent inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs font-medium"
            @click.stop="retryLoad"
          >
            <RotateCw class="size-3" />
            <span>Retry</span>
          </button>
        </div>

        <!-- Top Metadata Badges -->
        <div
          class="pointer-events-none absolute inset-x-2 top-2 z-10 flex items-start justify-between gap-1.5"
        >
          <span
            v-if="resolutionLabel"
            class="rounded-md border border-white/10 bg-black/65 px-1.5 py-0.5 font-mono text-xs text-white/90 opacity-0 backdrop-blur-md transition-opacity duration-200 group-hover:opacity-100"
          >
            {{ resolutionLabel }}
          </span>
          <span v-else />

          <Badge
            v-if="shortRating"
            variant="outline"
            :title="`Rating: ${post.rating}`"
            :class="ratingColorClass(post.rating)"
            class="border-white/15 bg-black/65 px-1.5 py-0 font-mono text-xs font-bold uppercase shadow-xs backdrop-blur-md"
          >
            {{ shortRating }}
          </Badge>
        </div>

        <!-- Bottom Action & Stats Overlay on Hover -->
        <div
          class="absolute inset-x-0 bottom-0 z-10 flex items-end justify-between gap-2 bg-linear-to-t from-black/90 via-black/50 to-transparent px-2.5 pt-8 pb-2.5 opacity-0 transition-opacity duration-200 group-hover:opacity-100"
        >
          <div
            class="flex min-w-0 items-center gap-2 font-mono text-xs text-white/90"
          >
            <span
              v-if="post.score > 0"
              class="inline-flex items-center gap-0.5"
              title="Score"
            >
              <ArrowUp class="size-3 text-emerald-400" />
              {{ post.score }}
            </span>
            <span
              v-if="post.favCount > 0"
              class="inline-flex items-center gap-0.5"
              title="Favorites"
            >
              <Heart class="size-3 text-rose-400" />
              {{ post.favCount }}
            </span>
            <span
              v-if="post.score <= 0 && post.favCount <= 0"
              class="truncate text-white/75"
            >
              #{{ post.postId }}
            </span>
          </div>

          <div class="flex shrink-0 items-center gap-1.5">
            <Button
              size="iconSm"
              variant="secondary"
              class="size-7 rounded-lg border border-white/20 bg-black/70 text-white shadow-md transition-colors hover:bg-white/20 hover:text-white"
              title="View Post Details & Tags"
              @click.stop="emit('select', post)"
            >
              <ZoomIn class="size-3.5" />
            </Button>
            <Button
              size="iconSm"
              variant="secondary"
              class="size-7 rounded-lg border border-white/20 bg-black/70 text-white shadow-md transition-colors hover:bg-white/20 hover:text-white"
              title="Open in Source Provider"
              @click.stop="emit('openExternal', post.postUrl)"
            >
              <ExternalLink class="size-3.5" />
            </Button>
          </div>
        </div>
      </div>
    </ContextMenuTrigger>
    <ContextMenuContent class="w-48">
      <ContextMenuItem @select="emit('select', post)">
        <ZoomIn /> View Details & Tags
      </ContextMenuItem>
      <ContextMenuSeparator />
      <ContextMenuItem @select="emit('openExternal', post.postUrl)">
        <ExternalLink /> Open Source Post
      </ContextMenuItem>
      <ContextMenuItem @select="emit('copyUrl', post.postUrl)">
        <Copy /> Copy Post URL
      </ContextMenuItem>
    </ContextMenuContent>
  </ContextMenu>
</template>
