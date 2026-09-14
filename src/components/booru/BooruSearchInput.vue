<script setup lang="ts">
import { nextTick, onMounted, onDeactivated, onUnmounted, ref } from 'vue';
import { Search, X, Sparkles } from '@lucide/vue';
import { Input } from '@/components/ui/input';
import { ComfyApi } from '@/services/comfyApi';
import { useComfyStore } from '@/stores/comfyStore';
import { useLauncherStore } from '@/stores/launcherStore';
import { usePromptSuggestionStore } from '@/stores/promptSuggestionStore';

defineProps<{ disabled: boolean }>();
const query = defineModel<string>({ required: true });
const comfyStore = useComfyStore();
const launcherStore = useLauncherStore();
const promptSuggestionStore = usePromptSuggestionStore();
interface BooruTokenRange {
  start: number;
  end: number;
  query: string;
  hasCommaPrefix: boolean;
}

interface BooruSuggestionItem {
  label: string;
  insertText: string;
  category: number | string;
  categoryName: string;
  categoryClass: string;
  postCount?: number;
}

// Autocomplete State
const searchInputRef = ref<{ $el?: HTMLInputElement } | HTMLInputElement>();
const autocompleteSuggestions = ref<BooruSuggestionItem[]>([]);
const activeAutocompleteIndex = ref(0);
const isAutocompleteOpen = ref(false);
const activeQueryToken = ref('');
let activeTokenRange: BooruTokenRange | null = null;
let autocompleteTimer: ReturnType<typeof setTimeout> | undefined;
let autocompleteController: AbortController | undefined;
const activeItemRef = ref<HTMLElement | null>(null);

const categoryMetaMap: Record<
  number | string,
  { name: string; class: string }
> = {
  0: {
    name: 'General',
    class: 'border-blue-500/30 bg-blue-500/10 text-blue-300'
  },
  1: {
    name: 'Artist',
    class: 'border-purple-500/30 bg-purple-500/10 text-purple-300'
  },
  3: {
    name: 'Copyright',
    class: 'border-amber-500/30 bg-amber-500/10 text-amber-300'
  },
  4: {
    name: 'Character',
    class: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
  },
  5: {
    name: 'Meta',
    class: 'border-zinc-500/30 bg-zinc-500/10 text-zinc-300'
  },
  quality: {
    name: 'Style',
    class: 'border-cyan-500/30 bg-cyan-500/10 text-cyan-300'
  },
  count: {
    name: 'Count',
    class: 'border-indigo-500/30 bg-indigo-500/10 text-indigo-300'
  }
};

function formatPostCount(count?: number) {
  if (count === undefined || count === null) return '';
  if (count >= 1_000_000) {
    return `${(count / 1_000_000).toFixed(1).replace(/\.0$/u, '')}M`;
  }
  if (count >= 1000) {
    return `${(count / 1000).toFixed(1).replace(/\.0$/u, '')}k`;
  }
  return String(count);
}

function getBooruTokenRange(
  text: string,
  cursor: number
): BooruTokenRange | null {
  if (cursor < 0 || cursor > text.length) return null;

  let start = cursor;
  while (start > 0 && ![',', ' ', '\t', '\n'].includes(text[start - 1])) {
    start--;
  }

  let end = cursor;
  while (end < text.length && ![',', ' ', '\t', '\n'].includes(text[end])) {
    end++;
  }

  const rawQuery = text
    .slice(start, cursor)
    .trim()
    .toLowerCase()
    .replaceAll(' ', '_');
  if (!rawQuery) return null;

  const beforeStart = text.slice(0, start).trimEnd();
  const hasCommaPrefix = beforeStart.endsWith(',');

  return { start, end, query: rawQuery, hasCommaPrefix };
}

function replaceBooruToken(
  text: string,
  range: BooruTokenRange,
  tag: string
): { text: string; cursor: number } {
  const prefix = text.slice(0, range.start);
  const suffix = text.slice(range.end).replace(/^[\s,]+/u, '');

  const usesCommas =
    range.hasCommaPrefix || prefix.includes(',') || suffix.includes(',');
  const separator = usesCommas ? ', ' : ' ';

  // Booru tags strictly require underscores for spaces regardless of app-wide settings
  const inserted = tag.trim().replaceAll(' ', '_');
  const newText = prefix + inserted + (suffix ? separator + suffix : separator);
  const newCursor = prefix.length + inserted.length + separator.length;

  return { text: newText, cursor: newCursor };
}

