<script setup lang="ts">
import { useElementSize } from '@vueuse/core';
import { ArrowDown, ArrowUp, Trash2 } from '@lucide/vue';
import { computed, onBeforeUnmount, ref, useTemplateRef } from 'vue';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogCloseButton,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { useWorkflowStore } from '../../stores/workflowStore';
import type { LayoutBox, LayoutBoxKind } from '../../types/workflow';
import { layoutCanvasSize } from '../../utils/mossLayout';

defineProps<{ open: boolean }>();
const emit = defineEmits<{ (e: 'update:open', value: boolean): void }>();

type DragMode = 'draw' | 'move' | 'resize';
interface Drag {
  mode: DragMode;
  box: LayoutBox;
  originX: number;
  originY: number;
  start: Pick<LayoutBox, 'x' | 'y' | 'width' | 'height'>;
}

const MIN_BOX_SIZE = 0.02;
const BOX_KINDS: { value: LayoutBoxKind; label: string; tone: string }[] = [
  { value: 'object', label: 'Object', tone: 'border-primary bg-primary/10' },
  {
    value: 'character',
    label: 'Character',
    tone: 'border-emerald-500 bg-emerald-500/10'
  },
  { value: 'text', label: 'Text', tone: 'border-amber-500 bg-amber-500/10' }
];

const workflowStore = useWorkflowStore();
const boxes = computed(() => workflowStore.moss.layoutBoxes);
const canvasSize = computed(() =>
  layoutCanvasSize({
    imageInput: workflowStore.imageInput,
    resolution: workflowStore.resolution
  })
);

const stage = useTemplateRef<HTMLElement>('stage');
const canvas = useTemplateRef<HTMLElement>('canvas');
const { width: stageWidth, height: stageHeight } = useElementSize(stage);
const canvasStyle = computed(() => {
  const { width, height } = canvasSize.value;
  const scale = Math.min(stageWidth.value / width, stageHeight.value / height);
  return { width: `${width * scale}px`, height: `${height * scale}px` };
});

const selectedId = ref<string | null>(null);
let drag: Drag | null = null;

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

function toneOf(kind: LayoutBoxKind) {
  return BOX_KINDS.find((option) => option.value === kind)?.tone;
}

function boxStyle(box: LayoutBox) {
  return {
    left: `${box.x * 100}%`,
    top: `${box.y * 100}%`,
    width: `${box.width * 100}%`,
    height: `${box.height * 100}%`
  };
}

function pointerPosition(event: PointerEvent) {
  const rect = canvas.value?.getBoundingClientRect();
  if (!rect) return { x: 0, y: 0 };
  return {
    x: clamp((event.clientX - rect.left) / rect.width, 0, 1),
    y: clamp((event.clientY - rect.top) / rect.height, 0, 1)
  };
}

function handlePointerMove(event: PointerEvent) {
  if (!drag) return;
  const { box, start, originX, originY } = drag;
  const point = pointerPosition(event);
  if (drag.mode === 'move') {
    box.x = clamp(start.x + point.x - originX, 0, 1 - start.width);
    box.y = clamp(start.y + point.y - originY, 0, 1 - start.height);
  } else if (drag.mode === 'resize') {
    box.width = clamp(
      start.width + point.x - originX,
      MIN_BOX_SIZE,
      1 - start.x
    );
    box.height = clamp(
      start.height + point.y - originY,
      MIN_BOX_SIZE,
      1 - start.y
    );
  } else {
    box.x = Math.min(originX, point.x);
    box.y = Math.min(originY, point.y);
    box.width = Math.abs(point.x - originX);
    box.height = Math.abs(point.y - originY);
  }
}

function stopDrag() {
  window.removeEventListener('pointermove', handlePointerMove);
  window.removeEventListener('pointerup', stopDrag);
  const finished = drag;
  drag = null;
  if (
    finished?.mode === 'draw' &&
    (finished.box.width < MIN_BOX_SIZE || finished.box.height < MIN_BOX_SIZE)
  ) {
    removeBox(boxes.value.indexOf(finished.box));
  }
}

function beginDrag(mode: DragMode, box: LayoutBox, event: PointerEvent) {
  if (event.button !== 0) return;
  const point = pointerPosition(event);
  selectedId.value = box.id;
  drag = {
    mode,
    box,
    originX: point.x,
    originY: point.y,
    start: { x: box.x, y: box.y, width: box.width, height: box.height }
  };
  window.addEventListener('pointermove', handlePointerMove);
  window.addEventListener('pointerup', stopDrag);
}

function startDrawing(event: PointerEvent) {
  if (event.button !== 0) return;
  const { x, y } = pointerPosition(event);
  boxes.value.push({
    id: crypto.randomUUID(),
    kind: 'object',
    x,
    y,
    width: 0,
    height: 0,
    caption: '',
    text: ''
  });
  const box = boxes.value.at(-1);
  if (box) beginDrag('draw', box, event);
}

function removeBox(index: number) {
  if (index < 0) return;
  const [removed] = boxes.value.splice(index, 1);
  if (removed?.id === selectedId.value) selectedId.value = null;
}

function moveBox(index: number, offset: -1 | 1) {
  const target = index + offset;
  if (target < 0 || target >= boxes.value.length) return;
  const [box] = boxes.value.splice(index, 1);
  if (box) boxes.value.splice(target, 0, box);
}

function clearBoxes() {
  boxes.value.splice(0);
  selectedId.value = null;
}

onBeforeUnmount(stopDrag);
</script>

