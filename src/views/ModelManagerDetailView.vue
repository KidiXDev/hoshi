<script setup lang="ts">
/**
 * Model Manager detail. Every model gets the Civitai-browser layout:
 * - linked to Civitai → the shared `CivitaiModelDetail` (live data) with the
 *   local sections appended to its sidebar;
 * - not linked → the same shell with the local preview as the stage.
 */
import { computed, onMounted, ref, watch } from 'vue';
import {
  CloudDownload,
  CloudOff,
  HardDrive,
  Loader2,
  RefreshCw
} from '@lucide/vue';
import { useRouter } from 'vue-router';
import CivitaiModelDetail from '@/components/civitai/CivitaiModelDetail.vue';
import NoticeBanner from '@/components/layout/NoticeBanner.vue';
import LocalModelDangerSection from '@/components/models/LocalModelDangerSection.vue';
import LocalModelInfoSection from '@/components/models/LocalModelInfoSection.vue';
import LocalModelMetadataSection from '@/components/models/LocalModelMetadataSection.vue';
import LocalModelStage from '@/components/models/LocalModelStage.vue';
import ModelDetailShell from '@/components/models/ModelDetailShell.vue';
import ModelDetailSkeleton from '@/components/models/ModelDetailSkeleton.vue';
import ModelPreviewMenu from '@/components/models/ModelPreviewMenu.vue';
import ModelSyncDialog from '@/components/models/ModelSyncDialog.vue';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useCivitaiModelDetailQuery } from '@/composables/useCivitaiQueries';
import {
  loadCivitaiApiKey,
  useCheckModelUpdateMutation,
  useLocalModelsIndexQuery,
  useModelMetadataQuery
} from '@/composables/useModelManagerQueries';
import { useModelSyncDialog } from '@/composables/useModelSyncDialog';
import {
  isVideoMedia,
  type CivitaiModel,
  type CivitaiVersion
} from '@/services/civitai';
import type { DownloadRecord } from '@/services/downloadManager';
import {
  modelCategoryLabel,
  showModelInFolder,
  type LocalModel
} from '@/services/modelManager';
import { useDownloadStore } from '@/stores/downloadStore';
import { useLauncherStore } from '@/stores/launcherStore';

const props = defineProps<{ id: string }>();

const router = useRouter();
const downloadStore = useDownloadStore();
const launcherStore = useLauncherStore();

// ─── Local record ────────────────────────────────────────────────────────────
const indexQuery = useLocalModelsIndexQuery();
const model = computed<LocalModel | undefined>(() =>
  indexQuery.data.value?.models.find((item) => item.id === props.id)
);
const summary = computed(() => model.value?.civitai ?? null);
const civitaiModelId = computed(() => summary.value?.modelId ?? null);
const notOnCivitai = computed(
  () =>
    Boolean(model.value) &&
    !summary.value &&
    (model.value?.syncAttemptedMs ?? 0) > 0
);
const headerMetadata = useModelMetadataQuery(() => model.value?.id, {
  enabled: () => model.value?.extension === 'safetensors'
});
const localBaseModel = computed(
  () => summary.value?.baseModel || headerMetadata.data.value?.baseModel || ''
);
const syncDialog = useModelSyncDialog();

function goBack() {
  if (window.history.length > 1) router.back();
  else router.push('/models');
}

async function runSync() {
  if (model.value) await syncDialog.run(model.value);
}

// ─── Civitai page (same component + wiring as the Civitai browser) ──────────
const apiKey = ref('');
const civitaiQuery = useCivitaiModelDetailQuery(civitaiModelId, apiKey);
const civitaiModel = computed<CivitaiModel | null>(
  () => civitaiQuery.data.value ?? null
);
const civitaiVersionId = ref('');
const queueingVersions = ref(new Set<number>());
const downloadError = ref('');
const checkUpdate = useCheckModelUpdateMutation();

watch(
  [civitaiModel, () => summary.value?.versionId],
  ([remote, installed]) => {
    if (!remote) return;
    const preferred =
      remote.modelVersions.find((version) => version.id === installed) ??
      remote.modelVersions[0];
    if (preferred && !civitaiVersionId.value)
      civitaiVersionId.value = String(preferred.id);
  },
  { immediate: true }
);
// Keep the grid's "Update" badge current whenever the Civitai page is opened.
watch(
  () => [civitaiModel.value?.id, model.value?.id] as const,
  ([remoteId, localId]) => {
    if (remoteId && localId && !checkUpdate.isPending.value)
      checkUpdate.mutate(localId);
  }
);

