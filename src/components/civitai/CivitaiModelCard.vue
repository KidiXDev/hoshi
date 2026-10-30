<script lang="ts">
const compactNumber = new Intl.NumberFormat('en', { notation: 'compact' });

const videoVisibility = new IntersectionObserver((entries) => {
  for (const { target, isIntersecting } of entries) {
    const video = target as HTMLVideoElement;
    if (isIntersecting) video.play().catch(() => {});
    else video.pause();
  }
});
</script>

<script setup lang="ts">
import { computed, type Directive } from 'vue';
import { openUrl } from '@tauri-apps/plugin-opener';
import {
  Bookmark,
  BookmarkMinus,
  BookmarkPlus,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Copy,
  Download,
  ExternalLink,
  ImageOff,
  Info,
  Link,
  ThumbsUp,
  UserRoundSearch,
  Video
} from '@lucide/vue';
import { toast } from 'vue-sonner';
import { Badge } from '@/components/ui/badge';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger
} from '@/components/ui/context-menu';
import {
  civitaiPreviewUrl,
  isVideoMedia,
  type CivitaiModel,
  type CivitaiVersion
} from '@/services/civitai';

const props = defineProps<{
  model: CivitaiModel;
  version?: CivitaiVersion;
  imageIndex: number;
  bookmarked: boolean;
  installed: boolean;
  downloadable: boolean;
}>();

const emit = defineEmits<{
  open: [];
  toggleBookmark: [];
  download: [];
  searchCreator: [username: string];
  'update:imageIndex': [index: number];
}>();

const images = computed(() => props.version?.images ?? []);
const image = computed(() => images.value[props.imageIndex] ?? images.value[0]);
const imageSrc = computed(() => civitaiPreviewUrl(image.value?.url ?? '', 450));
const isVideo = computed(() => isVideoMedia(image.value));
const hasCarousel = computed(() => images.value.length > 1);
const civitaiUrl = computed(
  () => `https://civitai.com/models/${props.model.id}`
);

const vPlayWhenVisible: Directive<HTMLVideoElement> = {
  mounted: (video) => videoVisibility.observe(video),
  beforeUnmount: (video) => {
    videoVisibility.unobserve(video);
    video.removeAttribute('src');
    video.load();
  }
};

function formatCount(value = 0) {
  return compactNumber.format(value);
}

function stepImage(offset: number) {
  const count = images.value.length;
  emit('update:imageIndex', (props.imageIndex + offset + count) % count);
}

async function copyText(text: string, label: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast.success(`${label} copied`);
  } catch (error) {
    toast.error(`Copy failed: ${String(error)}`);
  }
}
</script>

