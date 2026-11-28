<script setup lang="ts">
import { watchDebounced } from '@vueuse/core';
import { ComboboxInput } from 'reka-ui';
import { computed, ref, watch } from 'vue';
import {
  Combobox,
  ComboboxAnchor,
  ComboboxEmpty,
  ComboboxGroup,
  ComboboxItem,
  ComboboxList
} from '@/components/ui/combobox';
import {
  TagsInput,
  TagsInputInput,
  TagsInputItem,
  TagsInputItemDelete,
  TagsInputItemText
} from '@/components/ui/tags-input';
import {
  autocompleteCharacterTags,
  displayTag,
  suggestCharacterTags,
  type CharacterSuggestion
} from '@/services/characterData';
import { useCharacterHelperStore } from '@/stores/characterHelperStore';

const model = defineModel<string[]>({ required: true });
const props = withDefaults(
  defineProps<{ field: string; placeholder?: string }>(),
  { placeholder: 'Search tags...' }
);
const emit = defineEmits<{ pick: [suggestion: CharacterSuggestion] }>();

const store = useCharacterHelperStore();
const open = ref(false);
const search = ref('');
const items = ref<CharacterSuggestion[]>([]);
let request = 0;

const typed = computed(() =>
  search.value.trim().toLowerCase().replaceAll(/\s+/gu, '_')
);
const showTyped = computed(
  () =>
    typed.value !== '' &&
    !model.value.includes(typed.value) &&
    !items.value.some((item) => item.tag === typed.value)
);

async function refresh() {
  const id = ++request;
  const query = search.value.trim();
  try {
    const found = query
      ? await autocompleteCharacterTags(props.field, query)
      : props.field
        ? await suggestCharacterTags(props.field, store.fields, store.rating)
        : [];
    if (id === request) items.value = found;
  } catch {
    if (id === request) items.value = [];
  }
}

watchDebounced(search, refresh, { debounce: 150 });
watch(open, (isOpen) => {
  if (isOpen) void refresh();
});

function add(tag: string, suggestion?: CharacterSuggestion) {
  if (!model.value.includes(tag)) model.value = [...model.value, tag];
  search.value = '';
  if (suggestion) emit('pick', suggestion);
}

function detail(item: CharacterSuggestion) {
  if (item.hint) return item.hint;
  if (item.kind === 'series') return 'series';
  return Intl.NumberFormat('en', { notation: 'compact' }).format(item.count);
}
</script>

<template>
  <Combobox
    v-model:open="open"
    :model-value="model"
    multiple
    ignore-filter
    class="w-full"
  >
    <ComboboxAnchor as-child>
      <TagsInput v-model="model" class="w-full gap-1 px-1.5">
        <TagsInputItem v-for="tag in model" :key="tag" :value="tag" class="h-6">
          <TagsInputItemText class="px-1.5 text-xs">{{
            displayTag(tag)
          }}</TagsInputItemText>
          <TagsInputItemDelete />
        </TagsInputItem>
        <ComboboxInput v-model="search" as-child>
          <TagsInputInput
            :placeholder="model.length ? '' : placeholder"
            class="min-w-24 text-xs"
            @keydown.enter.prevent
            @focus="open = true"
          />
        </ComboboxInput>
      </TagsInput>
    </ComboboxAnchor>
    <ComboboxList class="w-(--reka-popper-anchor-width) min-w-56">
      <ComboboxEmpty class="text-muted-foreground p-2 text-xs">
        {{ search ? 'No matches' : 'Type to search' }}
      </ComboboxEmpty>
      <ComboboxGroup class="max-h-64 overflow-y-auto p-1">
        <ComboboxItem
          v-if="showTyped"
          :value="typed"
          class="text-xs"
          @select.prevent="add(typed)"
        >
          Add “{{ displayTag(typed) }}”
        </ComboboxItem>
        <ComboboxItem
          v-for="item in items"
          :key="`${item.kind}:${item.tag}`"
          :value="item.tag"
          class="justify-between gap-3 text-xs"
          @select.prevent="add(item.tag, item)"
        >
          <span class="min-w-0 truncate">
            {{ displayTag(item.tag) }}
            <span
              v-if="item.kind === 'character' && item.series"
              class="text-muted-foreground"
              >({{ displayTag(item.series) }})</span
            >
            <span v-if="item.alias" class="text-muted-foreground"
              >← {{ displayTag(item.alias) }}</span
            >
          </span>
          <span class="text-muted-foreground shrink-0 font-mono">{{
            detail(item)
          }}</span>
        </ComboboxItem>
      </ComboboxGroup>
    </ComboboxList>
  </Combobox>
</template>
