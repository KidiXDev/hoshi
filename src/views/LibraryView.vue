<script setup lang="ts">
import LibraryEntryEditor from '@/components/library/LibraryEntryEditor.vue';
import { computed, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import {
  ArrowUpRight,
  BookOpen,
  Check,
  Clock,
  Copy,
  CopyPlus,
  FolderOpen,
  Layers,
  MessageSquareText,
  Plus,
  RefreshCw,
  Search,
  Sparkles,
  StickyNote,
  Trash2,
  User,
  X
} from '@lucide/vue';
import { Button } from '@/components/ui/button';
import PageLayout from '@/components/layout/PageLayout.vue';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select';
import { useConfirmDialog } from '@/composables/useConfirmDialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import { formatShortDate } from '@/utils/formatters';
import { createLibraryCharacterMention } from '@/utils/aiMentions';
import { matchesQuery } from '@/utils/librarySearch';
import { LibraryService } from '../services/libraryService';
import { useAiStore } from '../stores/aiStore';
import { useLibraryStore } from '../stores/libraryStore';
import type {
  CharacterData,
  CharacterLibraryItem,
  LibraryListEntry,
  LoraData,
  PromptData
} from '../types/library';
import { useWorkflowStore } from '../stores/workflowStore';

const entryEditor = ref<InstanceType<typeof LibraryEntryEditor>>();

const route = useRoute();
const router = useRouter();
const libraryStore = useLibraryStore();
const workflowStore = useWorkflowStore();
const aiStore = useAiStore();
const { confirm } = useConfirmDialog();

// Category tab state

type CategoryTab = 'prompts' | 'loras' | 'characters';

const categoryTabs: Array<{ id: CategoryTab; label: string; icon: unknown }> = [
  { id: 'prompts', label: 'Prompts', icon: Sparkles },
  { id: 'loras', label: 'LoRAs', icon: Layers },
  { id: 'characters', label: 'Characters', icon: User }
];

const activeTab = ref<CategoryTab>('prompts');
const activeTabMeta = computed(
  () => categoryTabs.find((t) => t.id === activeTab.value) ?? categoryTabs[0]
);

onMounted(() => {
  const tabParam = route.query.tab as string;
  if (tabParam && categoryTabs.some((t) => t.id === tabParam)) {
    activeTab.value = tabParam as CategoryTab;
  }
  void loadAll();
});

watch(activeTab, (tab) => {
  seriesFilter.value = 'all';
  void router.replace({ query: { ...route.query, tab } });
});

// Data loading

async function loadAll() {
  await Promise.all([
    libraryStore.fetchCategory('prompts'),
    libraryStore.fetchCategory('loras'),
    libraryStore.fetchCategory('characters')
  ]);
}

async function refreshCurrentTab() {
  failedThumbnails.value.clear();
  await libraryStore.fetchCategory(activeTab.value);
}

const failedThumbnails = ref<Set<string>>(new Set());

// Search / filter / sort

type SortMode = 'updated' | 'created' | 'name';
const sortOptions: Array<{ value: SortMode; label: string }> = [
  { value: 'updated', label: 'Recently updated' },
  { value: 'created', label: 'Newest first' },
  { value: 'name', label: 'Name A–Z' }
];

const searchQuery = ref('');
const sortMode = ref<SortMode>('updated');
const promptTypeFilter = ref<'all' | 'both' | 'positive' | 'negative'>('all');
const seriesFilter = ref('all');

const promptData = (e: LibraryListEntry) => e.data as PromptData;
const loraData = (e: LibraryListEntry) => e.data as LoraData;
const charData = (e: LibraryListEntry) => e.data as CharacterData;

const seriesOptions = computed(() => {
  const set = new Set<string>();
  for (const e of libraryStore.getEntries('characters')) {
    const s = charData(e).series?.trim();
    if (s) set.add(s);
  }
  const list = [...set];
  list.sort((a, b) => a.localeCompare(b));
  return list;
});

const currentEntries = computed<LibraryListEntry[]>(() => {
  const q = searchQuery.value.trim();
  const entries = libraryStore.getEntries(activeTab.value).filter((entry) => {
    if (
      activeTab.value === 'prompts' &&
      promptTypeFilter.value !== 'all' &&
      promptData(entry).type !== promptTypeFilter.value
    )
      return false;
    if (
      activeTab.value === 'characters' &&
      seriesFilter.value !== 'all' &&
      charData(entry).series?.trim() !== seriesFilter.value
    )
      return false;
    return q ? matchesQuery(entry, q) : true;
  });
  entries.sort((a, b) => {
    if (sortMode.value === 'name') return a.name.localeCompare(b.name);
    if (sortMode.value === 'created') return b.createdAt - a.createdAt;
    return b.updatedAt - a.updatedAt;
  });
  return entries;
});

const hasActiveFilter = computed(
  () =>
    Boolean(searchQuery.value.trim()) ||
    promptTypeFilter.value !== 'all' ||
    seriesFilter.value !== 'all'
);

function clearFilters() {
  searchQuery.value = '';
  promptTypeFilter.value = 'all';
  seriesFilter.value = 'all';
}

// Card helpers

const MAX_TAG_CHIPS = 6;

function characterTags(entry: LibraryListEntry): string[] {
  return charData(entry).tags ?? [];
}

function characterTagString(entry: LibraryListEntry): string {
  const data = charData(entry);
  return [data.trigger, ...(data.tags ?? [])].filter(Boolean).join(', ');
}

function promptScopeLabel(entry: LibraryListEntry): string {
  const type = promptData(entry).type;
  return type === 'positive' ? '+ Pos' : type === 'negative' ? '− Neg' : 'Both';
}

// Apply actions

function applyPrompt(
  entry: LibraryListEntry,
  mode: 'both' | 'positive' | 'negative'
) {
  const data = promptData(entry);
  if ((mode === 'both' || mode === 'positive') && data.positive) {
    workflowStore.positivePrompt = data.positive;
  }
  if ((mode === 'both' || mode === 'negative') && data.negative) {
    workflowStore.negativePrompt = data.negative;
  }
  void router.push('/workflow');
}

function applyLora(entry: LibraryListEntry, append = false) {
  const newItems = loraData(entry).loras.map((l, i) => ({
    id: `lora-${i}-${Date.now()}`,
    name: l.name,
    strength: l.strength,
    enabled: l.enabled
  }));
  if (append) {
    workflowStore.loras.push(...newItems);
  } else {
    workflowStore.loras = newItems;
  }
  void router.push('/workflow');
}

async function copyText(entry: LibraryListEntry, text: string) {
  await navigator.clipboard.writeText(text);
  copiedEntryId.value = entry.id;
  setTimeout(() => {
    if (copiedEntryId.value === entry.id) copiedEntryId.value = null;
  }, 1500);
}

function copyPromptText(entry: LibraryListEntry) {
  const data = promptData(entry);
  const text = [data.positive, data.negative]
    .filter((s): s is string => Boolean(s?.trim()))
    .join('\n---\n');
  return copyText(entry, text);
}

function injectCharacterToPrompt(entry: LibraryListEntry) {
  const allTags = characterTagString(entry);
  if (workflowStore.positivePrompt.trim()) {
    workflowStore.positivePrompt += `, ${allTags}`;
  } else {
    workflowStore.positivePrompt = allTags;
  }
  void router.push('/workflow');
}

function askMaya(entry: LibraryListEntry) {
  aiStore.addDraftMention(
    createLibraryCharacterMention(entry as CharacterLibraryItem)
  );
  aiStore.isDrawerOpen = true;
}

const duplicatingId = ref<string | null>(null);
async function duplicateEntry(entry: LibraryListEntry) {
  duplicatingId.value = entry.id;
  try {
    const copy = await libraryStore.duplicateItem(entry);
    entryEditor.value?.edit(copy);
  } catch (err) {
    console.error('Failed to duplicate library item:', err);
  } finally {
    duplicatingId.value = null;
  }
}

// Delete Confirmation

async function requestDelete(entry: LibraryListEntry) {
  const confirmed = await confirm({
    title: 'Delete Preset?',
    description: `Are you sure you want to delete "${entry.name}"? This will permanently remove this item from your ${entry.category} library.`
  });
  if (!confirmed) return;

  try {
    await libraryStore.deleteItem(entry.id, entry.category);
    entryEditor.value?.closeDeleted(entry.id);
  } catch (err) {
    console.error('Failed to delete library item:', err);
  }
}

// Copy feedback
const copiedEntryId = ref<string | null>(null);
</script>

<template>
  <PageLayout
    title="Library"
    subtitle="Centralized presets for prompts, LoRAs, and characters"
    header-class="bg-card/60 px-5 py-3"
    content-class="flex flex-col overflow-hidden p-0"
    no-select
  >
    <template #icon>
      <BookOpen class="h-4 w-4" />
    </template>
    <template #actions>
      <Button
        size="sm"
        variant="outline"
        class="h-8 gap-1.5 px-3 text-xs"
        title="Open library folder"
        @click="LibraryService.openFolder(activeTab)"
      >
        <FolderOpen class="h-3.5 w-3.5" />
        <span>Folder</span>
      </Button>
      <Button
        size="sm"
        variant="outline"
        class="h-8 gap-1.5 px-3 text-xs"
        :disabled="libraryStore.isLoading(activeTab)"
        @click="refreshCurrentTab"
      >
        <RefreshCw
          class="h-3.5 w-3.5"
          :class="{ 'animate-spin': libraryStore.isLoading(activeTab) }"
        />
        <span>Refresh</span>
      </Button>
      <Button
        size="sm"
        class="bg-primary text-primary-foreground hover:bg-primary/90 h-8 gap-1.5 px-3 text-xs font-semibold"
        @click="entryEditor?.create()"
      >
        <Plus class="h-3.5 w-3.5" />
        <span>Add to {{ activeTabMeta.label }}</span>
      </Button>
    </template>

    <template #below-header>
      <!-- Category Tabs -->
      <div
        class="border-border bg-muted/20 flex shrink-0 items-center gap-1 border-b px-5 py-2.5"
      >
        <button
          v-for="tab in categoryTabs"
          :key="tab.id"
          type="button"
          class="flex cursor-pointer items-center gap-2 rounded-lg px-3.5 py-1.5 text-xs font-semibold transition-all"
          :class="
            activeTab === tab.id
              ? 'bg-primary text-primary-foreground shadow-sm'
              : 'text-muted-foreground hover:bg-accent hover:text-foreground'
          "
          @click="activeTab = tab.id"
        >
          <component :is="tab.icon" class="h-3.5 w-3.5" />
          {{ tab.label }}
          <span
            class="rounded-full px-1.5 py-0.5 font-mono text-xs"
            :class="
              activeTab === tab.id
                ? 'bg-primary-foreground/20 text-primary-foreground'
                : 'bg-muted text-muted-foreground'
            "
          >
            {{ libraryStore.getEntries(tab.id).length }}
          </span>
        </button>
      </div>

      <!-- Search / filters / sort -->
      <div
        class="border-border bg-card/20 flex shrink-0 flex-wrap items-center gap-3 border-b px-5 py-2.5"
      >
        <div class="relative min-w-60 flex-1">
          <Search
            class="text-muted-foreground absolute top-1/2 left-3 h-3.5 w-3.5 -translate-y-1/2"
          />
          <input
            v-model="searchQuery"
            type="text"
            :placeholder="
              activeTab === 'characters'
                ? 'Search name, series, trigger, tags, notes...'
                : activeTab === 'loras'
                  ? 'Search name, description, LoRA file names...'
                  : 'Search name, description, prompt text...'
            "
            class="bg-background border-border placeholder:text-muted-foreground text-foreground focus:border-primary/60 h-8 w-full rounded-lg border pr-8 pl-8.5 text-xs transition-colors outline-none"
          />
          <button
            v-if="searchQuery"
            type="button"
            class="text-muted-foreground hover:text-foreground absolute top-1/2 right-2.5 -translate-y-1/2"
            @click="searchQuery = ''"
          >
            <X class="h-3.5 w-3.5" />
          </button>
        </div>

        <!-- Prompt type scope filter -->
        <div v-if="activeTab === 'prompts'" class="flex items-center gap-1">
          <span class="text-muted-foreground mr-1 text-xs font-medium"
            >Scope:</span
          >
          <button
            v-for="st in [
              { label: 'All', val: 'all' },
              { label: 'Both', val: 'both' },
              { label: '+Pos', val: 'positive' },
              { label: '-Neg', val: 'negative' }
            ]"
            :key="st.val"
            type="button"
            class="cursor-pointer rounded-md px-2 py-0.5 font-mono text-xs font-semibold transition-colors"
            :class="
              promptTypeFilter === st.val
                ? 'bg-primary text-primary-foreground shadow-xs'
                : 'border-border bg-muted text-muted-foreground hover:text-foreground border'
            "
            @click="promptTypeFilter = st.val as any"
          >
            {{ st.label }}
          </button>
        </div>

        <!-- Character series filter -->
        <Select
          v-if="activeTab === 'characters' && seriesOptions.length > 0"
          v-model="seriesFilter"
        >
          <SelectTrigger class="h-8 w-44 text-xs">
            <SelectValue placeholder="All series" />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup class="max-h-40 overflow-y-auto">
              <SelectItem value="all" class="text-xs">All series</SelectItem>
              <SelectItem
                v-for="series in seriesOptions"
                :key="series"
                :value="series"
                class="text-xs"
              >
                {{ series }}
              </SelectItem>
            </SelectGroup>
          </SelectContent>
        </Select>

        <!-- Sort -->
        <Select v-model="sortMode">
          <SelectTrigger class="h-8 w-40 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup class="max-h-40 overflow-y-auto">
              <SelectItem
                v-for="opt in sortOptions"
                :key="opt.value"
                :value="opt.value"
                class="text-xs"
              >
                {{ opt.label }}
              </SelectItem>
            </SelectGroup>
          </SelectContent>
        </Select>

        <span class="text-muted-foreground font-mono text-xs">
          {{ currentEntries.length }} item{{
            currentEntries.length !== 1 ? 's' : ''
          }}
        </span>
      </div>
    </template>

    <!-- Content Area -->
    <ScrollArea class="flex-1 px-5 py-4">
      <!-- Loading skeleton -->
      <div
        v-if="libraryStore.isLoading(activeTab)"
        class="grid grid-cols-1 gap-4 md:grid-cols-2 2xl:grid-cols-3"
      >
        <div
          v-for="n in 6"
          :key="n"
          class="bg-card border-border flex min-h-44 animate-pulse overflow-hidden rounded-xl border"
        >
          <div class="flex min-w-0 flex-1 flex-col justify-between p-3.5">
            <div>
              <div class="mb-3 flex items-center justify-between">
                <div class="bg-muted h-4 w-16 rounded" />
                <div class="bg-muted h-3 w-14 rounded" />
              </div>
              <div class="bg-muted mb-2 h-4 w-2/3 rounded" />
              <div class="bg-muted mb-2 h-3 w-1/2 rounded" />
              <div class="bg-muted h-3 w-5/6 rounded" />
            </div>
            <div class="bg-muted mt-3 h-7 w-full rounded" />
          </div>
          <div
            class="bg-muted border-border/40 w-28 shrink-0 border-l sm:w-32 md:w-36"
          />
        </div>
      </div>

      <!-- Empty state -->
      <div
        v-else-if="currentEntries.length === 0"
        class="flex h-64 flex-col items-center justify-center gap-3 text-center"
      >
        <div
          class="bg-muted text-muted-foreground flex h-14 w-14 items-center justify-center rounded-full"
        >
          <component :is="activeTabMeta.icon" class="h-7 w-7 opacity-40" />
        </div>
        <div>
          <p class="text-foreground text-sm font-semibold">
            {{
              hasActiveFilter
                ? 'No entries match the current filters'
                : `No ${activeTab} yet`
            }}
          </p>
          <p class="text-muted-foreground mt-1 text-xs">
            {{
              hasActiveFilter
                ? 'Try a different search term or clear the filters.'
                : `Click "Add to ${activeTabMeta.label}" to create your first entry.`
            }}
          </p>
        </div>
        <Button
          v-if="hasActiveFilter"
          size="sm"
          variant="outline"
          class="mt-1 h-8 gap-1.5 px-3 text-xs"
          @click="clearFilters"
        >
          <X class="h-3.5 w-3.5" />
          Clear filters
        </Button>
        <Button
          v-else
          size="sm"
          class="bg-primary text-primary-foreground hover:bg-primary/90 mt-1 h-8 gap-1.5 px-3 text-xs"
          @click="entryEditor?.create()"
        >
          <Plus class="h-3.5 w-3.5" />
          Add first entry
        </Button>
      </div>

      <!-- Cards grid -->
      <div v-else class="grid grid-cols-1 gap-4 md:grid-cols-2 2xl:grid-cols-3">
        <div
          v-for="entry in currentEntries"
          :key="entry.id"
          class="border-border bg-card hover:border-primary/50 group relative flex min-h-44 cursor-pointer flex-row overflow-hidden rounded-xl border transition-all hover:shadow-md"
          @click="entryEditor?.edit(entry)"
        >
          <!-- Left: Content & Actions -->
          <div class="flex min-w-0 flex-1 flex-col justify-between p-3.5">
            <div class="min-w-0">
              <!-- Top row: category / scope / series badge + date -->
              <div class="flex items-center justify-between gap-2">
                <div class="flex min-w-0 items-center gap-1.5">
                  <span
                    v-if="activeTab === 'prompts'"
                    class="shrink-0 rounded-md border px-1.5 py-0.5 font-mono text-xs font-bold uppercase"
                    :class="{
                      'border-emerald-500/30 bg-emerald-500/15 text-emerald-400':
                        promptData(entry).type === 'positive',
                      'border-rose-500/30 bg-rose-500/15 text-rose-400':
                        promptData(entry).type === 'negative',
                      'border-sky-500/30 bg-sky-500/15 text-sky-400':
                        promptData(entry).type === 'both'
                    }"
                  >
                    {{ promptScopeLabel(entry) }}
                  </span>
                  <span
                    v-else-if="activeTab === 'loras'"
                    class="shrink-0 rounded-md border border-violet-500/30 bg-violet-500/15 px-1.5 py-0.5 font-mono text-xs font-bold text-violet-400 uppercase"
                  >
                    {{ loraData(entry).loras.length }} LoRA{{
                      loraData(entry).loras.length !== 1 ? 's' : ''
                    }}
                  </span>
                  <template v-else>
                    <span
                      class="truncate rounded-md border border-amber-500/30 bg-amber-500/15 px-1.5 py-0.5 text-xs font-bold text-amber-400"
                      :title="charData(entry).series || 'No series set'"
                    >
                      {{ charData(entry).series || 'Original' }}
                    </span>
                  </template>
                </div>

                <div
                  class="text-muted-foreground/70 flex shrink-0 items-center gap-1 font-mono text-xs"
                >
                  <Clock class="h-2.5 w-2.5" />
                  <span>{{ formatShortDate(entry.updatedAt) }}</span>
                </div>
              </div>

              <!-- Title + description -->
              <div class="mt-2">
                <h3
                  class="text-foreground truncate text-sm leading-snug font-bold"
                  :title="entry.name"
                >
                  {{ entry.name }}
                </h3>
                <p
                  v-if="entry.description"
                  class="text-muted-foreground mt-0.5 line-clamp-1 text-xs leading-relaxed"
                  :title="entry.description"
                >
                  {{ entry.description }}
                </p>
              </div>

              <!-- PROMPT preview -->
              <div
                v-if="activeTab === 'prompts'"
                class="mt-2 flex flex-col gap-1"
              >
                <p
                  v-if="promptData(entry).positive"
                  class="text-foreground/80 line-clamp-2 font-mono text-xs leading-relaxed"
                  :title="promptData(entry).positive"
                >
                  <span class="mr-1 font-bold text-emerald-400">+</span
                  >{{ promptData(entry).positive }}
                </p>
                <p
                  v-if="promptData(entry).negative"
                  class="text-muted-foreground line-clamp-1 font-mono text-xs leading-relaxed"
                  :title="promptData(entry).negative"
                >
                  <span class="mr-1 font-bold text-rose-400">−</span
                  >{{ promptData(entry).negative }}
                </p>
              </div>

              <!-- LORA preview -->
              <div
                v-else-if="activeTab === 'loras'"
                class="mt-2 flex flex-wrap gap-1"
              >
                <span
                  v-for="(lora, i) in loraData(entry).loras.slice(
                    0,
                    MAX_TAG_CHIPS
                  )"
                  :key="i"
                  class="border-border bg-muted/60 max-w-full truncate rounded border px-1.5 py-0.5 font-mono text-xs"
                  :class="
                    lora.enabled
                      ? 'text-foreground/80'
                      : 'text-muted-foreground line-through'
                  "
                  :title="`${lora.name} × ${lora.strength}${lora.enabled ? '' : ' (disabled)'}`"
                >
                  {{ lora.name || '(No model)' }}
                  <span class="text-primary">×{{ lora.strength }}</span>
                </span>
                <span
                  v-if="loraData(entry).loras.length > MAX_TAG_CHIPS"
                  class="text-muted-foreground px-1 py-0.5 font-mono text-xs"
                >
                  +{{ loraData(entry).loras.length - MAX_TAG_CHIPS }} more
                </span>
                <span
                  v-if="loraData(entry).loras.length === 0"
                  class="text-muted-foreground text-xs italic"
                >
                  Empty stack
                </span>
              </div>

              <!-- CHARACTER preview -->
              <div v-else class="mt-2 flex flex-col gap-1.5">
                <p
                  v-if="charData(entry).trigger"
                  class="text-primary truncate font-mono text-xs font-semibold"
                  :title="charData(entry).trigger"
                >
                  {{ charData(entry).trigger }}
                </p>
                <div
                  v-if="characterTags(entry).length > 0"
                  class="flex flex-wrap gap-1"
                >
                  <span
                    v-for="tag in characterTags(entry).slice(0, MAX_TAG_CHIPS)"
                    :key="tag"
                    class="border-border bg-muted/60 text-foreground/80 max-w-full truncate rounded border px-1.5 py-0.5 font-mono text-xs"
                  >
                    {{ tag }}
                  </span>
                  <span
                    v-if="characterTags(entry).length > MAX_TAG_CHIPS"
                    class="text-muted-foreground px-1 py-0.5 font-mono text-xs"
                  >
                    +{{ characterTags(entry).length - MAX_TAG_CHIPS }}
                  </span>
                </div>
                <p
                  v-if="charData(entry).notes"
                  class="text-muted-foreground line-clamp-2 flex items-start gap-1 text-xs leading-relaxed italic"
                  :title="charData(entry).notes"
                >
                  <StickyNote class="mt-0.5 h-3 w-3 shrink-0 text-amber-400" />
                  <span>{{ charData(entry).notes }}</span>
                </p>
              </div>
            </div>

            <!-- Bottom: Action Buttons -->
            <div
              class="border-border/60 mt-3 flex items-center justify-between gap-2 border-t pt-2.5"
            >
              <!-- Left: Edit / Duplicate / Delete -->
              <div class="flex shrink-0 items-center gap-0.5">
                <Button
                  size="iconSm"
                  variant="ghost"
                  class="text-muted-foreground hover:text-foreground h-7 w-7"
                  title="Duplicate"
                  :disabled="duplicatingId === entry.id"
                  @click.stop="duplicateEntry(entry)"
                >
                  <CopyPlus class="h-3.5 w-3.5" />
                </Button>
                <Button
                  size="iconSm"
                  variant="ghost"
                  class="text-muted-foreground hover:text-destructive h-7 w-7"
                  title="Delete"
                  @click.stop="requestDelete(entry)"
                >
                  <Trash2 class="h-3.5 w-3.5" />
                </Button>
              </div>

              <!-- Right: apply actions per category -->
              <div class="flex flex-wrap items-center justify-end gap-1.5">
                <!-- PROMPTS -->
                <template v-if="activeTab === 'prompts'">
                  <Button
                    size="iconSm"
                    variant="ghost"
                    class="text-muted-foreground hover:text-foreground h-7 w-7"
                    title="Copy prompt text"
                    @click.stop="copyPromptText(entry)"
                  >
                    <Check
                      v-if="copiedEntryId === entry.id"
                      class="h-3.5 w-3.5 text-emerald-400"
                    />
                    <Copy v-else class="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    v-if="promptData(entry).type === 'both'"
                    size="sm"
                    variant="outline"
                    class="h-7 px-2 text-xs"
                    title="Apply positive only"
                    @click.stop="applyPrompt(entry, 'positive')"
                  >
                    + Pos
                  </Button>
                  <Button
                    v-if="promptData(entry).type === 'both'"
                    size="sm"
                    variant="outline"
                    class="h-7 px-2 text-xs"
                    title="Apply negative only"
                    @click.stop="applyPrompt(entry, 'negative')"
                  >
                    − Neg
                  </Button>
                  <Button
                    size="sm"
                    class="bg-primary text-primary-foreground hover:bg-primary/90 h-7 px-2.5 text-xs font-semibold"
                    @click.stop="applyPrompt(entry, 'both')"
                  >
                    Apply
                  </Button>
                </template>

                <!-- LORAS -->
                <template v-else-if="activeTab === 'loras'">
                  <Button
                    size="sm"
                    variant="outline"
                    class="h-7 px-2 text-xs"
                    title="Append to current LoRA stack"
                    @click.stop="applyLora(entry, true)"
                  >
                    + Append
                  </Button>
                  <Button
                    size="sm"
                    class="bg-primary text-primary-foreground hover:bg-primary/90 h-7 px-2.5 text-xs font-semibold"
                    @click.stop="applyLora(entry, false)"
                  >
                    Apply
                  </Button>
                </template>

                <!-- CHARACTERS -->
                <template v-else-if="activeTab === 'characters'">
                  <Button
                    size="iconSm"
                    variant="ghost"
                    class="text-muted-foreground hover:text-foreground h-7 w-7"
                    title="Copy all tags"
                    @click.stop="copyText(entry, characterTagString(entry))"
                  >
                    <Check
                      v-if="copiedEntryId === entry.id"
                      class="h-3.5 w-3.5 text-emerald-400"
                    />
                    <Copy v-else class="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    class="h-7 gap-1 px-2 text-xs"
                    title="Attach this character (tags + notes) to a Maya chat"
                    @click.stop="askMaya(entry)"
                  >
                    <MessageSquareText class="h-3 w-3" />
                    Ask Maya
                  </Button>
                  <Button
                    size="sm"
                    class="bg-primary text-primary-foreground hover:bg-primary/90 h-7 px-2.5 text-xs font-semibold"
                    title="Inject tags into positive prompt"
                    @click.stop="injectCharacterToPrompt(entry)"
                  >
                    <ArrowUpRight class="mr-1 h-3 w-3" />
                    Inject
                  </Button>
                </template>
              </div>
            </div>
          </div>

          <!-- Right: Portrait Thumbnail -->
          <div
            class="bg-muted/40 border-border/50 relative w-28 shrink-0 self-stretch overflow-hidden border-l sm:w-32 md:w-36"
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
              <component
                :is="activeTabMeta.icon"
                class="text-primary/25 h-10 w-10"
              />
            </div>
          </div>
        </div>
      </div>
    </ScrollArea>
  </PageLayout>

  <LibraryEntryEditor
    ref="entryEditor"
    :category="activeTab"
    @delete="requestDelete"
  />
</template>
