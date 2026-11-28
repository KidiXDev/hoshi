<script setup lang="ts">
import { computed } from 'vue';
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
import {
  importPercent,
  type ModelImportStatus
} from '@/composables/useModelFileDrop';
import { modelCategoryLabel } from '@/services/modelManager';
import { formatFileSize } from '@/utils/formatters';

const STAGE_DESCRIPTIONS: Record<ModelImportStatus['stage'], string> = {
  moving: 'Moving files into the model folder.',
  syncing: 'Matching models on Civitai. Large files can take a while.',
  finished: 'Import finished.'
};

const props = defineProps<{
  open: boolean;
  status: ModelImportStatus | null;
}>();
const emit = defineEmits<{ cancel: []; close: [] }>();

const isRunning = computed(
  () => props.status !== null && props.status.stage !== 'finished'
);
const percent = computed(() =>
  props.status ? importPercent(props.status) : 0
);
const title = computed(() =>
  props.status
    ? `Importing to ${modelCategoryLabel(props.status.category)}`
    : 'Importing models'
);
const currentLabel = computed(() => {
  if (isRunning.value) return props.status?.file;
  return props.status?.cancelled ? 'Cancelled' : 'Finished';
});

function onOpenChange(open: boolean) {
  if (!open && !isRunning.value) emit('close');
}
</script>

<template>
  <Dialog :open="open" @update:open="onOpenChange">
    <DialogContent class="sm:max-w-md" :show-close-button="!isRunning">
      <DialogHeader>
        <DialogTitle>{{ title }}</DialogTitle>
        <DialogDescription>
          {{ status && STAGE_DESCRIPTIONS[status.stage] }}
        </DialogDescription>
      </DialogHeader>

      <div v-if="status" class="flex flex-col gap-3">
        <Progress :model-value="percent" class="h-2" />
        <div
          class="text-muted-foreground flex items-center justify-between gap-3 font-mono text-xs"
        >
          <span class="min-w-0 flex-1 truncate" :title="currentLabel">
            {{ currentLabel }}
          </span>
          <span v-if="isRunning" class="shrink-0">
            {{ status.position + 1 }} / {{ status.total }}
          </span>
        </div>
        <p
          v-if="isRunning && status.size > 0"
          class="text-muted-foreground font-mono text-xs"
        >
          {{ formatFileSize(status.copied) }} /
          {{ formatFileSize(status.size) }}
        </p>

        <div
          v-if="!isRunning"
          class="border-border bg-muted/40 grid grid-cols-3 gap-2 rounded-lg border p-3 text-center text-xs"
        >
          <div>
            <div class="text-base font-semibold text-emerald-400">
              {{ status.moved }}
            </div>
            <div class="text-muted-foreground">moved</div>
          </div>
          <div>
            <div class="text-base font-semibold text-emerald-400">
              {{ status.matched }}
            </div>
            <div class="text-muted-foreground">on Civitai</div>
          </div>
          <div>
            <div class="text-base font-semibold text-amber-300">
              {{ status.issues.length }}
            </div>
            <div class="text-muted-foreground">
              {{ status.issues.length === 1 ? 'issue' : 'issues' }}
            </div>
          </div>
        </div>

        <p v-if="status.error" class="text-destructive text-xs wrap-break-word">
          {{ status.error }}
        </p>

        <div
          v-if="!isRunning && status.issues.length > 0"
          class="border-border/60 bg-background/60 max-h-48 overflow-y-auto rounded-lg border"
        >
          <div
            v-for="(issue, index) in status.issues"
            :key="`${issue.file}-${index}`"
            class="border-border/40 flex min-w-0 items-baseline gap-2 border-b px-3 py-1.5 text-xs last:border-b-0"
          >
            <span class="min-w-0 flex-1 truncate font-mono" :title="issue.file">
              {{ issue.file }}
            </span>
            <span
              class="max-w-[45%] shrink-0 truncate text-amber-300"
              :title="issue.reason"
            >
              {{ issue.reason }}
            </span>
          </div>
        </div>
      </div>

      <DialogFooter>
        <Button
          v-if="isRunning"
          variant="outline"
          :disabled="status?.cancelled"
          @click="emit('cancel')"
        >
          Cancel
        </Button>
        <Button v-else @click="emit('close')">Close</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
