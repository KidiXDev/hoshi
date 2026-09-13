<script setup lang="ts">
/**
 * Progress dialog for a single-model Civitai sync. Cannot be dismissed by
 * Esc / outside click while running — only cancelled — and closes once the
 * sync reaches a terminal state.
 */
import { computed } from 'vue';
import {
  AlertTriangle,
  CheckCircle2,
  CloudOff,
  Loader2,
  XCircle
} from '@lucide/vue';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog';
import { Progress } from '@/components/ui/progress';
import type { ModelSyncState } from '@/composables/useModelSyncDialog';
import { formatFileSize } from '@/utils/formatters';

const props = defineProps<{ state: ModelSyncState }>();
const emit = defineEmits<{ cancel: []; close: [] }>();

const running = computed(
  () => props.state.stage === 'hashing' || props.state.stage === 'lookup'
);
const percent = computed(() => {
  const { stage, processed, total } = props.state;
  if (stage === 'hashing') return total ? (processed / total) * 100 : 0;
  if (stage === 'lookup') return 100;
  return stage === 'idle' ? 0 : 100;
});
const title = computed(() => {
  switch (props.state.stage) {
    case 'done':
      return 'Synced with Civitai';
    case 'notFound':
      return 'Not on Civitai';
    case 'cancelled':
      return 'Sync cancelled';
    case 'error':
      return 'Sync failed';
    default:
      return 'Syncing with Civitai';
  }
});
const stageLabel = computed(() => {
  const { stage, processed, total } = props.state;
  switch (stage) {
    case 'hashing':
      return `Hashing file (SHA-256) · ${formatFileSize(processed)} / ${formatFileSize(total)}`;
    case 'lookup':
      return 'Looking up on Civitai and writing metadata…';
    case 'done':
      return 'Metadata sidecars and preview were updated.';
    case 'notFound':
      return 'No Civitai model version matches this file hash. It may be a private, merged, or locally trained model.';
    case 'cancelled':
      return 'The sync was stopped before finishing. Nothing was changed.';
    case 'error':
      return props.state.error;
    default:
      return '';
  }
});

function onOpenChange(open: boolean) {
  // Ignore dismiss attempts while running; the Cancel button is the only exit.
  if (!open && !running.value) emit('close');
}
</script>

<template>
  <Dialog :open="state.open" @update:open="onOpenChange">
    <DialogContent
      class="sm:max-w-md"
      :show-close-button="!running"
      @escape-key-down="running && $event.preventDefault()"
      @pointer-down-outside="running && $event.preventDefault()"
      @interact-outside="running && $event.preventDefault()"
    >
      <DialogHeader>
        <div class="flex items-center gap-2">
          <Loader2
            v-if="running"
            class="text-primary h-5 w-5 shrink-0 animate-spin"
          />
          <CheckCircle2
            v-else-if="state.stage === 'done'"
            class="h-5 w-5 shrink-0 text-emerald-400"
          />
          <CloudOff
            v-else-if="state.stage === 'notFound'"
            class="text-muted-foreground h-5 w-5 shrink-0"
          />
          <XCircle
            v-else-if="state.stage === 'cancelled'"
            class="text-muted-foreground h-5 w-5 shrink-0"
          />
          <AlertTriangle
            v-else-if="state.stage === 'error'"
            class="text-destructive h-5 w-5 shrink-0"
          />
          <DialogTitle>{{ title }}</DialogTitle>
        </div>
        <DialogDescription
          class="min-w-0 truncate font-mono text-xs"
          :title="state.model?.filename"
        >
          {{ state.model?.filename }}
        </DialogDescription>
      </DialogHeader>

      <div class="flex flex-col gap-3">
        <Progress
          :model-value="percent"
          class="h-2"
          :class="{ 'opacity-40': !running && state.stage !== 'done' }"
        />
        <p
          class="text-xs break-words"
          :class="
            state.stage === 'error'
              ? 'text-destructive'
              : 'text-muted-foreground'
          "
        >
          {{ stageLabel }}
        </p>
        <p
          v-if="state.stage === 'done' && state.result?.civitai"
          class="text-xs"
        >
          <span class="font-semibold">{{
            state.result.civitai.modelName
          }}</span>
          <span class="text-muted-foreground">
            · {{ state.result.civitai.versionName }}
            <template v-if="state.result.civitai.baseModel">
              · {{ state.result.civitai.baseModel }}
            </template>
          </span>
        </p>
      </div>

      <DialogFooter>
        <Button v-if="running" variant="outline" @click="emit('cancel')">
          Cancel
        </Button>
        <Button v-else @click="emit('close')">Close</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
