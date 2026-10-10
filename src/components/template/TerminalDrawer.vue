<script setup lang="ts">
import { computed, ref } from 'vue';
import { useLocalStorage } from '@vueuse/core';
import { ArrowDown, Copy, Pause, Terminal, Trash2 } from '@lucide/vue';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  MessageScrollerContent,
  MessageScrollerViewport
} from '@/components/ui/message-scroller';
import { provideMessageScroller } from '@/components/ui/message-scroller/useMessageScroller';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle
} from '@/components/ui/sheet';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { useLauncherStore } from '../../stores/launcherStore';
import { getLogLevel, parseAnsiToSpans } from '../../utils/logFormatter';

const launcherStore = useLauncherStore();
const filterText = ref('');
const streamFilter = ref<'all' | 'stdout' | 'stderr' | 'system'>('all');
const autoScroll = ref(true);
const { context: terminalScroll } = provideMessageScroller({
  get autoScroll() {
    return autoScroll.value;
  }
});
const isFollowing = computed(
  () => autoScroll.value && !terminalScroll.scrollable.value.end
);
const MAX_VISIBLE_LOGS = 500;

const filteredLogs = computed(() => {
  if (!launcherStore.isTerminalOpen) return [];
  const hasFilter = streamFilter.value !== 'all' || filterText.value.trim();
  const logs = hasFilter
    ? launcherStore.logs
    : launcherStore.logs.slice(-MAX_VISIBLE_LOGS);
  return logs.filter((log) => {
    if (streamFilter.value !== 'all' && log.stream !== streamFilter.value) {
      return false;
    }
    if (filterText.value.trim()) {
      return log.message.toLowerCase().includes(filterText.value.toLowerCase());
    }
    return true;
  });
});

// Toggle buttons live outside the sheet; without this the outside-pointerdown
// dismiss closes it and the button's click immediately reopens it.
function ignoreToggleButton(event: CustomEvent<{ originalEvent: Event }>) {
  const target = event.detail.originalEvent.target as Element | null;
  if (target?.closest('[data-terminal-toggle]')) event.preventDefault();
}

// Resizable height
const MIN_HEIGHT = 160;
const DEFAULT_HEIGHT_RATIO = 0.45;
const drawerHeight = useLocalStorage('terminal-drawer-height', 0);
const drawerStyle = computed(() => ({
  height: drawerHeight.value
    ? `${drawerHeight.value}px`
    : `${DEFAULT_HEIGHT_RATIO * 100}vh`
}));

function resizeBy(delta: number) {
  const current =
    drawerHeight.value || window.innerHeight * DEFAULT_HEIGHT_RATIO;
  setDrawerHeight(current + delta);
}

function setDrawerHeight(height: number) {
  drawerHeight.value = Math.round(
    Math.min(Math.max(height, MIN_HEIGHT), window.innerHeight * 0.85)
  );
}

function startResize(event: PointerEvent) {
  event.preventDefault();
  const handle = event.currentTarget as HTMLElement;
  handle.setPointerCapture(event.pointerId);
  const onMove = (move: PointerEvent) =>
    setDrawerHeight(window.innerHeight - move.clientY);
  handle.addEventListener('pointermove', onMove);
  handle.addEventListener(
    'lostpointercapture',
    () => handle.removeEventListener('pointermove', onMove),
    { once: true }
  );
}

function toggleAutoScroll() {
  autoScroll.value = !isFollowing.value;
  if (autoScroll.value) terminalScroll.scrollToEnd();
}

function copyAllLogs() {
  const text = launcherStore.logs
    .map(
      (l) =>
        `[${new Date(l.timestamp).toLocaleTimeString()}] [${l.stream.toUpperCase()}] ${l.message}`
    )
    .join('\n');
  navigator.clipboard.writeText(text);
}
</script>

