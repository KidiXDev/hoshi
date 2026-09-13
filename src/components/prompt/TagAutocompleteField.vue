<script setup lang="ts">
import {
  nextTick,
  onBeforeUnmount,
  ref,
  watch,
  type HTMLAttributes
} from 'vue';
import PromptSuggestionOptions from '@/components/prompt/PromptSuggestionOptions.vue';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { ComfyApi, type AutocompleteItem } from '@/services/comfyApi';
import {
  getPromptTokenRange,
  replacePromptToken,
  type PromptTokenRange
} from '@/services/promptAutocomplete';
import { useComfyStore } from '@/stores/comfyStore';
import { useLauncherStore } from '@/stores/launcherStore';
import { getCaretCoordinates } from '@/utils/caretCoordinates';

// Input/Textarea with the same tag autocomplete as the prompt section.
// Dropdown is fixed + teleported to body so it escapes dialogs and scroll containers.
const props = defineProps<{
  multiline?: boolean;
  placeholder?: string;
  rows?: number | string;
  class?: HTMLAttributes['class'];
}>();
const model = defineModel<string>({ required: true });

const launcherStore = useLauncherStore();
const comfyStore = useComfyStore();
const field = ref<{ $el: HTMLInputElement | HTMLTextAreaElement }>();
const suggestionList = ref<HTMLElement | null>(null);
const suggestions = ref<AutocompleteItem[]>([]);
const activeIndex = ref(0);
const dropdownStyle = ref<Record<string, string>>({});
let activeRange: PromptTokenRange | null = null;
let searchTimer: ReturnType<typeof setTimeout> | undefined;
let searchController: AbortController | undefined;

function el() {
  return field.value?.$el ?? null;
}

function closeSuggestions() {
  clearTimeout(searchTimer);
  searchController?.abort();
  suggestions.value = [];
}

function closeSuggestionsAfterBlur() {
  setTimeout(closeSuggestions, 150);
}

// Anchored at the caret; flips above the caret line when there is no room below.
function updateDropdownPosition(input: HTMLInputElement | HTMLTextAreaElement) {
  const rect = input.getBoundingClientRect();
  const caret = getCaretCoordinates(input, input.selectionStart ?? 0);
  const width = Math.min(320, window.innerWidth - 16);
  // matches max-h-56
  const maxHeight = 224;
  const caretTop = rect.top + input.clientTop + caret.top;
  const below = caretTop + caret.height + 4;
  const top =
    below + maxHeight <= window.innerHeight
      ? below
      : Math.max(8, caretTop - 4 - maxHeight);
  const left = Math.max(
    8,
    Math.min(
      rect.left + input.clientLeft + caret.left,
      window.innerWidth - width - 8
    )
  );
  dropdownStyle.value = {
    top: `${top}px`,
    left: `${left}px`,
    width: `${width}px`
  };
}

function scheduleSuggestions() {
  clearTimeout(searchTimer);
  searchController?.abort();
  const input = el();
  if (
    !input ||
    !launcherStore.config.autocompleteEnabled ||
    !comfyStore.isConnected ||
    !comfyStore.isYetEssentialAvailable
  ) {
    return closeSuggestions();
  }
  const range = getPromptTokenRange(input.value, input.selectionStart ?? 0);
  if (!range) return closeSuggestions();
  activeRange = range;
  updateDropdownPosition(input);
  searchTimer = setTimeout(async () => {
    const controller = new AbortController();
    searchController = controller;
    try {
      const items = await ComfyApi.searchTags(
        launcherStore.config.serverUrl,
        range.query,
        launcherStore.config.autocompleteLimit,
        range.mode,
        controller.signal
      );
      if (controller.signal.aborted) return;
      suggestions.value = items;
      activeIndex.value = 0;
    } catch {
      // aborted or network failure — leave the list closed
    }
  }, 140);
}

function selectSuggestion(item: AutocompleteItem) {
  if (!activeRange) return;
  const result = replacePromptToken(
    model.value,
    activeRange,
    item.insert_text,
    launcherStore.config.autocompleteReplaceUnderscores,
    launcherStore.config.autocompleteIncludeArtistPrefix
  );
  model.value = result.text;
  closeSuggestions();
  void nextTick(() => {
    const input = el();
    input?.focus();
    input?.setSelectionRange(result.cursor, result.cursor);
  });
}

function handleKeydown(event: KeyboardEvent) {
  const count = suggestions.value.length;
  if (count === 0) return;
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault();
    const step = event.key === 'ArrowDown' ? 1 : -1;
    activeIndex.value = (activeIndex.value + step + count) % count;
  } else if (event.key === 'Tab' || event.key === 'Enter') {
    event.preventDefault();
    const item = suggestions.value[activeIndex.value];
    if (item) selectSuggestion(item);
  } else if (event.key === 'Escape') {
    event.preventDefault();
    event.stopPropagation();
    closeSuggestions();
  }
}

watch(activeIndex, () => {
  void nextTick(() => {
    suggestionList.value
      ?.querySelector<HTMLElement>(`[data-index="${activeIndex.value}"]`)
      ?.scrollIntoView({ block: 'nearest' });
  });
});

onBeforeUnmount(closeSuggestions);
</script>

<template>
  <component
    :is="multiline ? Textarea : Input"
    ref="field"
    v-model="model"
    :placeholder="placeholder"
    :rows="multiline ? rows : undefined"
    :class="props.class"
    autocomplete="off"
    @input="scheduleSuggestions"
    @keydown="handleKeydown"
    @blur="closeSuggestionsAfterBlur"
  />
  <Teleport to="body">
    <div
      v-if="suggestions.length > 0"
      ref="suggestionList"
      role="listbox"
      :style="dropdownStyle"
      class="border-border bg-popover/95 fixed z-50 max-h-56 overflow-y-auto rounded-lg border p-1 shadow-xl backdrop-blur-md"
    >
      <PromptSuggestionOptions
        :suggestions="suggestions"
        :active-index="activeIndex"
        @select="selectSuggestion"
      />
    </div>
  </Teleport>
</template>