const activeCivitaiVersion = computed<CivitaiVersion | undefined>(() => {
  const remote = civitaiModel.value;
  const wanted = Number(civitaiVersionId.value);
  return (
    remote?.modelVersions.find((version) => version.id === wanted) ??
    remote?.modelVersions[0]
  );
});
const activeSample = computed(() =>
  activeCivitaiVersion.value?.images.find((image) => !isVideoMedia(image))
);
const downloadProgress = computed<Record<number, DownloadRecord>>(() =>
  Object.fromEntries(
    downloadStore.items
      .filter((item) => ['active', 'waiting', 'paused'].includes(item.status))
      .map((item) => [item.versionId, item])
  )
);
const downloadedRecords = computed<Record<number, DownloadRecord>>(() =>
  Object.fromEntries(
    downloadStore.items
      .filter((item) => item.status === 'complete' && item.fileExists !== false)
      .map((item) => [item.versionId, item])
  )
);
const activeVersionInstalled = computed(() => {
  const version = activeCivitaiVersion.value;
  return Boolean(
    version &&
    (version.id === summary.value?.versionId ||
      downloadedRecords.value[version.id])
  );
});

async function downloadCivitaiVersion(
  _remote?: CivitaiModel,
  versionParam?: CivitaiVersion
) {
  const version = versionParam ?? activeCivitaiVersion.value;
  if (!version || queueingVersions.value.has(version.id)) return;
  if (!launcherStore.hasComfyDirectory) {
    downloadError.value = launcherStore.localSetupMessage;
    return;
  }
  downloadError.value = '';
  queueingVersions.value = new Set(queueingVersions.value).add(version.id);
  try {
    await downloadStore.enqueueCivitai({
      versionId: version.id,
      workingDir: launcherStore.config.workingDir,
      apiKey: apiKey.value
    });
  } catch (error) {
    downloadError.value = String(error);
  } finally {
    const next = new Set(queueingVersions.value);
    next.delete(version.id);
    queueingVersions.value = next;
  }
}

async function toggleCivitaiDownload(versionId: number) {
  const item = downloadProgress.value[versionId];
  if (!item) return;
  try {
    if (item.status === 'paused') await downloadStore.resume(item.gid);
    else await downloadStore.pause(item.gid);
  } catch (error) {
    downloadError.value = String(error);
  }
}

async function cancelCivitaiDownload(versionId: number) {
  const item = downloadProgress.value[versionId];
  if (!item) return;
  try {
    await downloadStore.cancel(item.gid);
  } catch (error) {
    downloadError.value = String(error);
  }
}

onMounted(async () => {
  apiKey.value = await loadCivitaiApiKey();
});
</script>

