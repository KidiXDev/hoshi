import { useQuery } from '@tanstack/vue-query';
import { computed, toValue, type MaybeRefOrGetter } from 'vue';
import {
  fetchCivitaiBaseModels,
  fetchCivitaiImageMeta,
  fetchCivitaiModelById,
  fetchCivitaiModels
} from '../services/civitai';
import { queryKeys } from './queryKeys';

export function useCivitaiModelsQuery(
  options: MaybeRefOrGetter<{
    query: string;
    modelType: string;
    baseModel: string;
    sort: string;
    period: string;
    cursor?: string;
    apiKey: string;
    nsfw?: boolean;
  }>,
  queryOptions?: { enabled?: MaybeRefOrGetter<boolean> }
) {
  return useQuery({
    queryKey: computed(() =>
      queryKeys.civitai.models(
        toValue(options) as unknown as Record<string, unknown>
      )
    ),
    queryFn: () => fetchCivitaiModels(toValue(options)),
    enabled: computed(() => {
      const isCustomEnabled = queryOptions?.enabled
        ? toValue(queryOptions.enabled)
        : true;
      return isCustomEnabled;
    }),
    staleTime: 1000 * 60 * 5
  });
}

export function useCivitaiModelDetailQuery(
  id: MaybeRefOrGetter<number | string | null | undefined>,
  apiKey: MaybeRefOrGetter<string> = '',
  queryOptions?: { enabled?: MaybeRefOrGetter<boolean> }
) {
  return useQuery({
    queryKey: computed(() => {
      const currentId = toValue(id);
      return currentId
        ? queryKeys.civitai.modelDetail(currentId)
        : ['civitai', 'model', null];
    }),
    queryFn: () => {
      const currentId = toValue(id);
      if (!currentId) throw new Error('Model ID is required');
      return fetchCivitaiModelById(currentId, toValue(apiKey));
    },
    enabled: computed(() => {
      const currentId = toValue(id);
      const isCustomEnabled = queryOptions?.enabled
        ? toValue(queryOptions.enabled)
        : true;
      return Boolean(currentId) && isCustomEnabled;
    }),
    staleTime: 1000 * 60 * 15
  });
}

export function useCivitaiImageMetaQuery(
  id: MaybeRefOrGetter<number | null | undefined>
) {
  return useQuery({
    queryKey: computed(() => queryKeys.civitai.imageMeta(toValue(id) ?? 0)),
    queryFn: () => fetchCivitaiImageMeta(toValue(id) ?? 0),
    enabled: computed(() => Boolean(toValue(id))),
    staleTime: Number.POSITIVE_INFINITY
  });
}

export function useCivitaiBaseModelsQuery() {
  return useQuery({
    queryKey: queryKeys.civitai.baseModels(),
    queryFn: () => fetchCivitaiBaseModels(),
    staleTime: 1000 * 60 * 60
  });
}