<template>
  <Sheet v-model:open="launcherStore.isTerminalOpen">
    <SheetContent
      side="bottom"
      class="border-border bg-sidebar text-foreground flex max-h-[85vh] min-h-40 flex-col gap-0 border-t p-0"
      :style="drawerStyle"
      @interact-outside="ignoreToggleButton"
    >
      <div
        role="separator"
        aria-orientation="horizontal"
        aria-label="Resize terminal"
        tabindex="0"
        title="Drag to resize"
        class="group focus-visible:outline-primary absolute inset-x-0 -top-1 z-10 flex h-2.5 cursor-row-resize touch-none justify-center outline-none focus-visible:outline-1"
        @pointerdown="startResize"
        @keydown.up.prevent="resizeBy(24)"
        @keydown.down.prevent="resizeBy(-24)"
      >
        <div
          class="bg-border group-hover:bg-primary/70 group-focus-visible:bg-primary/70 mt-1 h-1 w-12 rounded-full transition-colors"
        />
      </div>

      <SheetHeader class="border-border shrink-0 border-b px-4 py-2.5">
        <div class="flex items-center justify-between pr-6">
          <div class="flex items-center gap-3">
            <div class="flex items-center gap-2">
              <Terminal class="text-primary h-4 w-4" />
              <SheetTitle class="text-foreground text-xs font-bold">
                Terminal Logs
              </SheetTitle>
            </div>

            <Badge
              :variant="
                launcherStore.processStatus === 'running'
                  ? 'default'
                  : launcherStore.processStatus === 'starting'
                    ? 'secondary'
                    : 'outline'
              "
              class="text-xs"
            >
              {{ launcherStore.processStatus.toUpperCase() }}
            </Badge>
          </div>

          <div class="flex items-center gap-2">
            <!-- Filter Search -->
            <Input
              v-model="filterText"
              placeholder="Search logs..."
              class="border-border bg-secondary text-foreground h-7 w-36 px-2 py-0.5 text-xs"
            />

            <!-- Stream Type Filter -->
            <ToggleGroup
              type="single"
              :model-value="streamFilter"
              class="gap-1"
              @update:model-value="
                (val: any) => {
                  if (val)
                    streamFilter = val as
                      'all' | 'stdout' | 'stderr' | 'system';
                }
              "
            >
              <ToggleGroupItem
                value="all"
                size="sm"
                class="data-[state=on]:bg-primary data-[state=on]:text-primary-foreground h-6 px-2 text-xs"
              >
                All
              </ToggleGroupItem>
              <ToggleGroupItem
                value="stdout"
                size="sm"
                class="data-[state=on]:bg-primary data-[state=on]:text-primary-foreground h-6 px-2 text-xs"
              >
                Out
              </ToggleGroupItem>
              <ToggleGroupItem
                value="stderr"
                size="sm"
                class="data-[state=on]:bg-primary data-[state=on]:text-primary-foreground h-6 px-2 text-xs"
              >
                Err
              </ToggleGroupItem>
              <ToggleGroupItem
                value="system"
                size="sm"
                class="data-[state=on]:bg-primary data-[state=on]:text-primary-foreground h-6 px-2 text-xs"
              >
                Sys
              </ToggleGroupItem>
            </ToggleGroup>

            <!-- Auto-scroll toggle -->
            <Button
              size="iconSm"
              variant="ghost"
              :class="isFollowing ? 'text-primary' : 'text-muted-foreground'"
              :title="isFollowing ? 'Pause auto-scroll' : 'Follow latest logs'"
              :aria-label="
                isFollowing ? 'Pause auto-scroll' : 'Follow latest logs'
              "
              @click="toggleAutoScroll"
            >
              <ArrowDown v-if="isFollowing" class="h-3.5 w-3.5" />
              <Pause v-else class="h-3.5 w-3.5" />
            </Button>

            <!-- Copy All -->
            <Button
              size="iconSm"
              variant="ghost"
              title="Copy All Logs"
              class="text-muted-foreground hover:text-foreground"
              @click="copyAllLogs"
            >
              <Copy class="h-3.5 w-3.5" />
            </Button>

            <!-- Clear -->
            <Button
              size="iconSm"
              variant="ghost"
              title="Clear Logs"
              class="text-muted-foreground hover:text-destructive"
              @click="launcherStore.clearLogs"
            >
              <Trash2 class="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      </SheetHeader>

      <MessageScrollerViewport
        aria-label="Terminal logs"
        class="bg-background h-auto flex-1 p-3 font-mono text-xs leading-relaxed select-text"
      >
        <MessageScrollerContent class="gap-0">
          <div
            v-if="filteredLogs.length === 0"
            class="text-muted-foreground py-6 text-center italic"
          >
            No log output available. Start ComfyUI to see console logs.
          </div>

          <div
            v-for="log in filteredLogs"
            :key="log.id"
            class="border-border/20 hover:bg-muted/40 flex items-start gap-2 border-b py-0.5"
          >
            <span class="text-muted-foreground shrink-0 pt-0.5 text-xs">
              {{ new Date(log.timestamp).toLocaleTimeString() }}
            </span>
            <span
              class="shrink-0 rounded px-1.5 py-0.5 text-xs font-semibold uppercase"
              :class="{
                'border border-emerald-500/30 bg-emerald-500/10 text-emerald-400':
                  getLogLevel(log.stream, log.message) === 'stdout',
                'border border-sky-500/30 bg-sky-500/10 text-sky-400':
                  getLogLevel(log.stream, log.message) === 'info',
                'border border-amber-500/30 bg-amber-500/10 text-amber-400':
                  getLogLevel(log.stream, log.message) === 'warn',
                'border border-rose-500/30 bg-rose-500/10 text-rose-400':
                  getLogLevel(log.stream, log.message) === 'error',
                'border-primary/30 bg-primary/10 text-primary border':
                  getLogLevel(log.stream, log.message) === 'system'
              }"
            >
              {{ getLogLevel(log.stream, log.message).toUpperCase() }}
            </span>
            <span class="text-foreground flex-1 break-all whitespace-pre-wrap">
              <span
                v-for="(span, spanIndex) in parseAnsiToSpans(log.message)"
                :key="spanIndex"
                :class="
                  span.className ||
                  (getLogLevel(log.stream, log.message) === 'error'
                    ? 'text-destructive font-semibold'
                    : getLogLevel(log.stream, log.message) === 'warn'
                      ? 'text-amber-300'
                      : getLogLevel(log.stream, log.message) === 'system'
                        ? 'text-primary font-semibold'
                        : '')
                "
                >{{ span.text }}</span
              >
            </span>
          </div>
        </MessageScrollerContent>
      </MessageScrollerViewport>
    </SheetContent>
  </Sheet>
</template>
