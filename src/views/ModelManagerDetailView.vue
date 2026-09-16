<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import {
  CloudDownload,
  CloudOff,
  HardDrive,
  Loader2,
  RefreshCw
} from '@lucide/vue';
import { useRouter } from 'vue-router';
import CivitaiModelDetailHost from '@/components/civitai/CivitaiModelDetailHost.vue';
import NoticeBanner from '@/components/layout/NoticeBanner.vue';
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
  useLocalModelsIndexQuery,
  useModelMetadataQuery
} from '@/composables/useModelManagerQueries';
import { useModelSyncDialog } from '@/composables/useModelSyncDialog';
import { modelCategoryLabel, type LocalModel } from '@/services/modelManager';

const props = defineProps<{ id: string }>();

const router = useRouter();

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

const apiKey = ref('');
const civitaiQuery = useCivitaiModelDetailQuery(civitaiModelId, apiKey);

onMounted(async () => {
  apiKey.value = await loadCivitaiApiKey();
});
</script>

<template>
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

  <CivitaiModelDetailHost
    v-else-if="civitaiQuery.data.value"
    :model="civitaiQuery.data.value"
    :preferred-version-id="summary?.versionId"
    back-label="Back to Models"
    @close="goBack"
  />

  <!-- Not linked (or Civitai page unavailable) -->
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
    </template>
  </ModelDetailShell>

  <ModelSyncDialog
    :state="syncDialog.state"
    @cancel="syncDialog.cancel"
    @close="syncDialog.close"
  />
</template>
