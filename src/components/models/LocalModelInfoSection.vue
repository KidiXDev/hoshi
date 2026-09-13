<script setup lang="ts">
/** Local file facts for an indexed model: path, ComfyUI name, size, hash. */
import { computed, onMounted, onUnmounted, ref } from 'vue';
import type { UnlistenFn } from '@tauri-apps/api/event';
import { Check, Copy, Hash, Loader2 } from '@lucide/vue';
import { toast } from 'vue-sonner';
import { Button } from '@/components/ui/button';
import { useLocalModelsIndexQuery } from '@/composables/useModelManagerQueries';
import {
  hashModel,
  modelCategoryLabel,
  onModelHashProgress,
  showModelInFolder,
  type LocalModel
} from '@/services/modelManager';
import { formatFileSize, formatShortDate } from '@/utils/formatters';

const props = defineProps<{ model: LocalModel }>();

const indexQuery = useLocalModelsIndexQuery();
const copied = ref('');
const hashing = ref(false);
const hashProgress = ref<{ processed: number; total: number } | null>(null);
let unlistenHash: UnlistenFn | null = null;

const hashPercent = computed(() => {
  const progress = hashProgress.value;
  if (!progress?.total) return 0;
  return Math.round((progress.processed / progress.total) * 100);
});

async function copyText(key: string, text: string) {
  try {
    await navigator.clipboard.writeText(text);
    copied.value = key;
    setTimeout(() => {
      if (copied.value === key) copied.value = '';
    }, 1500);
  } catch (error) {
    toast.error(`Copy failed: ${String(error)}`);
  }
}

async function runHash() {
  hashing.value = true;
  hashProgress.value = { processed: 0, total: props.model.fileSize };
  try {
    await hashModel(props.model.id);
    await indexQuery.refetch();
  } catch (error) {
    toast.error(`Hashing failed: ${String(error)}`);
  } finally {
    hashing.value = false;
    hashProgress.value = null;
  }
}

onMounted(async () => {
  unlistenHash = await onModelHashProgress((progress) => {
    if (progress.id === props.model.id && hashing.value) {
      hashProgress.value = {
        processed: progress.processed,
        total: progress.total
      };
    }
  });
});
onUnmounted(() => unlistenHash?.());
</script>

<template>
  <section
    class="border-border/70 bg-card/70 flex flex-col gap-3 rounded-xl border p-4 shadow-xs"
  >
    <div class="flex items-center justify-between gap-2">
      <h3 class="text-xs font-bold tracking-wider uppercase">Local file</h3>
      <Button
        variant="ghost"
        size="sm"
        class="h-7 text-xs"
        @click="showModelInFolder(model.path)"
      >
        Show in Explorer
      </Button>
    </div>
    <dl class="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-xs">
      <dt class="text-muted-foreground">Path</dt>
      <dd class="flex min-w-0 items-center gap-1.5">
        <span class="truncate font-mono" :title="model.path">
          {{ model.path }}
        </span>
        <button
          type="button"
          class="text-muted-foreground hover:text-foreground shrink-0 cursor-pointer"
          title="Copy path"
          @click="copyText('path', model.path)"
        >
          <Check
            v-if="copied === 'path'"
            class="h-3.5 w-3.5 text-emerald-400"
          />
          <Copy v-else class="h-3.5 w-3.5" />
        </button>
      </dd>
      <dt class="text-muted-foreground">ComfyUI name</dt>
      <dd class="truncate font-mono" :title="model.relativeName">
        {{ modelCategoryLabel(model.category) }} / {{ model.relativeName }}
      </dd>
      <dt class="text-muted-foreground">Size</dt>
      <dd class="font-mono">{{ formatFileSize(model.fileSize) }}</dd>
      <dt class="text-muted-foreground">Modified</dt>
      <dd class="font-mono">{{ formatShortDate(model.modifiedMs) }}</dd>
      <dt class="text-muted-foreground">SHA-256</dt>
      <dd class="flex min-w-0 items-center gap-1.5">
        <template v-if="model.sha256">
          <span class="truncate font-mono" :title="model.sha256">
            {{ model.sha256 }}
          </span>
          <button
            type="button"
            class="text-muted-foreground hover:text-foreground shrink-0 cursor-pointer"
            title="Copy hash"
            @click="copyText('hash', model.sha256)"
          >
            <Check
              v-if="copied === 'hash'"
              class="h-3.5 w-3.5 text-emerald-400"
            />
            <Copy v-else class="h-3.5 w-3.5" />
          </button>
        </template>
        <Button
          v-else
          variant="outline"
          size="sm"
          class="h-6 text-xs"
          :disabled="hashing"
          @click="runHash"
        >
          <Loader2 v-if="hashing" class="h-3 w-3 animate-spin" />
          <Hash v-else class="h-3 w-3" />
          {{ hashing ? `${hashPercent}%` : 'Compute hash' }}
        </Button>
      </dd>
    </dl>
  </section>
</template>
