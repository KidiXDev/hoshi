<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import {
  BookOpen,
  Copy,
  LibraryBig,
  MessageSquare,
  Plus,
  Replace,
  User
} from '@lucide/vue';
import { toast } from 'vue-sonner';
import SaveCharacterDialog from '@/components/library/SaveCharacterDialog.vue';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  MOSS_CATALOG_NOTE,
  mossImageUrl,
  mossRemoteImageUrl,
  mossThumbnailUrl
} from '@/services/mossCatalog';
import { useAiStore } from '@/stores/aiStore';
import { useWorkflowStore } from '@/stores/workflowStore';
import type { CharacterDraft } from '@/types/library';
import type { MossCatalogEntry } from '@/types/mossCatalog';
import { createMossCatalogMention } from '@/utils/aiMentions';
import { formatTitle } from '@/utils/formatters';

const props = defineProps<{
  entry: MossCatalogEntry | null;
  categoryLabel?: string;
}>();

const open = defineModel<boolean>('open', { required: true });

const emit = defineEmits<{
  'filter-by-copyright': [copyright: string];
  'filter-by-tag': [tag: string];
}>();

const workflowStore = useWorkflowStore();
const aiStore = useAiStore();
const imageError = ref(false);
const isSaveOpen = ref(false);
const characterDraft = ref<CharacterDraft | null>(null);
watch(
  () => props.entry,
  () => {
    imageError.value = false;
  }
);

const isStyle = computed(() => props.entry?.kind === 'style');
const tagList = computed(() =>
  (props.entry?.tags ?? '')
    .split(',')
    .map((tag) => tag.trim())
    .filter(Boolean)
);
const promptBlocks = computed(() => {
  const entry = props.entry;
  if (!entry) return [];
  const blocks = [
    {
      label: isStyle.value ? 'Style description' : 'Caption',
      text: entry.caption
    },
    { label: 'Full scene prompt', text: entry.prompt }
  ];
  if (!isStyle.value) blocks.unshift({ label: 'Tags', text: entry.tags });
  return blocks.filter(
    (block, index) =>
      block.text &&
      blocks.findIndex((other) => other.text === block.text) === index
  );
});

async function copyText(text: string, label: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast.success(`${label} copied to clipboard`);
  } catch {
    toast.error('Failed to copy to clipboard');
  }
}

function appendToWorkflow(text: string) {
  const current = workflowStore.positivePrompt.trim();
  workflowStore.positivePrompt = current ? `${current}, ${text}` : text;
  toast.success('Appended to Workflow positive prompt');
}

function replaceWorkflow(text: string) {
  workflowStore.positivePrompt = text;
  toast.success('Replaced Workflow positive prompt');
}

function filterByCopyright(copyright: string) {
  emit('filter-by-copyright', copyright);
  open.value = false;
}

function filterByTag(tag: string) {
  emit('filter-by-tag', tag);
  open.value = false;
}

function mentionInMaya(entry: MossCatalogEntry) {
  aiStore.addDraftMention(createMossCatalogMention(entry));
  open.value = false;
  aiStore.isDrawerOpen = true;
}

function openSaveToLibrary(entry: MossCatalogEntry) {
  const identity = new Set([entry.name, entry.copyright]);
  characterDraft.value = {
    name: formatTitle(entry.name),
    trigger: entry.name,
    series: formatTitle(entry.copyright),
    tags: tagList.value.filter((tag) => !identity.has(tag)),
    thumbnailUrl: mossRemoteImageUrl(entry),
    source: 'moss'
  };
  isSaveOpen.value = true;
}
</script>

