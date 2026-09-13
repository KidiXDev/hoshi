<script setup lang="ts">
/**
 * "Set / replace preview" dropdown: from a local image file, or from a Civitai
 * sample URL supplied by the host (the current carousel image, for instance).
 */
import {
  ChevronDown,
  CloudDownload,
  FolderOpen,
  Image as ImageIcon,
  Loader2
} from '@lucide/vue';
import { toast } from 'vue-sonner';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu';
import { useSetModelPreviewMutation } from '@/composables/useModelManagerQueries';
import { pickPreviewImageFile, type LocalModel } from '@/services/modelManager';

const props = defineProps<{
  model: LocalModel;
  /** Civitai sample image to offer as preview (must be an image, not video). */
  sampleUrl?: string;
  sampleLabel?: string;
}>();

const previewMutation = useSetModelPreviewMutation();

async function fromFile() {
  const path = await pickPreviewImageFile(props.model.path);
  if (!path) return;
  await apply({ kind: 'localPath', path });
}

async function fromSample() {
  if (!props.sampleUrl) return;
  await apply({ kind: 'url', url: props.sampleUrl });
}

async function apply(
  source: { kind: 'localPath'; path: string } | { kind: 'url'; url: string }
) {
  try {
    await previewMutation.mutateAsync({ id: props.model.id, source });
    toast.success('Preview updated');
  } catch (error) {
    toast.error(`Preview update failed: ${String(error)}`);
  }
}
</script>

<template>
  <DropdownMenu>
    <DropdownMenuTrigger as-child>
      <Button
        variant="outline"
        size="sm"
        class="h-8 gap-1.5 text-xs"
        :disabled="previewMutation.isPending.value"
      >
        <Loader2
          v-if="previewMutation.isPending.value"
          class="h-3.5 w-3.5 animate-spin"
        />
        <ImageIcon v-else class="h-3.5 w-3.5" />
        <span>{{ model.previewPath ? 'Replace preview' : 'Set preview' }}</span>
        <ChevronDown class="h-3 w-3 opacity-70" />
      </Button>
    </DropdownMenuTrigger>
    <DropdownMenuContent align="end" class="w-60">
      <DropdownMenuItem @click="fromFile">
        <FolderOpen /> From image file…
      </DropdownMenuItem>
      <DropdownMenuItem :disabled="!sampleUrl" @click="fromSample">
        <CloudDownload /> {{ sampleLabel ?? 'From Civitai sample' }}
      </DropdownMenuItem>
    </DropdownMenuContent>
  </DropdownMenu>
</template>
