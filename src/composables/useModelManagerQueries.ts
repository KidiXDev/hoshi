import { useMutation, useQuery } from '@tanstack/vue-query';
import { computed, toValue, type MaybeRefOrGetter } from 'vue';
import { queryClient } from '../lib/queryClient';
import { loadAppData } from '../services/appStorage';
import {
  checkModelUpdate,
  deleteModel,
  findLocalModel,
  listLocalModelsIndex,
  readModelMetadata,
  rescanModels,
  setModelPreview,
  syncModelWithCivitai,
  type LocalModel,
  type LocalModelsIndex,
  type PreviewSource
} from '../services/modelManager';
import { useCivitaiStore } from '../stores/civitaiStore';
import { useComfyStore } from '../stores/comfyStore';
import {
  cleanPath,
  parseLauncherArgs,
  useLauncherStore
} from '../stores/launcherStore';
import { queryKeys } from './queryKeys';

/** Civitai API key stored in Settings (empty when unset). */
export async function loadCivitaiApiKey(): Promise<string> {
  try {
    const settings = await loadAppData<{ apiKey?: string }>('civitai_settings');
    return settings?.apiKey?.trim() ?? '';
  } catch {
    return '';
  }
}

function useLauncherScan() {
  const launcherStore = useLauncherStore();
  const workingDir = computed(() => cleanPath(launcherStore.config.workingDir));
  const args = computed(() => parseLauncherArgs(launcherStore.config.args));
  return { launcherStore, workingDir, args };
}

/** Whole local index (memory → disk → scan on the Rust side). */
export function useLocalModelsIndexQuery(queryOptions?: {
  enabled?: MaybeRefOrGetter<boolean>;
}) {
  const { launcherStore, workingDir, args } = useLauncherScan();
  return useQuery({
    queryKey: computed(() => queryKeys.models.index(workingDir.value)),
    queryFn: () => listLocalModelsIndex(workingDir.value, args.value),
    enabled: computed(
      () =>
        launcherStore.hasComfyDirectory &&
        (queryOptions?.enabled ? toValue(queryOptions.enabled) : true)
    ),
    staleTime: Number.POSITIVE_INFINITY,
    refetchOnWindowFocus: false
  });
}

/** Resolves a ComfyUI-style relative model name to its index record. */
export function useLocalModelByNameQuery(
  category: MaybeRefOrGetter<string>,
  relativeName: MaybeRefOrGetter<string>,
  queryOptions?: { enabled?: MaybeRefOrGetter<boolean> }
) {
  const { launcherStore, workingDir, args } = useLauncherScan();
  return useQuery({
    queryKey: computed(() =>
      queryKeys.models.byName(
        workingDir.value,
        toValue(category),
        toValue(relativeName)
      )
    ),
    queryFn: () =>
      findLocalModel(
        workingDir.value,
        args.value,
        toValue(category),
        toValue(relativeName)
      ),
    enabled: computed(
      () =>
        launcherStore.hasComfyDirectory &&
        toValue(relativeName).trim() !== '' &&
        (queryOptions?.enabled ? toValue(queryOptions.enabled) : true)
    ),
    staleTime: 1000 * 60 * 5,
    refetchOnWindowFocus: false
  });
}

export function useModelMetadataQuery(
  id: MaybeRefOrGetter<string | null | undefined>,
  queryOptions?: { enabled?: MaybeRefOrGetter<boolean> }
) {
  return useQuery({
    queryKey: computed(() => queryKeys.models.metadata(toValue(id) ?? '')),
    queryFn: () => readModelMetadata(toValue(id) ?? ''),
    enabled: computed(
      () =>
        Boolean(toValue(id)) &&
        (queryOptions?.enabled ? toValue(queryOptions.enabled) : true)
    ),
    staleTime: Number.POSITIVE_INFINITY,
    refetchOnWindowFocus: false
  });
}

/** Replaces one record inside every cached index snapshot. */
function replaceIndexedModel(model: LocalModel) {
  queryClient.setQueriesData<LocalModelsIndex>(
    { queryKey: ['models', 'index'] },
    (current) =>
      current && {
        ...current,
        models: current.models.map((item) =>
          item.id === model.id ? model : item
        )
      }
  );
  queryClient.setQueriesData<LocalModel | null>(
    { queryKey: ['models', 'byName'] },
    (current) => (current?.id === model.id ? model : current)
  );
}

function removeIndexedModel(id: string) {
  queryClient.setQueriesData<LocalModelsIndex>(
    { queryKey: ['models', 'index'] },
    (current) =>
      current && {
        ...current,
        models: current.models.filter((item) => item.id !== id)
      }
  );
  queryClient.setQueriesData<LocalModel | null>(
    { queryKey: ['models', 'byName'] },
    (current) => (current?.id === id ? null : current)
  );
  queryClient.removeQueries({ queryKey: queryKeys.models.metadata(id) });
}

export async function rescanLocalModelIndex(
  workingDir: string,
  args: string[]
) {
  const index = await rescanModels(workingDir, args);
  queryClient.setQueryData(queryKeys.models.index(workingDir), index);
  void queryClient.invalidateQueries({ queryKey: ['models', 'byName'] });
  return index;
}

export function useRescanModelsMutation() {
  const { workingDir, args } = useLauncherScan();
  return useMutation({
    mutationFn: () => rescanLocalModelIndex(workingDir.value, args.value)
  });
}

export function useSyncModelMutation() {
  return useMutation({
    mutationFn: async (id: string) =>
      syncModelWithCivitai(id, await loadCivitaiApiKey()),
    onSuccess: (model) => replaceIndexedModel(model)
  });
}

export function useSetModelPreviewMutation() {
  return useMutation({
    mutationFn: ({ id, source }: { id: string; source: PreviewSource }) =>
      setModelPreview(id, source),
    onSuccess: (model) => replaceIndexedModel(model)
  });
}

export function useDeleteModelMutation() {
  const comfyStore = useComfyStore();
  const civitaiStore = useCivitaiStore();
  return useMutation({
    mutationFn: (id: string) => deleteModel(id),
    onSuccess: (_deleted, id) => {
      removeIndexedModel(id);
      if (comfyStore.isConnected) void comfyStore.refreshModels();
      void civitaiStore.refreshLocalModels();
    }
  });
}

/** Refreshes `latestVersionId` for a linked model (cached Civitai lookup). */
export function useCheckModelUpdateMutation() {
  return useMutation({
    mutationFn: async (id: string) =>
      checkModelUpdate(id, await loadCivitaiApiKey()),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.models.all });
    }
  });
}
