<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { invoke } from '@tauri-apps/api/core';
import { ArrowLeft, ImageOff, RefreshCw } from '@lucide/vue';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import CivitaiModelDetail from '@/components/civitai/CivitaiModelDetail.vue';
import { loadAppData } from '@/services/appStorage';
import {
  fetchCivitaiModelById,
  getCachedCivitaiModel,
  normalizeModelFilename,
  type CivitaiModel,
  type CivitaiVersion
} from '@/services/civitai';
import type { DownloadRecord } from '@/services/downloadManager';
import { useComfyStore } from '@/stores/comfyStore';
import { useDownloadStore } from '@/stores/downloadStore';
import { useLauncherStore } from '@/stores/launcherStore';
import { useCivitaiStore } from '@/stores/civitaiStore';

defineOptions({ name: 'CivitaiModelDetailView' });

const route = useRoute();
const router = useRouter();
const comfyStore = useComfyStore();
const downloadStore = useDownloadStore();
const launcherStore = useLauncherStore();
const civitaiStore = useCivitaiStore();
onMounted(() => {
  void civitaiStore.refreshLocalModels();
});

const modelId = computed(() => Number(route.params.id));
const model = ref<CivitaiModel | null>(null);
const selectedVersionId = ref<string>('');
const queueingVersions = ref(new Set<number>());
const loading = ref(false);
const errorMessage = ref('');
const apiKey = ref('');

const progress = computed<Record<number, DownloadRecord>>(() =>
  Object.fromEntries(
    downloadStore.items
      .filter((item) => ['active', 'waiting', 'paused'].includes(item.status))
      .map((item) => [item.versionId, item])
  )
);

const downloaded = computed<Record<number, DownloadRecord>>(() =>
  Object.fromEntries(
    downloadStore.items
      .filter((item) => item.status === 'complete' && item.fileExists !== false)
      .map((item) => [item.versionId, item])
  )
);

function modelFileSet(...groups: (string[] | undefined)[]) {
  return new Set(
    groups
      .flatMap((group) => group ?? [])
      .map((name) => normalizeModelFilename(name))
  );
}

const discoveredModelFiles = computed(() => {
  const bridge =
    civitaiStore.localModels ??
    (launcherStore.hasComfyDirectory ? comfyStore.bridgeModels : null);
  return {
    checkpoints: modelFileSet(bridge?.checkpoints, bridge?.unets),
    loras: modelFileSet(bridge?.loras),
    vaes: modelFileSet(bridge?.vaes),
    embeddings: modelFileSet(bridge?.embeddings),
    controlnet: modelFileSet(bridge?.controlnet),
    upscalers: modelFileSet(bridge?.upscale_models),
    hypernetworks: modelFileSet(bridge?.hypernetworks)
  };
});

function discoveredFilesForType(type: string) {
  const files = discoveredModelFiles.value;
  switch (type.toLowerCase()) {
    case 'checkpoint':
      return files.checkpoints;
    case 'lora':
    case 'locon':
    case 'dora':
      return files.loras;
    case 'vae':
      return files.vaes;
    case 'textualinversion':
      return files.embeddings;
    case 'controlnet':
      return files.controlnet;
    case 'upscaler':
      return files.upscalers;
    case 'hypernetwork':
      return files.hypernetworks;
    default:
      return new Set<string>();
  }
}

const activeVersion = computed<CivitaiVersion | undefined>(() => {
  if (!model.value) return;
  const versionId = Number(selectedVersionId.value);
  return (
    model.value.modelVersions.find((v) => v.id === versionId) ??
    model.value.modelVersions[0]
  );
});

function isVersionInstalled(
  targetModel?: CivitaiModel | null,
  version?: CivitaiVersion
) {
  return (
    !!targetModel &&
    !!version &&
    (!!downloaded.value[version.id] ||
      version.files.some((file) =>
        discoveredFilesForType(targetModel.type).has(
          normalizeModelFilename(file.name)
        )
      ))
  );
}

function isDownloadBusy(versionId: number) {
  return !!progress.value[versionId] || queueingVersions.value.has(versionId);
}

async function toggleDownload(versionId: number) {
  const item = progress.value[versionId];
  if (!item) return;
  errorMessage.value = '';
  try {
    if (item.status === 'paused') await downloadStore.resume(item.gid);
    else await downloadStore.pause(item.gid);
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : String(error);
  }
}

async function cancelDownload(versionId: number) {
  const item = progress.value[versionId];
  if (!item) return;
  errorMessage.value = '';
  try {
    await downloadStore.cancel(item.gid);
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : String(error);
  }
}

async function downloadModel(
  _targetModel?: CivitaiModel,
  versionParam?: CivitaiVersion
) {
  const version = versionParam ?? activeVersion.value;
  if (!version || isDownloadBusy(version.id)) return;
  if (!launcherStore.hasComfyDirectory) {
    errorMessage.value = launcherStore.localSetupMessage;
    return;
  }
  errorMessage.value = '';
  queueingVersions.value.add(version.id);
  try {
    await downloadStore.enqueueCivitai({
      versionId: version.id,
      workingDir: launcherStore.config.workingDir,
      apiKey: apiKey.value
    });
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : String(error);
  } finally {
    queueingVersions.value.delete(version.id);
  }
}

function goBack() {
  if (window.history.length > 1) {
    router.back();
  } else {
    router.push('/civitai');
  }
}

function onTagClick(tag: string) {
  router.push({ path: '/civitai', query: { tag } });
}

