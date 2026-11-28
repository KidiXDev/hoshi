<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { openUrl } from '@tauri-apps/plugin-opener';
import {
  ArrowUpRight,
  BookOpen,
  Check,
  Copy,
  ExternalLink,
  Hash,
  Layers,
  MessageSquare,
  Palette,
  Plus,
  Replace,
  Search,
  Sparkles,
  User,
  Zap
} from '@lucide/vue';
import { toast } from 'vue-sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogCloseButton,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog';
import SaveCharacterDialog from '@/components/library/SaveCharacterDialog.vue';
import { ScrollArea } from '@/components/ui/scroll-area';
import { resolveAnimadexMediaUrl } from '@/services/animadexApi';
import { useWorkflowStore } from '@/stores/workflowStore';
import { useAiStore } from '@/stores/aiStore';
import type {
  AnimaDexArtist,
  AnimaDexCharacter,
  AnimaDexCopyright
} from '@/types/animadex';
import type { CharacterDraft } from '@/types/library';
import { createAnimadexMention } from '@/utils/aiMentions';
import { formatTitle } from '@/utils/formatters';

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
const copiedTrigger = ref(false);
const copiedTag = ref<string | null>(null);
watch(
  () => props.item,
  () => {
    imageLoaded.value = false;
    imageError.value = false;
    copiedAll.value = false;
    copiedTrigger.value = false;
    copiedTag.value = null;
  }
);

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

const coreTags = computed(() => allTags.value.filter((t) => !t.isTrigger));

const typeLabel = computed(() =>
  props.type === 'character'
    ? 'Character'
    : props.type === 'artist'
      ? 'Artist Style'
      : 'Series'
);

function handleCopyTrigger() {
  if (!triggerPrompt.value) return;
  void copyToClipboard(triggerPrompt.value, 'Trigger');
  copiedTrigger.value = true;
  setTimeout(() => {
    copiedTrigger.value = false;
  }, 2000);
}

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
const characterDraft = ref<CharacterDraft | null>(null);

function handleDetailOpenChange(val: boolean) {
  if (charModalOpen.value) return;
  emit('update:open', val);
}

function openCreateCharacterFromAnimadex() {
  if (!character.value) return;
  const char = character.value;
  const series = char.copyright_name || char.copyright || '';
  characterDraft.value = {
    name: char.name ? formatTitle(char.name) : '',
    trigger: char.trigger || char.name.toLowerCase().replaceAll(' ', '_'),
    series: series ? formatTitle(series) : '',
    tags: char.tags || [],
    thumbnailUrl: resolveAnimadexMediaUrl(char.img_url || char.thumb_url),
    source: 'animadex',
    animadexSlug: char.slug
  };
  charModalOpen.value = true;
}
</script>

