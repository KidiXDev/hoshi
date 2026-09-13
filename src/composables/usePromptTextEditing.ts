import { ComfyApi, type AutocompleteItem } from '@/services/comfyApi';
import {
  getPromptTokenRange,
  replacePromptToken,
  type PromptTokenRange
} from '@/services/promptAutocomplete';
import { useComfyStore } from '@/stores/comfyStore';
import { useLauncherStore } from '@/stores/launcherStore';
import { useWorkflowStore } from '@/stores/workflowStore';
import { getCaretCoordinates } from '@/utils/caretCoordinates';
import { adjustPromptWeight } from '@/utils/promptTools';
import { computed, nextTick, onUnmounted, ref, watch, type Ref } from 'vue';
export type PromptField = 'positive' | 'negative';
export type TextareaRef = { $el: HTMLTextAreaElement };
export function usePromptTextEditing(
  isPositiveChipsMode: Ref<boolean>,
  isNegativeChipsMode: Ref<boolean>
) {
  const launcherStore = useLauncherStore();
  const comfyStore = useComfyStore();
  const workflowStore = useWorkflowStore();

  const positiveTextarea = ref<TextareaRef>();
  const negativeTextarea = ref<TextareaRef>();
  const suggestions = ref<AutocompleteItem[]>([]);
  const activeIndex = ref(0);
  const activeField = ref<PromptField>();
  const autocompleteListRef = ref<HTMLElement | null>(null);
  let activeRange: PromptTokenRange | null = null;
  let searchTimer: ReturnType<typeof setTimeout> | undefined;
  let searchController: AbortController | undefined;
  function getTextareaElement(field: PromptField): HTMLTextAreaElement | null {
    const comp =
      field === 'positive' ? positiveTextarea.value : negativeTextarea.value;
    if (!comp) return null;
    return (
      (comp.$el instanceof HTMLTextAreaElement ? comp.$el : null) ??
      (comp as unknown as HTMLTextAreaElement)
    );
  }
  const caretCoords = ref<{ top: number; left: number; height: number }>({
    top: 0,
    left: 0,
    height: 20
  });
  function getAutocompleteDropdownStyle(field: PromptField) {
    const input = getTextareaElement(field);
    const containerWidth = input?.clientWidth ?? 400;
    const dropdownWidth = 320;

    let left = caretCoords.value.left;
    let top = caretCoords.value.top + caretCoords.value.height + 4;

    if (left + dropdownWidth > containerWidth - 8) {
      left = Math.max(8, containerWidth - dropdownWidth - 8);
    }
    if (left < 8) {
      left = 8;
    }
    if (top < 4) {
      top = 4;
    }

    return {
      top: `${top}px`,
      left: `${left}px`,
      width: `${Math.min(dropdownWidth, containerWidth - 16)}px`
    };
  }
  function handleTextareaScroll(field: PromptField, event: Event) {
    if (activeField.value === field) {
      const input = event.target as HTMLTextAreaElement;
      caretCoords.value = getCaretCoordinates(input, input.selectionStart);
    }
  }
  function scrollToActiveSuggestion() {
    void nextTick(() => {
      const list = autocompleteListRef.value;
      if (!list) return;
      const activeEl = list.querySelector<HTMLElement>(
        `[data-index="${activeIndex.value}"]`
      );
      if (activeEl) {
        activeEl.scrollIntoView({ block: 'nearest' });
      }
    });
  }
  watch(activeIndex, () => {
    if (activeField.value && suggestions.value.length > 0) {
      scrollToActiveSuggestion();
    }
  });
  const lastPositiveCursorPos = ref<number | null>(null);
  const lastNegativeCursorPos = ref<number | null>(null);
  function updateCursor(field: PromptField, event: Event) {
    const el = event.target as HTMLTextAreaElement;
    if (el) {
      if (field === 'positive') lastPositiveCursorPos.value = el.selectionStart;
      else lastNegativeCursorPos.value = el.selectionStart;
      if (activeField.value === field) {
        caretCoords.value = getCaretCoordinates(el, el.selectionStart);
      }
    }
  }
  function handleInput(field: PromptField, event: Event) {
    scheduleAutocomplete(field, event);
    updateCursor(field, event);
  }
  function handleBlur(field: PromptField, event: Event) {
    closeAutocompleteAfterBlur();
    updateCursor(field, event);
  }
  function closeAutocomplete() {
    suggestions.value = [];
    activeField.value = undefined;
  }
  function closeAutocompleteAfterBlur() {
    setTimeout(closeAutocomplete, 150);
  }
  function scheduleAutocomplete(field: PromptField, event: Event) {
    clearTimeout(searchTimer);
    searchController?.abort();
    if (
      !launcherStore.config.autocompleteEnabled ||
      !comfyStore.isConnected ||
      !comfyStore.isYetEssentialAvailable
    ) {
      return closeAutocomplete();
    }

    const input = event.target as HTMLTextAreaElement;
    caretCoords.value = getCaretCoordinates(input, input.selectionStart);
    const range = getPromptTokenRange(input.value, input.selectionStart);
    if (!range) return closeAutocomplete();
    activeRange = range;
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
        activeField.value = items.length > 0 ? field : undefined;
      } catch (error) {
        if (!(error instanceof DOMException && error.name === 'AbortError')) {
          closeAutocomplete();
        }
      }
    }, 140);
  }
  function selectSuggestion(field: PromptField, item: AutocompleteItem) {
    if (!activeRange) return;
    const input = getTextareaElement(field);
    if (!input) return;
    const current =
      field === 'positive'
        ? workflowStore.positivePrompt
        : workflowStore.negativePrompt;
    const result = replacePromptToken(
      current,
      activeRange,
      item.insert_text,
      launcherStore.config.autocompleteReplaceUnderscores,
      launcherStore.config.autocompleteIncludeArtistPrefix
    );
    input.select();
    document.execCommand('insertText', false, result.text);
    if (field === 'positive') lastPositiveCursorPos.value = result.cursor;
    else lastNegativeCursorPos.value = result.cursor;
    closeAutocomplete();
    void nextTick(() => {
      input.focus();
      input.setSelectionRange(result.cursor, result.cursor);
    });
  }
  function handleKeydown(field: PromptField, event: KeyboardEvent) {
    const isCtrlOrMeta = event.ctrlKey || event.metaKey;
    const isAlt = event.altKey;
    const isWeightModifier = isCtrlOrMeta || isAlt;

    // 1. Hotkey: Weight increase / decrease with Ctrl+Up / Ctrl+Down or Alt+Up / Alt+Down
    if (
      isWeightModifier &&
      (event.key === 'ArrowUp' || event.key === 'ArrowDown')
    ) {
      event.preventDefault();
      const input = getTextareaElement(field);
      if (!input) return;

      const delta = event.key === 'ArrowUp' ? 0.05 : -0.05;
      const current =
        field === 'positive'
          ? workflowStore.positivePrompt
          : workflowStore.negativePrompt;

      const result = adjustPromptWeight(
        current,
        input.selectionStart,
        input.selectionEnd,
        delta
      );

      if (field === 'positive') {
        workflowStore.positivePrompt = result.text;
        lastPositiveCursorPos.value = result.selectionEnd;
      } else {
        workflowStore.negativePrompt = result.text;
        lastNegativeCursorPos.value = result.selectionEnd;
      }

      void nextTick(() => {
        input.focus();
        input.setSelectionRange(result.selectionStart, result.selectionEnd);
      });
      return;
    }

    // 2. Shortcut: Ctrl+F to open Find in Prompt
    if (isCtrlOrMeta && (event.key === 'f' || event.key === 'F')) {
      event.preventDefault();
      openFindBar(field);
      return;
    }

    // 3. Autocomplete suggestions navigation
    if (
      !isCtrlOrMeta &&
      !isAlt &&
      activeField.value === field &&
      suggestions.value.length > 0
    ) {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        const direction = event.key === 'ArrowDown' ? 1 : -1;
        activeIndex.value =
          (activeIndex.value + direction + suggestions.value.length) %
          suggestions.value.length;
      } else if (event.key === 'PageDown') {
        event.preventDefault();
        activeIndex.value = Math.min(
          suggestions.value.length - 1,
          activeIndex.value + 5
        );
      } else if (event.key === 'PageUp') {
        event.preventDefault();
        activeIndex.value = Math.max(0, activeIndex.value - 5);
      } else if (event.key === 'Home') {
        event.preventDefault();
        activeIndex.value = 0;
      } else if (event.key === 'End') {
        event.preventDefault();
        activeIndex.value = suggestions.value.length - 1;
      } else if (event.key === 'Enter' || event.key === 'Tab') {
        const chosen = suggestions.value[activeIndex.value];
        if (chosen) {
          event.preventDefault();
          selectSuggestion(field, chosen);
        }
      } else if (event.key === 'Escape') {
        closeAutocomplete();
      }
    }
  }
  interface FindMatch {
    start: number;
    end: number;
  }
  const isFindBarOpen = ref(false);
  const findQuery = ref('');
  const findTarget = ref<PromptField>('positive');
  const findCaseSensitive = ref(false);
  const currentMatchIndex = ref(0);
  const findInputRef = ref<HTMLInputElement | null>(null);
  const findMatches = computed<FindMatch[]>(() => {
    const query = findQuery.value;
    if (!query) return [];

    const text =
      findTarget.value === 'positive'
        ? workflowStore.positivePrompt
        : workflowStore.negativePrompt;

    if (!text) return [];

    const matches: FindMatch[] = [];
    const searchPattern = findCaseSensitive.value ? query : query.toLowerCase();
    const searchContent = findCaseSensitive.value ? text : text.toLowerCase();

    let startIndex = 0;
    while (startIndex < searchContent.length) {
      const foundIndex = searchContent.indexOf(searchPattern, startIndex);
      if (foundIndex === -1) break;
      matches.push({
        start: foundIndex,
        end: foundIndex + query.length
      });
      startIndex = foundIndex + Math.max(1, query.length);
    }

    return matches;
  });
  watch(findMatches, (newMatches) => {
    if (newMatches.length === 0) {
      currentMatchIndex.value = 0;
    } else if (currentMatchIndex.value >= newMatches.length) {
      currentMatchIndex.value = 0;
      highlightCurrentMatch();
    } else {
      highlightCurrentMatch();
    }
  });
  function highlightCurrentMatch() {
    const matches = findMatches.value;
    if (matches.length === 0) return;

    const match = matches[currentMatchIndex.value];
    if (!match) return;

    const input = getTextareaElement(findTarget.value);
    if (!input) return;

    input.setSelectionRange(match.start, match.end);

    // Center match vertically
    const coords = getCaretCoordinates(input, match.start);
    const targetScrollTop =
      coords.top + input.scrollTop - input.clientHeight / 2;
    input.scrollTop = Math.max(0, targetScrollTop);
  }
  function findNext() {
    const matches = findMatches.value;
    if (matches.length === 0) return;
    currentMatchIndex.value = (currentMatchIndex.value + 1) % matches.length;
    highlightCurrentMatch();
  }
  function findPrev() {
    const matches = findMatches.value;
    if (matches.length === 0) return;
    currentMatchIndex.value =
      (currentMatchIndex.value - 1 + matches.length) % matches.length;
    highlightCurrentMatch();
  }
  function openFindBar(target?: PromptField) {
    if (target) {
      findTarget.value = target;
    }
    if (findTarget.value === 'positive' && isPositiveChipsMode.value) {
      isPositiveChipsMode.value = false;
    } else if (findTarget.value === 'negative' && isNegativeChipsMode.value) {
      isNegativeChipsMode.value = false;
    }

    const input = getTextareaElement(findTarget.value);
    if (input) {
      const start = input.selectionStart;
      const end = input.selectionEnd;
      if (start !== end) {
        const selection = input.value.slice(start, end).trim();
        if (selection && selection.length < 100) {
          findQuery.value = selection;
        }
      }
    }

    isFindBarOpen.value = true;
    void nextTick(() => {
      findInputRef.value?.focus();
      findInputRef.value?.select();
      if (findMatches.value.length > 0) {
        highlightCurrentMatch();
      }
    });
  }
  function setFindTarget(target: PromptField) {
    findTarget.value = target;
    if (target === 'positive' && isPositiveChipsMode.value) {
      isPositiveChipsMode.value = false;
    } else if (target === 'negative' && isNegativeChipsMode.value) {
      isNegativeChipsMode.value = false;
    }
    currentMatchIndex.value = 0;
    void nextTick(() => {
      highlightCurrentMatch();
      findInputRef.value?.focus();
    });
  }
  function closeFindBar() {
    isFindBarOpen.value = false;
    const input = getTextareaElement(findTarget.value);
    input?.focus();
  }
  function handleContainerKeydown(event: KeyboardEvent) {
    if (
      (event.ctrlKey || event.metaKey) &&
      (event.key === 'f' || event.key === 'F')
    ) {
      const target = event.target as HTMLElement;
      if (target.tagName === 'INPUT' && target !== findInputRef.value) {
        return;
      }
      event.preventDefault();
      openFindBar(findTarget.value);
    }
  }
  function insertTagAtCursor(tag: string, target: PromptField = 'positive') {
    const isPos = target === 'positive';
    const current = isPos
      ? workflowStore.positivePrompt
      : workflowStore.negativePrompt;
    const el = isPos
      ? positiveTextarea.value?.$el
      : negativeTextarea.value?.$el;

    const lastCursor = isPos
      ? lastPositiveCursorPos.value
      : lastNegativeCursorPos.value;
    let pos =
      el && document.activeElement === el
        ? el.selectionStart
        : (lastCursor ?? current.length);
    pos = Math.max(0, Math.min(pos, current.length));

    const before = current.slice(0, pos);
    const after = current.slice(pos);

    let prefix = '';
    if (before.length > 0) {
      const trimmedBefore = before.trimEnd();
      prefix = trimmedBefore.endsWith(',') ? ' ' : ', ';
    }

    let suffix = '';
    if (after.length > 0) {
      const trimmedAfter = after.trimStart();
      if (!trimmedAfter.startsWith(',')) {
        suffix = ', ';
      }
    }

    const insertion = `${prefix}${tag}${suffix}`;
    const newPrompt = before + insertion + after;

    if (isPos) workflowStore.positivePrompt = newPrompt;
    else workflowStore.negativePrompt = newPrompt;

    const newCursor = pos + prefix.length + tag.length;
    if (isPos) lastPositiveCursorPos.value = newCursor;
    else lastNegativeCursorPos.value = newCursor;

    void nextTick(() => {
      if (el) {
        el.focus();
        el.setSelectionRange(newCursor, newCursor);
      }
    });
  }
  onUnmounted(() => {
    clearTimeout(searchTimer);
    searchController?.abort();
  });
  return {
    positiveTextarea,
    negativeTextarea,
    suggestions,
    activeIndex,
    activeField,
    autocompleteListRef,
    getAutocompleteDropdownStyle,
    getTextareaElement,
    handleTextareaScroll,
    updateCursor,
    handleInput,
    handleBlur,
    selectSuggestion,
    handleKeydown,
    isFindBarOpen,
    findQuery,
    findTarget,
    findCaseSensitive,
    currentMatchIndex,
    findInputRef,
    findMatches,
    highlightCurrentMatch,
    findNext,
    findPrev,
    openFindBar,
    setFindTarget,
    closeFindBar,
    handleContainerKeydown,
    insertTagAtCursor
  };
}
