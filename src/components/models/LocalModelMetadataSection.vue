<script setup lang="ts">
/**
 * Safetensors header metadata (`__metadata__`) with a curated summary, an
 * optional raw dump, and — when requested — tags suggested from the training
 * tag frequency that can be inserted into the positive prompt.
 */
import { computed, ref } from 'vue';
import { Check, Plus } from '@lucide/vue';
import { Button } from '@/components/ui/button';
import { useModelMetadataQuery } from '@/composables/useModelManagerQueries';
import type { LocalModel } from '@/services/modelManager';
import { useWorkflowStore } from '@/stores/workflowStore';
import { appendPromptTerms, promptContainsTerm } from '@/utils/promptTools';

const props = withDefaults(
  defineProps<{ model: LocalModel; showSuggestedWords?: boolean }>(),
  { showSuggestedWords: false }
);

const HIGHLIGHTS: { keys: string[]; label: string }[] = [
  {
    keys: ['modelspec.architecture', 'ss_base_model_version'],
    label: 'Architecture'
  },
  { keys: ['ss_sd_model_name'], label: 'Trained on' },
  { keys: ['ss_network_dim'], label: 'Network dim' },
  { keys: ['ss_network_alpha'], label: 'Network alpha' },
  { keys: ['ss_resolution'], label: 'Resolution' },
  { keys: ['ss_num_train_images'], label: 'Training images' },
  { keys: ['ss_epoch', 'ss_num_epochs'], label: 'Epochs' },
  { keys: ['ss_steps', 'ss_max_train_steps'], label: 'Steps' },
  { keys: ['ss_clip_skip'], label: 'CLIP skip' },
  { keys: ['ss_training_started_at'], label: 'Trained at' }
];
const HIDDEN_RAW_KEYS = new Set(['ss_tag_frequency', 'ss_dataset_dirs']);

const workflowStore = useWorkflowStore();
const isSafetensors = computed(() => props.model.extension === 'safetensors');
const metadataQuery = useModelMetadataQuery(() => props.model.id, {
  enabled: isSafetensors
});
const showRaw = ref(false);

const metadata = computed(() => metadataQuery.data.value?.metadata ?? {});
const rawEntries = computed(() =>
  Object.entries(metadata.value).filter(([key]) => !HIDDEN_RAW_KEYS.has(key))
);
const highlighted = computed(() =>
  HIGHLIGHTS.flatMap(({ keys, label }) => {
    const key = keys.find((candidate) => metadata.value[candidate]?.trim());
    return key ? [{ label, value: metadata.value[key] }] : [];
  })
);
const suggestedWords = computed(() =>
  props.showSuggestedWords
    ? (metadataQuery.data.value?.suggestedWords ?? [])
    : []
);

function wordPresent(word: string) {
  return promptContainsTerm(workflowStore.positivePrompt, word);
}

function insertWord(word: string) {
  workflowStore.positivePrompt = appendPromptTerms(
    workflowStore.positivePrompt,
    [word]
  );
}
</script>

<template>
  <section
    v-if="suggestedWords.length > 0"
    class="border-border/70 bg-card/70 flex flex-col gap-3 rounded-xl border p-4 shadow-xs"
  >
    <div class="flex flex-col gap-0.5">
      <h3 class="text-xs font-bold tracking-wider uppercase">
        Suggested trigger words
      </h3>
      <p class="text-muted-foreground text-xs">
        Most frequent tags in the training set, read from the safetensors
        header. Click to add to the positive prompt.
      </p>
    </div>
    <div class="flex flex-wrap gap-1.5">
      <button
        v-for="word in suggestedWords"
        :key="word"
        type="button"
        class="inline-flex cursor-pointer items-center gap-1 rounded-md border border-dashed px-2 py-1 font-mono text-xs transition-colors"
        :class="
          wordPresent(word)
            ? 'border-primary/40 bg-primary/15 text-primary'
            : 'border-border/70 bg-muted/30 text-muted-foreground hover:border-primary/40 hover:text-foreground'
        "
        :title="
          wordPresent(word)
            ? 'Already in the positive prompt'
            : 'Add to the positive prompt'
        "
        @click="insertWord(word)"
      >
        <Check v-if="wordPresent(word)" class="h-3 w-3" />
        <Plus v-else class="h-3 w-3 opacity-60" />
        <span>{{ word }}</span>
      </button>
    </div>
  </section>

  <section
    v-if="isSafetensors"
    class="border-border/70 bg-card/70 flex flex-col gap-3 rounded-xl border p-4 shadow-xs"
  >
    <div class="flex items-center justify-between gap-2">
      <h3 class="text-xs font-bold tracking-wider uppercase">
        Embedded metadata
      </h3>
      <Button
        v-if="rawEntries.length > 0"
        variant="ghost"
        size="sm"
        class="h-7 text-xs"
        @click="showRaw = !showRaw"
      >
        {{ showRaw ? 'Hide raw' : `Show all (${rawEntries.length})` }}
      </Button>
    </div>
    <p
      v-if="metadataQuery.isLoading.value"
      class="text-muted-foreground text-xs"
    >
      Reading safetensors header…
    </p>
    <p v-else-if="metadataQuery.error.value" class="text-destructive text-xs">
      {{ String(metadataQuery.error.value) }}
    </p>
    <p
      v-else-if="rawEntries.length === 0"
      class="text-muted-foreground text-xs"
    >
      This file carries no <code>__metadata__</code> in its header.
    </p>
    <template v-else>
      <dl
        v-if="highlighted.length > 0"
        class="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-xs"
      >
        <template v-for="item in highlighted" :key="item.label">
          <dt class="text-muted-foreground">{{ item.label }}</dt>
          <dd class="truncate font-mono" :title="item.value">
            {{ item.value }}
          </dd>
        </template>
      </dl>
      <div
        v-if="showRaw"
        class="border-border/60 bg-background/60 max-h-80 overflow-auto rounded-lg border p-3"
      >
        <dl
          class="grid grid-cols-[minmax(0,14rem)_1fr] gap-x-4 gap-y-1 text-xs"
        >
          <template v-for="[key, value] in rawEntries" :key="key">
            <dt class="text-muted-foreground truncate font-mono" :title="key">
              {{ key }}
            </dt>
            <dd class="font-mono break-all">{{ value }}</dd>
          </template>
        </dl>
      </div>
    </template>
  </section>
</template>
