import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, toValue, type MaybeRefOrGetter } from 'vue';
import {
  clearBooruCache,
  fetchBooruDetail,
  fetchBooruSettings,
  fetchBooruSources,
  saveBooruSettings,
  searchBooru,
  testBooruCredentials,
  type BooruCredentials,
  type BooruSettingsUpdate
} from '../services/booruGallery';
import { queryKeys } from './queryKeys';

export function useBooruSourcesQuery(options?: {
  enabled?: MaybeRefOrGetter<boolean>;
}) {
  return useQuery({
    queryKey: queryKeys.booru.sources(),
    queryFn: fetchBooruSources,
    enabled: computed(() =>
      options?.enabled ? toValue(options.enabled) : true
    ),
    staleTime: 1000 * 60 * 10
  });
}

export function useBooruSearchQuery(
  searchOptions: MaybeRefOrGetter<{
    source: string;
    query: string;
    ratings: string[];
    sort: string;
    cursor?: string | null;
    limit?: number;
  }>,
  options?: { enabled?: MaybeRefOrGetter<boolean> }
) {
  return useQuery({
    queryKey: computed(() =>
      queryKeys.booru.search(
        toValue(searchOptions) as unknown as Record<string, unknown>
      )
    ),
    queryFn: () => searchBooru(toValue(searchOptions)),
    enabled: computed(() => {
      const opts = toValue(searchOptions);
      const isCustomEnabled = options?.enabled
        ? toValue(options.enabled)
        : true;
      return Boolean(opts.source) && isCustomEnabled;
    }),
    staleTime: 1000 * 60 * 2
  });
}

export function useBooruDetailQuery(
  source: MaybeRefOrGetter<string>,
  postId: MaybeRefOrGetter<string>,
  options?: { enabled?: MaybeRefOrGetter<boolean> }
) {
  return useQuery({
    queryKey: computed(() =>
      queryKeys.booru.detail(toValue(source), toValue(postId))
    ),
    queryFn: () => fetchBooruDetail(toValue(source), toValue(postId)),
    enabled: computed(() => {
      const src = toValue(source);
      const id = toValue(postId);
      const isCustomEnabled = options?.enabled
        ? toValue(options.enabled)
        : true;
      return Boolean(src && id) && isCustomEnabled;
    }),
    staleTime: 1000 * 60 * 15
  });
}

export function useBooruSettingsQuery(options?: {
  enabled?: MaybeRefOrGetter<boolean>;
}) {
  return useQuery({
    queryKey: queryKeys.booru.settings(),
    queryFn: fetchBooruSettings,
    enabled: computed(() =>
      options?.enabled ? toValue(options.enabled) : true
    ),
    staleTime: 1000 * 60 * 5
  });
}

export function useSaveBooruSettingsMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (update: BooruSettingsUpdate) => saveBooruSettings(update),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.booru.settings()
      });
    }
  });
}

export function useClearBooruCacheMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: clearBooruCache,
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.booru.all
      });
    }
  });
}

export function useTestBooruCredentialsMutation() {
  return useMutation({
    mutationFn: ({
      source,
      credentials
    }: {
      source: keyof BooruCredentials;
      credentials: Record<string, string>;
    }) => testBooruCredentials(source, credentials)
  });
}
