<script setup lang="ts">
import { listen } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { AlertTriangle, Loader2 } from '@lucide/vue';
import {
  computed,
  defineAsyncComponent,
  onMounted,
  onUnmounted,
  ref,
  watch
} from 'vue';
import { RouterView, useRoute } from 'vue-router';
import ConfirmDialogProvider from '@/components/common/ConfirmDialogProvider.vue';
import AppSidebar from '@/components/template/AppSidebar.vue';
import AppTitlebar from '@/components/template/AppTitlebar.vue';
import AiAssistantDrawer from '@/components/template/AiAssistantDrawer.vue';
import TerminalDrawer from '@/components/template/TerminalDrawer.vue';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogCloseButton,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog';
import { TooltipProvider } from '@/components/ui/tooltip';
import { Toaster } from '@/components/ui/sonner';
import { BRAND_NAME } from '@/lib/brand';
import { useCivitaiStore } from './stores/civitaiStore';
import { useComfyStore } from './stores/comfyStore';
import { useDownloadStore } from './stores/downloadStore';
import { useLauncherStore } from './stores/launcherStore';
import { usePromptSuggestionStore } from './stores/promptSuggestionStore';
import { useWorkflowStore } from './stores/workflowStore';

const launcherStore = useLauncherStore();
const downloadStore = useDownloadStore();
const comfyStore = useComfyStore();
useWorkflowStore();
const promptSuggestionStore = usePromptSuggestionStore();
const civitaiStore = useCivitaiStore();
const route = useRoute();
const ComfyUiWorkspace = defineAsyncComponent(
  () => import('@/components/template/ComfyUiWorkspace.vue')
);
const isComfyUi = computed(() => route.name === 'comfyui');
const comfyUiVisited = ref(false);
watch(
  isComfyUi,
  (active) => {
    if (active) comfyUiVisited.value = true;
  },
  { immediate: true }
);
const shutdownDialogOpen = ref(false);
const isShuttingDown = ref(false);
const shutdownError = ref('');
let unlistenClose: (() => void) | null = null;
let unlistenTrayQuit: (() => void) | null = null;

const isComfyRunning = computed(() =>
  ['starting', 'stopping', 'running'].includes(launcherStore.processStatus)
);
const downloadingCount = computed(
  () =>
    downloadStore.items.filter((item) =>
      ['active', 'waiting'].includes(item.status)
    ).length
);

function cancelShutdown() {
  if (!isShuttingDown.value) shutdownDialogOpen.value = false;
}

async function continueShutdown() {
  isShuttingDown.value = true;
  shutdownError.value = '';
  try {
    if (comfyStore.isGenerating) await comfyStore.interrupt();
    if (isComfyRunning.value) await launcherStore.stopServer();
    await getCurrentWindow().close();
  } catch (error) {
    shutdownError.value = String(error);
    isShuttingDown.value = false;
  }
}

onMounted(async () => {
  try {
    const appWindow = getCurrentWindow();
    let quitRequested = false;
    unlistenClose = await appWindow.onCloseRequested((event) => {
      const quitting = quitRequested;
      quitRequested = false;
      if (isShuttingDown.value) return;
      if (launcherStore.config.closeToTray && !quitting) {
        event.preventDefault();
        void appWindow.hide();
      } else if (isComfyRunning.value || downloadingCount.value > 0) {
        event.preventDefault();
        shutdownError.value = '';
        shutdownDialogOpen.value = true;
      }
    });
    unlistenTrayQuit = await listen('tray-quit', () => {
      quitRequested = true;
      void appWindow.close();
    });
  } catch {
    // Browser preview mode.
  }

  await launcherStore.initTauriListeners();
  void downloadStore.init();
  comfyStore.init();
  void promptSuggestionStore.init();
  void civitaiStore.init();
});

onUnmounted(() => {
  unlistenClose?.();
  unlistenTrayQuit?.();
  downloadStore.stop();
});
</script>

<template>
  <TooltipProvider :delay-duration="150">
    <ConfirmDialogProvider>
      <div
        class="bg-background text-foreground flex h-screen w-screen flex-col overflow-clip antialiased select-none"
      >
        <AppTitlebar />

        <div
          id="app-content"
          class="relative flex min-h-0 w-full flex-1 overflow-clip"
        >
          <!-- Icon-only Sidebar Rail -->
          <AppSidebar />

          <!-- Main Viewport Workspace -->
          <main class="flex h-full min-w-0 flex-1 flex-col overflow-clip">
            <ComfyUiWorkspace v-if="comfyUiVisited" v-show="isComfyUi" />
            <RouterView v-slot="{ Component }">
              <KeepAlive
                include="BooruGalleryView,CivitaiBrowserView,ImageViewerView,UpscalerView,RemoveBackgroundView,FaceDetailerView,AnimadexExploreView,DanbooruWikiView,ModelManagerView"
                :max="10"
              >
                <component :is="Component" />
              </KeepAlive>
            </RouterView>
          </main>
          <!-- Global Terminal Slide-over Drawer -->
          <TerminalDrawer />

          <!-- Global AI Assistant Slide-over Drawer -->
          <AiAssistantDrawer />

          <Dialog
            :open="shutdownDialogOpen"
            @update:open="(open) => !open && cancelShutdown()"
          >
            <DialogContent>
              <DialogHeader class="flex-row items-start justify-between gap-3">
                <div class="flex flex-col gap-2">
                  <div class="flex items-center gap-2">
                    <AlertTriangle class="h-5 w-5 text-amber-400" />
                    <DialogTitle>
                      {{
                        isComfyRunning
                          ? 'ComfyUI is still running'
                          : 'Downloads in progress'
                      }}
                    </DialogTitle>
                  </div>
                  <DialogDescription v-if="isComfyRunning">
                    Cancel generation and shut down ComfyUI?
                  </DialogDescription>
                  <DialogDescription v-if="downloadingCount > 0">
                    {{ downloadingCount }} download{{
                      downloadingCount > 1 ? 's' : ''
                    }}
                    will be paused and resume automatically the next time you
                    open {{ BRAND_NAME }}.
                  </DialogDescription>
                </div>
                <DialogCloseButton class="-mt-1.5 -mr-2" />
              </DialogHeader>

              <p v-if="shutdownError" class="text-destructive text-xs">
                {{ shutdownError }}
              </p>

              <DialogFooter>
                <Button
                  variant="outline"
                  :disabled="isShuttingDown"
                  @click="cancelShutdown"
                >
                  Cancel
                </Button>
                <Button :disabled="isShuttingDown" @click="continueShutdown">
                  <Loader2 v-if="isShuttingDown" class="h-4 w-4 animate-spin" />
                  {{ isShuttingDown ? 'Shutting down...' : 'Continue' }}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
          <Toaster position="bottom-right" theme="dark" richColors />
        </div>
      </div>
    </ConfirmDialogProvider>
  </TooltipProvider>
</template>
