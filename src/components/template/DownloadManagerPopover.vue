<script setup lang="ts">
import { computed, ref } from 'vue';
import { invoke } from '@tauri-apps/api/core';
import {
  CheckCircle2,
  CircleAlert,
  Download,
  FileQuestion,
  FolderOpen,
  Loader2,
  Pause,
  Play,
  Trash2,
  X
} from '@lucide/vue';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Popover,
  PopoverContent,
  PopoverTrigger
} from '@/components/ui/popover';
import { Progress } from '@/components/ui/progress';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import DownloadUrlForm from './DownloadUrlForm.vue';
import { formatFileSize, formatShortDate } from '@/utils/formatters';
import { useDownloadStore } from '@/stores/downloadStore';
import { useLauncherStore } from '@/stores/launcherStore';
import { loadAppData } from '@/services/appStorage';
import type { DownloadRecord } from '@/services/downloadManager';
import { isVideoMedia } from '@/services/civitai';

const downloadStore = useDownloadStore();
const launcherStore = useLauncherStore();

const activeTab = ref<'active' | 'history' | 'url'>('active');
const reDownloadingGids = ref<Set<string>>(new Set());

const activeDownloads = computed(() =>
  downloadStore.items.filter((item) =>
    ['active', 'waiting', 'paused'].includes(item.status)
  )
);

const historyDownloads = computed(() =>
  downloadStore.items.filter((item) =>
    ['complete', 'error', 'removed'].includes(item.status)
  )
);

function percent(item: DownloadRecord) {
  return item.totalLength
    ? Math.min(100, Math.round((item.completedLength / item.totalLength) * 100))
    : 0;
}

function statusLabel(item: DownloadRecord) {
  if (item.status === 'active')
    return `${formatFileSize(item.downloadSpeed)}/s`;
  if (item.status === 'complete') {
    if (item.fileExists === false) return 'Deleted from disk';
    return 'Completed';
  }
  if (item.status === 'paused') return 'Paused';
  if (item.status === 'waiting') return 'Queued';
  return item.errorMessage || 'Failed';
}

async function handleClearHistory() {
  await downloadStore.clearHistory();
}

async function handleRedownload(item: DownloadRecord) {
  try {
    reDownloadingGids.value.add(item.gid);
    if (item.versionId === 0) {
      await downloadStore.retry(item.gid);
    } else {
      const settings = await loadAppData<{ apiKey?: string }>(
        'civitai_settings'
      );
      await downloadStore.enqueueCivitai({
        versionId: item.versionId,
        workingDir: launcherStore.config.workingDir,
        apiKey: settings?.apiKey?.trim() ?? ''
      });
    }
    activeTab.value = 'active';
  } catch (error) {
    downloadStore.errorMessage =
      error instanceof Error ? error.message : String(error);
  } finally {
    reDownloadingGids.value.delete(item.gid);
  }
}
</script>

