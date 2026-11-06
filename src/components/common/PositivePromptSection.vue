<script setup lang="ts">
import { useLocalStorage } from '@vueuse/core';
import { computed } from 'vue';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';

const props = defineProps<{ prompt?: string; emptyMessage: string }>();

const viewMode = useLocalStorage<'standard' | 'raw'>(
  'generation-data-prompt-view',
  'raw'
);
const promptTags = computed(() =>
  (props.prompt ?? '')
    .split(',')
    .map((tag) => tag.trim())
    .filter(Boolean)
);

function selectViewMode(mode: unknown) {
  if (mode === 'standard' || mode === 'raw') viewMode.value = mode;
}
</script>
<template>
  <section class="border-border/80 rounded-xl border p-3">
    <div class="mb-2 flex items-center justify-between gap-2">
      <h3 class="text-foreground text-xs font-bold tracking-wider uppercase">
        Positive Prompt
      </h3>
      <div class="flex items-center gap-1">
        <ToggleGroup
          type="single"
          :model-value="viewMode"
          class="gap-1"
          @update:model-value="selectViewMode"
        >
          <ToggleGroupItem
            value="standard"
            size="sm"
            class="data-[state=on]:bg-primary data-[state=on]:text-primary-foreground h-6 px-2 text-xs"
          >
            Standard
          </ToggleGroupItem>
          <ToggleGroupItem
            value="raw"
            size="sm"
            class="data-[state=on]:bg-primary data-[state=on]:text-primary-foreground h-6 px-2 text-xs"
          >
            Raw
          </ToggleGroupItem>
        </ToggleGroup>
        <slot />
      </div>
    </div>

    <p v-if="!promptTags.length" class="text-muted-foreground text-xs italic">
      {{ emptyMessage }}
    </p>
    <p
      v-else-if="viewMode === 'raw'"
      class="text-muted-foreground font-mono text-xs leading-relaxed whitespace-pre-wrap"
    >
      {{ prompt }}
    </p>
    <div v-else class="flex flex-wrap gap-1.5">
      <span
        v-for="tag in promptTags"
        :key="tag"
        class="border-border/80 bg-muted/60 text-foreground hover:border-primary/40 rounded-md border px-2 py-0.5 font-mono text-xs break-all transition-colors"
      >
        {{ tag }}
      </span>
    </div>
  </section>
</template>