<template>
  <ContextMenu>
    <ContextMenuTrigger as-child>
      <article
        class="border-border/70 bg-card/75 hover:border-primary/50 hover:bg-card/95 group relative flex cursor-pointer flex-col overflow-hidden rounded-xl border shadow-xs transition-all duration-200 hover:shadow-md"
        @click="emit('open')"
      >
        <div
          class="bg-muted/40 relative aspect-3/4 w-full overflow-hidden select-none"
        >
          <!-- Render only the active preview to keep scrolling lightweight. -->
          <template v-if="image?.url">
            <video
              v-if="isVideo"
              :key="`video-${image.url}`"
              v-play-when-visible
              :src="imageSrc"
              preload="auto"
              loop
              muted
              playsinline
              class="pointer-events-none h-full w-full object-cover"
            />
            <img
              v-else
              :key="`img-${image.url}`"
              :src="imageSrc"
              :alt="`${model.name} preview`"
              class="h-full w-full object-cover"
              decoding="async"
              draggable="false"
            />

            <!-- Multi-Image Hover Carousel Controls -->
            <button
              v-if="hasCarousel"
              type="button"
              aria-label="Previous preview image"
              class="absolute top-1/2 left-1.5 z-20 flex h-6 w-6 -translate-y-1/2 cursor-pointer items-center justify-center rounded-full bg-black/60 text-white opacity-0 transition-opacity group-hover:opacity-100 hover:bg-black/90"
              @click.stop="stepImage(-1)"
            >
              <ChevronLeft class="h-3.5 w-3.5" />
            </button>
            <button
              v-if="hasCarousel"
              type="button"
              aria-label="Next preview image"
              class="absolute top-1/2 right-1.5 z-20 flex h-6 w-6 -translate-y-1/2 cursor-pointer items-center justify-center rounded-full bg-black/60 text-white opacity-0 transition-opacity group-hover:opacity-100 hover:bg-black/90"
              @click.stop="stepImage(1)"
            >
              <ChevronRight class="h-3.5 w-3.5" />
            </button>

            <!-- Carousel Indicators (Dots) -->
            <div
              v-if="hasCarousel"
              class="absolute inset-x-0 bottom-8 z-10 flex justify-center gap-1"
            >
              <button
                v-for="(_, imgIdx) in images.slice(0, 5)"
                :key="imgIdx"
                type="button"
                :aria-label="`Go to preview ${imgIdx + 1}`"
                class="h-1 cursor-pointer rounded-full transition-all"
                :class="
                  imgIdx === imageIndex
                    ? 'w-3 bg-white shadow-xs'
                    : 'w-1 bg-white/50 hover:bg-white/80'
                "
                @click.stop="emit('update:imageIndex', imgIdx)"
              />
            </div>
          </template>

          <!-- Fallback empty -->
          <div
            v-else
            class="text-muted-foreground flex h-full items-center justify-center"
          >
            <ImageOff class="h-8 w-8" />
          </div>

          <!-- Top Gradient Overlay -->
          <div
            class="pointer-events-none absolute inset-x-0 top-0 z-10 h-16 bg-linear-to-b from-black/75 via-black/30 to-transparent"
          />

          <!-- Top Badges Row -->
          <div
            class="pointer-events-none absolute inset-x-2 top-2 z-10 flex items-start justify-between gap-1"
          >
            <!-- Model Type Badge & Video Indicator -->
            <div class="flex items-center gap-1">
              <Badge
                variant="outline"
                class="border-white/20 bg-black/65 px-2 py-0.5 text-xs font-medium text-white shadow-sm backdrop-blur-md"
              >
                {{ model.type }}
              </Badge>
              <Badge
                v-if="isVideo"
                variant="outline"
                class="flex items-center gap-1 border-sky-400/30 bg-sky-950/70 px-1.5 py-0.5 text-xs font-medium text-sky-300 shadow-sm backdrop-blur-md"
              >
                <Video class="h-3 w-3" />
                <span>Video</span>
              </Badge>
            </div>

            <!-- Installed or Base Model Badge -->
            <div class="flex items-center gap-1">
              <Badge
                v-if="bookmarked"
                class="border-primary/40 bg-primary/90 text-primary-foreground px-1 py-0.5 shadow-sm backdrop-blur-md"
                title="Bookmarked"
              >
                <Bookmark class="h-3 w-3 fill-current" />
              </Badge>
              <Badge
                v-if="installed"
                class="flex items-center gap-1 border-emerald-500/30 bg-emerald-600/90 px-1.5 py-0.5 text-xs text-white shadow-sm backdrop-blur-md"
              >
                <CheckCircle2 class="h-3 w-3" />
                <span>Installed</span>
              </Badge>
              <Badge
                v-else-if="version?.baseModel"
                variant="outline"
                class="max-w-28 truncate border-amber-500/30 bg-black/65 px-1.5 py-0.5 text-xs text-amber-300 shadow-sm backdrop-blur-md"
              >
                {{ version.baseModel }}
              </Badge>
            </div>
          </div>

          <!-- Bottom Gradient Overlay with Stats -->
          <div
            class="pointer-events-none absolute inset-x-0 bottom-0 z-10 flex items-end justify-between bg-linear-to-t from-black/85 via-black/40 to-transparent p-2 text-white"
          >
            <div class="flex items-center gap-2 text-xs font-medium">
              <span class="flex items-center gap-1 drop-shadow-xs">
                <Download class="h-3 w-3 text-white/80" />
                {{ formatCount(model.stats?.downloadCount) }}
              </span>
              <span
                v-if="model.stats?.thumbsUpCount"
                class="flex items-center gap-1 drop-shadow-xs"
              >
                <ThumbsUp class="h-3 w-3 text-white/80" />
                {{ formatCount(model.stats?.thumbsUpCount) }}
              </span>
            </div>

            <span
              class="text-xs text-white/70 transition-colors group-hover:text-white"
            >
              {{ model.modelVersions.length }}
              {{ model.modelVersions.length > 1 ? 'vers' : 'ver' }}
            </span>
          </div>
        </div>

        <!-- Pure Card Footer: Name & Creator -->
        <div class="flex flex-col gap-0.5 p-2.5">
          <h2
            class="group-hover:text-primary truncate text-xs font-semibold transition-colors"
            :title="model.name"
          >
            {{ model.name }}
          </h2>
          <p class="text-muted-foreground truncate text-xs">
            by {{ model.creator?.username || 'Unknown' }}
          </p>
        </div>
      </article>
    </ContextMenuTrigger>
    <ContextMenuContent class="w-60">
      <ContextMenuItem @select="emit('open')">
        <Info /> Details
      </ContextMenuItem>
      <ContextMenuItem @select="emit('toggleBookmark')">
        <template v-if="bookmarked">
          <BookmarkMinus /> Remove bookmark
        </template>
        <template v-else> <BookmarkPlus /> Bookmark </template>
      </ContextMenuItem>
      <ContextMenuItem :disabled="!downloadable" @select="emit('download')">
        <Download />
        <span class="truncate"> Download {{ version?.name }} </span>
      </ContextMenuItem>
      <ContextMenuSeparator />
      <ContextMenuItem
        v-if="model.creator?.username"
        @select="emit('searchCreator', model.creator.username)"
      >
        <UserRoundSearch />
        <span class="truncate"> More from {{ model.creator.username }} </span>
      </ContextMenuItem>
      <ContextMenuItem @select="copyText(model.name, 'Model name')">
        <Copy /> Copy name
      </ContextMenuItem>
      <ContextMenuItem @select="copyText(civitaiUrl, 'Link')">
        <Link /> Copy Civitai link
      </ContextMenuItem>
      <ContextMenuItem @select="openUrl(civitaiUrl)">
        <ExternalLink /> Open on Civitai
      </ContextMenuItem>
    </ContextMenuContent>
  </ContextMenu>
</template>