<template>
  <Popover>
    <PopoverTrigger as-child>
      <Button
        variant="ghost"
        size="icon"
        class="text-muted-foreground hover:text-foreground relative h-9 w-9"
        aria-label="Download manager"
      >
        <Download class="h-4 w-4" />
        <Badge
          v-if="downloadStore.activeCount"
          class="border-background absolute -top-1.5 -right-1.5 h-5 min-w-5 justify-center rounded-full border-2 px-1 text-xs"
        >
          {{ downloadStore.activeCount }}
        </Badge>
      </Button>
    </PopoverTrigger>
    <PopoverContent
      side="right"
      align="end"
      class="flex h-112 w-96 flex-col overflow-hidden p-0 shadow-lg"
    >
      <div
        class="border-border flex shrink-0 items-center justify-between border-b px-4 py-3"
      >
        <div>
          <h2 class="text-sm font-semibold">Downloads</h2>
          <p class="text-muted-foreground text-xs">Model downloads</p>
        </div>
        <Badge variant="secondary" class="text-xs">
          {{ downloadStore.items.length }} items
        </Badge>
      </div>

      <div
        v-if="downloadStore.errorMessage"
        class="text-destructive border-border shrink-0 border-b px-4 py-2 text-xs"
      >
        {{ downloadStore.errorMessage }}
      </div>

      <Tabs
        v-model="activeTab"
        default-value="active"
        class="flex min-h-0 flex-1 flex-col gap-0 overflow-hidden"
      >
        <div class="border-border shrink-0 border-b px-3 py-2">
          <TabsList class="grid w-full grid-cols-3">
            <TabsTrigger value="active" class="gap-1.5 text-xs">
              <span>Active</span>
              <Badge
                v-if="activeDownloads.length"
                variant="secondary"
                class="h-4 min-w-4 px-1 text-xs font-semibold"
              >
                {{ activeDownloads.length }}
              </Badge>
            </TabsTrigger>
            <TabsTrigger value="history" class="gap-1.5 text-xs">
              <span>History</span>
              <Badge
                v-if="historyDownloads.length"
                variant="secondary"
                class="h-4 min-w-4 px-1 text-xs font-semibold"
              >
                {{ historyDownloads.length }}
              </Badge>
            </TabsTrigger>
            <TabsTrigger value="url" class="text-xs">Add URL</TabsTrigger>
          </TabsList>
        </div>

        <TabsContent
          value="active"
          class="m-0 flex min-h-0 flex-1 flex-col overflow-hidden focus-visible:outline-none"
        >
          <div
            v-if="activeDownloads.length === 0"
            class="text-muted-foreground flex flex-1 flex-col items-center justify-center gap-2 text-xs"
          >
            <Download class="h-8 w-8 opacity-30" />
            <span>No active downloads</span>
          </div>

          <ScrollArea v-else class="min-h-0 flex-1">
            <div class="divide-border divide-y">
              <div
                v-for="item in activeDownloads"
                :key="item.gid"
                class="flex gap-3 px-4 py-3"
              >
                <div
                  class="bg-muted flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-md"
                >
                  <video
                    v-if="
                      item.previewUrl && isVideoMedia({ url: item.previewUrl })
                    "
                    :src="item.previewUrl"
                    autoplay
                    loop
                    muted
                    playsinline
                    class="pointer-events-none h-full w-full object-cover"
                  />
                  <img
                    v-else-if="item.previewUrl"
                    :src="item.previewUrl"
                    :alt="item.name"
                    class="h-full w-full object-cover"
                  />
                  <Download v-else class="text-muted-foreground h-5 w-5" />
                </div>

                <div class="min-w-0 flex-1">
                  <div class="flex items-start justify-between gap-2">
                    <div class="min-w-0">
                      <p
                        class="truncate text-xs font-semibold"
                        :title="item.name"
                      >
                        {{ item.name }}
                      </p>
                      <p class="text-muted-foreground truncate text-xs">
                        {{ item.modelType }} · {{ item.baseModel }}
                      </p>
                    </div>
                    <div class="flex shrink-0 items-center gap-1">
                      <Button
                        v-if="
                          item.status === 'active' || item.status === 'waiting'
                        "
                        variant="ghost"
                        size="iconSm"
                        title="Pause download"
                        @click="downloadStore.pause(item.gid)"
                      >
                        <Pause class="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        v-else-if="item.status === 'paused'"
                        variant="ghost"
                        size="iconSm"
                        title="Resume download"
                        @click="downloadStore.resume(item.gid)"
                      >
                        <Play class="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="iconSm"
                        title="Cancel and clean up download"
                        @click="downloadStore.cancel(item.gid)"
                      >
                        <X class="text-destructive h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>

                  <Progress :model-value="percent(item)" class="mt-2 h-1.5" />
                  <div
                    class="text-muted-foreground mt-1.5 flex justify-between text-xs"
                  >
                    <span>{{ statusLabel(item) }}</span>
                    <span v-if="item.totalLength">
                      {{ formatFileSize(item.completedLength) }} /
                      {{ formatFileSize(item.totalLength) }}
                    </span>
                    <span v-else>{{ formatShortDate(item.createdAt) }}</span>
                  </div>
                </div>
              </div>
            </div>
          </ScrollArea>
        </TabsContent>

        <TabsContent
          value="history"
          class="m-0 flex min-h-0 flex-1 flex-col overflow-hidden focus-visible:outline-none"
        >
          <div
            v-if="historyDownloads.length === 0"
            class="text-muted-foreground flex flex-1 flex-col items-center justify-center gap-2 text-xs"
          >
            <Download class="h-8 w-8 opacity-30" />
            <span>No download history</span>
          </div>

          <template v-else>
            <div
              class="border-border/60 bg-muted/20 text-muted-foreground flex shrink-0 items-center justify-between border-b px-4 py-1.5 text-xs"
            >
              <span>{{ historyDownloads.length }} completed items</span>
              <Button
                variant="ghost"
                size="sm"
                class="text-muted-foreground hover:text-destructive flex h-6 cursor-pointer items-center gap-1 px-1.5 text-xs transition-colors"
                title="Clear download history"
                @click="handleClearHistory"
              >
                <Trash2 class="h-3.5 w-3.5" />
                <span>Clear history</span>
              </Button>
            </div>

            <ScrollArea class="min-h-0 flex-1">
              <div class="divide-border divide-y">
                <div
                  v-for="item in historyDownloads"
                  :key="item.gid"
                  class="flex gap-3 px-4 py-3"
                >
                  <div
                    class="bg-muted relative flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-md"
                    :class="{
                      'opacity-60':
                        item.status === 'complete' && item.fileExists === false
                    }"
                  >
                    <video
                      v-if="
                        item.previewUrl &&
                        isVideoMedia({ url: item.previewUrl })
                      "
                      :src="item.previewUrl"
                      autoplay
                      loop
                      muted
                      playsinline
                      class="pointer-events-none h-full w-full object-cover"
                    />
                    <img
                      v-else-if="item.previewUrl"
                      :src="item.previewUrl"
                      :alt="item.name"
                      class="h-full w-full object-cover"
                    />
                    <CheckCircle2
                      v-else-if="
                        item.status === 'complete' && item.fileExists !== false
                      "
                      class="h-5 w-5 text-emerald-500"
                    />
                    <FileQuestion
                      v-else-if="
                        item.status === 'complete' && item.fileExists === false
                      "
                      class="h-5 w-5 text-amber-500"
                    />
                    <CircleAlert
                      v-else-if="item.status === 'error'"
                      class="text-destructive h-5 w-5"
                    />
                    <Download v-else class="text-muted-foreground h-5 w-5" />
                  </div>

                  <div class="min-w-0 flex-1">
                    <div class="flex items-start justify-between gap-2">
                      <div class="min-w-0">
                        <p
                          class="truncate text-xs font-semibold"
                          :title="item.name"
                        >
                          {{ item.name }}
                        </p>
                        <p class="text-muted-foreground truncate text-xs">
                          {{ item.modelType }} · {{ item.baseModel }}
                        </p>
                      </div>

                      <!-- Action buttons -->
                      <div class="flex shrink-0 items-center gap-1.5">
                        <!-- Show in folder if file exists -->
                        <Button
                          v-if="
                            item.status === 'complete' &&
                            item.fileExists !== false
                          "
                          variant="ghost"
                          size="iconSm"
                          title="Show downloaded model in folder"
                          @click="
                            invoke('show_in_folder', { path: item.modelPath })
                          "
                        >
                          <FolderOpen class="h-3.5 w-3.5" />
                        </Button>

                        <!-- Re-download button if error -->
                        <Button
                          v-else-if="item.status === 'error'"
                          variant="outline"
                          size="sm"
                          class="h-7 cursor-pointer gap-1 px-2 text-xs font-medium"
                          :disabled="reDownloadingGids.has(item.gid)"
                          title="Retry download"
                          @click="handleRedownload(item)"
                        >
                          <Loader2
                            v-if="reDownloadingGids.has(item.gid)"
                            class="h-3.5 w-3.5 animate-spin"
                          />
                          <Download v-else class="h-3.5 w-3.5" />
                          <span>Retry</span>
                        </Button>
                        <Button
                          variant="ghost"
                          size="iconSm"
                          title="Delete from download history"
                          aria-label="Delete from download history"
                          :disabled="reDownloadingGids.has(item.gid)"
                          @click="downloadStore.clearHistory(item.gid)"
                        >
                          <Trash2 class="text-destructive h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </div>

                    <div
                      class="mt-1.5 flex items-center justify-between text-xs"
                    >
                      <div class="flex items-center gap-1.5">
                        <!-- Deleted status badge with clear contrast -->
                        <Badge
                          v-if="
                            item.status === 'complete' &&
                            item.fileExists === false
                          "
                          class="border-0 bg-red-600 px-1.5 py-0 text-xs font-semibold text-white hover:bg-red-600"
                        >
                          Deleted
                        </Badge>
                        <span
                          v-else
                          :class="{
                            'text-emerald-500': item.status === 'complete',
                            'text-destructive': item.status === 'error',
                            'text-muted-foreground': ![
                              'complete',
                              'error'
                            ].includes(item.status)
                          }"
                        >
                          {{ statusLabel(item) }}
                        </span>
                      </div>

                      <span
                        v-if="item.totalLength"
                        class="text-muted-foreground"
                      >
                        {{ formatFileSize(item.totalLength) }}
                      </span>
                      <span v-else class="text-muted-foreground">{{
                        formatShortDate(item.createdAt)
                      }}</span>
                    </div>
                  </div>
                </div>
              </div>
            </ScrollArea>
          </template>
        </TabsContent>

        <TabsContent
          value="url"
          class="m-0 min-h-0 flex-1 overflow-y-auto focus-visible:outline-none"
        >
          <DownloadUrlForm @queued="activeTab = 'active'" />
        </TabsContent>
      </Tabs>
    </PopoverContent>
  </Popover>
</template>
