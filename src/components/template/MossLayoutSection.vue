<script setup lang="ts">
import {
  AlertCircle,
  LayoutDashboard,
  SquareDashedMousePointer
} from '@lucide/vue';
import { ref } from 'vue';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import LayoutEditorDialog from '../common/LayoutEditorDialog.vue';
import { useWorkflowStore } from '../../stores/workflowStore';

const workflowStore = useWorkflowStore();
const isEditorOpen = ref(false);
</script>

<template>
  <div class="flex flex-col gap-3">
    <div class="flex items-center justify-between">
      <div class="flex items-center gap-2">
        <div
          class="bg-primary/10 text-primary flex h-7 w-7 items-center justify-center rounded-lg"
        >
          <LayoutDashboard class="h-4 w-4" />
        </div>
        <div>
          <h3 class="text-xs font-bold tracking-wider uppercase">
            Layout Boxes
          </h3>
          <p class="text-muted-foreground text-xs">
            Place objects, characters and exact text with bounding boxes; the
            positive prompt becomes the scene caption
          </p>
        </div>
      </div>
      <Switch
        v-model="workflowStore.moss.layoutEnabled"
        aria-label="Enable layout boxes"
      />
    </div>

    <div
      v-if="workflowStore.moss.layoutEnabled"
      class="border-border bg-card/40 flex flex-col gap-2.5 rounded-xl border p-3"
    >
      <ol
        v-if="workflowStore.moss.layoutBoxes.length > 0"
        class="flex flex-col gap-1"
      >
        <li
          v-for="(box, index) in workflowStore.moss.layoutBoxes"
          :key="box.id"
          class="flex items-center gap-2 text-xs"
        >
          <span class="text-muted-foreground w-5 font-mono">
            {{ index + 1 }}
          </span>
          <Badge variant="outline" class="font-mono text-xs capitalize">
            {{ box.kind }}
          </Badge>
          <span class="text-muted-foreground min-w-0 flex-1 truncate">
            {{
              (box.kind === 'text' ? box.text : box.caption) || 'No description'
            }}
          </span>
        </li>
      </ol>

      <div
        v-else
        class="flex items-center gap-2 rounded-lg border border-amber-500/20 bg-amber-500/10 p-2.5 text-xs text-amber-400"
      >
        <AlertCircle class="h-4 w-4 shrink-0" />
        <span>
          No boxes yet. Without boxes the prompt is sent as a plain caption.
        </span>
      </div>

      <Button
        type="button"
        variant="outline"
        class="text-xs font-semibold"
        @click="isEditorOpen = true"
      >
        <SquareDashedMousePointer class="text-primary mr-1.5 h-3.5 w-3.5" />
        Edit Layout
      </Button>
    </div>

    <LayoutEditorDialog v-model:open="isEditorOpen" />
  </div>
</template>
