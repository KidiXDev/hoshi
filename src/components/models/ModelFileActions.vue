<script setup lang="ts">
/**
 * Icon buttons for an indexed model file: reveal it in the file manager, or
 * delete it (with confirmation; navigates back to the Model Manager after).
 */
import { FolderOpen, Loader2, Trash2 } from '@lucide/vue';
import { useRouter } from 'vue-router';
import { toast } from 'vue-sonner';
import { Button } from '@/components/ui/button';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger
} from '@/components/ui/tooltip';
import { useConfirmDialog } from '@/composables/useConfirmDialog';
import { useDeleteModelMutation } from '@/composables/useModelManagerQueries';
import { showModelInFolder, type LocalModel } from '@/services/modelManager';
import { formatFileSize } from '@/utils/formatters';

const props = defineProps<{ model: LocalModel }>();

const router = useRouter();
const { confirm } = useConfirmDialog();
const deleteMutation = useDeleteModelMutation();

async function confirmAndDelete() {
  const { model } = props;
  const confirmed = await confirm({
    title: `Delete ${model.filename}?`,
    description: `This permanently deletes the model file (${formatFileSize(model.fileSize)}) and any metadata sidecars or preview images next to it. This cannot be undone.`,
    confirmLabel: 'Delete'
  });
  if (!confirmed) return;
  try {
    await deleteMutation.mutateAsync(model.id);
    toast.success(`Deleted ${model.filename}`);
    router.push('/models');
  } catch (error) {
    toast.error(`Delete failed: ${String(error)}`);
  }
}
</script>

<template>
  <div class="flex shrink-0 items-center gap-1">
    <Tooltip>
      <TooltipTrigger as-child>
        <Button
          variant="outline"
          size="icon"
          class="h-9 w-9"
          aria-label="Show file in folder"
          @click="showModelInFolder(model.path)"
        >
          <FolderOpen class="h-4 w-4" />
        </Button>
      </TooltipTrigger>
      <TooltipContent>Show file in folder</TooltipContent>
    </Tooltip>
    <Tooltip>
      <TooltipTrigger as-child>
        <Button
          variant="outline"
          size="icon"
          class="text-destructive hover:bg-destructive/10 hover:text-destructive h-9 w-9"
          aria-label="Delete model file"
          :disabled="deleteMutation.isPending.value"
          @click="confirmAndDelete"
        >
          <Loader2
            v-if="deleteMutation.isPending.value"
            class="h-4 w-4 animate-spin"
          />
          <Trash2 v-else class="h-4 w-4" />
        </Button>
      </TooltipTrigger>
      <TooltipContent>Delete model and its sidecars</TooltipContent>
    </Tooltip>
  </div>
</template>
