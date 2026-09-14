<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue';
import { Eraser, Paintbrush, Redo2, Trash2, Undo2 } from '@lucide/vue';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';
import {
  Dialog,
  DialogCloseButton,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog';

const props = defineProps<{
  open: boolean;
  imageUrl: string;
  maskUrl: string;
  maskOpacity: number;
}>();
const emit = defineEmits<{
  (event: 'update:open', open: boolean): void;
  (event: 'update:maskOpacity', opacity: number): void;
  (event: 'save', mask: Blob): void;
}>();

const baseCanvas = ref<HTMLCanvasElement>();
const maskCanvas = ref<HTMLCanvasElement>();
const canvasViewport = ref<HTMLDivElement>();
const brushSize = ref(48);
const brushHardness = ref(1);
const erasing = ref(false);
const isDrawing = ref(false);
const strokeErasing = ref(false);
const isPanning = ref(false);
const isCursorVisible = ref(false);
const cursorPosition = ref({ x: 0, y: 0 });
const displayWidth = ref(800);
const displayHeight = ref(600);
const zoom = ref(1);
const pan = ref({ x: 0, y: 0 });
const panStart = ref({ x: 0, y: 0, panX: 0, panY: 0 });
const undoStack = ref<ImageData[]>([]);
const redoStack = ref<ImageData[]>([]);
const adjustment = ref<{
  x: number;
  y: number;
  size: number;
  hardness: number;
} | null>(null);

const brushSizeModel = computed({
  get: () => [brushSize.value],
  set: ([value]: number[]) => {
    if (value !== undefined) brushSize.value = value;
  }
});
const brushHardnessModel = computed({
  get: () => [brushHardness.value],
  set: ([value]: number[]) => {
    if (value !== undefined) brushHardness.value = value;
  }
});
const maskOpacityModel = computed({
  get: () => [props.maskOpacity],
  set: ([value]: number[]) => {
    if (value !== undefined) emit('update:maskOpacity', value);
  }
});
const brushCursorStyle = computed(() => ({
  width: `${brushSize.value}px`,
  height: `${brushSize.value}px`,
  left: `${cursorPosition.value.x}px`,
  top: `${cursorPosition.value.y}px`
}));
const canvasViewportStyle = computed(() => ({
  width: `${displayWidth.value}px`,
  height: `${displayHeight.value}px`,
  transform: `translate(${pan.value.x}px, ${pan.value.y}px) scale(${zoom.value})`
}));

watch(
  () => props.open,
  (open) => {
    if (open) void nextTick(loadImage);
  }
);

function loadImage() {
  const base = baseCanvas.value;
  const mask = maskCanvas.value;
  if (!base || !mask || !props.imageUrl) return;
  const image = new Image();
  image.crossOrigin = 'anonymous';
  image.onload = () => {
    const scale = Math.min(
      900 / image.naturalWidth,
      620 / image.naturalHeight,
      1
    );
    displayWidth.value = Math.round(image.naturalWidth * scale);
    displayHeight.value = Math.round(image.naturalHeight * scale);
    for (const canvas of [base, mask]) {
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
    }
    base.getContext('2d')?.drawImage(image, 0, 0);
    const maskContext = mask.getContext('2d');
    maskContext?.clearRect(0, 0, mask.width, mask.height);
    if (props.maskUrl && maskContext) {
      const savedMask = new Image();
      savedMask.crossOrigin = 'anonymous';
      savedMask.onload = () => {
        maskContext.drawImage(savedMask, 0, 0, mask.width, mask.height);
        const pixels = maskContext.getImageData(0, 0, mask.width, mask.height);
        for (let index = 0; index < pixels.data.length; index += 4) {
          pixels.data[index + 3] = pixels.data[index];
          pixels.data[index] = 255;
          pixels.data[index + 1] = 255;
          pixels.data[index + 2] = 255;
        }
        maskContext.putImageData(pixels, 0, 0);
      };
      savedMask.src = props.maskUrl;
    }
    undoStack.value = [];
    redoStack.value = [];
    zoom.value = 1;
    pan.value = { x: 0, y: 0 };
  };
  image.src = props.imageUrl;
}

function point(event: PointerEvent) {
  const canvas = maskCanvas.value;
  if (!canvas) return { x: 0, y: 0, scale: 1 };
  const rect = canvas.getBoundingClientRect();
  return {
    x: ((event.clientX - rect.left) / rect.width) * canvas.width,
    y: ((event.clientY - rect.top) / rect.height) * canvas.height,
    scale: canvas.width / rect.width
  };
}

function updateCursor(event: Pick<PointerEvent, 'clientX' | 'clientY'>) {
  const viewport = canvasViewport.value;
  if (!viewport) return;
  const rect = viewport.getBoundingClientRect();
  cursorPosition.value = {
    x: event.clientX - rect.left,
    y: event.clientY - rect.top
  };
  isCursorVisible.value = true;
}

function hideCursor() {
  if (!isDrawing.value && !adjustment.value && !isPanning.value)
    isCursorVisible.value = false;
}

function adjustZoom(event: WheelEvent) {
  zoom.value = Math.max(0.25, Math.min(4, zoom.value - event.deltaY * 0.001));
  void nextTick(() => updateCursor(event));
}

function saveHistory() {
  const canvas = maskCanvas.value;
  const context = canvas?.getContext('2d');
  if (!canvas || !context) return;
  undoStack.value.push(context.getImageData(0, 0, canvas.width, canvas.height));
  if (undoStack.value.length > 20) undoStack.value.shift();
  redoStack.value = [];
}

function undo() {
  const canvas = maskCanvas.value;
  const context = canvas?.getContext('2d');
  const snapshot = undoStack.value.pop();
  if (!canvas || !context || !snapshot) return;
  redoStack.value.push(context.getImageData(0, 0, canvas.width, canvas.height));
  context.putImageData(snapshot, 0, 0);
}

function redo() {
  const canvas = maskCanvas.value;
  const context = canvas?.getContext('2d');
  const snapshot = redoStack.value.pop();
  if (!canvas || !context || !snapshot) return;
  undoStack.value.push(context.getImageData(0, 0, canvas.width, canvas.height));
  context.putImageData(snapshot, 0, 0);
}

function startDrawing(event: PointerEvent) {
  const canvas = maskCanvas.value;
  if (!canvas) return;
  event.preventDefault();

  if (event.button === 1) {
    canvas.setPointerCapture(event.pointerId);
    isPanning.value = true;
    isCursorVisible.value = false;
    panStart.value = {
      x: event.clientX,
      y: event.clientY,
      panX: pan.value.x,
      panY: pan.value.y
    };
    return;
  }

  updateCursor(event);

  canvas.setPointerCapture(event.pointerId);
  if (event.altKey && event.button === 2) {
    adjustment.value = {
      x: event.clientX,
      y: event.clientY,
      size: brushSize.value,
      hardness: brushHardness.value
    };
    return;
  }

  if (event.button !== 0 && event.button !== 2) return;
  saveHistory();
  isDrawing.value = true;
  strokeErasing.value = event.button === 2 || erasing.value;
  const { x, y, scale } = point(event);
  const context = canvas.getContext('2d');
  if (!context) return;
  context.beginPath();
  context.moveTo(x, y);
  context.lineCap = 'round';
  context.lineJoin = 'round';
  context.lineWidth = brushSize.value * scale;
  context.strokeStyle = '#ffffff';
  context.globalAlpha = 1;
  context.shadowColor = strokeErasing.value ? 'transparent' : '#ffffff';
  context.shadowBlur = (1 - brushHardness.value) * context.lineWidth;
  context.globalCompositeOperation = strokeErasing.value
    ? 'destination-out'
    : 'source-over';
  context.lineTo(x, y);
  context.stroke();
}

function draw(event: PointerEvent) {
  if (isPanning.value) {
    pan.value = {
      x: panStart.value.panX + event.clientX - panStart.value.x,
      y: panStart.value.panY + event.clientY - panStart.value.y
    };
    return;
  }
  if (adjustment.value) {
    const deltaX = event.clientX - adjustment.value.x;
    const deltaY = adjustment.value.y - event.clientY;
    brushSize.value = Math.round(
      Math.max(8, Math.min(180, adjustment.value.size + deltaX / 2))
    );
    const value = Math.max(
      0.05,
      Math.min(1, adjustment.value.hardness + deltaY / 200)
    );
    brushHardness.value = value;
    return;
  }
  updateCursor(event);
  if (!isDrawing.value) return;
  const context = maskCanvas.value?.getContext('2d');
  if (!context) return;
  const { x, y } = point(event);
  context.lineTo(x, y);
  context.stroke();
}

function stopDrawing() {
  adjustment.value = null;
  isDrawing.value = false;
  isPanning.value = false;
  strokeErasing.value = false;
  maskCanvas.value?.getContext('2d')?.closePath();
}

function clearMask() {
  const canvas = maskCanvas.value;
  if (canvas) {
    saveHistory();
    canvas.getContext('2d')?.clearRect(0, 0, canvas.width, canvas.height);
  }
}

function saveMask() {
  const mask = maskCanvas.value;
  if (!mask) return;
  const output = document.createElement('canvas');
  output.width = mask.width;
  output.height = mask.height;
  const context = output.getContext('2d');
  if (!context) return;
  context.fillStyle = '#000000';
  context.fillRect(0, 0, output.width, output.height);
  const alphaMask = document.createElement('canvas');
  alphaMask.width = mask.width;
  alphaMask.height = mask.height;
  const alphaContext = alphaMask.getContext('2d');
  if (!alphaContext) return;
  alphaContext.fillStyle = '#ffffff';
  alphaContext.fillRect(0, 0, alphaMask.width, alphaMask.height);
  alphaContext.globalCompositeOperation = 'destination-in';
  alphaContext.drawImage(mask, 0, 0);
  context.drawImage(alphaMask, 0, 0);
  output.toBlob((blob) => blob && emit('save', blob), 'image/png');
}

function handleShortcut(event: KeyboardEvent) {
  if (!props.open) return;
  if (event.key === 'Alt') {
    event.preventDefault();
    return;
  }
  if (!(event.ctrlKey || event.metaKey)) return;
  if (event.key.toLowerCase() === 'z') {
    event.preventDefault();
    if (event.shiftKey) redo();
    else undo();
  } else if (event.key.toLowerCase() === 'y') {
    event.preventDefault();
    redo();
  }
}

window.addEventListener('keydown', handleShortcut);
onBeforeUnmount(() => window.removeEventListener('keydown', handleShortcut));
</script>

<template>
  <Dialog :open="open" @update:open="(value) => emit('update:open', value)">
    <DialogContent class="flex max-h-[94vh] min-w-[80vw] flex-col">
      <DialogHeader class="flex-row items-start justify-between gap-3">
        <div class="flex flex-col gap-2">
          <DialogTitle>Paint Inpainting Mask</DialogTitle>
          <DialogDescription>
            White regenerates; black preserves. Alt + right-drag adjusts brush
            size and hardness. Scroll to zoom; middle-drag to pan.
          </DialogDescription>
        </div>
        <DialogCloseButton class="-mt-1.5 -mr-2" />
      </DialogHeader>

      <div
        class="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-4 rounded-lg border p-2"
      >
        <div class="flex items-center gap-1.5">
          <Button
            size="sm"
            :variant="erasing ? 'outline' : 'default'"
            @click="erasing = false"
          >
            <Paintbrush class="h-3.5 w-3.5" /> Paint White
          </Button>
          <Button
            size="sm"
            :variant="erasing ? 'default' : 'outline'"
            @click="erasing = true"
          >
            <Eraser class="h-3.5 w-3.5" /> Erase
          </Button>
        </div>

        <div class="grid grid-cols-2 gap-4">
          <Label
            class="text-muted-foreground grid grid-cols-[auto_1fr_auto] items-center gap-2 text-xs"
          >
            Brush
            <Slider v-model="brushSizeModel" :min="8" :max="180" :step="1" />
            <span class="w-8 font-mono">{{ brushSize }}</span>
          </Label>
          <Label
            class="text-muted-foreground grid grid-cols-[auto_1fr_auto] items-center gap-2 text-xs"
          >
            Hardness
            <Slider
              v-model="brushHardnessModel"
              :min="0.05"
              :max="1"
              :step="0.05"
            />
            <span class="w-8 font-mono"
              >{{ Math.round(brushHardness * 100) }}%</span
            >
          </Label>
          <Label
            class="text-muted-foreground col-span-2 grid grid-cols-[auto_1fr_auto] items-center gap-2 text-xs"
          >
            Opacity
            <Slider v-model="maskOpacityModel" :min="0" :max="1" :step="0.05" />
            <span class="w-8 font-mono"
              >{{ Math.round(maskOpacity * 100) }}%</span
            >
          </Label>
        </div>

        <div class="flex items-center justify-end gap-1">
          <Button
            size="sm"
            variant="ghost"
            :disabled="undoStack.length === 0"
            @click="undo"
          >
            <Undo2 class="h-3.5 w-3.5" /> Undo
          </Button>
          <Button
            size="sm"
            variant="ghost"
            :disabled="redoStack.length === 0"
            @click="redo"
          >
            <Redo2 class="h-3.5 w-3.5" /> Redo
          </Button>
          <Button size="sm" variant="ghost" @click="clearMask">
            <Trash2 class="h-3.5 w-3.5" /> Clear
          </Button>
        </div>
      </div>

      <div
        ref="canvasViewport"
        class="bg-muted/40 relative flex min-h-0 flex-1 items-center justify-center overflow-hidden rounded-lg border p-2"
        @wheel.prevent="adjustZoom"
      >
        <div
          class="relative shrink-0 origin-center rounded-md"
          :style="canvasViewportStyle"
        >
          <canvas
            ref="baseCanvas"
            class="absolute inset-0 h-full w-full object-contain"
          />
          <canvas
            ref="maskCanvas"
            class="absolute inset-0 h-full w-full cursor-none touch-none"
            :style="{ opacity: maskOpacity }"
            @pointerdown="startDrawing"
            @pointermove="draw"
            @pointerup="stopDrawing"
            @pointercancel="stopDrawing"
            @pointerenter="updateCursor"
            @pointerleave="hideCursor"
            @contextmenu.prevent
          />
        </div>
        <div
          v-if="isCursorVisible"
          class="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-1/2 rounded-full border border-black"
          :style="brushCursorStyle"
        />
      </div>

      <div class="flex justify-end gap-2">
        <Button variant="outline" @click="emit('update:open', false)">
          Cancel
        </Button>
        <Button @click="saveMask">Use Mask</Button>
      </div>
    </DialogContent>
  </Dialog>
</template>
