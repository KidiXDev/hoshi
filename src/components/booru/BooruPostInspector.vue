<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { openUrl } from '@tauri-apps/plugin-opener';
import {
  AlertCircle,
  BookOpen,
  Check,
  Copy,
  ExternalLink,
  Loader2,
  MessageSquare,
  RotateCw,
  Sparkles,
  Tag
} from '@lucide/vue';
import { toast } from 'vue-sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogCloseButton,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { LibraryService } from '@/services/libraryService';
import { useLibraryStore } from '@/stores/libraryStore';
import type { CharacterData } from '@/types/library';
import { Input } from '@/components/ui/input';
import { loadAppData, saveAppData } from '@/services/appStorage';
import { Skeleton } from '@/components/ui/skeleton';
import {
  buildBooruPrompt,
  fetchBooruDetail,
  getBooruMediaUrl,
  type BooruPost,
  type BooruPostDetail,
  type BooruSettings
} from '@/services/booruGallery';
import { useAiStore } from '@/stores/aiStore';
import { ratingColorClass } from '@/utils/booruPresentation';
import { createBooruMention } from '@/utils/aiMentions';

const props = defineProps<{ settings: BooruSettings | null }>();
const aiStore = useAiStore();
function readableError(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
const detail = ref<BooruPostDetail | null>(null);
const detailActivePost = ref<BooruPost | null>(null);
const detailOpen = ref(false);
const detailLoading = ref(false);
const detailError = ref('');
const detailFallbackAttempted = ref(false);
const detailImageLoaded = ref(false);
const detailImageError = ref(false);
const copiedPrompt = ref(false);
const copiedTag = ref<string | null>(null);
const router = useRouter();
interface BooruPromptFormatOptions {
  replaceUnderscores: boolean;
  escapeParentheses: boolean;
}
const BOORU_FORMAT_OPTIONS_KEY = 'booru_prompt_format_options';
const promptFormatOptions = ref<BooruPromptFormatOptions>({
  replaceUnderscores: false,
  escapeParentheses: false
});
onMounted(async () => {
  try {
    const saved = await loadAppData<BooruPromptFormatOptions>(
      BOORU_FORMAT_OPTIONS_KEY
    );
    if (saved) {
      if (typeof saved.replaceUnderscores === 'boolean') {
        promptFormatOptions.value.replaceUnderscores = saved.replaceUnderscores;
      }
      if (typeof saved.escapeParentheses === 'boolean') {
        promptFormatOptions.value.escapeParentheses = saved.escapeParentheses;
      }
    }
  } catch (err) {
    console.warn('Failed to load booru prompt format options:', err);
  }
});
watch(
  promptFormatOptions,
  (options) => {
    void saveAppData(BOORU_FORMAT_OPTIONS_KEY, options).catch(console.error);
  },
  { deep: true }
);
function formatTag(tag: string): string {
  let value = promptFormatOptions.value.replaceUnderscores
    ? tag.replaceAll('_', ' ')
    : tag;
  if (promptFormatOptions.value.escapeParentheses) {
    value = value.replaceAll('(', '\\(').replaceAll(')', '\\)');
  }
  return value;
}
const charModalOpen = ref(false);
const charName = ref('');
const charTrigger = ref('');
const charSeries = ref('');
const charTags = ref('');
const charThumbnailUrl = ref('');
const isSavingChar = ref(false);
const characterTags = computed(() => {
  if (!detail.value?.tags) return [];
  for (const [key, tags] of Object.entries(detail.value.tags)) {
    if (key.toLowerCase() === 'character' || key === '4') {
      return tags;
    }
  }
  return [];
});
const copyrightTags = computed(() => {
  if (!detail.value?.tags) return [];
  for (const [key, tags] of Object.entries(detail.value.tags)) {
    if (key.toLowerCase() === 'copyright' || key === '3') {
      return tags;
    }
  }
  return [];
});
const generalTags = computed(() => {
  if (!detail.value?.tags) return [];
  for (const [key, tags] of Object.entries(detail.value.tags)) {
    if (key.toLowerCase() === 'general' || key === '0') {
      return tags;
    }
  }
  return [];
});
function formatTitle(str: string): string {
  return str
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}
const reopenDetailOnCharClose = ref(false);
function openCreateCharacterFromBooru() {
  const cTag = characterTags.value[0] || '';
  charName.value = cTag ? formatTitle(cTag) : '';
  charTrigger.value = cTag || '';
  const cpTag = copyrightTags.value[0] || '';
  charSeries.value = cpTag ? formatTitle(cpTag) : '';
  charTags.value = generalTags.value.map(formatTag).join(', ');
  charThumbnailUrl.value =
    detailActiveImgUrl.value || detail.value?.previewUrl || '';

  if (detailOpen.value) {
    reopenDetailOnCharClose.value = true;
    detailOpen.value = false;
  }
  charModalOpen.value = true;
}
function closeCharModal() {
  charModalOpen.value = false;
  if (reopenDetailOnCharClose.value) {
    reopenDetailOnCharClose.value = false;
    detailOpen.value = true;
  }
}
async function handleSaveCharacterToLibrary() {
  if (!charName.value.trim()) return;
  isSavingChar.value = true;
  try {
    const tempId = `booru-char-${Date.now()}`;
    let thumbnailId: string | undefined;

    if (charThumbnailUrl.value) {
      try {
        thumbnailId = await LibraryService.saveThumbnailFromUrl(
          tempId,
          charThumbnailUrl.value
        );
      } catch (err) {
        console.warn('[Booru] Could not save thumbnail for character:', err);
      }
    }

    const item = await LibraryService.saveItem<CharacterData>({
      category: 'characters',
      name: charName.value.trim(),
      description: charSeries.value.trim()
        ? `From ${charSeries.value.trim()}`
        : undefined,
      thumbnailId,
      data: {
        trigger:
          charTrigger.value.trim() ||
          charName.value.trim().toLowerCase().replaceAll(' ', '_'),
        tags: charTags.value
          .split(',')
          .map((t) => t.trim())
          .filter(Boolean),
        series: charSeries.value.trim() || undefined,
        source: 'manual'
      }
    });

    const libraryStore = useLibraryStore();
    void libraryStore.fetchCategory('characters');

    closeCharModal();
    toast.success(`Saved "${item.name}" to Character Library!`, {
      action: {
        label: 'Open Library',
        onClick: () => router.push('/library')
      }
    });
  } catch (err) {
    toast.error(
      `Failed to save character: ${err instanceof Error ? err.message : String(err)}`
    );
  } finally {
    isSavingChar.value = false;
  }
}
const prompt = computed(() => {
  if (!detail.value) return '';
  return buildBooruPrompt(
    detail.value.tags,
    {
      categories: props.settings?.promptDefaults?.categories ?? [
        'copyright',
        'character',
        'general'
      ],
      replaceUnderscores: promptFormatOptions.value.replaceUnderscores,
      escapeParentheses: promptFormatOptions.value.escapeParentheses
    },
    props.settings?.outputFilterTags
  );
});
const tagCountTotal = computed(() => {
  if (!detail.value?.tags) return 0;
  return Object.values(detail.value.tags).reduce(
    (acc, list) => acc + list.length,
    0
  );
});
const detailActiveImgUrl = computed(() => {
  if (detailFallbackAttempted.value) {
    const rawUrl =
      detail.value?.previewUrl || detailActivePost.value?.previewUrl || '';
    return rawUrl
      ? getBooruMediaUrl(
          detail.value?.source || detailActivePost.value?.source || '',
          rawUrl
        )
      : '';
  }
  if (detail.value) {
    const rawUrl =
      detail.value.sampleUrl ||
      detail.value.mediaUrl ||
      detail.value.previewUrl;
    return rawUrl ? getBooruMediaUrl(detail.value.source, rawUrl) : '';
  }
  if (detailActivePost.value) {
    const rawUrl =
      detailActivePost.value.sampleUrl || detailActivePost.value.previewUrl;
    return rawUrl
      ? getBooruMediaUrl(detailActivePost.value.source, rawUrl)
      : '';
  }
  return '';
});
function handleDetailImageError() {
  const preview =
    detail.value?.previewUrl || detailActivePost.value?.previewUrl;
  const currentUrl = detailActiveImgUrl.value;
  if (
    !detailFallbackAttempted.value &&
    preview &&
    !currentUrl.includes(encodeURIComponent(preview))
  ) {
    detailFallbackAttempted.value = true;
    detailImageError.value = false;
    detailImageLoaded.value = false;
  } else {
    detailImageError.value = true;
  }
}

function mentionInMaya() {
  if (!detail.value) return;
  aiStore.addDraftMention(
    createBooruMention(detail.value, detailActiveImgUrl.value, props.settings)
  );
  detailOpen.value = false;
  aiStore.isDrawerOpen = true;
}
function retryDetailImage() {
  detailFallbackAttempted.value = false;
  detailImageError.value = false;
  detailImageLoaded.value = false;
}
async function openDetail(post: BooruPost) {
  detailActivePost.value = post;
  detailOpen.value = true;
  detailLoading.value = true;
  detailError.value = '';
  detail.value = null;
  detailFallbackAttempted.value = false;
  detailImageLoaded.value = false;
  detailImageError.value = false;
  copiedPrompt.value = false;
  copiedTag.value = null;
  try {
    detail.value = await fetchBooruDetail(post.source, post.postId);
  } catch (error) {
    detailError.value = readableError(error);
  } finally {
    detailLoading.value = false;
  }
}
async function copyPrompt() {
  if (!prompt.value) return;
  await navigator.clipboard.writeText(prompt.value);
  copiedPrompt.value = true;
  setTimeout(() => (copiedPrompt.value = false), 1500);
}
async function copyTag(tag: string) {
  const text = formatTag(tag);
  await navigator.clipboard.writeText(text);
  copiedTag.value = tag;
  setTimeout(() => {
    if (copiedTag.value === tag) copiedTag.value = null;
  }, 1200);
}
function categoryBadgeClass(category: string): string {
  switch (category?.toLowerCase()) {
    case 'artist':
      return 'border-purple-500/30 bg-purple-500/10 text-purple-300 hover:bg-purple-500/20';
    case 'character':
      return 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/20';
    case 'copyright':
      return 'border-amber-500/30 bg-amber-500/10 text-amber-300 hover:bg-amber-500/20';
    case 'meta':
      return 'border-zinc-500/30 bg-zinc-500/10 text-zinc-300 hover:bg-zinc-500/20';
    default:
      return 'border-blue-500/30 bg-blue-500/10 text-blue-300 hover:bg-blue-500/20';
  }
}
defineExpose({ open: openDetail });
</script>
<template>
  <Dialog v-model:open="detailOpen">
    <DialogContent
      class="bg-card/95 border-border/80 flex h-[90vh] w-full min-w-[80vw] flex-col overflow-hidden rounded-2xl p-0 backdrop-blur-md"
    >
      <!-- Modal Header -->
      <DialogHeader
        class="border-border/80 flex shrink-0 flex-row items-center justify-between border-b px-5 py-3"
      >
        <div class="flex items-center gap-3">
          <DialogTitle class="text-xs font-bold tracking-wider uppercase">
            Booru Post Inspector
          </DialogTitle>
          <div
            v-if="detail || detailActivePost"
            class="flex items-center gap-2"
          >
            <Badge
              variant="outline"
              class="border-border font-mono text-xs uppercase"
            >
              {{ detail?.source || detailActivePost?.source }} #{{
                detail?.postId || detailActivePost?.postId
              }}
            </Badge>
            <Badge
              variant="outline"
              :class="
                ratingColorClass(
                  detail?.rating || detailActivePost?.rating || ''
                )
              "
              class="font-mono text-xs capitalize"
            >
              {{ detail?.rating || detailActivePost?.rating }}
            </Badge>
            <span
              v-if="detail?.width && detail?.height"
              class="text-muted-foreground font-mono text-xs"
            >
              {{ detail.width }} × {{ detail.height }}
            </span>
            <Skeleton v-else-if="detailLoading" class="h-3.5 w-16" />
          </div>
        </div>
        <DialogCloseButton class="-my-1.5" />
      </DialogHeader>

      <div
        class="grid min-h-0 flex-1 grid-cols-1 overflow-hidden md:grid-cols-2"
      >
        <div
          class="border-border/60 relative flex h-full min-h-0 w-full items-center justify-center overflow-hidden border-r bg-black/60 p-4"
        >
          <div
            v-if="!detailImageLoaded && !detailImageError"
            class="bg-muted/10 absolute inset-0 flex flex-col items-center justify-center gap-3 p-6"
          >
            <div
              class="border-border/60 bg-secondary/80 flex h-14 w-14 items-center justify-center rounded-2xl border shadow-lg"
            >
              <Loader2 class="text-primary h-7 w-7 animate-spin" />
            </div>
            <div class="flex flex-col items-center gap-1 text-center">
              <span class="text-foreground text-xs font-semibold">
                {{
                  detailFallbackAttempted
                    ? 'Loading preview thumbnail…'
                    : 'Loading high-resolution preview…'
                }}
              </span>
              <span class="text-muted-foreground font-mono text-[10px]">
                {{ detail?.source || detailActivePost?.source }} #{{
                  detail?.postId || detailActivePost?.postId
                }}
              </span>
            </div>
          </div>

          <!-- Image Load Error Fallback -->
          <div
            v-else-if="detailImageError"
            class="flex max-w-sm flex-col items-center justify-center gap-3 p-6 text-center text-xs"
          >
            <div
              class="border-destructive/30 bg-destructive/10 text-destructive flex h-12 w-12 items-center justify-center rounded-2xl border shadow-inner"
            >
              <AlertCircle class="h-6 w-6" />
            </div>
            <div class="space-y-1">
              <h3 class="text-foreground text-xs font-semibold">
                Failed to load image preview
              </h3>
              <p class="text-muted-foreground text-[11px] leading-relaxed">
                The media provider for
                <span
                  class="text-foreground font-mono font-medium capitalize"
                  >{{ detail?.source || detailActivePost?.source }}</span
                >
                may restrict direct hotlinking.
              </p>
            </div>
            <div class="mt-1 flex flex-wrap items-center justify-center gap-2">
              <Button
                size="sm"
                variant="outline"
                class="h-7 text-xs"
                @click="retryDetailImage"
              >
                <RotateCw class="mr-1.5 h-3 w-3" />
                <span>Retry Image</span>
              </Button>
              <Button
                v-if="detail?.postUrl || detailActivePost?.postUrl"
                size="sm"
                variant="outline"
                class="h-7 text-xs"
                @click="
                  openUrl(detail?.postUrl || detailActivePost?.postUrl || '')
                "
              >
                <ExternalLink class="mr-1.5 h-3.5 w-3.5" />
                <span>Open original post</span>
              </Button>
            </div>
          </div>

          <!-- Image Display -->
          <img
            v-if="detailActiveImgUrl"
            :src="detailActiveImgUrl"
            :alt="`${detail?.source || detailActivePost?.source} post ${detail?.postId || detailActivePost?.postId}`"
            class="h-full w-full rounded-lg object-contain shadow-2xl transition-opacity duration-300 select-none"
            :class="detailImageLoaded ? 'opacity-100' : 'opacity-0'"
            @load="detailImageLoaded = true"
            @error="handleDetailImageError"
          />
        </div>

        <!-- Right: Metadata & Tag Inspector -->
        <div class="flex min-h-0 flex-col gap-4 overflow-y-auto p-5">
          <!-- Full Right Skeleton while detailLoading is true -->
          <template v-if="detailLoading">
            <!-- Action Buttons Skeleton -->
            <div class="flex items-center gap-2">
              <Skeleton class="h-8 flex-1 rounded-md" />
              <Skeleton class="h-8 w-28 rounded-md" />
            </div>

            <!-- Extracted Prompt Skeleton -->
            <div
              class="border-border/80 bg-secondary/30 flex flex-col gap-2.5 rounded-xl border p-3.5"
            >
              <div class="flex items-center justify-between">
                <div class="flex items-center gap-1.5">
                  <Sparkles
                    class="h-3.5 w-3.5 animate-pulse text-amber-400/40"
                  />
                  <Skeleton class="h-3 w-28" />
                </div>
                <Skeleton class="h-3 w-12" />
              </div>
              <div
                class="border-border/50 bg-background/50 flex flex-col gap-2 rounded-lg border p-3"
              >
                <Skeleton class="h-3 w-full" />
                <Skeleton class="h-3 w-5/6" />
                <Skeleton class="h-3 w-4/6" />
              </div>
            </div>

            <!-- Tags Cloud Skeleton -->
            <div class="space-y-4 pt-1">
              <div class="space-y-2">
                <div class="flex items-center justify-between">
                  <Skeleton class="h-3.5 w-20" />
                  <Skeleton class="h-3 w-6" />
                </div>
                <div class="flex flex-wrap gap-1.5">
                  <Skeleton class="h-6 w-16 rounded-md" />
                  <Skeleton class="h-6 w-24 rounded-md" />
                  <Skeleton class="h-6 w-20 rounded-md" />
                  <Skeleton class="h-6 w-28 rounded-md" />
                  <Skeleton class="h-6 w-14 rounded-md" />
                </div>
              </div>

              <div class="space-y-2">
                <div class="flex items-center justify-between">
                  <Skeleton class="h-3.5 w-24" />
                  <Skeleton class="h-3 w-6" />
                </div>
                <div class="flex flex-wrap gap-1.5">
                  <Skeleton class="h-6 w-20 rounded-md" />
                  <Skeleton class="h-6 w-16 rounded-md" />
                  <Skeleton class="h-6 w-28 rounded-md" />
                  <Skeleton class="h-6 w-22 rounded-md" />
                  <Skeleton class="h-6 w-18 rounded-md" />
                  <Skeleton class="h-6 w-24 rounded-md" />
                </div>
              </div>
            </div>
          </template>

          <!-- Loaded Metadata & Tags View -->
          <template v-else-if="detail">
            <!-- Action Buttons -->
            <div class="flex items-center gap-2">
              <Button
                size="sm"
                class="bg-primary text-primary-foreground hover:bg-primary/90 flex-1 text-xs font-semibold shadow-xs"
                @click="copyPrompt"
              >
                <Check v-if="copiedPrompt" class="h-3.5 w-3.5" />
                <Copy v-else class="h-3.5 w-3.5" />
                <span>{{
                  copiedPrompt
                    ? 'Copied to Clipboard!'
                    : 'Copy Extracted Prompt'
                }}</span>
              </Button>
              <Button
                v-if="characterTags.length > 0"
                size="sm"
                variant="outline"
                class="border-primary/30 hover:bg-primary/10 text-primary gap-1.5 text-xs font-semibold"
                @click="openCreateCharacterFromBooru"
              >
                <BookOpen class="h-3.5 w-3.5" />
                <span>Save as Character</span>
              </Button>
              <Button
                size="sm"
                variant="outline"
                class="border-primary/30 hover:bg-primary/10 text-primary gap-1.5 text-xs font-semibold"
                @click="mentionInMaya"
              >
                <MessageSquare class="h-3.5 w-3.5" />
                <span>Mention in Maya</span>
              </Button>
              <Button
                variant="outline"
                size="sm"
                class="border-border bg-secondary hover:bg-accent text-xs font-medium"
                @click="openUrl(detail.postUrl)"
              >
                <ExternalLink class="h-3.5 w-3.5" />
                <span>Open Source</span>
              </Button>
            </div>

            <!-- Extracted Prompt Box -->
            <div
              class="border-border/80 bg-secondary/30 flex flex-col gap-2 rounded-xl border p-3.5"
            >
              <div class="flex flex-wrap items-center justify-between gap-2">
                <span
                  class="text-muted-foreground flex items-center gap-1.5 text-xs font-bold tracking-wider uppercase"
                >
                  <Sparkles class="h-3.5 w-3.5 text-amber-400" />
                  <span>Extracted Prompt</span>
                </span>
                <div class="flex items-center gap-1.5">
                  <button
                    type="button"
                    class="h-6 cursor-pointer rounded border px-2 font-mono text-xs transition-colors select-none"
                    :class="
                      promptFormatOptions.replaceUnderscores
                        ? 'border-primary/40 bg-primary/20 text-primary font-semibold shadow-2xs'
                        : 'border-border/60 bg-background/50 text-muted-foreground hover:text-foreground'
                    "
                    title="Replace underscores with spaces in extracted prompt and tags"
                    @click="
                      promptFormatOptions.replaceUnderscores =
                        !promptFormatOptions.replaceUnderscores
                    "
                  >
                    _ &rarr; space
                  </button>
                  <button
                    type="button"
                    class="h-6 cursor-pointer rounded border px-2 font-mono text-xs transition-colors select-none"
                    :class="
                      promptFormatOptions.escapeParentheses
                        ? 'border-primary/40 bg-primary/20 text-primary font-semibold shadow-2xs'
                        : 'border-border/60 bg-background/50 text-muted-foreground hover:text-foreground'
                    "
                    title="Escape parentheses (\( \)) in extracted prompt and tags"
                    @click="
                      promptFormatOptions.escapeParentheses =
                        !promptFormatOptions.escapeParentheses
                    "
                  >
                    \( \)
                  </button>
                  <span class="text-muted-foreground ml-1 font-mono text-xs">
                    {{ tagCountTotal }} tags
                  </span>
                </div>
              </div>
              <p
                class="text-foreground border-border/50 bg-background/50 rounded-lg border p-3 font-mono text-xs leading-relaxed wrap-break-word select-text"
              >
                {{ prompt || 'No matching tags extracted from defaults.' }}
              </p>
            </div>

            <!-- Categorized Tags Cloud -->
            <div class="space-y-3.5 pb-2">
              <div
                v-if="!tagCountTotal"
                class="border-border/60 bg-muted/20 flex flex-col items-center justify-center gap-2 rounded-xl border p-6 text-center text-xs"
              >
                <Tag class="text-muted-foreground/40 h-6 w-6" />
                <span class="text-muted-foreground font-medium">
                  No categorized tags available for this post
                </span>
              </div>

              <section
                v-for="(tags, category) in detail.tags"
                v-else
                :key="category"
                class="space-y-1.5"
              >
                <div class="flex items-center justify-between">
                  <h3
                    class="text-muted-foreground flex items-center gap-1.5 text-xs font-semibold capitalize"
                  >
                    <Tag class="h-3 w-3" />
                    <span>{{ category }}</span>
                  </h3>
                  <span class="text-muted-foreground font-mono text-xs">
                    {{ tags.length }}
                  </span>
                </div>

                <div class="flex flex-wrap gap-1.5">
                  <button
                    v-for="tag in tags"
                    :key="tag"
                    type="button"
                    class="cursor-pointer rounded-md border px-2 py-0.5 font-mono text-xs transition-all select-text"
                    :class="[
                      categoryBadgeClass(category),
                      copiedTag === tag ? 'ring-primary scale-105 ring-2' : ''
                    ]"
                    :title="`Click to copy: ${formatTag(tag)}`"
                    @click="copyTag(tag)"
                  >
                    <span v-if="copiedTag === tag" class="font-bold"
                      >✓ {{ formatTag(tag) }}</span
                    >
                    <span v-else>{{ formatTag(tag) }}</span>
                  </button>
                </div>
              </section>
            </div>
          </template>

          <!-- Error / Empty State Fallback -->
          <template v-else>
            <div
              class="border-destructive/30 bg-destructive/10 text-destructive flex flex-col gap-3 rounded-xl border p-4 text-xs"
            >
              <div class="flex items-center gap-2">
                <AlertCircle class="h-4 w-4 shrink-0" />
                <span class="font-semibold"
                  >Unable to load metadata & tags</span
                >
              </div>
              <p class="text-muted-foreground text-xs leading-relaxed">
                {{
                  detailError ||
                  'The source provider did not return tags or metadata for this post.'
                }}
              </p>
              <div class="mt-1 flex items-center gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  class="h-7 text-xs"
                  @click="detailActivePost && openDetail(detailActivePost)"
                >
                  <RotateCw class="mr-1.5 h-3 w-3" />
                  <span>Retry Details</span>
                </Button>
                <Button
                  v-if="detailActivePost?.postUrl"
                  size="sm"
                  variant="outline"
                  class="h-7 text-xs"
                  @click="openUrl(detailActivePost.postUrl)"
                >
                  <ExternalLink class="mr-1.5 h-3 w-3" />
                  <span>Open in browser</span>
                </Button>
              </div>
            </div>

            <!-- Available Post Summary Info -->
            <div
              v-if="detailActivePost"
              class="border-border/80 bg-secondary/30 flex flex-col gap-2.5 rounded-xl border p-3.5"
            >
              <span
                class="text-muted-foreground text-xs font-bold tracking-wider uppercase"
              >
                Available Post Info
              </span>
              <div class="grid grid-cols-2 gap-2 font-mono text-xs">
                <div>
                  <span class="text-muted-foreground">Source:</span>
                  <span class="text-foreground ml-1.5 font-medium capitalize">{{
                    detailActivePost.source
                  }}</span>
                </div>
                <div>
                  <span class="text-muted-foreground">ID:</span>
                  <span class="text-foreground ml-1.5 font-medium"
                    >#{{ detailActivePost.postId }}</span
                  >
                </div>
                <div>
                  <span class="text-muted-foreground">Rating:</span>
                  <span class="text-foreground ml-1.5 font-medium capitalize">{{
                    detailActivePost.rating || 'N/A'
                  }}</span>
                </div>
                <div v-if="detailActivePost.score">
                  <span class="text-muted-foreground">Score:</span>
                  <span class="text-foreground ml-1.5 font-medium">{{
                    detailActivePost.score
                  }}</span>
                </div>
              </div>
            </div>
          </template>
        </div>
      </div>
    </DialogContent>
  </Dialog>

  <Dialog
    :open="charModalOpen"
    @update:open="
      (v) => {
        if (!v) closeCharModal();
        else charModalOpen = true;
      }
    "
  >
    <DialogContent
      class="border-border bg-card flex max-h-[90vh] w-full min-w-[60vw] flex-col gap-0 overflow-hidden p-0"
    >
      <DialogHeader
        class="border-border bg-background/50 shrink-0 flex-row items-center justify-between border-b px-5 py-4"
      >
        <DialogTitle
          class="text-foreground flex items-center gap-2 text-sm font-bold"
        >
          <BookOpen class="text-primary h-4 w-4" />
          <span>Save to Character Library</span>
        </DialogTitle>
        <DialogCloseButton class="-my-1.5" />
      </DialogHeader>

      <div class="min-h-0 flex-1 overflow-y-auto px-6 py-5">
        <div class="grid grid-cols-1 items-start gap-6 md:grid-cols-3">
          <!-- Left (2 cols): Character Inputs -->
          <div class="flex flex-col gap-4 md:col-span-2">
            <!-- Character Name -->
            <div class="flex flex-col gap-1.5">
              <Label class="text-foreground text-xs font-bold"
                >Character Name <span class="text-destructive">*</span></Label
              >
              <Input
                v-model="charName"
                placeholder="e.g. Hatsune Miku"
                class="text-xs"
              />
            </div>

            <!-- Trigger Tag -->
            <div class="flex flex-col gap-1.5">
              <Label class="text-foreground text-xs font-bold"
                >Trigger Tag <span class="text-destructive">*</span></Label
              >
              <Input
                v-model="charTrigger"
                placeholder="e.g. hatsune_miku"
                class="font-mono text-xs"
              />
            </div>

            <!-- Series / Copyright -->
            <div class="flex flex-col gap-1.5">
              <Label class="text-foreground text-xs font-bold"
                >Series / Copyright (optional)</Label
              >
              <Input
                v-model="charSeries"
                placeholder="e.g. Vocaloid"
                class="text-xs"
              />
            </div>

            <!-- Tags -->
            <div class="flex flex-col gap-1.5">
              <Label class="text-foreground text-xs font-bold">
                Tags & Features
                <span class="text-muted-foreground font-normal"
                  >(comma-separated)</span
                >
              </Label>
              <Textarea
                v-model="charTags"
                rows="4"
                placeholder="twin tails, sleeveless shirt, necktie..."
                class="bg-background font-mono text-xs"
              />
            </div>
          </div>

          <!-- Right (1 col): Portrait Thumbnail Preview -->
          <div class="flex flex-col gap-2 md:col-span-1">
            <Label class="text-foreground text-xs font-bold">Thumbnail</Label>
            <div
              class="border-border bg-muted/30 relative aspect-3/4 w-full overflow-hidden rounded-xl border"
            >
              <img
                v-if="charThumbnailUrl"
                :src="charThumbnailUrl"
                alt="Character thumbnail"
                class="h-full w-full object-cover object-center"
              />
              <div
                v-else
                class="text-muted-foreground flex h-full w-full items-center justify-center text-xs"
              >
                No image selected
              </div>
            </div>
          </div>
        </div>
      </div>

      <DialogFooter
        class="border-border bg-muted/30 shrink-0 border-t px-5 py-3"
      >
        <Button
          variant="outline"
          size="sm"
          class="text-xs"
          @click="closeCharModal"
        >
          Cancel
        </Button>
        <Button
          size="sm"
          class="bg-primary text-primary-foreground hover:bg-primary/90 gap-1.5 text-xs font-semibold"
          :disabled="!charName.trim() || isSavingChar"
          @click="handleSaveCharacterToLibrary"
        >
          <Loader2 v-if="isSavingChar" class="h-3.5 w-3.5 animate-spin" />
          <Check v-else class="h-3.5 w-3.5" />
          {{ isSavingChar ? 'Saving…' : 'Save to Library' }}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
