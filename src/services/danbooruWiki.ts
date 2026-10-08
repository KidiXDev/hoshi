import { invoke, isTauri } from '@tauri-apps/api/core';
import { customSchemeUrl } from '../lib/customScheme';
import { http } from './httpClient';

export const DANBOORU_URL = 'https://danbooru.donmai.us';
export interface WikiPage {
  title: string;
  body: string;
  updated_at: string;
  is_deleted?: boolean;
}
export interface WikiGroup {
  title: string;
  category: string;
  links: { title: string; label: string; depth: number }[];
}
export interface WikiPost {
  id: number;
  preview_file_url?: string;
}

export function normalizeWikiTitle(title: string) {
  return title.trim().replaceAll(' ', '_').toLowerCase();
}
export function wikiPath(title: string) {
  return `/danbooru-wiki/${encodeURIComponent(normalizeWikiTitle(title))}`;
}
export function danbooruMediaUrl(rawUrl?: string): string {
  if (!rawUrl) return '';
  // Upgrade 180x180 thumbnail to crisp 360x360 variant
  let cleanPath = rawUrl.replace('/180x180/', '/360x360/');
  if (!isTauri()) return cleanPath;

  const cdnHttps = 'https://cdn.donmai.us/';
  const cdnHttp = 'http://cdn.donmai.us/';
  if (cleanPath.startsWith(cdnHttps)) {
    cleanPath = cleanPath.slice(cdnHttps.length);
  } else if (cleanPath.startsWith(cdnHttp)) {
    cleanPath = cleanPath.slice(cdnHttp.length);
  }

  return customSchemeUrl('danbooru-image', cleanPath);
}
export function wikiPostIds(body: string) {
  return [
    ...new Set(
      [...body.matchAll(/(?:!post\s*#|post\s+#|post:)(\d+)/giu)].map((match) =>
        Number(match[1])
      )
    )
  ].filter((id) => Number.isSafeInteger(id) && id > 0);
}
export function parseWikiGroups(body: string): WikiGroup[] {
  const groups: WikiGroup[] = [];
  let category = 'Tag groups';
  let current: WikiGroup | undefined;
  for (const line of body
    .replaceAll(/\[expand=Table of Contents\][\s\S]*?\[\/expand\]/giu, '')
    .split(/\r?\n/u)) {
    const heading = line.match(/^h([1-6])(?:#[\w-]+)?\.\s+(.+)$/u);
    if (heading) {
      const headingTitle = heading[2] ?? '';
      if (Number(heading[1]) < 6) category = headingTitle;
      current = { title: headingTitle, category, links: [] };
      groups.push(current);
    } else if (/^\*+\s/u.test(line)) {
      const depth = (line.match(/^\*+/u)?.[0].length ?? 1) - 1;
      for (const match of line.matchAll(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/gu)) {
        if (!current) {
          current = { title: category, category, links: [] };
          groups.push(current);
        }
        current.links.push({
          title: match[1] ?? '',
          label: (match[2] || match[1] || '')
            .replace(/^tag group:/iu, '')
            .replaceAll('_', ' '),
          depth
        });
      }
    }
  }
  return groups.filter((group) => group.links.length);
}

async function request<T>(
  title?: string,
  postIds?: number[],
  signal?: AbortSignal
): Promise<T> {
  if (isTauri()) return invoke<T>('danbooru_wiki_request', { title, postIds });
  const path = title
    ? `/wiki_pages/${encodeURIComponent(title)}.json`
    : `/posts.json?${new URLSearchParams({ tags: `id:${postIds?.join(',') ?? ''}`, limit: '100', only: 'id,preview_file_url' })}`;
  return await http.get<T>(`${DANBOORU_URL}${path}`, { signal });
}
export async function fetchWikiPage(title: string, signal?: AbortSignal) {
  const page = await request<WikiPage>(
    normalizeWikiTitle(title),
    undefined,
    signal
  );
  if (
    typeof page.title !== 'string' ||
    typeof page.body !== 'string' ||
    page.is_deleted
  )
    throw new Error('This wiki page is unavailable.');
  return page;
}
export async function fetchWikiPosts(ids: number[], signal: AbortSignal) {
  const posts: WikiPost[] = [];
  for (let offset = 0; offset < ids.length; offset += 100) {
    signal.throwIfAborted();
    posts.push(
      ...(await request<WikiPost[]>(
        undefined,
        ids.slice(offset, offset + 100),
        signal
      ))
    );
  }
  return posts;
}