function highlightMatch(
  label: string,
  queryToken: string
): Array<{ text: string; isMatch: boolean }> {
  if (!queryToken) return [{ text: label, isMatch: false }];
  const q = queryToken.replaceAll('_', ' ').toLowerCase();
  const l = label.replaceAll('_', ' ');
  const lowerL = l.toLowerCase();
  const idx = lowerL.indexOf(q);
  if (idx === -1) {
    const qUnderscore = queryToken.replaceAll(' ', '_').toLowerCase();
    const lUnderscore = label.replaceAll(' ', '_');
    const idxU = lUnderscore.toLowerCase().indexOf(qUnderscore);
    if (idxU === -1) return [{ text: label, isMatch: false }];
    return [
      { text: label.slice(0, idxU), isMatch: false },
      { text: label.slice(idxU, idxU + qUnderscore.length), isMatch: true },
      { text: label.slice(idxU + qUnderscore.length), isMatch: false }
    ].filter((p) => p.text.length > 0);
  }
  return [
    { text: label.slice(0, idx), isMatch: false },
    { text: label.slice(idx, idx + q.length), isMatch: true },
    { text: label.slice(idx + q.length), isMatch: false }
  ].filter((p) => p.text.length > 0);
}

async function searchAutocompleteSuggestions(
  searchQuery: string,
  signal?: AbortSignal
): Promise<BooruSuggestionItem[]> {
  const normalized = searchQuery.trim().toLowerCase().replaceAll(' ', '_');
  if (!normalized) return [];

  const results: BooruSuggestionItem[] = [];
  const seenLabels = new Set<string>();

  // 1. Try remote ComfyUI yet_essential tag autocomplete endpoint if connected
  if (comfyStore.isConnected) {
    try {
      const remoteItems = await ComfyApi.searchTags(
        launcherStore.config.serverUrl,
        normalized,
        30,
        'tag',
        signal
      );
      for (const item of remoteItems) {
        // Enforce underscores for booru search tags regardless of settings
        const formattedTag = (item.insert_text || item.label)
          .trim()
          .replaceAll(' ', '_');
        const key = formattedTag.toLowerCase();
        if (!seenLabels.has(key)) {
          seenLabels.add(key);
          const category = Number(item.category);
          const catInfo = categoryMetaMap[category] ?? {
            name: 'General',
            class: 'border-blue-500/30 bg-blue-500/10 text-blue-300'
          };
          results.push({
            label: formattedTag,
            insertText: formattedTag,
            category,
            categoryName: catInfo.name,
            categoryClass: catInfo.class,
            postCount: item.total_post
          });
        }
      }
    } catch {
      // ignore aborts
    }
  }

  // 2. Supplement from local Prompt Suggestion Store
  const localCats = promptSuggestionStore.categories;
  for (const cat of localCats) {
    for (const tag of cat.tags || []) {
      // Enforce underscores for booru search tags regardless of settings
      const tagWithUnderscores = tag.trim().replaceAll(' ', '_');
      const tagNormalized = tagWithUnderscores.toLowerCase();
      if (seenLabels.has(tagNormalized)) continue;

      if (tagNormalized.includes(normalized)) {
        seenLabels.add(tagNormalized);
        const catInfo = categoryMetaMap[cat.id] ?? {
          name: cat.name.split(' ')[0] || 'Tag',
          class: 'border-blue-500/30 bg-blue-500/10 text-blue-300'
        };
        results.push({
          label: tagWithUnderscores,
          insertText: tagWithUnderscores,
          category: cat.id,
          categoryName: catInfo.name,
          categoryClass: catInfo.class
        });
      }
    }
  }

  // Ranking: exact prefix match first, then by post count
  results.sort((a, b) => {
    const aKey = a.insertText.toLowerCase();
    const bKey = b.insertText.toLowerCase();
    const aStarts = aKey.startsWith(normalized);
    const bStarts = bKey.startsWith(normalized);
    if (aStarts && !bStarts) return -1;
    if (!aStarts && bStarts) return 1;
    if (a.postCount !== undefined && b.postCount !== undefined) {
      return b.postCount - a.postCount;
    }
    if (a.postCount !== undefined) return -1;
    if (b.postCount !== undefined) return 1;
    return aKey.localeCompare(bKey);
  });

  return results.slice(0, 25);
}

