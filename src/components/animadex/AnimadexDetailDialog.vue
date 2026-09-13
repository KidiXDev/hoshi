<script setup lang="ts">
import { computed, ref } from 'vue';
import { useRouter } from 'vue-router';
import { openUrl } from '@tauri-apps/plugin-opener';
import {
  ArrowUpRight,
  BookOpen,
  Check,
  Copy,
  ExternalLink,
  Layers,
  Loader2,
  MessageSquare,
  Palette,
  Plus,
  Replace,
  Search,
  Sparkles,
  User
} from '@lucide/vue';
import { toast } from 'vue-sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { ScrollArea } from '@/components/ui/scroll-area';
import { resolveAnimadexMediaUrl } from '@/services/animadexApi';
import { LibraryService } from '@/services/libraryService';
import { useLibraryStore } from '@/stores/libraryStore';
import { useWorkflowStore } from '@/stores/workflowStore';
import { useAiStore } from '@/stores/aiStore';
import type {
  AnimaDexArtist,
  AnimaDexCharacter,
  AnimaDexCopyright
} from '@/types/animadex';
import type { CharacterData } from '@/types/library';
import { createAnimadexMention } from '@/utils/aiMentions';

const props = defineProps<{
  open: boolean;
  item: AnimaDexCharacter | AnimaDexArtist | AnimaDexCopyright | null;
  type: 'character' | 'artist' | 'copyright';
}>();

const emit = defineEmits<{
  (e: 'update:open', value: boolean): void;
  (e: 'filter-by-copyright', copyrightSlug: string): void;
  (e: 'filter-by-tag', tag: string): void;
}>();

const router = useRouter();
const workflowStore = useWorkflowStore();
const aiStore = useAiStore();

const imageLoaded = ref(false);
const imageError = ref(false);
const copiedAll = ref(false);
const copiedTag = ref<string | null>(null);

const character = computed(() =>
  props.type === 'character' ? (props.item as AnimaDexCharacter) : null
);

const artist = computed(() =>
  props.type === 'artist' ? (props.item as AnimaDexArtist) : null
);

const triggerPrompt = computed(() => {
  if (character.value?.trigger) return character.value.trigger;
  if (artist.value?.trigger) return artist.value.trigger;
  return '';
});

interface DisplayTag {
  text: string;
  isTrigger: boolean;
}

const allTags = computed<DisplayTag[]>(() => {
  const list: DisplayTag[] = [];
  const seen = new Set<string>();

  // 1. Add trigger tag(s) first
  if (triggerPrompt.value) {
    const triggerParts = triggerPrompt.value
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean);

    for (const part of triggerParts) {
      const key = part.toLowerCase();
      if (!seen.has(key)) {
        seen.add(key);
        list.push({ text: part, isTrigger: true });
      }
    }
  }

  // 2. Add character core tags
  if (character.value?.tags) {
    for (const tag of character.value.tags) {
      const trimmed = tag.trim();
      const key = trimmed.toLowerCase();
      if (trimmed && !seen.has(key)) {
        seen.add(key);
        list.push({ text: trimmed, isTrigger: false });
      }
    }
  }

  return list;
});

const combinedPromptText = computed(() => {
  return allTags.value.map((t) => t.text).join(', ');
});

const previewImageUrl = computed(() => {
  if (!props.item) return '';
  return (
    ('img_url' in props.item && props.item.img_url) ||
    props.item.thumb_url ||
    ''
  );
});

const formattedCount = computed(() => {
  if (!props.item || (props.item.count !== 0 && !props.item.count)) return '';
  return props.item.count.toLocaleString();
});

const formattedScore = computed(() => {
  if (artist.value && typeof artist.value.score === 'number') {
    return `${(artist.value.score * 100).toFixed(1)}%`;
  }
  return null;
});

async function copyToClipboard(text: string, label = 'Trigger') {
  try {
    await navigator.clipboard.writeText(text);
    toast.success(`${label} copied to clipboard`);
  } catch {
    toast.error('Failed to copy to clipboard');
  }
}

function handleCopyAllPrompt() {
  if (!combinedPromptText.value) return;
  void copyToClipboard(combinedPromptText.value, 'Full prompt');
  copiedAll.value = true;
  setTimeout(() => {
    copiedAll.value = false;
  }, 2000);
}

