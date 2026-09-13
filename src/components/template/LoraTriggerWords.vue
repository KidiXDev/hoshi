<script setup lang="ts">
/**
 * Trigger-word strip for one LoRA row. Resolves the ComfyUI filename through
 * the local model index (Civitai sidecar → trained words, safetensors header
 * → suggested tags) and lets the user toggle words into the positive prompt.
 */
import { computed, ref } from 'vue';
import { Check, CloudDownload, Loader2, Plus, Sparkles } from '@lucide/vue';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger
} from '@/components/ui/tooltip';
import ModelSyncDialog from '@/components/models/ModelSyncDialog.vue';
import {
  useLocalModelByNameQuery,
  useModelMetadataQuery
} from '@/composables/useModelManagerQueries';
import { useModelSyncDialog } from '@/composables/useModelSyncDialog';
import { useLauncherStore } from '@/stores/launcherStore';
import {
  mergeTriggerWords,
  missingTriggerWords,
  wordState
} from '@/utils/loraTriggerWords';

const COLLAPSED_LIMIT = 8;

const props = defineProps<{
  loraName: string;
  prompt: string;
  disabled?: boolean;
}>();

const emit = defineEmits<{
  insert: [words: string[]];
  remove: [word: string];
}>();

const launcherStore = useLauncherStore();
const record = useLocalModelByNameQuery('loras', () => props.loraName);
const recordId = computed(() => record.data.value?.id ?? null);
const trainedWords = computed(
  () => record.data.value?.civitai?.trainedWords ?? []
);
const metadata = useModelMetadataQuery(recordId, {
  enabled: () =>
    trainedWords.value.length === 0 &&
    record.data.value?.extension === 'safetensors'
});
const sync = useModelSyncDialog();
const expanded = ref(false);

const words = computed(() =>
  mergeTriggerWords(
    trainedWords.value,
    metadata.data.value?.suggestedWords ?? []
  )
);
const isSuggested = computed(() =>
  words.value.some((entry) => entry.source === 'suggested')
);
const visibleWords = computed(() =>
  expanded.value ? words.value : words.value.slice(0, COLLAPSED_LIMIT)
);
const hiddenCount = computed(
  () => words.value.length - visibleWords.value.length
);
const missing = computed(() =>
  missingTriggerWords(
    props.prompt,
    words.value.map((entry) => entry.word)
  )
);
const canSync = computed(
  () => launcherStore.hasComfyDirectory && Boolean(recordId.value)
);
const notFoundOnCivitai = computed(
  () =>
    Boolean(record.data.value) &&
    !record.data.value?.civitai &&
    (record.data.value?.syncAttemptedMs ?? 0) > 0
);
const showEmpty = computed(
  () =>
    !record.isLoading.value &&
    !metadata.isLoading.value &&
    words.value.length === 0
);

function toggle(word: string) {
  if (props.disabled) return;
  if (wordState(props.prompt, word) === 'present') emit('remove', word);
  else emit('insert', [word]);
}

async function runSync() {
  if (!record.data.value) return;
  await sync.run(record.data.value);
}
</script>

<template>
  <div
    v-if="props.loraName"
    class="border-border/60 flex flex-col gap-1.5 border-t px-1 pt-1.5"
  >
    <div class="flex items-center justify-between gap-2">
      <span
        class="text-muted-foreground flex items-center gap-1 text-xs font-medium"
      >
        <Sparkles class="h-3 w-3" />
        <span>{{ isSuggested ? 'Suggested tags' : 'Trigger words' }}</span>
        <Tooltip v-if="isSuggested">
          <TooltipTrigger as-child>
            <span
              class="border-border/70 text-muted-foreground cursor-help rounded border border-dashed px-1 text-xs"
            >
              from training
            </span>
          </TooltipTrigger>
          <TooltipContent side="bottom" class="max-w-xs text-xs">
            No Civitai metadata for this LoRA yet. These are the most frequent
            tags in its training set (read from the safetensors header).
          </TooltipContent>
        </Tooltip>
      </span>
      <div class="flex items-center gap-1">
        <button
          v-if="words.length > 0 && missing.length > 0"
          type="button"
          class="text-primary hover:text-primary/80 cursor-pointer text-xs font-medium disabled:cursor-not-allowed disabled:opacity-50"
          :disabled="props.disabled"
          @click="emit('insert', missing)"
        >
          Insert all ({{ missing.length }})
        </button>
        <button
          v-if="canSync && (showEmpty || trainedWords.length === 0)"
          type="button"
          class="text-muted-foreground hover:text-foreground inline-flex cursor-pointer items-center gap-1 text-xs disabled:cursor-not-allowed disabled:opacity-50"
          :disabled="sync.isRunning()"
          :title="
            notFoundOnCivitai
              ? 'Last lookup found nothing on Civitai; try again'
              : 'Hash this file and fetch trigger words from Civitai'
          "
          @click="runSync"
        >
          <Loader2 v-if="sync.isRunning()" class="h-3 w-3 animate-spin" />
          <CloudDownload v-else class="h-3 w-3" />
          <span>{{ sync.isRunning() ? 'Syncing…' : 'Sync from Civitai' }}</span>
        </button>
      </div>
    </div>

    <div
      v-if="record.isLoading.value || metadata.isLoading.value"
      class="text-muted-foreground flex items-center gap-1.5 text-xs"
    >
      <Loader2 class="h-3 w-3 animate-spin" />
      <span>Looking up model metadata…</span>
    </div>

    <div v-else-if="words.length > 0" class="flex flex-wrap gap-1">
      <button
        v-for="entry in visibleWords"
        :key="entry.word"
        type="button"
        class="inline-flex max-w-full cursor-pointer items-center gap-1 rounded-md border px-1.5 py-0.5 font-mono text-xs transition-colors disabled:cursor-not-allowed disabled:opacity-50"
        :class="[
          wordState(props.prompt, entry.word) === 'present'
            ? 'border-primary/40 bg-primary/15 text-primary'
            : 'border-border bg-muted/50 text-foreground hover:border-primary/40 hover:bg-muted',
          entry.source === 'suggested' ? 'border-dashed' : ''
        ]"
        :disabled="props.disabled"
        :title="
          wordState(props.prompt, entry.word) === 'present'
            ? 'In prompt — click to remove'
            : 'Click to add to the positive prompt'
        "
        @click="toggle(entry.word)"
      >
        <Check
          v-if="wordState(props.prompt, entry.word) === 'present'"
          class="h-3 w-3 shrink-0"
        />
        <Plus v-else class="h-3 w-3 shrink-0 opacity-60" />
        <span class="truncate">{{ entry.word }}</span>
      </button>
      <button
        v-if="hiddenCount > 0 || expanded"
        type="button"
        class="text-muted-foreground hover:text-foreground cursor-pointer px-1 text-xs"
        @click="expanded = !expanded"
      >
        {{ expanded ? 'Show less' : `+${hiddenCount} more` }}
      </button>
    </div>

    <p v-else-if="record.error.value" class="text-xs text-amber-300">
      Model lookup failed: {{ String(record.error.value) }}
    </p>
    <p v-else-if="showEmpty" class="text-muted-foreground text-xs">
      {{
        !launcherStore.hasComfyDirectory
          ? 'Set your ComfyUI folder in Settings to look up trigger words.'
          : !record.data.value
            ? 'This LoRA was not found in the local model index.'
            : notFoundOnCivitai
              ? 'No Civitai record for this file.'
              : 'No trigger words known yet.'
      }}
    </p>

    <ModelSyncDialog
      :state="sync.state"
      @cancel="sync.cancel"
      @close="sync.close"
    />
  </div>
</template>
