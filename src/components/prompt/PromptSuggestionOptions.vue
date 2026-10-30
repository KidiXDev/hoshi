<script setup lang="ts">
import {
  Dices,
  Tag,
  Palette,
  Copyright,
  User,
  Code2,
  WholeWord
} from '@lucide/vue';
import type { AutocompleteItem } from '@/services/comfyApi';

defineProps<{ suggestions: AutocompleteItem[]; activeIndex: number }>();
const emit = defineEmits<{ select: [item: AutocompleteItem] }>();
const categoryNames: Record<number, string> = {
  0: 'General',
  1: 'Artist',
  3: 'Copyright',
  4: 'Character',
  5: 'Meta'
};
const categoryBadgeStyles: Record<number, string> = {
  0: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30',
  1: 'bg-sky-500/10 text-sky-400 border-sky-500/30',
  3: 'bg-amber-500/10 text-amber-400 border-amber-500/30',
  4: 'bg-purple-500/10 text-purple-400 border-purple-500/30',
  5: 'bg-slate-500/10 text-slate-400 border-slate-500/30'
};
function getCategoryIcon(item: AutocompleteItem) {
  if (item.kind === 'wildcard') return Dices;
  if (item.kind === 'word') return WholeWord;
  switch (Number(item.category)) {
    case 0:
      return Tag;
    case 1:
      return Palette;
    case 3:
      return Copyright;
    case 4:
      return User;
    case 5:
      return Code2;
    default:
      return Tag;
  }
}
function getCategoryName(item: AutocompleteItem) {
  if (item.kind === 'wildcard') return 'Wildcard';
  if (item.kind === 'word') return 'Word';
  return categoryNames[Number(item.category)] ?? 'Tag';
}
function getCategoryBadgeStyle(item: AutocompleteItem) {
  if (item.kind === 'wildcard') {
    return 'bg-pink-500/10 text-pink-400 border-pink-500/30';
  }
  if (item.kind === 'word') {
    return 'bg-teal-500/10 text-teal-400 border-teal-500/30';
  }
  return (
    categoryBadgeStyles[Number(item.category)] ||
    'bg-muted text-muted-foreground border-border'
  );
}
function formatPostCount(count: number) {
  return count >= 1000
    ? `${(count / 1000).toFixed(1).replace(/\.0$/u, '')}k`
    : count;
}
function autocompleteMeta(item: AutocompleteItem) {
  if (item.kind === 'word') return '';
  const count = formatPostCount(item.total_post);
  return item.kind === 'wildcard' ? `${count} entries` : `${count} posts`;
}
</script>
<template>
  <button
    v-for="(item, index) in suggestions"
    :key="`${item.label}-${item.category}`"
    :data-index="index"
    type="button"
    role="option"
    :aria-selected="index === activeIndex"
    class="flex w-full cursor-pointer items-center justify-between rounded-md px-2.5 py-1.5 text-left font-mono text-xs transition-colors"
    :class="
      index === activeIndex
        ? 'bg-primary/20 text-foreground border-primary/30 border font-semibold'
        : 'hover:bg-accent/60 text-foreground'
    "
    @mousedown.prevent
    @click="emit('select', item)"
  >
    <div class="flex items-center gap-2 overflow-hidden">
      <span
        class="flex h-5 w-5 shrink-0 items-center justify-center rounded border"
        :class="getCategoryBadgeStyle(item)"
        :title="getCategoryName(item)"
      >
        <component :is="getCategoryIcon(item)" class="h-3 w-3" />
      </span>
      <span class="truncate">{{ item.label }}</span>
    </div>
    <span class="text-muted-foreground ml-3 shrink-0 text-xs">
      {{ autocompleteMeta(item) }}
    </span>
  </button>
</template>
