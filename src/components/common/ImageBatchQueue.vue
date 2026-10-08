<script setup lang="ts">
import {
  AlertCircle,
  CheckCircle2,
  FileImage,
  Loader2,
  Plus,
  RefreshCw,
  Trash2
} from '@lucide/vue';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import ImageDropOverlay from './ImageDropOverlay.vue';
import ImageDropzone from './ImageDropzone.vue';
import { useImageDropZone } from '@/composables/useImageDropZone';
import { formatFileSize } from '@/utils/formatters';
import type { ImageBatchItem } from '@/types/imageBatch';
import { useTemplateRef } from 'vue';

defineProps<{
  items: ImageBatchItem[];
  selectedId: string | null;
  fill?: boolean;
  checkered?: boolean;
}>();
const emit = defineEmits<{
  select: [id: string];
  selectFiles: [];
  retry: [item: ImageBatchItem];
  remove: [item: ImageBatchItem];
  files: [files: File[]];
}>();
const dragging = useImageDropZone(
  useTemplateRef<HTMLElement>('queue'),
  (files) => emit('files', files)
);
</script>
<template>
  <section
    ref="queue"
    class="border-border bg-card relative flex flex-col gap-3 rounded-xl border p-4 shadow-2xs transition-colors"
    :class="[
      dragging ? 'border-primary ring-primary/40 bg-primary/5 ring-1' : '',
      fill ? 'min-h-0 flex-1' : 'shrink-0'
    ]"
  >
    <div class="flex shrink-0 items-center justify-between">
      <div class="flex items-center gap-2">
        <FileImage class="text-primary h-4 w-4" />
        <h3 class="text-xs font-bold tracking-wider uppercase">Image Queue</h3>
      </div>
      <div class="flex items-center gap-1.5">
        <Badge
          v-if="items.length > 0"
          variant="secondary"
          class="font-mono text-xs"
        >
          {{ items.length }} image{{ items.length > 1 ? 's' : '' }}
        </Badge>
        <Button
          variant="outline"
          size="sm"
          class="h-6.5 gap-1 px-2 text-xs"
          @click="emit('selectFiles')"
        >
          <Plus class="h-3 w-3" />
          <span>Add Images</span>
        </Button>
      </div>
    </div>

    <ImageDropOverlay v-if="dragging" compact />

    <ImageDropzone
      v-if="items.length === 0"
      :compact="!fill"
      :fill="fill"
      @select="emit('selectFiles')"
    />

    <!-- Items List -->
    <div
      v-else
      class="flex flex-col gap-2"
      :class="{ 'min-h-0 flex-1 overflow-y-auto pr-1': fill }"
    >
      <div
        v-for="item in items"
        :key="item.id"
        class="border-border bg-secondary/40 hover:bg-secondary/70 group flex cursor-pointer items-center gap-2.5 rounded-lg border p-2 transition-all"
        :class="
          selectedId === item.id ? 'border-primary ring-primary/30 ring-1' : ''
        "
        @click="emit('select', item.id)"
        role="button"
        tabindex="0"
        :aria-pressed="selectedId === item.id"
        @keydown.enter.self="emit('select', item.id)"
        @keydown.space.prevent.self="emit('select', item.id)"
      >
        <!-- Thumbnail -->
        <div
          class="bg-background relative h-11 w-11 shrink-0 overflow-hidden rounded-md border"
          :class="{ 'checkered-thumbnail': checkered }"
        >
          <img
            :src="item.resultUrl || item.previewUrl"
            :alt="item.file.name"
            class="h-full w-full object-cover"
          />
          <div
            v-if="item.status === 'uploading' || item.status === 'queued'"
            class="bg-background/80 absolute inset-0 flex items-center justify-center"
          >
            <Loader2 class="text-primary h-3.5 w-3.5 animate-spin" />
          </div>
          <CheckCircle2
            v-else-if="item.status === 'done'"
            class="absolute right-0.5 bottom-0.5 h-3.5 w-3.5 text-emerald-400"
          />
          <AlertCircle
            v-else-if="item.status === 'error'"
            class="text-destructive absolute right-0.5 bottom-0.5 h-3.5 w-3.5"
          />
        </div>

        <!-- Item Meta -->
        <div class="min-w-0 flex-1">
          <p class="truncate text-xs font-semibold">
            {{ item.file.name }}
          </p>
          <div
            class="text-muted-foreground flex items-center gap-1.5 font-mono text-xs"
          >
            <span>{{ formatFileSize(item.file.size) }}</span>
            <span v-if="item.width && item.height">•</span>
            <span v-if="item.width && item.height">
              {{ item.width }}×{{ item.height }}
            </span>
          </div>
        </div>

        <!-- Item Status / Actions -->
        <div class="flex items-center gap-1">
          <Badge
            v-if="item.status === 'done'"
            variant="outline"
            class="border-emerald-500/30 bg-emerald-500/10 text-xs text-emerald-400"
          >
            Done
          </Badge>
          <Badge
            v-else-if="item.status === 'queued' || item.status === 'uploading'"
            variant="outline"
            class="border-primary/30 bg-primary/10 text-primary text-xs"
          >
            Working
          </Badge>
          <Badge
            v-else-if="item.status === 'error'"
            variant="destructive"
            class="text-xs"
          >
            Error
          </Badge>

          <Button
            v-if="item.status === 'error'"
            size="iconSm"
            variant="ghost"
            class="h-7 w-7 text-amber-400 hover:text-amber-300"
            title="Retry image"
            @click.stop="emit('retry', item)"
          >
            <RefreshCw class="h-3.5 w-3.5" />
          </Button>

          <Button
            size="iconSm"
            variant="ghost"
            class="text-muted-foreground hover:text-destructive h-7 w-7 opacity-0 transition-opacity group-hover:opacity-100"
            title="Remove from queue"
            @click.stop="emit('remove', item)"
          >
            <Trash2 class="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      <!-- Mini Drop Cue at Bottom of List -->
      <button
        type="button"
        class="border-border/60 bg-secondary/20 hover:border-primary/40 hover:bg-primary/5 text-muted-foreground flex shrink-0 cursor-pointer items-center justify-center gap-1.5 rounded-lg border border-dashed p-2 text-center text-xs transition-colors"
        @click="emit('selectFiles')"
      >
        <Plus class="h-3 w-3" />
        <span>Drop more images or click to browse</span>
      </button>
    </div>
  </section>
</template>

<style scoped>
.checkered-thumbnail {
  background-image:
    linear-gradient(45deg, var(--border) 25%, transparent 25%),
    linear-gradient(-45deg, var(--border) 25%, transparent 25%),
    linear-gradient(45deg, transparent 75%, var(--border) 75%),
    linear-gradient(-45deg, transparent 75%, var(--border) 75%);
  background-size: 8px 8px;
  background-position:
    0 0,
    0 4px,
    4px -4px,
    -4px 0;
}
</style>
