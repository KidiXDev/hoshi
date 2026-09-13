import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, toValue, type MaybeRefOrGetter } from 'vue';
import { ComfyApi, type AutocompleteSearchMode } from '../services/comfyApi';
import type {
  BridgeModelsResponse,
  BridgeSystemResponse,
  ComfyObjectInfo
} from '../types/comfy';
import { queryKeys } from './queryKeys';

export function useComfyHealthQuery(
  serverUrl: MaybeRefOrGetter<string>,
  options?: { enabled?: MaybeRefOrGetter<boolean>; refetchInterval?: number }
) {
  return useQuery({
    queryKey: computed(() => queryKeys.comfy.health(toValue(serverUrl))),
    queryFn: () => ComfyApi.checkHealth(toValue(serverUrl)),
    enabled: computed(() => {
      const url = toValue(serverUrl);
      const isCustomEnabled = options?.enabled
        ? toValue(options.enabled)
        : true;
      return Boolean(url) && isCustomEnabled;
    }),
    refetchInterval: options?.refetchInterval,
    staleTime: 2500
  });
}

export function useComfyModelsQuery(
  serverUrl: MaybeRefOrGetter<string>,
  options?: { enabled?: MaybeRefOrGetter<boolean> }
) {
  return useQuery<BridgeModelsResponse | null>({
    queryKey: computed(() => queryKeys.comfy.models(toValue(serverUrl))),
    queryFn: () => ComfyApi.fetchBridgeModels(toValue(serverUrl)),
    enabled: computed(() => {
      const url = toValue(serverUrl);
      const isCustomEnabled = options?.enabled
        ? toValue(options.enabled)
        : true;
      return Boolean(url) && isCustomEnabled;
    }),
    // 5 minutes
    staleTime: 1000 * 60 * 5
  });
}

export function useComfySystemQuery(
  serverUrl: MaybeRefOrGetter<string>,
  options?: { enabled?: MaybeRefOrGetter<boolean>; refetchInterval?: number }
) {
  return useQuery<BridgeSystemResponse | null>({
    queryKey: computed(() => queryKeys.comfy.system(toValue(serverUrl))),
    queryFn: () => ComfyApi.fetchBridgeSystem(toValue(serverUrl)),
    enabled: computed(() => {
      const url = toValue(serverUrl);
      const isCustomEnabled = options?.enabled
        ? toValue(options.enabled)
        : true;
      return Boolean(url) && isCustomEnabled;
    }),
    refetchInterval: options?.refetchInterval,
    staleTime: 5000
  });
}

export function useComfyObjectInfoQuery(
  serverUrl: MaybeRefOrGetter<string>,
  options?: { enabled?: MaybeRefOrGetter<boolean> }
) {
  return useQuery<ComfyObjectInfo>({
    queryKey: computed(() => ['comfy', 'objectInfo', toValue(serverUrl)]),
    queryFn: () => ComfyApi.fetchObjectInfo(toValue(serverUrl)),
    enabled: computed(() => {
      const url = toValue(serverUrl);
      const isCustomEnabled = options?.enabled
        ? toValue(options.enabled)
        : true;
      return Boolean(url) && isCustomEnabled;
    }),
    staleTime: 1000 * 60 * 10
  });
}

export function useTagAutocompleteQuery(
  serverUrl: MaybeRefOrGetter<string>,
  query: MaybeRefOrGetter<string>,
  limit: MaybeRefOrGetter<number> = 20,
  mode: MaybeRefOrGetter<AutocompleteSearchMode> = 'tag',
  options?: { enabled?: MaybeRefOrGetter<boolean> }
) {
  return useQuery({
    queryKey: computed(() =>
      queryKeys.comfy.tagAutocompleteSearch(
        toValue(serverUrl),
        toValue(query),
        toValue(mode)
      )
    ),
    queryFn: ({ signal }) =>
      ComfyApi.searchTags(
        toValue(serverUrl),
        toValue(query),
        toValue(limit),
        toValue(mode),
        signal
      ),
    enabled: computed(() => {
      const q = toValue(query).trim();
      const url = toValue(serverUrl);
      const isCustomEnabled = options?.enabled
        ? toValue(options.enabled)
        : true;
      return Boolean(url) && q.length > 0 && isCustomEnabled;
    }),
    staleTime: 1000 * 60 * 5
  });
}

export function useRefreshModelsMutation(serverUrl: MaybeRefOrGetter<string>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => ComfyApi.refreshBridgeModels(toValue(serverUrl)),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.comfy.models(toValue(serverUrl))
      });
      void queryClient.invalidateQueries({
        queryKey: ['comfy', 'objectInfo', toValue(serverUrl)]
      });
    }
  });
}

export function useQueuePromptMutation(serverUrl: MaybeRefOrGetter<string>) {
  return useMutation({
    mutationFn: ({
      prompt,
      clientId
    }: {
      prompt: Record<string, unknown>;
      clientId: string;
    }) => ComfyApi.queuePrompt(toValue(serverUrl), prompt, clientId)
  });
}

export function useInterruptMutation(serverUrl: MaybeRefOrGetter<string>) {
  return useMutation({
    mutationFn: () => ComfyApi.interrupt(toValue(serverUrl))
  });
}
