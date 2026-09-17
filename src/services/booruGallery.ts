import { invoke } from '@tauri-apps/api/core';

export interface BooruSource {
  source: string;
  displayName: string;
  ratings: string[];
  sortValues: string[];
  pagination: string;
  maxPageSize: number;
  authFields: string[];
  authRequired: boolean;
  credentialsUrl: string;
  categorizedTags: boolean;
  favoriteRead: boolean;
  favoriteWrite: boolean;
  rankingPeriods: string[];
  pageJump: boolean;
  detailHydration: boolean;
  download: boolean;
  tagSearch: boolean;
  maxSearchTags: number | null;
}

export interface BooruPost {
  source: string;
  postId: string;
  postUrl: string;
  previewUrl: string;
  sampleUrl: string;
  width: number;
  height: number;
  rating: string;
  createdAt: string;
  favorite: boolean | null;
  score: number;
  favCount: number;
}

export interface BooruPostDetail extends BooruPost {
  mediaUrl: string;
  fileExt: string;
  fileSize: number;
  tags: Record<string, string[]>;
  complete: boolean;
}

export interface BooruPage {
  posts: BooruPost[];
  nextCursor: string | null;
  ended: boolean;
  warnings: string[];
  page: number;
  total?: number;
}

export interface BooruSettings {
  defaultSource: string;
  blacklist: string[];
  outputFilterTags: string[];
  promptDefaults: {
    categories: string[];
    replaceUnderscores: boolean;
    escapeParentheses: boolean;
  };
  timeout: number;
  cacheBudgetMiB: number;
  credentialStatus: Record<string, Record<string, boolean>>;
}

export interface BooruCredentials {
  danbooru: { username: string; apiKey: string };
  gelbooru: { userId: string; apiKey: string };
  rule34: { userId: string; apiKey: string };
  konachan: { cookie: string; userAgent: string };
}

export function normalizeBooruRatings(
  available: string[],
  saved?: string[]
): string[] {
  if (available.length < 2) return [...available];
  const supported = saved?.filter((rating) => available.includes(rating));
  if (saved?.length === 0 || supported?.length) return supported ?? [];
  return available.includes('general') ? ['general'] : [available[0]];
}

export function fetchBooruSources() {
  return invoke<BooruSource[]>('booru_sources');
}

export function searchBooru(options: {
  source: string;
  query: string;
  ratings: string[];
  sort: string;
  cursor?: string | null;
  limit?: number;
  page?: number;
  random?: boolean;
}) {
  return invoke<BooruPage>('booru_search', { request: options });
}

export function fetchBooruDetail(source: string, postId: string) {
  return invoke<BooruPostDetail>('booru_detail', { source, postId });
}

export function getBooruMediaUrl(source: string, url: string) {
  const query = new URLSearchParams({ source, url });
  return navigator.userAgent.includes('Windows')
    ? `http://booru-image.localhost/?${query}`
    : `booru-image://localhost/?${query}`;
}

export function fetchBooruSettings() {
  return invoke<BooruSettings>('booru_settings_get');
}

export interface BooruSettingsUpdate {
  defaultSource?: string;
  blacklist?: string[];
  outputFilterTags?: string[];
  promptDefaults?: BooruSettings['promptDefaults'];
  timeout?: number;
  cacheBudgetMiB?: number;
  credentials?: Partial<BooruCredentials>;
  clearCredentials?: Partial<Record<keyof BooruCredentials | string, string[]>>;
}

export function saveBooruSettings(update: BooruSettingsUpdate) {
  return invoke<BooruSettings>('booru_settings_save', { update });
}

export function clearBooruCache() {
  return invoke<{ ok: boolean }>('booru_clear_cache');
}

export function testBooruCredentials(
  source: string,
  credentials: Record<string, string>
) {
  return invoke<{ ok: boolean }>('booru_test_credentials', {
    source,
    credentials
  });
}

export function fetchBooruRanking(request: {
  source: string;
  period: string;
  ratings: string[];
  cursor?: string | null;
  limit?: number;
  page?: number;
  random?: boolean;
}) {
  return invoke<BooruPage>('booru_ranking', { request });
}

export function fetchBooruFavorites(request: {
  source: string;
  cursor?: string | null;
  limit?: number;
  page?: number;
  random?: boolean;
}) {
  return invoke<BooruPage>('booru_favorites', { request });
}

export function setBooruFavorite(
  source: string,
  postId: string,
  favorite: boolean
) {
  return invoke<{ favorite: boolean }>('booru_favorite_set', {
    source,
    postId,
    favorite
  });
}

export function buildBooruPrompt(
  tags: Record<string, string[]>,
  defaults: BooruSettings['promptDefaults'],
  outputFilterTags: string[] = []
) {
  const excluded = new Set(outputFilterTags);
  const seen = new Set<string>();
  const result: string[] = [];
  for (const category of defaults.categories) {
    for (const tag of tags[category] ?? []) {
      if (seen.has(tag) || excluded.has(tag)) continue;
      seen.add(tag);
      let value = defaults.replaceUnderscores ? tag.replaceAll('_', ' ') : tag;
      if (defaults.escapeParentheses) {
        value = value.replaceAll('(', '\\(').replaceAll(')', '\\)');
      }
      result.push(value);
    }
  }
  return result.join(', ');
}

export function formatBooruWarnings(warnings: string[]) {
  return warnings.flatMap((warning) => {
    if (warning === 'local-blacklist-filtered') return [];
    if (warning === 'restricted-media-hidden') {
      return ['Some restricted posts are unavailable for this account.'];
    }
    return [warning.replaceAll('-', ' ')];
  });
}

export function solveBooruCloudflare(source: string = 'konachan.com') {
  return invoke<{ ok: boolean; message: string }>('booru_solve_cloudflare', {
    source
  });
}