<template>
  <Dialog
    :open="open && !isSaveOpen"
    @update:open="(value) => !isSaveOpen && (open = value)"
  >
    <DialogContent
      class="border-border/60 bg-background w-[92vw] max-w-5xl min-w-0 overflow-hidden p-0 shadow-2xl sm:max-w-5xl sm:rounded-2xl"
    >
      <DialogHeader class="sr-only">
        <DialogTitle>{{ entry?.name ?? 'Detail' }}</DialogTitle>
        <DialogDescription>MOSS Catalog prompt information</DialogDescription>
      </DialogHeader>

      <div
        v-if="entry"
        class="grid max-h-[85vh] grid-cols-1 overflow-hidden md:grid-cols-12"
      >
        <div
          class="bg-muted/30 relative flex min-h-64 items-center justify-center overflow-hidden md:col-span-5 md:min-h-140"
        >
          <img
            v-if="!imageError"
            :src="mossImageUrl(entry)"
            :alt="entry.name"
            class="relative h-full max-h-[85vh] w-full object-contain object-center"
            :style="{
              backgroundImage: `url(${mossThumbnailUrl(entry)})`,
              backgroundSize: 'contain',
              backgroundPosition: 'center',
              backgroundRepeat: 'no-repeat'
            }"
            @error="imageError = true"
          />
          <div
            v-else
            class="text-muted-foreground flex flex-col items-center gap-2 p-6"
          >
            <User class="h-16 w-16 opacity-30" />
            <span class="text-xs opacity-50">Image preview unavailable</span>
          </div>
        </div>

        <ScrollArea class="max-h-[85vh] md:col-span-7">
          <div class="flex flex-col gap-5 p-6">
            <div class="flex flex-col gap-1.5 pr-8">
              <Badge variant="outline" class="w-fit text-xs">
                {{ isStyle ? categoryLabel || 'Art Style' : 'Character' }}
              </Badge>
              <h2 class="text-xl font-semibold">{{ entry.name }}</h2>
              <button
                v-if="!isStyle"
                type="button"
                class="text-muted-foreground hover:text-foreground flex w-fit cursor-pointer items-center gap-1.5 text-sm"
                @click="filterByCopyright(entry.copyright)"
              >
                <BookOpen class="h-3.5 w-3.5" />
                {{ entry.copyright }}
              </button>
              <span
                v-if="entry.sourceCount"
                class="text-muted-foreground text-xs"
              >
                {{ entry.sourceCount.toLocaleString() }} source posts
              </span>
              <div class="mt-1 flex flex-wrap items-center gap-1.5">
                <Button
                  size="sm"
                  variant="ghost"
                  class="text-primary hover:bg-primary/10 h-8 cursor-pointer gap-1.5 px-2.5 text-xs font-medium"
                  @click="mentionInMaya(entry)"
                >
                  <MessageSquare class="h-3.5 w-3.5" />
                  Maya
                </Button>
                <Button
                  v-if="!isStyle"
                  size="sm"
                  variant="outline"
                  class="border-primary/30 hover:bg-primary/10 text-primary h-8 cursor-pointer gap-1.5 px-2.5 text-xs font-medium"
                  @click="openSaveToLibrary(entry)"
                >
                  <LibraryBig class="h-3.5 w-3.5" />
                  Save to Library
                </Button>
              </div>
            </div>

            <div
              v-for="block in promptBlocks"
              :key="block.label"
              class="flex flex-col gap-2"
            >
              <div class="flex items-center justify-between gap-2">
                <span class="text-sm font-medium">{{ block.label }}</span>
                <div class="flex items-center gap-1">
                  <Button
                    variant="ghost"
                    size="sm"
                    class="h-7 cursor-pointer gap-1 px-2 text-xs"
                    @click="copyText(block.text, block.label)"
                  >
                    <Copy class="h-3.5 w-3.5" /> Copy
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    class="h-7 cursor-pointer gap-1 px-2 text-xs"
                    @click="appendToWorkflow(block.text)"
                  >
                    <Plus class="h-3.5 w-3.5" /> Append
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    class="h-7 cursor-pointer gap-1 px-2 text-xs"
                    @click="replaceWorkflow(block.text)"
                  >
                    <Replace class="h-3.5 w-3.5" /> Replace
                  </Button>
                </div>
              </div>
              <p
                class="bg-muted/40 border-border/60 rounded-lg border p-3 text-xs leading-relaxed whitespace-pre-wrap select-text"
              >
                {{ block.text }}
              </p>
            </div>

            <div v-if="!isStyle && tagList.length" class="flex flex-col gap-2">
              <span class="text-sm font-medium">Search by tag</span>
              <div class="flex flex-wrap gap-1.5">
                <button
                  v-for="tag in tagList"
                  :key="tag"
                  type="button"
                  class="bg-secondary/60 hover:bg-secondary cursor-pointer rounded-md px-2 py-0.5 text-xs"
                  @click="filterByTag(tag)"
                >
                  {{ tag }}
                </button>
              </div>
            </div>

            <p class="text-muted-foreground text-xs">{{ MOSS_CATALOG_NOTE }}</p>
          </div>
        </ScrollArea>
      </div>
    </DialogContent>
  </Dialog>

  <SaveCharacterDialog
    v-model:open="isSaveOpen"
    :draft="characterDraft"
    @open-library="open = false"
  />
</template>