function handleCopyTag(tag: string) {
  void copyToClipboard(tag, `Tag "${tag}"`);
  copiedTag.value = tag;
  setTimeout(() => {
    if (copiedTag.value === tag) copiedTag.value = null;
  }, 1500);
}

function handleAppendToWorkflow(promptText: string, andNavigate = false) {
  if (!promptText.trim()) return;
  const current = workflowStore.positivePrompt.trim();
  if (current) {
    workflowStore.positivePrompt = `${current}, ${promptText.trim()}`;
  } else {
    workflowStore.positivePrompt = promptText.trim();
  }
  toast.success('Appended to Workflow positive prompt!');
  if (andNavigate) {
    emit('update:open', false);
    router.push('/workflow');
  }
}

function mentionInMaya() {
  if (!character.value) return;
  aiStore.addDraftMention(createAnimadexMention(character.value));
  emit('update:open', false);
  aiStore.isDrawerOpen = true;
}

function handleReplaceWorkflow(promptText: string, andNavigate = false) {
  if (!promptText.trim()) return;
  workflowStore.positivePrompt = promptText.trim();
  toast.success('Replaced Workflow positive prompt!');
  if (andNavigate) {
    emit('update:open', false);
    router.push('/workflow');
  }
}

async function handleOpenExternal(url?: string) {
  if (!url) return;
  try {
    await openUrl(url);
  } catch {
    window.open(url, '_blank');
  }
}

function handleFilterBySeries() {
  if (character.value?.copyright) {
    emit('filter-by-copyright', character.value.copyright);
    emit('update:open', false);
  }
}

function handleFilterByTag(tag: string) {
  emit('filter-by-tag', tag);
  emit('update:open', false);
}

const charModalOpen = ref(false);
const charName = ref('');
const charTrigger = ref('');
const charSeries = ref('');
const charTags = ref('');
const charThumbnailUrl = ref('');
const isSavingChar = ref(false);