async function loadModelData() {
  const id = modelId.value;
  if (!id || isNaN(id)) {
    errorMessage.value = 'Invalid model ID';
    return;
  }

  // Check cache first for instantaneous navigation
  const cached = getCachedCivitaiModel(id);
  if (cached) {
    model.value = cached;
    if (cached.modelVersions[0] && !selectedVersionId.value) {
      selectedVersionId.value = String(cached.modelVersions[0].id);
    }
  }

  try {
    const settings = await loadAppData<{ apiKey?: string; nsfw?: boolean }>(
      'civitai_settings'
    );
    apiKey.value = settings?.apiKey?.trim() ?? '';
  } catch {
    apiKey.value = '';
  }

  if (!model.value) {
    loading.value = true;
    errorMessage.value = '';
    try {
      const fetched = await fetchCivitaiModelById(id, apiKey.value);
      model.value = fetched;
      if (fetched.modelVersions[0] && !selectedVersionId.value) {
        selectedVersionId.value = String(fetched.modelVersions[0].id);
      }
    } catch (err) {
      errorMessage.value = err instanceof Error ? err.message : String(err);
    } finally {
      loading.value = false;
    }
  }
}

onMounted(() => {
  void loadModelData();
});

watch(
  () => route.params.id,
  (newId) => {
    if (newId) {
      model.value = null;
      selectedVersionId.value = '';
      void loadModelData();
    }
  }
);
</script>

<template>
  <div class="relative flex h-full w-full flex-col overflow-hidden">
    <!-- Loading State -->
    <div
      v-if="loading"
      class="bg-background flex h-full w-full flex-col overflow-hidden"
    >
      <header
        class="border-border/80 bg-card/70 flex h-14 shrink-0 items-center justify-between border-b px-6 backdrop-blur-md"
      >
        <div class="flex items-center gap-3">
          <Button
            variant="outline"
            size="sm"
            class="h-8 cursor-pointer gap-1.5 text-xs font-medium"
            @click="goBack"
          >
            <ArrowLeft class="h-3.5 w-3.5" />
            <span>Back to Browser</span>
          </Button>
          <div class="bg-border/80 h-4 w-px shrink-0" />
          <Skeleton class="h-4 w-40" />
        </div>
      </header>

      <div class="flex-1 overflow-y-auto p-6 lg:p-8">
        <div class="mx-auto grid w-full grid-cols-1 gap-8 lg:grid-cols-12">
          <div class="flex flex-col gap-4 lg:col-span-7">
            <Skeleton class="aspect-3/4 max-h-150 w-full rounded-2xl" />
            <div class="flex gap-2">
              <Skeleton
                v-for="n in 6"
                :key="n"
                class="h-16 w-16 shrink-0 rounded-lg"
              />
            </div>
            <Skeleton class="h-40 w-full rounded-xl" />
          </div>
          <div class="flex flex-col gap-5 lg:col-span-5">
            <Skeleton class="h-8 w-3/4 rounded-lg" />
            <Skeleton class="h-5 w-1/2 rounded" />
            <div class="flex gap-2">
              <Skeleton v-for="n in 4" :key="n" class="h-6 w-16 rounded-md" />
            </div>
            <Skeleton class="h-32 w-full rounded-xl" />
            <Skeleton class="h-24 w-full rounded-xl" />
          </div>
        </div>
      </div>
    </div>

    <!-- Error State -->
    <div
      v-else-if="errorMessage && !model"
      class="bg-background flex h-full w-full flex-col items-center justify-center p-8 text-center"
    >
      <div
        class="bg-destructive/10 text-destructive mb-4 flex h-14 w-14 items-center justify-center rounded-full"
      >
        <ImageOff class="h-7 w-7" />
      </div>
      <h2 class="text-foreground text-lg font-semibold">
        Failed to load model details
      </h2>
      <p class="text-muted-foreground mt-1 max-w-md text-xs">
        {{ errorMessage }}
      </p>
      <div class="mt-6 flex items-center gap-3">
        <Button
          variant="outline"
          size="sm"
          class="cursor-pointer text-xs"
          @click="goBack"
        >
          <ArrowLeft class="mr-1.5 h-3.5 w-3.5" />
          Back to Browser
        </Button>
        <Button
          variant="default"
          size="sm"
          class="cursor-pointer text-xs"
          @click="loadModelData"
        >
          <RefreshCw class="mr-1.5 h-3.5 w-3.5" />
          Try Again
        </Button>
      </div>
    </div>

    <!-- Loaded Dedicated Detail View -->
    <CivitaiModelDetail
      v-else-if="model"
      :model="model"
      :selected-version-id="selectedVersionId"
      :is-installed="isVersionInstalled(model, activeVersion)"
      :is-downloading="!!progress[activeVersion?.id || 0]"
      :is-queueing="queueingVersions.has(activeVersion?.id || 0)"
      :progress-record="progress[activeVersion?.id || 0]"
      :downloaded-record="downloaded[activeVersion?.id || 0]"
      :download-disabled="!launcherStore.hasComfyDirectory"
      :download-message="
        !launcherStore.hasComfyDirectory ? launcherStore.localSetupMessage : ''
      "
      :error-message="errorMessage || civitaiStore.discoveryError"
      @update:selected-version-id="(val) => (selectedVersionId = val)"
      @close="goBack"
      @download="downloadModel"
      @pause="(vId) => toggleDownload(vId)"
      @resume="(vId) => toggleDownload(vId)"
      @cancel="(vId) => cancelDownload(vId)"
      @show-in-folder="(path) => invoke('show_in_folder', { path })"
      @tag-click="onTagClick"
    />
  </div>
</template>
