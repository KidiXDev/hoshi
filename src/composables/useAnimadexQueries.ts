import { useQuery } from '@tanstack/vue-query';
import { computed, toValue, type MaybeRefOrGetter } from 'vue';
import {
  getArtistFacets,
  getCharacterFacets,
  getCopyrightFacets,
  searchArtists,
  searchCharacters,
  searchCopyrights,
  searchFacet
} from '../services/animadexApi';
import type {
  ArtistFilterParams,
  CharacterFilterParams,
  CopyrightFilterParams
} from '../types/animadex';
import { queryKeys } from './queryKeys';

export function useAnimadexCharactersQuery(
  params: MaybeRefOrGetter<CharacterFilterParams>,
  options?: { enabled?: MaybeRefOrGetter<boolean> }
) {
  return useQuery({
    queryKey: computed(() =>
      queryKeys.animadex.characters(
        toValue(params) as unknown as Record<string, unknown>
      )
    ),
    queryFn: () => searchCharacters(toValue(params)),
    enabled: options?.enabled ? computed(() => toValue(options.enabled)) : true,
    staleTime: 1000 * 60 * 5
  });
}

export function useAnimadexArtistsQuery(
  params: MaybeRefOrGetter<ArtistFilterParams>,
  options?: { enabled?: MaybeRefOrGetter<boolean> }
) {
  return useQuery({
    queryKey: computed(() =>
      queryKeys.animadex.artists(
        toValue(params) as unknown as Record<string, unknown>
      )
    ),
    queryFn: () => searchArtists(toValue(params)),
    enabled: options?.enabled ? computed(() => toValue(options.enabled)) : true,
    staleTime: 1000 * 60 * 5
  });
}

export function useAnimadexCopyrightsQuery(
  params: MaybeRefOrGetter<CopyrightFilterParams>,
  options?: { enabled?: MaybeRefOrGetter<boolean> }
) {
  return useQuery({
    queryKey: computed(() =>
      queryKeys.animadex.copyrights(
        toValue(params) as unknown as Record<string, unknown>
      )
    ),
    queryFn: () => searchCopyrights(toValue(params)),
    enabled: options?.enabled ? computed(() => toValue(options.enabled)) : true,
    staleTime: 1000 * 60 * 5
  });
}

export function useAnimadexCharacterFacetsQuery() {
  return useQuery({
    queryKey: queryKeys.animadex.characterFacets(),
    queryFn: () => getCharacterFacets(),
    staleTime: 1000 * 60 * 30
  });
}

export function useAnimadexArtistFacetsQuery() {
  return useQuery({
    queryKey: queryKeys.animadex.artistFacets(),
    queryFn: () => getArtistFacets(),
    staleTime: 1000 * 60 * 30
  });
}

export function useAnimadexCopyrightFacetsQuery() {
  return useQuery({
    queryKey: queryKeys.animadex.copyrightFacets(),
    queryFn: () => getCopyrightFacets(),
    staleTime: 1000 * 60 * 30
  });
}

export function useAnimadexFacetSearchQuery(
  mode: MaybeRefOrGetter<'characters' | 'artists'>,
  facet: MaybeRefOrGetter<string>,
  searchQuery: MaybeRefOrGetter<string>,
  options?: { enabled?: MaybeRefOrGetter<boolean> }
) {
  return useQuery({
    queryKey: computed(() =>
      queryKeys.animadex.facetSearch(
        toValue(mode),
        toValue(facet),
        toValue(searchQuery)
      )
    ),
    queryFn: () =>
      searchFacet(toValue(mode), toValue(facet), toValue(searchQuery)),
    enabled: options?.enabled ? computed(() => toValue(options.enabled)) : true,
    staleTime: 1000 * 60 * 10
  });
}
