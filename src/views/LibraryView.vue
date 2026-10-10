<script setup lang="ts">
import LibraryEntryCard from '@/components/library/LibraryEntryCard.vue';
import LibraryEntryEditor from '@/components/library/LibraryEntryEditor.vue';
import { computed, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import {
  ArrowUpRight,
  BookOpen,
  Check,
  Copy,
  CopyPlus,
  FolderOpen,
  Layers,
  MessageSquareText,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Sparkles,
  Trash2,
  User,
  X
} from '@lucide/vue';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
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
import { createLibraryCharacterMention } from '@/utils/aiMentions';
import { matchesQuery } from '@/utils/librarySearch';
import { appendPromptTerms } from '@/utils/promptTools';
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
import {
  useWorkflowStore,
  type PromptPresetTarget
} from '../stores/workflowStore';

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

// Search / filter / sort

type SortMode = 'updated' | 'created' | 'name';
const sortOptions: Array<{ value: SortMode; label: string }> = [
  { value: 'updated', label: 'Recently updated' },
  { value: 'created', label: 'Newest first' },
  { value: 'name', label: 'Name A–Z' }
];

type PromptScopeFilter = 'all' | PromptPresetTarget;
const promptScopeFilters: Array<{ value: PromptScopeFilter; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'both', label: 'Both' },
  { value: 'positive', label: '+Pos' },
  { value: 'negative', label: '−Neg' }
];

const searchQuery = ref('');
const sortMode = ref<SortMode>('updated');
const promptTypeFilter = ref<PromptScopeFilter>('all');
const seriesFilter = ref('all');
const appendPrompts = ref(false);

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

function characterTagString(entry: LibraryListEntry): string {
  const data = charData(entry);
  return [data.trigger, ...(data.tags ?? [])].filter(Boolean).join(', ');
}

// Apply actions

function applyPrompt(entry: LibraryListEntry, target: PromptPresetTarget) {
  workflowStore.applyPromptPreset(
    promptData(entry),
    target,
    appendPrompts.value
  );
  void router.push('/workflow');
}

function applyLora(entry: LibraryListEntry, append: boolean) {
  workflowStore.applyLoraPreset(loraData(entry), append);
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
  const data = charData(entry);
  workflowStore.positivePrompt = appendPromptTerms(
    workflowStore.positivePrompt,
    [data.trigger, ...(data.tags ?? [])]
  );
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
        @click="libraryStore.fetchCategory(activeTab)"
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
      <!-- Category tabs + search / filters / sort -->
      <div
        class="border-border bg-card/30 flex shrink-0 flex-wrap items-center gap-2.5 border-b px-5 py-2.5"
      >
        <div
          role="tablist"
          class="border-border bg-muted/60 flex shrink-0 items-center gap-0.5 rounded-lg border p-0.5"
        >
          <button
            v-for="tab in categoryTabs"
            :key="tab.id"
            type="button"
            role="tab"
            :aria-selected="activeTab === tab.id"
            class="flex cursor-pointer items-center gap-1.5 rounded-md px-3 py-1 text-xs font-semibold transition-all"
            :class="
              activeTab === tab.id
                ? 'bg-background text-foreground shadow-xs'
                : 'text-muted-foreground hover:text-foreground'
            "
            @click="activeTab = tab.id"
          >
            <component
              :is="tab.icon"
              class="h-3.5 w-3.5"
              :class="activeTab === tab.id && 'text-primary'"
            />
            {{ tab.label }}
            <span class="text-muted-foreground font-mono text-xs">
              {{ libraryStore.getEntries(tab.id).length }}
            </span>
          </button>
        </div>

        <div class="relative min-w-52 flex-1">
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
            title="Clear search"
            class="text-muted-foreground hover:text-foreground absolute top-1/2 right-2.5 -translate-y-1/2 cursor-pointer"
            @click="searchQuery = ''"
          >
            <X class="h-3.5 w-3.5" />
          </button>
        </div>

        <!-- Prompt scope filter + append mode -->
        <template v-if="activeTab === 'prompts'">
          <div
            class="border-border bg-muted/60 flex items-center gap-0.5 rounded-lg border p-0.5"
            title="Filter by prompt scope"
          >
            <button
              v-for="scope in promptScopeFilters"
              :key="scope.value"
              type="button"
              class="cursor-pointer rounded-md px-2 py-0.5 font-mono text-xs font-semibold transition-colors"
              :class="
                promptTypeFilter === scope.value
                  ? 'bg-background text-foreground shadow-xs'
                  : 'text-muted-foreground hover:text-foreground'
              "
              @click="promptTypeFilter = scope.value"
            >
              {{ scope.label }}
            </button>
          </div>
          <Label
            class="text-muted-foreground hover:text-foreground flex cursor-pointer items-center gap-1.5 text-xs font-medium"
            title="Add only the missing tags instead of replacing the prompt"
          >
            <Checkbox v-model="appendPrompts" />
            Append
          </Label>
        </template>

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
          class="bg-card border-border flex min-h-40 animate-pulse flex-col justify-between rounded-xl border p-3.5"
        >
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
        <LibraryEntryCard
          v-for="entry in currentEntries"
          :key="entry.id"
          :entry="entry"
          class="cursor-pointer"
          @click="entryEditor?.edit(entry)"
        >
          <template #manage>
            <Button
              size="iconSm"
              variant="ghost"
              class="text-muted-foreground hover:text-foreground h-7 w-7"
              title="Edit"
              @click.stop="entryEditor?.edit(entry)"
            >
              <Pencil class="h-3.5 w-3.5" />
            </Button>
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
          </template>

          <template #apply>
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
              <template v-if="promptData(entry).type === 'both'">
                <Button
                  size="sm"
                  variant="outline"
                  class="h-7 px-2 text-xs"
                  title="Apply positive only"
                  @click.stop="applyPrompt(entry, 'positive')"
                >
                  + Pos
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  class="h-7 px-2 text-xs"
                  title="Apply negative only"
                  @click.stop="applyPrompt(entry, 'negative')"
                >
                  − Neg
                </Button>
              </template>
              <Button
                size="sm"
                class="bg-primary text-primary-foreground hover:bg-primary/90 h-7 px-2.5 text-xs font-semibold"
                :title="
                  appendPrompts
                    ? 'Append missing tags to the workflow prompt'
                    : 'Replace the workflow prompt'
                "
                @click.stop="applyPrompt(entry, 'both')"
              >
                {{ appendPrompts ? 'Append' : 'Apply' }}
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
                title="Replace the current LoRA stack"
                @click.stop="applyLora(entry, false)"
              >
                Apply
              </Button>
            </template>

            <!-- CHARACTERS -->
            <template v-else>
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
                title="Add missing tags to the positive prompt"
                @click.stop="injectCharacterToPrompt(entry)"
              >
                <ArrowUpRight class="mr-1 h-3 w-3" />
                Inject
              </Button>
            </template>
          </template>
        </LibraryEntryCard>
      </div>
    </ScrollArea>
  </PageLayout>

  <LibraryEntryEditor
    ref="entryEditor"
    :category="activeTab"
    @delete="requestDelete"
  />
</template>
