<script setup lang="ts">
/** Delete-with-confirmation for an indexed model; navigates back on success. */
import { Loader2, Trash2 } from '@lucide/vue';
import { useRouter } from 'vue-router';
import { toast } from 'vue-sonner';
import { Button } from '@/components/ui/button';
import { useConfirmDialog } from '@/composables/useConfirmDialog';
import { useDeleteModelMutation } from '@/composables/useModelManagerQueries';
import type { LocalModel } from '@/services/modelManager';
import { formatFileSize } from '@/utils/formatters';

const props = defineProps<{ model: LocalModel }>();

const router = useRouter();
const { confirm } = useConfirmDialog();
const deleteMutation = useDeleteModelMutation();

async function runDelete() {
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
  <section
    class="border-destructive/30 bg-destructive/5 flex items-center justify-between gap-3 rounded-xl border p-4"
  >
    <div class="flex flex-col gap-0.5">
      <h3 class="text-destructive text-xs font-bold tracking-wider uppercase">
        Delete model
      </h3>
      <p class="text-muted-foreground text-xs">
        Removes the file and its sidecars from disk.
      </p>
    </div>
    <Button
      variant="destructive"
      size="sm"
      class="h-8 text-xs"
      :disabled="deleteMutation.isPending.value"
      @click="runDelete"
    >
      <Loader2
        v-if="deleteMutation.isPending.value"
        class="h-3.5 w-3.5 animate-spin"
      />
      <Trash2 v-else class="h-3.5 w-3.5" />
      Delete
    </Button>
  </section>
</template>
