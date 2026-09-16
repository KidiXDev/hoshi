<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { Loader2, RefreshCw } from '@lucide/vue';
import { useRouter } from 'vue-router';
import CivitaiModelDetail from '@/components/civitai/CivitaiModelDetail.vue';
import NoticeBanner from '@/components/layout/NoticeBanner.vue';
import LocalModelInfoSection from '@/components/models/LocalModelInfoSection.vue';
import LocalModelMetadataSection from '@/components/models/LocalModelMetadataSection.vue';
import ModelFileActions from '@/components/models/ModelFileActions.vue';
import ModelPreviewMenu from '@/components/models/ModelPreviewMenu.vue';
import ModelSyncDialog from '@/components/models/ModelSyncDialog.vue';
import { Button } from '@/components/ui/button';
import { useInstalledCivitaiVersions } from '@/composables/useInstalledCivitaiVersions';
import {
  loadCivitaiApiKey,
  useCheckModelUpdateMutation
} from '@/composables/useModelManagerQueries';
import { useModelSyncDialog } from '@/composables/useModelSyncDialog';
import {
  isVideoMedia,
  type CivitaiModel,
  type CivitaiVersion
} from '@/services/civitai';
import { showModelInFolder } from '@/services/modelManager';
import { useCivitaiStore } from '@/stores/civitaiStore';
import { useDownloadStore } from '@/stores/downloadStore';
import { useLauncherStore } from '@/stores/launcherStore';

const props = withDefaults(
  defineProps<{
    model: CivitaiModel;
    preferredVersionId?: number | null;
    backLabel?: string;
  }>(),
  { preferredVersionId: null, backLabel: 'Back to Browser' }
);

const emit = defineEmits<{ close: [] }>();

const router = useRouter();
const civitaiStore = useCivitaiStore();
const downloadStore = useDownloadStore();
const launcherStore = useLauncherStore();
const { progress, downloaded, installedLocalModel, isVersionInstalled } =
  useInstalledCivitaiVersions();
const syncDialog = useModelSyncDialog();
const checkUpdate = useCheckModelUpdateMutation();

const apiKey = ref('');
const selectedVersionId = ref('');
const queueingVersions = ref(new Set<number>());
const errorMessage = ref('');

watch(
  [() => props.model.id, () => props.preferredVersionId],
  () => {
    const preferred =
      props.model.modelVersions.find(
        (version) => version.id === props.preferredVersionId
      ) ?? props.model.modelVersions[0];
    selectedVersionId.value = preferred ? String(preferred.id) : '';
  },
  { immediate: true }
);

const activeVersion = computed<CivitaiVersion | undefined>(
  () =>
    props.model.modelVersions.find(
      (version) => version.id === Number(selectedVersionId.value)
    ) ?? props.model.modelVersions[0]
);
const activeVersionId = computed(() => activeVersion.value?.id ?? 0);
const installedVersionIds = computed(() =>
  props.model.modelVersions
    .filter((version) => isVersionInstalled(props.model, version))
    .map((version) => version.id)
);
const localModel = computed(() =>
  installedLocalModel(props.model, activeVersion.value)
);
const summary = computed(() => localModel.value?.civitai ?? null);
const activeSample = computed(() =>
  activeVersion.value?.images.find((image) => !isVideoMedia(image))
);

watch(
  () => localModel.value?.id,
  (localId) => {
    if (localId && !checkUpdate.isPending.value) checkUpdate.mutate(localId);
  },
  { immediate: true }
);

function reportError(error: unknown) {
  errorMessage.value = error instanceof Error ? error.message : String(error);
}