function getSearchInputEl(): HTMLInputElement | null {
  if (!searchInputRef.value) return null;
  return (
    (searchInputRef.value as { $el?: HTMLInputElement }).$el ??
    (searchInputRef.value as HTMLInputElement)
  );
}

function closeAutocomplete() {
  clearTimeout(autocompleteTimer);
  autocompleteController?.abort();
  isAutocompleteOpen.value = false;
  autocompleteSuggestions.value = [];
  activeQueryToken.value = '';
  activeTokenRange = null;
}

function handleSearchBlur() {
  setTimeout(() => {
    closeAutocomplete();
  }, 160);
}

function updateSearchCursor(event: Event) {
  if (
    event instanceof KeyboardEvent &&
    ['ArrowDown', 'ArrowUp', 'Enter', 'Tab', 'Escape'].includes(event.key)
  )
    return;
  const el = event.target as HTMLInputElement;
  if (!el) return;
  scheduleAutocomplete(el.value, el.selectionStart ?? el.value.length);
}

function handleSearchInput(event: Event) {
  const el = event.target as HTMLInputElement;
  if (!el) return;
  scheduleAutocomplete(el.value, el.selectionStart ?? el.value.length);
}

function scheduleAutocomplete(text: string, cursor: number) {
  clearTimeout(autocompleteTimer);
  autocompleteController?.abort();

  const range = getBooruTokenRange(text, cursor);
  if (!range || !range.query) {
    closeAutocomplete();
    return;
  }

  activeTokenRange = range;
  activeQueryToken.value = range.query;

  autocompleteTimer = setTimeout(async () => {
    const controller = new AbortController();
    autocompleteController = controller;
    try {
      const items = await searchAutocompleteSuggestions(
        range.query,
        controller.signal
      );
      if (controller.signal.aborted) return;
      if (items.length > 0) {
        autocompleteSuggestions.value = items;
        activeAutocompleteIndex.value = 0;
        isAutocompleteOpen.value = true;
      } else {
        closeAutocomplete();
      }
    } catch (err) {
      if (!(err instanceof DOMException && err.name === 'AbortError')) {
        closeAutocomplete();
      }
    }
  }, 120);
}

function handleSearchKeydown(event: KeyboardEvent) {
  if (event.ctrlKey || event.metaKey || event.altKey) return;
  if (!isAutocompleteOpen.value || autocompleteSuggestions.value.length === 0) {
    return;
  }

  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault();
    const dir = event.key === 'ArrowDown' ? 1 : -1;
    activeAutocompleteIndex.value =
      (activeAutocompleteIndex.value +
        dir +
        autocompleteSuggestions.value.length) %
      autocompleteSuggestions.value.length;
    void nextTick(() => {
      activeItemRef.value?.scrollIntoView({ block: 'nearest' });
    });
  } else if (event.key === 'Enter' || event.key === 'Tab') {
    event.preventDefault();
    const item = autocompleteSuggestions.value[activeAutocompleteIndex.value];
    if (item) {
      selectSuggestion(item);
    }
  } else if (event.key === 'Escape') {
    event.preventDefault();
    closeAutocomplete();
  }
}

function selectSuggestion(item: BooruSuggestionItem) {
  if (!activeTokenRange) return;
  const inputEl = getSearchInputEl();
  const result = replaceBooruToken(
    query.value,
    activeTokenRange,
    item.insertText
  );
  query.value = result.text;
  closeAutocomplete();
  void nextTick(() => {
    if (inputEl) {
      inputEl.focus();
      inputEl.setSelectionRange(result.cursor, result.cursor);
    }
  });
}