<template>
  <Dialog :open="open" @update:open="(value) => emit('update:open', value)">
    <DialogContent class="flex h-[90vh] min-w-[80vw] flex-col">
      <DialogHeader class="flex-row items-start justify-between gap-3">
        <div class="flex flex-col gap-2">
          <DialogTitle>MOSS-Image Layout</DialogTitle>
          <DialogDescription>
            Drag on the canvas to draw a box, drag a box to move it, drag its
            corner to resize, and press Delete to remove the selected box. Boxes
            render in order, so put the background first and foreground last.
          </DialogDescription>
        </div>
        <DialogCloseButton class="-mt-1.5 -mr-2" />
      </DialogHeader>

      <div class="flex min-h-0 flex-1 gap-4">
        <!-- Canvas -->
        <div
          ref="stage"
          class="bg-muted/30 flex min-w-0 flex-1 items-center justify-center overflow-hidden rounded-lg border p-4"
        >
          <div
            ref="canvas"
            class="bg-background relative cursor-crosshair touch-none overflow-hidden rounded-md border shadow-sm select-none"
            :style="canvasStyle"
            @pointerdown="startDrawing"
          >
            <div
              v-for="(box, index) in boxes"
              :key="box.id"
              tabindex="0"
              :aria-label="`Layout box ${index + 1}, press Delete to remove`"
              class="absolute cursor-move border-2 outline-none"
              :class="[
                toneOf(box.kind),
                selectedId === box.id && 'ring-ring ring-2 ring-offset-1'
              ]"
              :style="boxStyle(box)"
              @focus="selectedId = box.id"
              @keydown.delete.prevent="removeBox(index)"
              @pointerdown.stop="beginDrag('move', box, $event)"
            >
              <span
                class="bg-background/90 absolute top-0 left-0 rounded-br px-1 font-mono text-xs font-bold"
              >
                {{ index + 1 }}
              </span>
              <span
                class="bg-foreground/80 absolute right-0 bottom-0 size-3 cursor-se-resize"
                aria-hidden="true"
                @pointerdown.stop="beginDrag('resize', box, $event)"
              />
            </div>
          </div>
        </div>

        <!-- Box List -->
        <aside class="flex w-80 shrink-0 flex-col gap-2">
          <div class="flex items-center justify-between">
            <span
              class="text-muted-foreground text-xs font-bold tracking-wider uppercase"
            >
              Boxes · {{ canvasSize.width }} × {{ canvasSize.height }}
            </span>
            <Button
              size="sm"
              variant="ghost"
              class="hover:text-destructive h-7 px-2 text-xs"
              :disabled="boxes.length === 0"
              @click="clearBoxes"
            >
              Clear all
            </Button>
          </div>

          <p
            v-if="boxes.length === 0"
            class="text-muted-foreground rounded-lg border border-dashed p-4 text-center text-xs"
          >
            No boxes yet. Draw one on the canvas.
          </p>

          <ScrollArea v-else class="min-h-0 flex-1 pr-2">
            <div class="flex flex-col gap-2">
              <div
                v-for="(box, index) in boxes"
                :key="box.id"
                class="flex flex-col gap-2 rounded-lg border p-2.5 transition-colors"
                :class="
                  selectedId === box.id
                    ? 'border-primary/60 bg-primary/5'
                    : 'border-border'
                "
                @focusin="selectedId = box.id"
                @click="selectedId = box.id"
              >
                <div class="flex items-center gap-1.5">
                  <span class="w-6 font-mono text-xs font-bold">
                    #{{ index + 1 }}
                  </span>
                  <Select v-model="box.kind">
                    <SelectTrigger
                      size="sm"
                      class="h-7 flex-1 text-xs"
                      :aria-label="`Box ${index + 1} type`"
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectGroup class="max-h-40 overflow-y-auto">
                        <SelectItem
                          v-for="option in BOX_KINDS"
                          :key="option.value"
                          :value="option.value"
                          class="text-xs"
                        >
                          {{ option.label }}
                        </SelectItem>
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                  <Button
                    size="iconSm"
                    variant="ghost"
                    :disabled="index === 0"
                    :aria-label="`Move box ${index + 1} up`"
                    @click.stop="moveBox(index, -1)"
                  >
                    <ArrowUp class="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    size="iconSm"
                    variant="ghost"
                    :disabled="index === boxes.length - 1"
                    :aria-label="`Move box ${index + 1} down`"
                    @click.stop="moveBox(index, 1)"
                  >
                    <ArrowDown class="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    size="iconSm"
                    variant="ghost"
                    class="hover:text-destructive"
                    :aria-label="`Delete box ${index + 1}`"
                    @click.stop="removeBox(index)"
                  >
                    <Trash2 class="h-3.5 w-3.5" />
                  </Button>
                </div>

                <div v-if="box.kind === 'text'" class="flex flex-col gap-1">
                  <Label :for="`box-text-${box.id}`" class="text-xs">
                    Text to render
                  </Label>
                  <Textarea
                    :id="`box-text-${box.id}`"
                    v-model="box.text"
                    :rows="2"
                    placeholder="Exact wording, line breaks kept"
                    class="min-h-12 text-xs"
                  />
                </div>

                <div class="flex flex-col gap-1">
                  <Label :for="`box-caption-${box.id}`" class="text-xs">
                    {{ box.kind === 'text' ? 'Typography' : 'Description' }}
                  </Label>
                  <Textarea
                    :id="`box-caption-${box.id}`"
                    v-model="box.caption"
                    :rows="3"
                    :placeholder="
                      box.kind === 'text'
                        ? 'Typeface, color, size, surface…'
                        : 'What appears inside this box…'
                    "
                    class="min-h-16 text-xs"
                  />
                </div>
              </div>
            </div>
          </ScrollArea>
        </aside>
      </div>
    </DialogContent>
  </Dialog>
</template>
