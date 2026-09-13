<script setup lang="ts">
import mayaMascot from '@/assets/maya-mascot.png';
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { useRoute } from 'vue-router';
import {
  Copy,
  Folder,
  Loader2,
  Minus,
  Play,
  Square,
  Terminal,
  X
} from '@lucide/vue';
import { invoke } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import ServerStatusBadge from '../common/ServerStatusBadge.vue';
import { useAiStore } from '../../stores/aiStore';
import { useLauncherStore } from '../../stores/launcherStore';

const route = useRoute();
const launcherStore = useLauncherStore();
const aiStore = useAiStore();

const isMaximized = ref(false);
let unlistenResize: (() => void) | null = null;

const activeViewTitle = computed(() => {
  if (route.path.startsWith('/comfyui')) return 'ComfyUI Editor';
  if (route.path.startsWith('/danbooru-wiki')) return 'Danbooru Tag Wiki';
  if (route.path.startsWith('/server')) return 'Server Terminal';
  if (route.path.startsWith('/settings')) return 'Preferences';
  if (route.path.startsWith('/library')) return 'Library';
  if (route.path.startsWith('/booru')) return 'Booru Gallery';
  if (route.path.startsWith('/animadex')) return 'Animadex Explore';
  if (route.path.startsWith('/models/')) return 'Model Detail';
  if (route.path.startsWith('/models')) return 'Model Manager';
  if (route.path.startsWith('/civitai/model')) return 'Civitai Model Detail';
  if (route.path.startsWith('/civitai')) return 'Civitai Model Browser';
  if (route.path.startsWith('/viewer')) return 'Image Viewer';
  if (route.path.startsWith('/upscaler')) return 'Image Upscaler';
  if (route.path.startsWith('/remove-background')) return 'Remove Background';
  if (route.path.startsWith('/face-detailer')) return 'Face Detailer';
  return 'Workflow Generator';
});

async function openOutputFolder() {
  const workingDir = launcherStore.config.workingDir.replace(/[\\/]+$/u, '');
  if (!workingDir) return;
  const path = /[\\/]comfyui$/iu.test(workingDir)
    ? `${workingDir}\\output`
    : `${workingDir}\\ComfyUI\\output`;
  try {
    await invoke('show_in_folder', { path });
  } catch (error) {
    console.error('Failed to open output folder:', error);
  }
}

async function handleMinimize() {
  try {
    const appWindow = getCurrentWindow();
    await appWindow.minimize();
  } catch {
    // fallback
  }
}

async function handleToggleMaximize(event?: MouseEvent) {
  if (
    (event?.currentTarget as Element | null)?.matches('header') &&
    (event?.target as Element | null)?.closest('button')
  )
    return;
  try {
    const appWindow = getCurrentWindow();
    await appWindow.toggleMaximize();
    isMaximized.value = await appWindow.isMaximized();
  } catch {
    // fallback
  }
}

async function handleClose() {
  try {
    const appWindow = getCurrentWindow();
    await appWindow.close();
  } catch {
    // fallback
  }
}

onMounted(async () => {
  try {
    const appWindow = getCurrentWindow();
    isMaximized.value = await appWindow.isMaximized();
    unlistenResize = await appWindow.onResized(async () => {
      isMaximized.value = await appWindow.isMaximized();
    });
  } catch {
    // browser preview mode fallback
  }
});

onUnmounted(() => {
  if (unlistenResize) {
    unlistenResize();
  }
});
</script>