function clearQuery() {
  query.value = '';
  closeAutocomplete();
}
onMounted(() => {
  void promptSuggestionStore.init();
});
onDeactivated(closeAutocomplete);
onUnmounted(closeAutocomplete);
</script>
<template>
  <div class="relative min-w-64 flex-1">
    <Search
      class="text-muted-foreground pointer-events-none absolute top-1/2 left-3 h-3.5 w-3.5 -translate-y-1/2"
    />
    <Input
      ref="searchInputRef"
      v-model="query"
      class="border-border bg-secondary/50 focus:bg-background h-9 pr-8 pl-9 font-mono text-xs transition-colors"
      placeholder="Search tags..."
      :disabled="disabled"
      autocomplete="off"
      spellcheck="false"
      @input="handleSearchInput"
      @click="updateSearchCursor"
      @keyup="updateSearchCursor"
      @select="updateSearchCursor"
      @keydown="handleSearchKeydown"
      @blur="handleSearchBlur"
    />
    <button
      v-if="query"
      type="button"
      class="text-muted-foreground hover:text-foreground absolute top-1/2 right-2.5 -translate-y-1/2 p-0.5"
      @click="clearQuery"
    >
      <X class="h-3.5 w-3.5" />
    </button>

    <!-- Autocomplete Floating Dropdown Menu -->
    <div
      v-if="isAutocompleteOpen && autocompleteSuggestions.length > 0"
      role="listbox"
      class="border-border/80 bg-popover/95 absolute top-full left-0 z-50 mt-1.5 max-h-64 w-full overflow-hidden rounded-xl border shadow-xl backdrop-blur-md"
    >
      <!-- Header bar with search hint and suggestion count -->
      <div
        class="border-border/60 bg-muted/40 flex items-center justify-between border-b px-3 py-1.5 text-xs select-none"
      >
        <div class="text-muted-foreground flex items-center gap-1.5">
          <Sparkles class="h-3 w-3 text-amber-400" />
          <span class="font-medium"
            >Suggestions for
            <span class="text-foreground font-mono font-semibold"
              >"{{ activeQueryToken }}"</span
            ></span
          >
        </div>
        <span class="text-muted-foreground font-mono text-[10px]"
          >{{ autocompleteSuggestions.length }} results</span
        >
      </div>

      <!-- Scrollable Suggestions List -->
      <div class="max-h-48 overflow-y-auto p-1">
        <button
          v-for="(item, index) in autocompleteSuggestions"
          :key="`${item.label}-${item.category}`"
          :ref="
            (el) => {
              if (index === activeAutocompleteIndex)
                activeItemRef = el as HTMLElement;
            }
          "
          type="button"
          role="option"
          :aria-selected="index === activeAutocompleteIndex"
          class="flex w-full cursor-pointer items-center justify-between rounded-lg px-2.5 py-1.5 text-left font-mono text-xs transition-colors"
          :class="
            index === activeAutocompleteIndex
              ? 'bg-accent text-accent-foreground shadow-xs'
              : 'text-foreground/90 hover:bg-accent/60'
          "
          @mousedown.prevent
          @click="selectSuggestion(item)"
        >
          <!-- Matched Highlight Label -->
          <div class="flex min-w-0 items-center gap-2">
            <span class="truncate">
              <template
                v-for="(part, i) in highlightMatch(
                  item.label,
                  activeQueryToken
                )"
                :key="i"
              >
                <span
                  v-if="part.isMatch"
                  class="text-primary decoration-primary/40 font-bold underline"
                  >{{ part.text }}</span
                >
                <span v-else>{{ part.text }}</span>
              </template>
            </span>
          </div>

          <!-- Category Pill & Post Count -->
          <div class="ml-3 flex shrink-0 items-center gap-1.5">
            <span
              v-if="item.postCount"
              class="text-muted-foreground font-mono text-[10px]"
            >
              {{ formatPostCount(item.postCount) }}
            </span>
            <span
              class="py-0.2 rounded-full border px-1.5 font-mono text-[10px] font-medium capitalize"
              :class="item.categoryClass"
            >
              {{ item.categoryName }}
            </span>
          </div>
        </button>
      </div>

      <!-- Footer Keyboard Navigation Hint Bar -->
      <div
        class="border-border/50 bg-muted/20 text-muted-foreground flex items-center justify-between border-t px-2.5 py-1 font-mono text-[10px] select-none"
      >
        <div class="flex items-center gap-2">
          <span
            ><kbd
              class="border-border/80 bg-background/80 rounded border px-1 py-0.5"
              >↑</kbd
            ><kbd
              class="border-border/80 bg-background/80 ml-0.5 rounded border px-1 py-0.5"
              >↓</kbd
            >
            navigate</span
          >
          <span
            ><kbd
              class="border-border/80 bg-background/80 rounded border px-1 py-0.5"
              >↵</kbd
            >
            or
            <kbd
              class="border-border/80 bg-background/80 rounded border px-1 py-0.5"
              >Tab</kbd
            >
            select</span
          >
        </div>
        <span
          ><kbd
            class="border-border/80 bg-background/80 rounded border px-1 py-0.5"
            >Esc</kbd
          >
          close</span
        >
      </div>
    </div>
  </div>
</template>