async function downloadVersion(
  _model?: CivitaiModel,
  versionParam?: CivitaiVersion
) {
  const version = versionParam ?? activeVersion.value;
  if (
    !version ||
    progress.value[version.id] ||
    queueingVersions.value.has(version.id)
  )
    return;
  if (!launcherStore.hasComfyDirectory) {
    errorMessage.value = launcherStore.localSetupMessage;
    return;
  }
  errorMessage.value = '';
  queueingVersions.value = new Set(queueingVersions.value).add(version.id);
  try {
    await downloadStore.enqueueCivitai({
      versionId: version.id,
      workingDir: launcherStore.config.workingDir,
      apiKey: apiKey.value
    });
  } catch (error) {
    reportError(error);
  } finally {
    const next = new Set(queueingVersions.value);
    next.delete(version.id);
    queueingVersions.value = next;
  }
}

async function toggleDownload(versionId: number) {
  const item = progress.value[versionId];
  if (!item) return;
  errorMessage.value = '';
  try {
    if (item.status === 'paused') await downloadStore.resume(item.gid);
    else await downloadStore.pause(item.gid);
  } catch (error) {
    reportError(error);
  }
}

async function cancelDownload(versionId: number) {
  const item = progress.value[versionId];
  if (!item) return;
  errorMessage.value = '';
  try {
    await downloadStore.cancel(item.gid);
  } catch (error) {
    reportError(error);
  }
}

onMounted(async () => {
  void civitaiStore.refreshLocalModels();
  apiKey.value = await loadCivitaiApiKey();
});
</script>

<template>
  <CivitaiModelDetail
    :model="model"
    :selected-version-id="selectedVersionId"
    :is-installed="installedVersionIds.includes(activeVersionId)"
    :installed-version-ids="installedVersionIds"
    :is-downloading="!!progress[activeVersionId]"
    :is-queueing="queueingVersions.has(activeVersionId)"
    :progress-record="progress[activeVersionId]"
    :downloaded-record="downloaded[activeVersionId]"
    :download-disabled="!launcherStore.hasComfyDirectory"
    :download-message="
      !launcherStore.hasComfyDirectory ? launcherStore.localSetupMessage : ''
    "
    :error-message="errorMessage || civitaiStore.discoveryError"
    :back-label="backLabel"
    @update:selected-version-id="(value) => (selectedVersionId = value)"
    @close="emit('close')"
    @download="downloadVersion"
    @pause="toggleDownload"
    @resume="toggleDownload"
    @cancel="cancelDownload"
    @show-in-folder="showModelInFolder"
    @tag-click="(tag) => router.push({ path: '/civitai', query: { tag } })"
  >
    <template v-if="localModel" #header-actions>
      <ModelPreviewMenu
        :model="localModel"
        :sample-url="activeSample?.url"
        sample-label="From current Civitai sample"
      />
      <Button
        variant="outline"
        size="sm"
        class="h-8 gap-1.5 text-xs"
        :disabled="syncDialog.isRunning()"
        title="Refresh sidecar metadata and preview from Civitai"
        @click="syncDialog.run(localModel)"
      >
        <Loader2
          v-if="syncDialog.isRunning()"
          class="h-3.5 w-3.5 animate-spin"
        />
        <RefreshCw v-else class="h-3.5 w-3.5" />
        <span>Re-sync</span>
      </Button>
    </template>
    <template v-if="localModel" #installed-actions>
      <ModelFileActions :model="localModel" />
    </template>
    <template v-if="localModel" #sidebar-bottom>
      <NoticeBanner v-if="summary && !summary.verified" tone="amber">
        <span>
          <span class="font-semibold">Unverified metadata.</span>
          The Civitai link comes from a sidecar file next to the model; the file
          hash has not been checked against Civitai yet. Re-sync to verify it is
          this exact file.
        </span>
      </NoticeBanner>
      <LocalModelInfoSection :model="localModel" :show-actions="false" />
      <LocalModelMetadataSection :model="localModel" />
    </template>
  </CivitaiModelDetail>

  <ModelSyncDialog
    :state="syncDialog.state"
    @cancel="syncDialog.cancel"
    @close="syncDialog.close"
  />
</template>