<template>
  <!-- Index loading, or a linked model whose Civitai page is still loading -->
  <ModelDetailSkeleton
    v-if="
      indexQuery.isLoading.value ||
      (civitaiModelId && civitaiQuery.isLoading.value)
    "
    back-label="Back to Models"
    :title="summary?.modelName || model?.filename || ''"
    :category="model ? modelCategoryLabel(model.category) : ''"
    @close="goBack"
  />

  <!-- Record gone (deleted / moved) -->
  <ModelDetailShell
    v-else-if="!model"
    back-label="Back to Models"
    @close="goBack"
  >
    <template #breadcrumb>
      <span class="text-muted-foreground">Models</span>
      <span class="text-muted-foreground">/</span>
      <span class="font-semibold">Not found</span>
    </template>
    <template #sidebar>
      <NoticeBanner tone="amber">
        <span>
          This model is no longer in the index — it may have been deleted or
          moved. Rescan the library from the Model Manager to refresh it.
        </span>
        <template #actions>
          <Button variant="outline" size="sm" @click="router.push('/models')">
            Back to Model Manager
          </Button>
        </template>
      </NoticeBanner>
    </template>
  </ModelDetailShell>

  <!-- Linked to Civitai: the browser's detail page + local sections -->
  <CivitaiModelDetail
    v-else-if="civitaiModel"
    :model="civitaiModel"
    :selected-version-id="civitaiVersionId"
    :is-installed="activeVersionInstalled"
    :is-downloading="!!downloadProgress[activeCivitaiVersion?.id || 0]"
    :is-queueing="queueingVersions.has(activeCivitaiVersion?.id || 0)"
    :progress-record="downloadProgress[activeCivitaiVersion?.id || 0]"
    :downloaded-record="downloadedRecords[activeCivitaiVersion?.id || 0]"
    :download-disabled="!launcherStore.hasComfyDirectory"
    :download-message="
      !launcherStore.hasComfyDirectory ? launcherStore.localSetupMessage : ''
    "
    :error-message="downloadError"
    back-label="Back to Models"
    @update:selected-version-id="(value) => (civitaiVersionId = value)"
    @close="goBack"
    @download="downloadCivitaiVersion"
    @pause="toggleCivitaiDownload"
    @resume="toggleCivitaiDownload"
    @cancel="cancelCivitaiDownload"
    @show-in-folder="showModelInFolder"
    @tag-click="(tag) => router.push({ path: '/civitai', query: { tag } })"
  >
    <template #header-actions>
      <ModelPreviewMenu
        :model="model"
        :sample-url="activeSample?.url"
        sample-label="From current Civitai sample"
      />
      <Button
        variant="outline"
        size="sm"
        class="h-8 gap-1.5 text-xs"
        :disabled="syncDialog.isRunning()"
        title="Refresh sidecar metadata and preview from Civitai"
        @click="runSync"
      >
        <Loader2
          v-if="syncDialog.isRunning()"
          class="h-3.5 w-3.5 animate-spin"
        />
        <RefreshCw v-else class="h-3.5 w-3.5" />
        <span>Re-sync</span>
      </Button>
    </template>
    <template #sidebar-bottom>
      <NoticeBanner v-if="summary && !summary.verified" tone="amber">
        <span>
          <span class="font-semibold">Unverified metadata.</span>
          The Civitai link comes from a sidecar file next to the model; the file
          hash has not been checked against Civitai yet. Re-sync to verify it is
          this exact file.
        </span>
      </NoticeBanner>
      <LocalModelInfoSection :model="model" />
      <LocalModelMetadataSection :model="model" />
      <LocalModelDangerSection :model="model" />
    </template>
  </CivitaiModelDetail>

  <!-- Not linked (or Civitai page unavailable): same layout, local data -->
  <ModelDetailShell v-else back-label="Back to Models" @close="goBack">
    <template #breadcrumb>
      <span class="text-muted-foreground shrink-0">Models</span>
      <span class="text-muted-foreground">/</span>
      <Badge variant="outline" class="shrink-0 py-0 text-xs">
        {{ modelCategoryLabel(model.category) }}
      </Badge>
      <span class="text-muted-foreground">/</span>
      <span class="text-foreground truncate font-semibold">
        {{ summary?.modelName || model.filename }}
      </span>
    </template>

    <template #actions>
      <ModelPreviewMenu :model="model" />
      <Button
        size="sm"
        class="h-8 gap-1.5 text-xs"
        :disabled="syncDialog.isRunning()"
        @click="runSync"
      >
        <Loader2
          v-if="syncDialog.isRunning()"
          class="h-3.5 w-3.5 animate-spin"
        />
        <CloudDownload v-else class="h-3.5 w-3.5" />
        <span>{{
          notOnCivitai ? 'Check Civitai again' : 'Sync with Civitai'
        }}</span>
      </Button>
    </template>

    <template #stage>
      <LocalModelStage :model="model" />
    </template>

    <template #sidebar>
      <div class="flex flex-col gap-2.5">
        <div class="flex flex-wrap items-center gap-2">
          <Badge variant="outline" class="text-xs">
            {{ modelCategoryLabel(model.category) }}
          </Badge>
          <Badge v-if="localBaseModel" variant="secondary" class="text-xs">
            {{ localBaseModel }}
          </Badge>
          <Badge variant="outline" class="text-xs uppercase">
            {{ model.extension }}
          </Badge>
        </div>
        <h1 class="text-foreground text-xl font-bold tracking-tight">
          {{ summary?.modelName || model.filename }}
        </h1>
        <p class="text-muted-foreground flex items-center gap-1.5 text-xs">
          <HardDrive class="h-3 w-3" />
          <span>Local model · {{ modelCategoryLabel(model.category) }}</span>
        </p>
      </div>

      <NoticeBanner v-if="civitaiModelId" tone="amber">
        <span>
          <span class="font-semibold">Civitai page unavailable.</span>
          {{
            civitaiQuery.error.value
              ? String(civitaiQuery.error.value)
              : 'The model may have been removed from Civitai.'
          }}
          Showing the metadata saved locally instead.
        </span>
        <template #actions>
          <Button
            variant="outline"
            size="sm"
            class="h-7 text-xs"
            @click="civitaiQuery.refetch()"
          >
            <RefreshCw class="h-3 w-3" /> Retry
          </Button>
        </template>
      </NoticeBanner>
      <NoticeBanner v-else-if="notOnCivitai" tone="info">
        <template #icon>
          <CloudOff class="h-4 w-4 shrink-0" />
        </template>
        <span>
          <span class="font-semibold">Not on Civitai.</span>
          No Civitai model version matches this file's SHA-256, so it is a
          private, merged, or locally trained model. Trigger words can still be
          suggested from its embedded training metadata.
        </span>
      </NoticeBanner>
      <NoticeBanner v-else tone="info">
        <template #icon>
          <CloudDownload class="h-4 w-4 shrink-0" />
        </template>
        <span>
          <span class="font-semibold">Not synced yet.</span>
          Syncing hashes the file and looks it up on Civitai to fetch the model
          page, trigger words, version info and a preview image.
        </span>
      </NoticeBanner>

      <section
        v-if="summary?.trainedWords.length"
        class="border-border/70 bg-card/70 flex flex-col gap-2 rounded-xl border p-4 shadow-xs"
      >
        <h3 class="text-xs font-bold tracking-wider uppercase">
          Trigger words (from saved metadata)
        </h3>
        <div class="flex flex-wrap gap-1.5">
          <Badge
            v-for="word in summary.trainedWords"
            :key="word"
            variant="secondary"
            class="font-mono text-xs"
          >
            {{ word }}
          </Badge>
        </div>
      </section>

      <LocalModelMetadataSection :model="model" show-suggested-words />
      <LocalModelInfoSection :model="model" />
      <LocalModelDangerSection :model="model" />
    </template>
  </ModelDetailShell>

  <ModelSyncDialog
    :state="syncDialog.state"
    @cancel="syncDialog.cancel"
    @close="syncDialog.close"
  />
</template>