<template>
  <header
    data-tauri-drag-region
    class="border-border bg-card/95 text-foreground pointer-events-auto flex h-10 shrink-0 items-center justify-between border-b pl-2 backdrop-blur-md select-none"
    @dblclick="handleToggleMaximize"
  >
    <!-- Left: App Brand & View Breadcrumb -->
    <div class="flex items-center gap-2.5 pl-1" data-tauri-drag-region>
      <div class="flex items-center gap-1.5" data-tauri-drag-region>
        <span
          class="text-foreground font-mono text-xs font-bold tracking-tight uppercase"
        >
          ComfyUI
        </span>
        <span class="text-muted-foreground/60 text-xs">/</span>
        <span class="text-muted-foreground text-xs font-medium">
          {{ activeViewTitle }}
        </span>
      </div>
    </div>

    <!-- Center: Server Health & Draggable Space -->
    <div
      data-tauri-drag-region
      class="flex flex-1 items-center justify-center px-4"
    >
      <ServerStatusBadge />
    </div>

    <!-- Right: Quick Actions & Window Controls -->
    <div class="flex items-center gap-1.5 self-stretch">
      <!-- ComfyUI Process Toggle Button -->
      <button
        type="button"
        :title="
          launcherStore.processStatus === 'running'
            ? 'Stop ComfyUI'
            : launcherStore.processStatus === 'starting'
              ? 'Starting ComfyUI...'
              : launcherStore.processStatus === 'stopping'
                ? 'Stopping ComfyUI...'
                : 'Start ComfyUI'
        "
        :disabled="
          launcherStore.processStatus === 'starting' ||
          launcherStore.processStatus === 'stopping'
        "
        class="border-border bg-secondary inline-flex h-6.5 cursor-pointer items-center gap-1.5 rounded-md border px-2 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50"
        :class="{
          'text-rose-500 hover:bg-rose-500/15 hover:text-rose-400':
            launcherStore.processStatus === 'running',
          'text-amber-500':
            launcherStore.processStatus === 'starting' ||
            launcherStore.processStatus === 'stopping',
          'text-emerald-500 hover:bg-emerald-500/15 hover:text-emerald-400':
            launcherStore.processStatus !== 'running' &&
            launcherStore.processStatus !== 'starting' &&
            launcherStore.processStatus !== 'stopping'
        }"
        @click="
          launcherStore.processStatus === 'running'
            ? launcherStore.stopServer()
            : launcherStore.startServer()
        "
      >
        <Loader2
          v-if="
            launcherStore.processStatus === 'starting' ||
            launcherStore.processStatus === 'stopping'
          "
          class="h-3 w-3 animate-spin text-amber-500"
        />
        <Square
          v-else-if="launcherStore.processStatus === 'running'"
          class="h-2.5 w-2.5 fill-current"
        />
        <Play v-else class="h-3 w-3 fill-current" />
        <span class="hidden sm:inline">
          {{
            launcherStore.processStatus === 'running'
              ? 'Stop'
              : launcherStore.processStatus === 'starting'
                ? 'Starting'
                : launcherStore.processStatus === 'stopping'
                  ? 'Stopping'
                  : 'Start'
          }}
        </span>
      </button>

      <!-- Quick Output Folder Button -->
      <button
        type="button"
        title="Open Output Folder"
        class="border-border bg-secondary text-muted-foreground hover:bg-accent hover:text-foreground inline-flex h-6.5 cursor-pointer items-center gap-1.5 rounded-md border px-2 text-xs font-medium transition-colors"
        @click="openOutputFolder"
      >
        <Folder class="h-3 w-3" />
        <span class="hidden sm:inline">Output</span>
      </button>

      <!-- Quick Terminal Drawer Toggle -->
      <button
        type="button"
        title="Toggle Terminal Logs"
        class="border-border bg-secondary text-muted-foreground hover:bg-accent hover:text-foreground inline-flex h-6.5 cursor-pointer items-center gap-1.5 rounded-md border px-2 text-xs font-medium transition-colors"
        data-terminal-toggle
        @click="launcherStore.isTerminalOpen = !launcherStore.isTerminalOpen"
      >
        <Terminal class="h-3 w-3" />
        <span class="hidden sm:inline">Logs</span>
      </button>

      <!-- AI Assistant Drawer Toggle Button (Icon only) -->
      <button
        type="button"
        title="Toggle Maya AI Assistant"
        class="border-border inline-flex h-6.5 w-6.5 cursor-pointer items-center justify-center rounded-md border transition-colors"
        :class="
          aiStore.isDrawerOpen
            ? 'border-primary/50 bg-primary/20 text-primary'
            : 'bg-secondary text-muted-foreground hover:bg-accent hover:text-foreground'
        "
        @click="aiStore.isDrawerOpen = !aiStore.isDrawerOpen"
      >
        <img :src="mayaMascot" alt="Maya" class="h-5 w-5 object-contain" />
      </button>

      <div class="bg-border mx-1 h-3.5 w-px" />

      <!-- Window Control Buttons (Native Look & Feel) -->
      <div class="flex h-full items-center">
        <!-- Minimize -->
        <button
          type="button"
          title="Minimize"
          class="text-muted-foreground hover:bg-accent hover:text-foreground inline-flex h-full w-11 cursor-pointer items-center justify-center transition-colors"
          @click="handleMinimize"
        >
          <Minus class="h-3.5 w-3.5" />
        </button>

        <!-- Maximize / Restore -->
        <button
          type="button"
          :title="isMaximized ? 'Restore' : 'Maximize'"
          class="text-muted-foreground hover:bg-accent hover:text-foreground inline-flex h-full w-11 cursor-pointer items-center justify-center transition-colors"
          @click="handleToggleMaximize"
        >
          <Copy v-if="isMaximized" class="h-3 w-3 rotate-90" />
          <Square v-else class="h-3 w-3" />
        </button>

        <!-- Close -->
        <button
          type="button"
          title="Close"
          class="text-muted-foreground inline-flex h-full w-11 cursor-pointer items-center justify-center transition-colors hover:bg-rose-600 hover:text-white"
          @click="handleClose"
        >
          <X class="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  </header>
</template>
