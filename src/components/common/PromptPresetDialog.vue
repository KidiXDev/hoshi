<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import {
  ArrowUpRight,
  Bookmark,
  Check,
  Clock,
  Copy,
  FileText,
  FolderOpen,
  Library,
  Plus,
  PlusCircle,
  RefreshCw,
  RotateCcw,
  Search,
  Sparkles,
  Trash2,
  X
} from '@lucide/vue';
import { Button } from '@/components/ui/button';
import { useConfirmDialog } from '@/composables/useConfirmDialog';
import {
  Dialog,
  DialogCloseButton,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { formatShortDate } from '@/utils/formatters';
import { LibraryService } from '../../services/libraryService';
import { useWorkflowStore } from '../../stores/workflowStore';
import type {
  LibraryItem,
  LibraryListEntry,
  PromptData
} from '../../types/library';

const props = defineProps<{
  open: boolean;
}>();

const emit = defineEmits<{
  (e: 'update:open', val: boolean): void;
}>();

const workflowStore = useWorkflowStore();
const { confirm } = useConfirmDialog();

const activeTab = ref<'load' | 'save'>('load');
const entries = ref<LibraryListEntry[]>([]);
const failedThumbnails = ref<Set<string>>(new Set());
const isLoading = ref(false);
const searchQuery = ref('');
const appendMode = ref(false);
const copiedEntryId = ref<string | null>(null);

// Form state for saving
const saveName = ref('');
const saveDescription = ref('');
const saveType = ref<'both' | 'positive' | 'negative'>('both');
const editPositivePrompt = ref('');
const editNegativePrompt = ref('');
const saveSuccessMessage = ref('');

function resetToCurrentPrompt() {
  editPositivePrompt.value = workflowStore.positivePrompt;
  editNegativePrompt.value = workflowStore.negativePrompt;
}

async function fetchEntries() {
  isLoading.value = true;
  failedThumbnails.value.clear();
  entries.value = await LibraryService.listItems('prompts');
  isLoading.value = false;
}

watch(
  () => props.open,
  (isOpen) => {
    if (isOpen) {
      void fetchEntries();
      saveSuccessMessage.value = '';
      resetToCurrentPrompt();
      if (!saveName.value) {
        saveName.value = `Preset ${new Date().toLocaleDateString()}`;
      }
    }
  }
);

onMounted(() => {
  if (props.open) {
    void fetchEntries();
  }
});

const filteredEntries = computed(() => {
  const q = searchQuery.value.trim().toLowerCase();
  return entries.value.filter((e) => {
    if (q) {
      const inName = e.name.toLowerCase().includes(q);
      const inDesc = e.description?.toLowerCase().includes(q) ?? false;
      return inName || inDesc;
    }
    return true;
  });
});

async function applyPrompt(
  entry: LibraryListEntry,
  applyMode: 'both' | 'positive' | 'negative' = 'both'
) {
  const item = await LibraryService.getItem<PromptData>(entry.id, 'prompts');
  const data = item.data;

  if ((applyMode === 'both' || applyMode === 'positive') && data.positive) {
    if (appendMode.value && workflowStore.positivePrompt.trim()) {
      workflowStore.positivePrompt += `, ${data.positive}`;
    } else {
      workflowStore.positivePrompt = data.positive;
    }
  }

  if ((applyMode === 'both' || applyMode === 'negative') && data.negative) {
    if (appendMode.value && workflowStore.negativePrompt.trim()) {
      workflowStore.negativePrompt += `, ${data.negative}`;
    } else {
      workflowStore.negativePrompt = data.negative;
    }
  }

  emit('update:open', false);
}

async function handleSavePreset() {
  if (!saveName.value.trim()) return;

  const data: PromptData = {
    type: saveType.value,
    positive:
      saveType.value === 'negative' ? undefined : editPositivePrompt.value,
    negative:
      saveType.value === 'positive' ? undefined : editNegativePrompt.value
  };

  const payload: Omit<LibraryItem<PromptData>, 'thumbnailUrl'> = {
    id: '',
    category: 'prompts',
    name: saveName.value.trim(),
    description: saveDescription.value.trim() || undefined,
    data,
    createdAt: Date.now(),
    updatedAt: Date.now()
  };

  await LibraryService.saveItem(payload);
  saveSuccessMessage.value = `Saved "${saveName.value.trim()}" to Library!`;
  saveName.value = '';
  saveDescription.value = '';
  await fetchEntries();
  setTimeout(() => {
    activeTab.value = 'load';
    saveSuccessMessage.value = '';
  }, 900);
}

async function requestDelete(entry: LibraryListEntry) {
  const confirmed = await confirm({
    title: 'Delete Prompt Preset?',
    description: `Are you sure you want to delete "${entry.name}"? This will permanently remove this preset from your prompt library.`
  });
  if (!confirmed) return;

  try {
    await LibraryService.deleteItem(entry.id, 'prompts');
    await fetchEntries();
  } catch (err) {
    console.error('Failed to delete prompt preset:', err);
  }
}

async function copyPromptText(entry: LibraryListEntry) {
  const item = await LibraryService.getItem<PromptData>(entry.id, 'prompts');
  const text = [item.data.positive, item.data.negative]
    .filter(Boolean)
    .join('\n\nNegative:\n');
  void navigator.clipboard.writeText(text);
  copiedEntryId.value = entry.id;
  setTimeout(() => {
    if (copiedEntryId.value === entry.id) copiedEntryId.value = null;
  }, 1500);
}
</script>

<template>
  <Dialog :open="open" @update:open="(val) => emit('update:open', val)">
    <DialogContent
      class="border-border bg-card flex max-h-[88vh] w-full max-w-5xl min-w-[70vw] flex-col gap-0 overflow-hidden p-0 shadow-2xl"
    >
      <!-- Dialog Header -->
      <DialogHeader
        class="border-border bg-background/50 flex flex-row items-center justify-between border-b px-5 py-3.5"
      >
        <div class="flex items-center gap-2.5">
          <div
            class="bg-primary/10 text-primary border-primary/20 flex h-8 w-8 items-center justify-center rounded-lg border"
          >
            <Bookmark class="h-4 w-4" />
          </div>
          <div>
            <DialogTitle
              class="text-foreground text-sm font-bold tracking-tight"
            >
              Prompt Presets
            </DialogTitle>
            <DialogDescription class="text-muted-foreground text-xs">
              Save, load, and manage prompt presets from your Library.
            </DialogDescription>
          </div>
        </div>

        <!-- Header Actions -->
        <div class="flex items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            title="Open full Library"
            class="border-border bg-secondary hover:bg-accent h-7.5 gap-1 px-2.5 text-xs"
            @click="
              emit('update:open', false);
              $router.push('/library?tab=prompts');
            "
          >
            <Library class="h-3.5 w-3.5" />
            <span>Open Library</span>
            <ArrowUpRight class="h-3 w-3" />
          </Button>

          <Button
            size="sm"
            variant="outline"
            title="Open library folder in file explorer"
            class="border-border bg-secondary hover:bg-accent h-7.5 gap-1 px-2.5 text-xs"
            @click="LibraryService.openFolder('prompts')"
          >
            <FolderOpen class="h-3.5 w-3.5" />
            <span>Open Folder</span>
          </Button>

          <Button
            size="iconSm"
            variant="outline"
            :disabled="isLoading"
            title="Refresh presets from disk"
            class="border-border bg-secondary hover:bg-accent h-7.5 w-7.5"
            @click="fetchEntries"
          >
            <RefreshCw
              class="h-3.5 w-3.5"
              :class="{ 'animate-spin': isLoading }"
            />
          </Button>
          <DialogCloseButton class="h-7.5 w-7.5" />
        </div>
      </DialogHeader>

      <!-- Main Tabs Container -->
      <Tabs v-model="activeTab" class="flex flex-1 flex-col overflow-hidden">
        <div class="border-border bg-muted/20 border-b px-6 py-3">
          <TabsList class="bg-muted/80 h-10 gap-1 rounded-lg p-1">
            <TabsTrigger
              value="load"
              class="data-[state=active]:bg-background data-[state=active]:text-foreground flex items-center gap-2 rounded-md px-4 py-2 text-xs font-semibold transition-all data-[state=active]:shadow-xs"
            >
              <FileText class="h-3.5 w-3.5" />
              Load Preset ({{ entries.length }})
            </TabsTrigger>
            <TabsTrigger
              value="save"
              class="data-[state=active]:bg-background data-[state=active]:text-foreground flex items-center gap-2 rounded-md px-4 py-2 text-xs font-semibold transition-all data-[state=active]:shadow-xs"
            >
              <PlusCircle class="h-3.5 w-3.5" />
              Save Current Prompt
            </TabsTrigger>
          </TabsList>
        </div>

        <!-- TAB 1: LOAD PRESETS -->
        <TabsContent
          value="load"
          class="m-0 flex flex-1 flex-col overflow-hidden outline-hidden"
        >
          <!-- Filter & Search Toolbar -->
          <div
            class="border-border bg-card/20 flex flex-wrap items-center justify-between gap-3 border-b px-6 py-3"
          >
            <div class="relative min-w-65 flex-1">
              <Search
                class="text-muted-foreground absolute top-1/2 left-3 h-3.5 w-3.5 -translate-y-1/2"
              />
              <Input
                v-model="searchQuery"
                placeholder="Search preset name or description..."
                class="bg-background/80 focus:ring-primary/30 h-8 w-full pr-8 pl-8.5 text-xs"
              />
              <button
                v-if="searchQuery"
                type="button"
                class="text-muted-foreground hover:text-foreground absolute top-1/2 right-2.5 -translate-y-1/2 cursor-pointer"
                @click="searchQuery = ''"
              >
                <X class="h-3.5 w-3.5" />
              </button>
            </div>

            <!-- Append Mode Toggle -->
            <div class="border-border flex items-center gap-1.5 border-l pl-3">
              <Label
                class="text-muted-foreground hover:text-foreground flex cursor-pointer items-center gap-1.5 text-xs"
              >
                <input
                  v-model="appendMode"
                  type="checkbox"
                  class="text-primary accent-primary rounded"
                />
                <span class="text-xs font-medium">Append to prompt</span>
              </Label>
            </div>
          </div>

          <!-- Presets List Area -->
          <ScrollArea class="h-[52vh] px-5 py-4">
            <!-- Empty State -->
            <div
              v-if="filteredEntries.length === 0"
              class="flex h-56 flex-col items-center justify-center gap-2 text-center"
            >
              <div
                class="bg-muted text-muted-foreground flex h-12 w-12 items-center justify-center rounded-full"
              >
                <FileText class="h-6 w-6 opacity-40" />
              </div>
              <span class="text-foreground text-xs font-semibold"
                >No presets found</span
              >
              <p class="text-muted-foreground max-w-sm text-xs">
                {{
                  searchQuery
                    ? `No presets match "${searchQuery}".`
                    : `No prompt presets in your Library yet. Click "Save Current Prompt" to create one.`
                }}
              </p>
            </div>

            <!-- Presets Grid / Cards -->
            <div v-else class="grid grid-cols-1 gap-3.5 md:grid-cols-2">
              <div
                v-for="entry in filteredEntries"
                :key="entry.id"
                class="border-border bg-card hover:border-primary/50 relative flex min-h-36 flex-row overflow-hidden rounded-xl border transition-all hover:shadow-md"
              >
                <!-- Left: Content & Actions -->
                <div class="flex min-w-0 flex-1 flex-col justify-between p-3.5">
                  <!-- Top: Badge + Date + Title + Desc -->
                  <div>
                    <div class="flex items-center justify-between gap-2">
                      <span
                        class="rounded-md border border-emerald-500/30 bg-emerald-500/15 px-1.5 py-0.5 font-mono text-xs font-bold text-emerald-400 uppercase"
                      >
                        Prompt
                      </span>

                      <div
                        class="text-muted-foreground/70 flex items-center gap-1 font-mono text-xs"
                      >
                        <Clock class="h-2.5 w-2.5" />
                        <span>{{ formatShortDate(entry.updatedAt) }}</span>
                      </div>
                    </div>

                    <div class="mt-2">
                      <h4
                        class="text-foreground truncate text-sm leading-snug font-bold"
                        :title="entry.name"
                      >
                        {{ entry.name }}
                      </h4>
                      <p
                        v-if="entry.description"
                        class="text-muted-foreground mt-1 line-clamp-2 text-xs leading-relaxed"
                        :title="entry.description"
                      >
                        {{ entry.description }}
                      </p>
                    </div>
                  </div>

                  <!-- Bottom: Action Buttons -->
                  <div
                    class="border-border/60 mt-3 flex items-center justify-between gap-2 border-t pt-2.5"
                  >
                    <!-- Left: Copy & Delete -->
                    <div class="flex shrink-0 items-center gap-1">
                      <Button
                        size="iconSm"
                        variant="ghost"
                        class="text-muted-foreground hover:text-foreground h-7 w-7"
                        title="Copy Prompt Text"
                        @click="copyPromptText(entry)"
                      >
                        <Check
                          v-if="copiedEntryId === entry.id"
                          class="h-3.5 w-3.5 text-emerald-400"
                        />
                        <Copy v-else class="h-3.5 w-3.5" />
                      </Button>

                      <Button
                        size="iconSm"
                        variant="ghost"
                        class="text-muted-foreground hover:text-destructive h-7 w-7"
                        title="Delete Preset"
                        @click="requestDelete(entry)"
                      >
                        <Trash2 class="h-3.5 w-3.5" />
                      </Button>
                    </div>

                    <!-- Right: Apply Buttons -->
                    <div
                      class="flex flex-wrap items-center justify-end gap-1.5"
                    >
                      <Button
                        size="sm"
                        variant="outline"
                        class="h-7 px-2 text-xs"
                        title="Apply positive only"
                        @click="applyPrompt(entry, 'positive')"
                      >
                        + Pos
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        class="h-7 px-2 text-xs"
                        title="Apply negative only"
                        @click="applyPrompt(entry, 'negative')"
                      >
                        − Neg
                      </Button>
                      <Button
                        size="sm"
                        class="bg-primary text-primary-foreground hover:bg-primary/90 h-7 px-2.5 text-xs font-semibold"
                        @click="applyPrompt(entry, 'both')"
                      >
                        Apply
                      </Button>
                    </div>
                  </div>
                </div>

                <!-- Right: Portrait Thumbnail -->
                <div
                  class="bg-muted/40 border-border/50 relative w-24 shrink-0 self-stretch overflow-hidden border-l sm:w-28"
                >
                  <img
                    v-if="entry.thumbnailUrl && !failedThumbnails.has(entry.id)"
                    :src="entry.thumbnailUrl"
                    :alt="entry.name"
                    class="h-full w-full object-cover object-center"
                    @error="failedThumbnails.add(entry.id)"
                  />
                  <div
                    v-else
                    class="from-primary/5 to-primary/20 flex h-full w-full items-center justify-center bg-linear-to-br"
                  >
                    <Sparkles class="text-primary/25 h-7 w-7" />
                  </div>
                </div>
              </div>
            </div>
          </ScrollArea>
        </TabsContent>

        <!-- TAB 2: SAVE CURRENT PROMPT -->
        <TabsContent
          value="save"
          class="m-0 flex flex-1 flex-col overflow-hidden outline-hidden"
        >
          <ScrollArea class="h-[56vh] px-6 py-5.5">
            <div class="flex w-full flex-col gap-5">
              <!-- Success Banner -->
              <div
                v-if="saveSuccessMessage"
                class="flex items-center gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3 text-xs font-semibold text-emerald-400"
              >
                <Check class="h-4 w-4" />
                <span>{{ saveSuccessMessage }}</span>
              </div>

              <!-- Preset Name -->
              <div class="flex flex-col gap-1.5">
                <Label class="text-foreground text-xs font-bold"
                  >Preset Name</Label
                >
                <Input
                  v-model="saveName"
                  placeholder="e.g. Masterpiece Cyberpunk Anime"
                  class="text-xs"
                />
              </div>

              <!-- Optional Description -->
              <div class="flex flex-col gap-1.5">
                <Label class="text-foreground text-xs font-bold"
                  >Description (Optional)</Label
                >
                <Input
                  v-model="saveDescription"
                  placeholder="e.g. Optimized for anime SDXL checkpoints"
                  class="text-xs"
                />
              </div>

              <!-- Scope Selection -->
              <div class="flex flex-col gap-1.5">
                <Label class="text-foreground text-xs font-bold"
                  >Preset Scope / Target</Label
                >
                <div class="grid grid-cols-3 gap-2">
                  <button
                    v-for="st in [
                      {
                        val: 'both',
                        title: 'Both Prompts',
                        desc: 'Save Positive & Negative'
                      },
                      {
                        val: 'positive',
                        title: 'Positive Only',
                        desc: 'Save only Positive'
                      },
                      {
                        val: 'negative',
                        title: 'Negative Only',
                        desc: 'Save only Negative'
                      }
                    ]"
                    :key="st.val"
                    type="button"
                    class="border-border hover:border-primary/60 flex cursor-pointer flex-col gap-0.5 rounded-lg border p-2.5 text-left transition-all"
                    :class="
                      saveType === st.val
                        ? 'border-primary bg-primary/10 ring-primary/20 ring-1'
                        : 'bg-card text-muted-foreground'
                    "
                    @click="saveType = st.val as any"
                  >
                    <span class="text-foreground text-xs font-bold">{{
                      st.title
                    }}</span>
                    <span class="text-muted-foreground text-xs">{{
                      st.desc
                    }}</span>
                  </button>
                </div>
              </div>

              <!-- Editable Prompt Content -->
              <div class="border-border flex flex-col gap-3 border-t pt-3.5">
                <div class="flex items-center justify-between">
                  <span
                    class="text-muted-foreground text-xs font-bold tracking-wider uppercase"
                  >
                    Prompt Content to Save
                  </span>
                  <button
                    type="button"
                    class="text-muted-foreground hover:text-foreground inline-flex cursor-pointer items-center gap-1 font-mono text-xs transition-colors"
                    title="Reset to current workflow prompt"
                    @click="resetToCurrentPrompt"
                  >
                    <RotateCcw class="text-primary h-3 w-3" />
                    <span>Reset to Workflow</span>
                  </button>
                </div>

                <div
                  v-if="saveType === 'both' || saveType === 'positive'"
                  class="flex flex-col gap-1.5"
                >
                  <div class="flex items-center justify-between">
                    <span
                      class="font-mono text-xs font-bold text-emerald-400 uppercase"
                      >Positive Prompt</span
                    >
                    <span class="text-muted-foreground font-mono text-xs"
                      >Editable</span
                    >
                  </div>
                  <Textarea
                    v-model="editPositivePrompt"
                    rows="3"
                    placeholder="Type or edit positive prompt to save..."
                    class="bg-background focus:ring-primary/30 font-mono text-xs leading-relaxed"
                  />
                </div>

                <div
                  v-if="saveType === 'both' || saveType === 'negative'"
                  class="flex flex-col gap-1.5"
                >
                  <div class="flex items-center justify-between">
                    <span
                      class="font-mono text-xs font-bold text-rose-400 uppercase"
                      >Negative Prompt</span
                    >
                    <span class="text-muted-foreground font-mono text-xs"
                      >Editable</span
                    >
                  </div>
                  <Textarea
                    v-model="editNegativePrompt"
                    rows="3"
                    placeholder="Type or edit negative prompt to save..."
                    class="bg-background focus:ring-primary/30 font-mono text-xs leading-relaxed"
                  />
                </div>
              </div>
            </div>
          </ScrollArea>

          <!-- Save Tab Footer -->
          <div
            class="border-border bg-muted/30 flex items-center justify-between border-t px-6 py-3"
          >
            <span class="text-muted-foreground text-xs">
              Saved to your
              <code class="text-foreground font-mono font-semibold"
                >Library / Prompts</code
              >.
            </span>

            <Button
              class="bg-primary text-primary-foreground hover:bg-primary/90 gap-1.5 px-4 text-xs font-semibold"
              :disabled="!saveName.trim()"
              @click="handleSavePreset"
            >
              <Plus class="h-3.5 w-3.5" />
              <span>Save to Library</span>
            </Button>
          </div>
        </TabsContent>
      </Tabs>
    </DialogContent>
  </Dialog>
</template>
