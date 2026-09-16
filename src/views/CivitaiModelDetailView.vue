<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ArrowLeft, ImageOff, RefreshCw } from '@lucide/vue';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import CivitaiModelDetailHost from '@/components/civitai/CivitaiModelDetailHost.vue';
import { loadCivitaiApiKey } from '@/composables/useModelManagerQueries';
import {
  fetchCivitaiModelById,
  getCachedCivitaiModel,
  type CivitaiModel
} from '@/services/civitai';

defineOptions({ name: 'CivitaiModelDetailView' });

const route = useRoute();
const router = useRouter();

const modelId = computed(() => Number(route.params.id));
const model = ref<CivitaiModel | null>(null);
const loading = ref(false);
const errorMessage = ref('');

function goBack() {
  if (window.history.length > 1) {
    router.back();
  } else {
    router.push('/civitai');
  }
}

async function loadModelData() {
  const id = modelId.value;
  if (!id || isNaN(id)) {
    errorMessage.value = 'Invalid model ID';
    return;
  }
  model.value = getCachedCivitaiModel(id) ?? null;
  if (model.value) return;

  loading.value = true;
  errorMessage.value = '';
  try {
    model.value = await fetchCivitaiModelById(id, await loadCivitaiApiKey());
  } catch (err) {
    errorMessage.value = err instanceof Error ? err.message : String(err);
  } finally {
    loading.value = false;
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

    <CivitaiModelDetailHost v-else-if="model" :model="model" @close="goBack" />
  </div>
</template>