<template>
  <Dialog :open="open && !charModalOpen" @update:open="handleDetailOpenChange">
    <DialogContent
      class="border-border/60 bg-background w-[92vw] max-w-5xl min-w-0 overflow-hidden p-0 shadow-2xl sm:max-w-5xl sm:rounded-2xl"
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
          class="bg-muted/30 relative flex min-h-64 items-center justify-center overflow-hidden md:col-span-5 md:min-h-140"
        >
          <!-- Blurred backdrop fills letterbox space -->
          <img
            v-if="previewImageUrl && !imageError"
            :src="previewImageUrl"
            alt=""
            aria-hidden="true"
            class="absolute inset-0 h-full w-full scale-110 object-cover opacity-30 blur-2xl"
          />
          <div
            v-if="!imageLoaded && !imageError && previewImageUrl"
            class="bg-muted/40 absolute inset-0 animate-pulse"
          />

          <img
            v-if="previewImageUrl && !imageError"
            :src="previewImageUrl"
            :alt="item.name"
            class="relative h-full max-h-[85vh] w-full object-contain object-center transition-opacity duration-300"
            :class="imageLoaded ? 'opacity-100' : 'opacity-0'"
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

          <Button
            v-if="previewImageUrl && !imageError"
            variant="secondary"
            size="sm"
            class="bg-background/70 hover:bg-background absolute top-3 left-3 h-7 cursor-pointer gap-1.5 rounded-lg px-2.5 text-xs shadow-xs backdrop-blur-md"
            @click="handleOpenExternal(previewImageUrl)"
          >
            <ArrowUpRight class="h-3 w-3" />
            <span>Full Image</span>
          </Button>
        </div>

        <!-- Right: Details -->
        <div
          class="flex max-h-[85vh] min-h-0 flex-col overflow-hidden md:col-span-7"
        >
          <!-- Header -->
          <header class="border-border/60 border-b px-6 pt-5 pb-4">
            <div class="flex items-start justify-between gap-3">
              <div class="min-w-0">
                <div
                  class="text-muted-foreground mb-1 flex items-center gap-1.5 text-xs font-semibold tracking-wider uppercase"
                >
                  <User v-if="type === 'character'" class="h-3 w-3" />
                  <Palette v-else-if="type === 'artist'" class="h-3 w-3" />
                  <Layers v-else class="h-3 w-3" />
                  {{ typeLabel }}
                </div>
                <h2
                  class="text-foreground truncate text-2xl leading-tight font-bold tracking-tight"
                  :title="item.name"
                >
                  {{ item.name }}
                </h2>
                <button
                  v-if="
                    character &&
                    (character.copyright_name || character.copyright)
                  "
                  type="button"
                  class="text-primary mt-1 inline-flex cursor-pointer items-center gap-1 text-sm font-medium hover:underline"
                  title="Browse this series"
                  @click="handleFilterBySeries"
                >
                  <Layers class="h-3.5 w-3.5" />
                  {{ character.copyright_name || character.copyright }}
                </button>
              </div>

              <div class="flex shrink-0 items-center gap-1.5">
                <Button
                  v-if="'url' in item && item.url"
                  variant="outline"
                  size="sm"
                  class="h-8 cursor-pointer gap-1.5 rounded-lg px-2.5 text-xs"
                  @click="handleOpenExternal(item.url)"
                >
                  <span>Danbooru</span>
                  <ExternalLink class="h-3 w-3" />
                </Button>
                <DialogCloseButton class="rounded-lg" />
              </div>
            </div>

            <div class="mt-3 flex flex-wrap items-center gap-1.5">
              <Badge
                v-if="formattedCount"
                variant="secondary"
                class="gap-1 text-xs font-normal"
              >
                <Hash class="h-3 w-3 opacity-60" />
                {{ formattedCount }} posts
              </Badge>
              <Badge
                v-if="formattedScore"
                variant="secondary"
                class="border border-emerald-500/30 bg-emerald-500/15 text-xs text-emerald-400"
              >
                Score {{ formattedScore }}
              </Badge>
              <Badge
                v-if="character?.loras && character.loras.length > 0"
                variant="secondary"
                class="border border-purple-500/30 bg-purple-600/20 text-xs text-purple-300"
              >
                {{ character.loras.length }} LoRA{{
                  character.loras.length > 1 ? 's' : ''
                }}
              </Badge>
              <Badge
                v-if="coreTags.length"
                variant="secondary"
                class="text-xs font-normal"
              >
                {{ coreTags.length }} tags
              </Badge>
            </div>
          </header>

          <!-- Scrollable body -->
          <ScrollArea class="min-h-0 flex-1">
            <div class="flex flex-col gap-6 px-6 py-5">
              <!-- Trigger -->
              <section v-if="triggerPrompt" class="flex flex-col gap-2">
                <div class="flex items-center justify-between">
                  <span
                    class="text-muted-foreground flex items-center gap-1.5 text-xs font-semibold tracking-wider uppercase"
                  >
                    <Zap class="text-primary h-3.5 w-3.5" />
                    Trigger
                  </span>
                  <Button
                    size="sm"
                    variant="ghost"
                    class="h-6 cursor-pointer gap-1 px-2 text-xs"
                    @click="handleCopyTrigger"
                  >
                    <Check
                      v-if="copiedTrigger"
                      class="h-3 w-3 text-emerald-500"
                    />
                    <Copy v-else class="h-3 w-3" />
                    {{ copiedTrigger ? 'Copied' : 'Copy' }}
                  </Button>
                </div>
                <div
                  class="border-primary/30 bg-primary/5 text-foreground rounded-lg border px-3 py-2.5 font-mono text-sm leading-relaxed break-words select-text"
                >
                  {{ triggerPrompt }}
                </div>
              </section>

              <!-- Tags -->
              <section v-if="coreTags.length" class="flex flex-col gap-2">
                <div class="flex items-center justify-between">
                  <span
                    class="text-muted-foreground flex items-center gap-1.5 text-xs font-semibold tracking-wider uppercase"
                  >
                    <Sparkles class="h-3.5 w-3.5 text-amber-400" />
                    Tags
                  </span>
                  <span class="text-muted-foreground/70 text-xs">
                    Click to copy · hover for more
                  </span>
                </div>
                <div class="flex flex-wrap gap-1.5">
                  <div
                    v-for="tagItem in coreTags"
                    :key="tagItem.text"
                    class="group border-border/60 bg-secondary/40 hover:border-primary/50 hover:bg-secondary inline-flex items-center overflow-hidden rounded-md border text-xs transition-colors"
                  >
                    <button
                      type="button"
                      class="text-secondary-foreground inline-flex cursor-pointer items-center gap-1 py-1 pr-1.5 pl-2"
                      :title="`Copy ${tagItem.text}`"
                      @click="handleCopyTag(tagItem.text)"
                    >
                      <Check
                        v-if="copiedTag === tagItem.text"
                        class="h-3 w-3 shrink-0 text-emerald-500"
                      />
                      <span>{{ tagItem.text }}</span>
                    </button>
                    <span
                      class="flex w-0 items-center gap-0.5 overflow-hidden pr-0 opacity-0 transition-all group-hover:w-auto group-hover:pr-1.5 group-hover:opacity-100"
                    >
                      <button
                        type="button"
                        class="text-muted-foreground hover:text-primary cursor-pointer p-0.5"
                        title="Append to workflow prompt"
                        @click="handleAppendToWorkflow(tagItem.text, false)"
                      >
                        <Plus class="h-3 w-3" />
                      </button>
                      <button
                        type="button"
                        class="text-muted-foreground hover:text-foreground cursor-pointer p-0.5"
                        title="Search this tag"
                        @click="handleFilterByTag(tagItem.text)"
                      >
                        <Search class="h-3 w-3" />
                      </button>
                    </span>
                  </div>
                </div>
              </section>

              <!-- Full prompt -->
              <section v-if="allTags.length" class="flex flex-col gap-2">
                <div class="flex items-center justify-between">
                  <span
                    class="text-muted-foreground text-xs font-semibold tracking-wider uppercase"
                  >
                    Full Prompt
                  </span>
                  <Button
                    size="sm"
                    variant="ghost"
                    class="h-6 cursor-pointer gap-1 px-2 text-xs"
                    @click="handleCopyAllPrompt"
                  >
                    <Check v-if="copiedAll" class="h-3 w-3 text-emerald-500" />
                    <Copy v-else class="h-3 w-3" />
                    {{ copiedAll ? 'Copied' : 'Copy' }}
                  </Button>
                </div>
                <div
                  class="border-border/60 bg-muted/30 text-muted-foreground max-h-32 overflow-y-auto rounded-lg border px-3 py-2.5 font-mono text-xs leading-relaxed break-words select-text"
                >
                  {{ combinedPromptText }}
                </div>
              </section>

              <!-- Associated LoRAs -->
              <section
                v-if="
                  character && character.loras && character.loras.length > 0
                "
                class="flex flex-col gap-2"
              >
                <span
                  class="text-muted-foreground flex items-center gap-1.5 text-xs font-semibold tracking-wider uppercase"
                >
                  <Layers class="h-3.5 w-3.5 text-purple-400" />
                  Trained LoRAs
                </span>
                <div class="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  <div
                    v-for="lora in character.loras"
                    :key="lora.name"
                    class="flex items-center gap-2.5 rounded-lg border border-purple-500/20 bg-purple-500/5 p-2 transition-colors hover:border-purple-500/40"
                  >
                    <img
                      v-if="lora.thumb"
                      :src="lora.thumb"
                      :alt="lora.name"
                      class="bg-muted/40 h-10 w-10 shrink-0 rounded-md object-cover"
                    />
                    <div
                      v-else
                      class="bg-muted/40 flex h-10 w-10 shrink-0 items-center justify-center rounded-md"
                    >
                      <Layers class="h-4 w-4 text-purple-400/60" />
                    </div>
                    <div class="flex min-w-0 flex-1 flex-col">
                      <span
                        class="text-foreground truncate text-xs font-semibold"
                        :title="lora.name"
                      >
                        {{ lora.name }}
                      </span>
                      <span class="text-muted-foreground text-xs">Civitai</span>
                    </div>
                    <Button
                      v-if="lora.url"
                      size="iconSm"
                      variant="ghost"
                      class="text-muted-foreground hover:text-foreground shrink-0 cursor-pointer"
                      title="Open on Civitai"
                      @click="handleOpenExternal(lora.url)"
                    >
                      <ExternalLink class="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              </section>
            </div>
          </ScrollArea>

          <!-- Action bar -->
          <footer
            v-if="allTags.length"
            class="border-border/60 bg-muted/20 flex flex-wrap items-center gap-2 border-t px-6 py-3"
          >
            <Button
              size="sm"
              class="h-8 cursor-pointer gap-1.5 px-3 text-xs font-medium"
              @click="handleAppendToWorkflow(combinedPromptText, false)"
            >
              <Plus class="h-3.5 w-3.5" />
              Append
            </Button>
            <Button
              size="sm"
              variant="secondary"
              class="h-8 cursor-pointer gap-1.5 px-3 text-xs"
              @click="handleReplaceWorkflow(combinedPromptText, false)"
            >
              <Replace class="h-3.5 w-3.5" />
              Replace
            </Button>
            <Button
              size="sm"
              variant="outline"
              class="h-8 cursor-pointer gap-1.5 px-3 text-xs"
              @click="handleAppendToWorkflow(combinedPromptText, true)"
            >
              Use & Open Workflow
              <ArrowUpRight class="h-3.5 w-3.5" />
            </Button>

            <div v-if="character" class="ml-auto flex items-center gap-1.5">
              <Button
                size="sm"
                variant="ghost"
                class="text-primary hover:bg-primary/10 h-8 cursor-pointer gap-1.5 px-2.5 text-xs font-medium"
                @click="mentionInMaya"
              >
                <MessageSquare class="h-3.5 w-3.5" />
                Maya
              </Button>
              <Button
                size="sm"
                variant="outline"
                class="border-primary/30 hover:bg-primary/10 text-primary h-8 cursor-pointer gap-1.5 px-2.5 text-xs font-medium"
                @click="openCreateCharacterFromAnimadex"
              >
                <BookOpen class="h-3.5 w-3.5" />
                Save to Library
              </Button>
            </div>
          </footer>
        </div>
      </div>
    </DialogContent>
  </Dialog>

  <SaveCharacterDialog
    v-model:open="charModalOpen"
    :draft="characterDraft"
    @open-library="emit('update:open', false)"
  />
</template>
