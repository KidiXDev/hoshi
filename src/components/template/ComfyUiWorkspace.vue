<script setup lang="ts">
import {
  AlertCircle,
  Loader2,
  Play,
  RefreshCw,
  Terminal,
  Workflow
} from '@lucide/vue';
import { computed, useTemplateRef } from 'vue';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useComfyUiFrame } from '@/composables/useComfyUiWorkspace';
import { useConfirmDialog } from '@/composables/useConfirmDialog';
import { useComfyStore } from '@/stores/comfyStore';
import { useLauncherStore } from '@/stores/launcherStore';

const comfyStore = useComfyStore();
const launcherStore = useLauncherStore();
const frame = useTemplateRef<HTMLIFrameElement>('frame');
const { confirm } = useConfirmDialog();
const {
  src,
  loading,
  error,
  ready,
  bridgeChecking,
  loaded,
  pending,
  isOnline,
  reload,
  onLoad
} = useComfyUiFrame(frame, () => launcherStore.config.serverUrl);

const isStartingOrBooting = computed(() => {
  return (
    launcherStore.processStatus === 'starting' ||
    (launcherStore.processStatus === 'running' && !isOnline.value)
  );
});

async function retry() {
  if (!isOnline.value) return;
  if (
    loaded.value &&
    !(await confirm({
      title: 'Reload ComfyUI?',
      description:
        'Save your work in ComfyUI before reloading. Unsaved editor changes may be lost.',
      confirmLabel: 'Reload'
    }))
  )
    return;
  await reload();
}
</script>