function formatTitle(str: string): string {
  return str
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

function closeCharModal() {
  charModalOpen.value = false;
}

function handleDetailOpenChange(val: boolean) {
  if (charModalOpen.value) return;
  emit('update:open', val);
}

function openCreateCharacterFromAnimadex() {
  if (!character.value) return;
  const char = character.value;
  charName.value = char.name ? formatTitle(char.name) : '';
  charTrigger.value =
    char.trigger || char.name.toLowerCase().replaceAll(' ', '_');
  const series = char.copyright_name || char.copyright || '';
  charSeries.value = series ? formatTitle(series) : '';
  charTags.value = (char.tags || []).join(', ');
  const rawUrl = char.img_url || char.thumb_url;
  charThumbnailUrl.value = resolveAnimadexMediaUrl(rawUrl) || '';
  charModalOpen.value = true;
}

async function handleSaveCharacterToLibrary() {
  if (!charName.value.trim()) return;
  isSavingChar.value = true;
  try {
    const char = character.value;
    const tempId = `animadex-char-${Date.now()}`;
    let thumbnailId: string | undefined;

    if (charThumbnailUrl.value) {
      try {
        thumbnailId = await LibraryService.saveThumbnailFromUrl(
          tempId,
          charThumbnailUrl.value
        );
      } catch (err) {
        console.warn('[Animadex] Could not save thumbnail for character:', err);
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
        source: 'animadex',
        animadexSlug: char?.slug
      }
    });

    const libraryStore = useLibraryStore();
    void libraryStore.fetchCategory('characters');

    closeCharModal();
    toast.success(`Saved "${item.name}" to Character Library!`, {
      action: {
        label: 'Open Library',
        onClick: () => {
          emit('update:open', false);
          router.push('/library');
        }
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
</script>

<template>
  <Dialog :open="open && !charModalOpen" @update:open="handleDetailOpenChange">
    <DialogContent
      class="border-border/60 bg-background/95 min-w-[60vw] overflow-hidden p-0 shadow-2xl backdrop-blur-xl sm:rounded-2xl"
    >
      <DialogHeader class="sr-only">
        <DialogTitle>{{ item?.name ?? 'Detail' }}</DialogTitle>
        <DialogDescription
          >Character or artist prompt information</DialogDescription
        >
      </DialogHeader>

      <div
        v-if="item"
        class="grid max-h-[85vh] grid-cols-1 overflow-hidden md:grid-cols-12"
      >
        <!-- Left: Image Preview -->
        <div
          class="bg-muted/20 relative flex min-h-75 items-center justify-center overflow-hidden md:col-span-5 md:min-h-130"
        >
          <!-- Image skeleton -->
          <div
            v-if="!imageLoaded && !imageError && previewImageUrl"
            class="bg-muted/40 absolute inset-0 animate-pulse"
          />

          <img
            v-if="previewImageUrl && !imageError"
            :src="previewImageUrl"
            :alt="item.name"
            class="h-full w-full object-contain object-center transition-opacity duration-300"
            :class="{ 'opacity-0': !imageLoaded, 'opacity-100': imageLoaded }"
            @load="imageLoaded = true"
            @error="imageError = true"
          />

          <div
            v-if="!previewImageUrl || imageError"
            class="text-muted-foreground flex flex-col items-center justify-center gap-2 p-6"
          >
            <User v-if="type === 'character'" class="h-16 w-16 opacity-30" />
            <Palette
              v-else-if="type === 'artist'"
              class="h-16 w-16 opacity-30"
            />
            <Layers v-else class="h-16 w-16 opacity-30" />
            <span class="text-xs opacity-50">Image preview unavailable</span>
          </div>

          <!-- Direct Image View Button -->
          <Button
            v-if="previewImageUrl && !imageError"
            variant="secondary"
            size="sm"
            class="bg-background/80 hover:bg-background absolute right-3 bottom-3 h-7 cursor-pointer gap-1.5 rounded-lg px-2.5 text-xs shadow-xs backdrop-blur-md"
            @click="handleOpenExternal(previewImageUrl)"
          >
            <ArrowUpRight class="h-3 w-3" />
            <span>Full Image</span>
          </Button>
        </div>

        <!-- Right: Information & Action Details -->
        <div class="flex max-h-[85vh] flex-col overflow-hidden md:col-span-7">
          <ScrollArea class="h-full w-full p-6">
            <div class="flex flex-col gap-5 pr-2">
              <!-- Top Header & Badges -->
              <div class="flex flex-col gap-2">
                <div class="flex items-start justify-between gap-3">
                  <div>
                    <h2
                      class="text-foreground text-xl font-bold tracking-tight"
                    >
                      {{ item.name }}
                    </h2>
                    <div class="mt-1 flex items-center gap-2">
                      <button
                        v-if="
                          character &&
                          (character.copyright_name || character.copyright)
                        "
                        type="button"
                        class="text-primary cursor-pointer text-xs font-medium hover:underline"
                        @click="handleFilterBySeries"
                      >
                        {{ character.copyright_name || character.copyright }}
                      </button>
                      <span
                        v-else-if="artist"
                        class="text-muted-foreground text-xs"
                      >
                        Artist Style Prompt
                      </span>
                      <span v-else class="text-muted-foreground text-xs">
                        Series Franchise
                      </span>
                    </div>
                  </div>

                  <!-- External Reference Button -->
                  <Button
                    v-if="'url' in item && item.url"
                    variant="outline"
                    size="sm"
                    class="h-8 shrink-0 cursor-pointer gap-1.5 rounded-lg px-2.5 text-xs"
                    @click="handleOpenExternal(item.url)"
                  >
                    <span>Danbooru</span>
                    <ExternalLink class="h-3 w-3" />
                  </Button>
                </div>

                <!-- Metadata badges -->
                <div class="flex flex-wrap items-center gap-1.5 pt-1">
                  <Badge variant="secondary" class="text-xs font-normal">
                    {{ formattedCount }} posts
                  </Badge>

                  <Badge
                    v-if="formattedScore"
                    variant="secondary"
                    class="border border-emerald-500/30 bg-emerald-500/15 text-xs text-emerald-400"
                  >
                    Score: {{ formattedScore }}
                  </Badge>

                  <Badge
                    v-if="character?.loras && character.loras.length > 0"
                    variant="secondary"
                    class="border border-purple-500/30 bg-purple-600/20 text-xs text-purple-300"
                  >
                    {{ character.loras.length }} LoRA{{
                      character.loras.length > 1 ? 's' : ''
                    }}
                    Available
                  </Badge>
                </div>
              </div>

              <!-- Unified Prompt & Tags Field (Trigger tags placed first) -->
              <div
                v-if="allTags.length > 0"
                class="border-border/60 bg-muted/20 flex flex-col gap-3 rounded-xl border p-4"
              >
                <!-- Header -->
                <div class="flex items-center justify-between">
                  <div class="flex items-center gap-2">
                    <Sparkles class="text-primary h-4 w-4" />
                    <span
                      class="text-muted-foreground text-xs font-semibold tracking-wider uppercase"
                    >
                      Prompt & Tags ({{ allTags.length }})
                    </span>
                  </div>

                  <div class="flex items-center gap-1.5">
                    <Button
                      size="sm"
                      variant="ghost"
                      class="h-7 cursor-pointer gap-1 px-2.5 text-xs font-medium"
                      @click="handleCopyAllPrompt"
                    >
                      <Check
                        v-if="copiedAll"
                        class="h-3.5 w-3.5 text-emerald-500"
                      />
                      <Copy v-else class="h-3.5 w-3.5" />
                      <span>{{ copiedAll ? 'Copied' : 'Copy Prompt' }}</span>
                    </Button>
                  </div>
                </div>

                <!-- Combined Full Prompt Box -->
                <div
                  class="bg-background/80 border-border/40 text-foreground max-h-36 overflow-y-auto rounded-lg border p-3 font-mono text-xs leading-relaxed select-text"
                >
                  {{ combinedPromptText }}
                </div>

                <!-- Action Buttons to Workflow -->
                <div class="flex flex-wrap items-center gap-2">
                  <Button
                    size="sm"
                    variant="default"
                    class="h-8 cursor-pointer gap-1.5 px-3 text-xs font-medium"
                    @click="handleAppendToWorkflow(combinedPromptText, false)"
                  >
                    <Plus class="h-3.5 w-3.5" />
                    <span>Append to Workflow</span>
                  </Button>

                  <Button
                    size="sm"
                    variant="secondary"
                    class="h-8 cursor-pointer gap-1.5 px-3 text-xs"
                    @click="handleReplaceWorkflow(combinedPromptText, false)"
                  >
                    <Replace class="h-3.5 w-3.5" />
                    <span>Replace Prompt</span>
                  </Button>

                  <Button
                    v-if="props.type === 'character'"
                    size="sm"
                    variant="outline"
                    class="border-primary/30 hover:bg-primary/10 text-primary h-8 cursor-pointer gap-1.5 px-3 text-xs font-medium"
                    @click="openCreateCharacterFromAnimadex"
                  >
                    <BookOpen class="h-3.5 w-3.5" />
                    <span>Save to Character Library</span>
                  </Button>

                  <Button
                    v-if="props.type === 'character'"
                    size="sm"
                    variant="outline"
                    class="border-primary/30 hover:bg-primary/10 text-primary h-8 cursor-pointer gap-1.5 px-3 text-xs font-medium"
                    @click="mentionInMaya"
                  >
                    <MessageSquare class="h-3.5 w-3.5" />
                    <span>Mention in Maya</span>
                  </Button>

                  <Button
                    size="sm"
                    variant="outline"
                    class="ml-auto h-8 cursor-pointer gap-1.5 px-3 text-xs"
                    @click="handleAppendToWorkflow(combinedPromptText, true)"
                  >
                    <span>Use & Open Workflow</span>
                    <ArrowUpRight class="h-3.5 w-3.5" />
                  </Button>
                </div>

                <!-- Interactive Tag Chips (Trigger tags placed first) -->
                <div
                  class="border-border/40 flex flex-col gap-1.5 border-t pt-2.5"
                >
                  <div class="flex items-center justify-between">
                    <span class="text-muted-foreground text-xs font-medium">
                      All Tags (Click to copy, + to append):
                    </span>
                    <span class="text-muted-foreground/70 text-xs">
                      Highlighted tags are triggers
                    </span>
                  </div>

                  <div
                    class="flex max-h-48 flex-wrap gap-1.5 overflow-y-auto pr-1"
                  >
                    <button
                      v-for="tagItem in allTags"
                      :key="tagItem.text"
                      type="button"
                      class="group relative inline-flex cursor-pointer items-center gap-1 rounded-lg border px-2 py-1 text-xs transition-colors"
                      :class="
                        tagItem.isTrigger
                          ? 'border-primary/50 bg-primary/15 text-primary hover:bg-primary/25 font-medium'
                          : 'border-border/50 bg-secondary/30 text-secondary-foreground hover:border-primary/50 hover:bg-secondary'
                      "
                      :title="`Click to copy: ${tagItem.text}`"
                      @click="handleCopyTag(tagItem.text)"
                    >
                      <Sparkles
                        v-if="tagItem.isTrigger"
                        class="text-primary h-3 w-3 shrink-0"
                      />
                      <Check
                        v-if="copiedTag === tagItem.text"
                        class="h-3 w-3 shrink-0 text-emerald-500"
                      />
                      <span>{{ tagItem.text }}</span>
                      <span
                        class="text-primary hover:text-primary/80 ml-0.5 opacity-0 transition-opacity group-hover:opacity-100"
                        title="Append tag to workflow prompt"
                        @click.stop="
                          handleAppendToWorkflow(tagItem.text, false)
                        "
                      >
                        <Plus class="h-3 w-3" />
                      </span>
                      <span
                        class="text-muted-foreground hover:text-foreground opacity-0 transition-opacity group-hover:opacity-100"
                        title="Search by this tag"
                        @click.stop="handleFilterByTag(tagItem.text)"
                      >
                        <Search class="h-3 w-3" />
                      </span>
                    </button>
                  </div>
                </div>
              </div>

              <!-- Associated LoRAs -->
              <div
                v-if="
                  character && character.loras && character.loras.length > 0
                "
                class="flex flex-col gap-2"
              >
                <span
                  class="text-muted-foreground flex items-center gap-1.5 text-xs font-semibold tracking-wider uppercase"
                >
                  <Layers class="h-3.5 w-3.5 text-purple-400" />
                  Trained LoRA Models
                </span>

                <div class="flex flex-col gap-2">
                  <div
                    v-for="lora in character.loras"
                    :key="lora.name"
                    class="flex items-center justify-between gap-3 rounded-xl border border-purple-500/20 bg-purple-500/5 p-2.5 transition-colors hover:border-purple-500/40"
                  >
                    <div class="flex items-center gap-2.5 overflow-hidden">
                      <img
                        v-if="lora.thumb"
                        :src="lora.thumb"
                        :alt="lora.name"
                        class="bg-muted/40 h-10 w-10 shrink-0 rounded-lg object-cover"
                      />
                      <div class="flex flex-col overflow-hidden">
                        <span
                          class="text-foreground truncate text-xs font-semibold"
                          :title="lora.name"
                        >
                          {{ lora.name }}
                        </span>
                        <span class="text-muted-foreground text-xs"
                          >Civitai Model</span
                        >
                      </div>
                    </div>

                    <Button
                      v-if="lora.url"
                      size="sm"
                      variant="outline"
                      class="h-7 shrink-0 cursor-pointer gap-1 border-purple-500/30 px-2 text-xs hover:bg-purple-500/10"
                      @click="handleOpenExternal(lora.url)"
                    >
                      <span>Civitai</span>
                      <ExternalLink class="h-3 w-3" />
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          </ScrollArea>
        </div>
      </div>
    </DialogContent>
  </Dialog>

  <!-- Save Character to Library Modal -->
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
      class="border-border bg-card flex max-h-[90vh] w-full min-w-[60vw] flex-col gap-0 overflow-hidden p-0 shadow-2xl"
    >
      <DialogHeader
        class="border-border bg-background/50 shrink-0 border-b px-5 py-4"
      >
        <DialogTitle
          class="text-foreground flex items-center gap-2 text-sm font-bold"
        >
          <BookOpen class="text-primary h-4 w-4" />
          <span>Save to Character Library</span>
        </DialogTitle>
      </DialogHeader>

      <div class="min-h-0 flex-1 overflow-y-auto px-6 py-5">
        <div class="grid grid-cols-1 items-start gap-6 md:grid-cols-3">
          <!-- Left (2 cols): Character Inputs -->
          <div class="flex flex-col gap-4 md:col-span-2">
            <!-- Character Name -->
            <div class="flex flex-col gap-1.5">
              <Label class="text-foreground text-xs font-bold">
                Character Name <span class="text-destructive">*</span>
              </Label>
              <Input
                v-model="charName"
                placeholder="e.g. Hatsune Miku"
                class="text-xs"
              />
            </div>

            <!-- Trigger Tag -->
            <div class="flex flex-col gap-1.5">
              <Label class="text-foreground text-xs font-bold">
                Trigger Tag <span class="text-destructive">*</span>
              </Label>
              <Input
                v-model="charTrigger"
                placeholder="e.g. hatsune_miku"
                class="font-mono text-xs"
              />
            </div>

            <!-- Series / Copyright -->
            <div class="flex flex-col gap-1.5">
              <Label class="text-foreground text-xs font-bold">
                Series / Copyright (optional)
              </Label>
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