<template>
  <section
    class="bg-background flex h-full min-h-0 flex-col"
    aria-label="ComfyUI editor"
  >
    <header
      class="border-border bg-card flex h-10 shrink-0 items-center justify-between gap-3 border-b px-4 text-xs select-none"
    >
      <div class="flex items-center gap-2 font-semibold">
        <Workflow class="text-muted-foreground h-3.5 w-3.5" />
        <span>ComfyUI</span>
      </div>

      <span
        class="text-muted-foreground flex min-w-0 flex-1 items-center gap-2"
        role="status"
      >
        <template v-if="!isOnline">
          <Loader2
            v-if="isStartingOrBooting"
            class="h-3 w-3 shrink-0 animate-spin text-amber-500"
          />
          <span v-else class="h-2 w-2 shrink-0 rounded-full bg-rose-500/80" />
          {{
            launcherStore.processStatus === 'starting'
              ? 'Starting ComfyUI process...'
              : launcherStore.processStatus === 'running'
                ? 'ComfyUI booting, waiting for API...'
                : launcherStore.processStatus === 'error'
                  ? 'ComfyUI failed to launch'
                  : 'ComfyUI API is offline'
          }}
        </template>
        <template v-else>
          <Loader2
            v-if="loading || pending"
            class="text-primary h-3 w-3 shrink-0 animate-spin"
          />
          <span
            v-else
            class="h-2 w-2 shrink-0 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.7)]"
          />
          {{
            pending
              ? 'Opening workflow…'
              : loading
                ? 'Connecting to ComfyUI…'
                : ''
          }}
        </template>
      </span>

      <Button
        variant="ghost"
        size="sm"
        :disabled="!isOnline || loading || !!pending"
        @click="retry"
      >
        <RefreshCw class="h-3 w-3" /> Reload
      </Button>
    </header>

    <p
      v-if="isOnline && loaded && !ready && !bridgeChecking"
      class="border-border text-muted-foreground border-b px-4 py-2 text-xs"
      role="status"
    >
      Workflow import needs the latest Koharu Bridge. Update the bridge and
      restart ComfyUI, then reload. You can still use the editor below.
    </p>

    <div
      v-if="!isOnline"
      class="flex flex-1 flex-col items-center justify-center p-6 text-center"
      role="status"
    >
      <div
        class="border-border bg-card/60 flex max-w-md flex-col items-center gap-4 rounded-2xl border p-8 shadow-xs backdrop-blur-xs"
      >
        <!-- Icon Container -->
        <div
          class="flex h-14 w-14 items-center justify-center rounded-2xl border shadow-inner transition-colors"
          :class="
            isStartingOrBooting
              ? 'border-amber-500/30 bg-amber-500/10 text-amber-500'
              : launcherStore.processStatus === 'error'
                ? 'border-rose-500/30 bg-rose-500/10 text-rose-500'
                : 'border-border bg-secondary/80 text-muted-foreground'
          "
        >
          <Loader2 v-if="isStartingOrBooting" class="h-7 w-7 animate-spin" />
          <AlertCircle
            v-else-if="launcherStore.processStatus === 'error'"
            class="h-7 w-7"
          />
          <Workflow v-else class="h-7 w-7 opacity-75" />
        </div>

        <!-- Title & Subtitle -->
        <div class="flex flex-col gap-1.5">
          <h2 class="text-foreground text-base font-semibold tracking-tight">
            {{
              launcherStore.processStatus === 'starting'
                ? 'Starting ComfyUI Server...'
                : launcherStore.processStatus === 'running'
                  ? 'Server Booting Up...'
                  : launcherStore.processStatus === 'error'
                    ? 'Server Launch Failed'
                    : 'ComfyUI API is Offline'
            }}
          </h2>
          <p class="text-muted-foreground text-xs leading-relaxed">
            {{
              launcherStore.processStatus === 'starting'
                ? 'The ComfyUI process is launching. The workspace will connect automatically as soon as the API is ready.'
                : launcherStore.processStatus === 'running'
                  ? 'The ComfyUI process is running. Waiting for the API to become ready. Connecting automatically...'
                  : launcherStore.processStatus === 'error'
                    ? 'The ComfyUI server encountered an error during launch. Check the terminal logs for details.'
                    : 'The ComfyUI API is currently offline. Start the server to load the original ComfyUI editor.'
            }}
          </p>
        </div>

        <!-- Server Metadata Card -->
        <div
          class="border-border bg-secondary/50 flex w-full flex-col gap-2 rounded-lg border px-3.5 py-2.5 text-left text-xs"
        >
          <div class="flex items-center justify-between">
            <span class="text-muted-foreground">Server URL</span>
            <code class="text-foreground font-mono text-xs">{{
              launcherStore.config.serverUrl
            }}</code>
          </div>
          <div class="flex items-center justify-between">
            <span class="text-muted-foreground">Process Status</span>
            <Badge
              variant="outline"
              class="text-xs font-medium capitalize"
              :class="{
                'border-emerald-500/30 bg-emerald-500/10 text-emerald-500':
                  comfyStore.isConnected,
                'border-amber-500/30 bg-amber-500/10 text-amber-500':
                  !comfyStore.isConnected && isStartingOrBooting,
                'border-rose-500/30 bg-rose-500/10 text-rose-500':
                  !comfyStore.isConnected &&
                  launcherStore.processStatus === 'error',
                'border-border text-muted-foreground':
                  !comfyStore.isConnected &&
                  !isStartingOrBooting &&
                  launcherStore.processStatus !== 'error'
              }"
            >
              {{
                launcherStore.processStatus === 'running' &&
                !comfyStore.isConnected
                  ? 'Booting API'
                  : launcherStore.processStatus
              }}
            </Badge>
          </div>
        </div>

        <!-- Setup warning if needed -->
        <p
          v-if="
            launcherStore.localSetupMessage &&
            launcherStore.processStatus === 'stopped'
          "
          class="text-left text-xs text-amber-500"
        >
          {{ launcherStore.localSetupMessage }}
        </p>

        <!-- Action Buttons -->
        <div class="flex flex-wrap items-center justify-center gap-2 pt-1">
          <Button
            v-if="
              launcherStore.processStatus === 'stopped' ||
              launcherStore.processStatus === 'error'
            "
            size="sm"
            class="cursor-pointer gap-1.5"
            @click="launcherStore.startServer()"
          >
            <Play class="h-3.5 w-3.5 fill-current" />
            Start Server
          </Button>

          <Button
            v-else-if="isStartingOrBooting"
            size="sm"
            variant="outline"
            disabled
            class="gap-1.5"
          >
            <Loader2 class="h-3.5 w-3.5 animate-spin text-amber-500" />
            Waiting for API...
          </Button>

          <Button
            size="sm"
            variant="outline"
            class="cursor-pointer gap-1.5"
            @click="launcherStore.isTerminalOpen = true"
          >
            <Terminal class="h-3.5 w-3.5" />
            Server Logs
          </Button>
        </div>

        <p class="text-muted-foreground/70 text-xs">
          Will automatically connect when the API is online.
        </p>
      </div>
    </div>

    <div
      v-else-if="error"
      class="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-sm"
      role="alert"
    >
      <p class="text-muted-foreground text-xs">{{ error }}</p>
      <Button variant="outline" size="sm" @click="retry"
        >Retry connection</Button
      >
    </div>

    <!-- Connected Iframe -->
    <iframe
      v-if="isOnline && src"
      ref="frame"
      :src="src"
      title="Original ComfyUI workflow editor"
      class="min-h-0 w-full flex-1 border-0"
      allow="clipboard-read; clipboard-write; fullscreen"
      @load="onLoad"
    />
  </section>
</template>
