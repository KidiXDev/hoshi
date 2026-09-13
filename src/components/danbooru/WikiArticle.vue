<script setup lang="ts">
import { computed } from 'vue';
import DOMPurify from 'dompurify';
import { useRouter } from 'vue-router';
import {
  Clock,
  Copy,
  ExternalLink,
  Image as ImageIcon,
  Sparkles
} from '@lucide/vue';
import { toast } from 'vue-sonner';
import { openUrl } from '@tauri-apps/plugin-opener';
import { isTauri } from '@tauri-apps/api/core';
import { Button } from '@/components/ui/button';
import { renderWikiDtext } from '@/services/danbooruDtext';
import { DANBOORU_URL, type WikiPost } from '@/services/danbooruWiki';
import { useWorkflowStore } from '@/stores/workflowStore';

const props = withDefaults(
  defineProps<{
    body: string;
    posts: WikiPost[];
    title?: string;
    updatedAt?: string;
  }>(),
  {
    title: '',
    updatedAt: ''
  }
);

const router = useRouter();
const workflowStore = useWorkflowStore();

const displayTitle = computed(() =>
  props.title ? props.title.replaceAll('_', ' ') : ''
);

const rawTag = computed(() =>
  props.title ? props.title.replaceAll(' ', '_').toLowerCase() : ''
);

const formattedDate = computed(() => {
  if (!props.updatedAt) return '';
  try {
    return new Date(props.updatedAt).toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    });
  } catch {
    return '';
  }
});

const html = computed(() =>
  DOMPurify.sanitize(renderWikiDtext(props.body, props.posts), {
    ALLOWED_TAGS: [
      'div',
      'p',
      'br',
      'hr',
      'a',
      'span',
      'img',
      'h1',
      'h2',
      'h3',
      'h4',
      'h5',
      'h6',
      'ul',
      'ol',
      'li',
      'b',
      'strong',
      'i',
      'em',
      'u',
      's',
      'del',
      'code',
      'pre',
      'blockquote',
      'aside',
      'details',
      'summary',
      'table',
      'thead',
      'tbody',
      'tr',
      'th',
      'td'
    ],
    ALLOWED_ATTR: [
      'href',
      'src',
      'alt',
      'loading',
      'id',
      'class',
      'colspan',
      'rowspan',
      'target',
      'rel',
      'title'
    ],
    ALLOWED_URI_REGEXP:
      /^(?:(?:(?:f|ht)tps?|danbooru-image):|\/|data:image\/)/iu
  })
);

function handleCopyTag() {
  if (!rawTag.value) return;
  void navigator.clipboard.writeText(rawTag.value);
  toast.success(`Copied "${rawTag.value}" to clipboard!`);
}

function handleSendToWorkflow() {
  if (!rawTag.value) return;
  const current = workflowStore.positivePrompt.trim();
  if (current) {
    workflowStore.positivePrompt = `${current}, ${rawTag.value}`;
  } else {
    workflowStore.positivePrompt = rawTag.value;
  }
  toast.success(`Appended "${rawTag.value}" to Workflow Generator prompt!`);
}

function handleSearchInBooru() {
  if (!rawTag.value) return;
  void router.push({
    path: '/booru',
    query: { q: rawTag.value }
  });
}

async function openOfficial() {
  if (!props.title) return;
  const url = `${DANBOORU_URL}/wiki_pages/${encodeURIComponent(props.title)}`;
  if (isTauri()) {
    await openUrl(url).catch(console.error);
  } else {
    window.open(url, '_blank', 'noopener,noreferrer');
  }
}

async function navigate(event: MouseEvent) {
  const anchor = (event.target as Element).closest('a');
  const href = anchor?.getAttribute('href');
  if (!href) return;
  event.preventDefault();

  if (href.startsWith('/danbooru-wiki/')) {
    await router.push(href);
    return;
  }
  if (href.startsWith('#')) {
    const id = CSS.escape(decodeURIComponent(href.slice(1)));
    document.querySelector(`#${id}`)?.scrollIntoView({ behavior: 'smooth' });
    return;
  }
  const url = new URL(href, DANBOORU_URL);
  if (!['https:', 'http:'].includes(url.protocol)) return;
  if (isTauri()) {
    await openUrl(url.href).catch(console.error);
  } else {
    window.open(url.href, '_blank', 'noopener,noreferrer');
  }
}
</script>

<template>
  <div class="space-y-4">
    <!-- Clean Document Header -->
    <header v-if="title" class="border-border/50 border-b pb-3">
      <div class="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1
            class="text-foreground text-xl font-bold tracking-tight capitalize"
          >
            {{ displayTitle }}
          </h1>
          <div class="mt-1 flex flex-wrap items-center gap-2 text-xs">
            <span
              class="border-border bg-secondary/80 text-secondary-foreground rounded px-1.5 py-0.5 font-mono text-xs font-medium"
            >
              {{ rawTag }}
            </span>
            <span
              v-if="formattedDate"
              class="text-muted-foreground flex items-center gap-1 text-xs"
            >
              <Clock class="size-3" />
              <span>Updated {{ formattedDate }}</span>
            </span>
          </div>
        </div>

        <!-- Document Quick Actions -->
        <div class="flex flex-wrap items-center gap-1.5">
          <Button
            variant="outline"
            size="sm"
            class="h-7 gap-1.5 text-xs font-medium"
            @click="handleSendToWorkflow"
          >
            <Sparkles class="size-3 text-amber-400" />
            <span>Use in Prompt</span>
          </Button>

          <Button
            variant="outline"
            size="sm"
            class="h-7 gap-1.5 text-xs"
            @click="handleSearchInBooru"
          >
            <ImageIcon class="size-3 text-blue-400" />
            <span>Search Booru</span>
          </Button>

          <Button
            variant="ghost"
            size="sm"
            class="text-muted-foreground hover:text-foreground h-7 gap-1.5 text-xs"
            @click="handleCopyTag"
          >
            <Copy class="size-3" />
            <span>Copy</span>
          </Button>

          <Button
            variant="ghost"
            size="sm"
            class="text-muted-foreground hover:text-foreground h-7 gap-1.5 text-xs"
            @click="openOfficial"
          >
            <ExternalLink class="size-3" />
            <span>Danbooru</span>
          </Button>
        </div>
      </div>
    </header>

    <!-- Clean Document Body -->
    <article
      class="wiki-article text-sm leading-relaxed"
      @click="navigate"
      v-html="html"
    />
  </div>
</template>

<style scoped>
.wiki-article {
  overflow-wrap: anywhere;
  color: var(--foreground);
}

.wiki-article :deep(p) {
  margin: 0.5rem 0;
  line-height: 1.6;
  color: var(--foreground);
  opacity: 0.9;
}

.wiki-article :deep(a) {
  color: var(--primary);
  text-decoration: none;
  font-weight: 500;
  transition: opacity 0.15s ease;
}

.wiki-article :deep(a:hover) {
  text-decoration: underline;
  opacity: 0.85;
}

/* Headings */
.wiki-article :deep(h1),
.wiki-article :deep(h2),
.wiki-article :deep(h3),
.wiki-article :deep(h4),
.wiki-article :deep(h5),
.wiki-article :deep(h6) {
  font-weight: 600;
  scroll-margin-top: 4.5rem;
  color: var(--foreground);
}

.wiki-article :deep(h1) {
  font-size: 1.25rem;
  margin: 1.5rem 0 0.5rem;
  padding-bottom: 0.35rem;
  border-bottom: 1px solid var(--border);
}

.wiki-article :deep(h2) {
  font-size: 1.15rem;
  margin: 1.25rem 0 0.4rem;
  padding-bottom: 0.25rem;
  border-bottom: 1px solid var(--border);
}

.wiki-article :deep(h3) {
  font-size: 1rem;
  margin: 1rem 0 0.35rem;
}

.wiki-article :deep(h4) {
  font-size: 0.875rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--muted-foreground);
  margin: 1.25rem 0 0.35rem;
}

.wiki-article :deep(h5),
.wiki-article :deep(h6) {
  font-size: 0.8125rem;
  font-weight: 600;
  color: var(--muted-foreground);
  margin: 0.85rem 0 0.25rem;
}

/* Standard Lists */
.wiki-article :deep(ul) {
  padding-left: 1.25rem;
  margin: 0.4rem 0;
  list-style-type: disc;
}

.wiki-article :deep(ol) {
  padding-left: 1.25rem;
  margin: 0.4rem 0;
  list-style-type: decimal;
}

.wiki-article :deep(li) {
  margin: 0.2rem 0;
  line-height: 1.5;
  color: var(--foreground);
  opacity: 0.9;
}

/* Illustrated list items with post thumbnails */
.wiki-article :deep(ul:has(> li > .wiki-post-item)) {
  list-style: none;
  padding: 0;
  margin: 1rem 0 2rem;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
  gap: 1.5rem 1.25rem;
}

.wiki-article :deep(li:has(> .wiki-post-item)) {
  list-style: none;
  margin: 0;
  padding: 0;
}

.wiki-article :deep(.wiki-post-item) {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  padding: 0;
  background: transparent;
  border: none;
  margin: 0;
}

.wiki-article :deep(.wiki-post-thumb) {
  position: relative;
  width: 100%;
  aspect-ratio: 3 / 4;
  height: auto;
  border-radius: 0.5rem;
  overflow: hidden;
  background: var(--muted);
  border: 1px solid var(--border);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  text-decoration: none !important;
  transition: border-color 0.15s ease;
}

.wiki-article :deep(.wiki-post-thumb:hover) {
  border-color: var(--primary);
}

.wiki-article :deep(.wiki-post-thumb img) {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.wiki-article :deep(.wiki-post-id) {
  position: absolute;
  bottom: 0.35rem;
  right: 0.35rem;
  background: rgba(0, 0, 0, 0.7);
  backdrop-filter: blur(4px);
  color: rgba(255, 255, 255, 0.9);
  font-size: 0.6875rem;
  font-family: monospace;
  padding: 0.1rem 0.4rem;
  border-radius: 0.25rem;
  line-height: 1.2;
}

.wiki-article :deep(.wiki-no-thumb) {
  font-size: 0.75rem;
  color: var(--muted-foreground);
  font-family: monospace;
}

.wiki-article :deep(.wiki-post-content) {
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
  padding: 0.1rem 0.15rem 0;
}

.wiki-article :deep(.wiki-post-title) {
  font-size: 0.875rem;
  font-weight: 600;
  line-height: 1.35;
  color: var(--foreground);
}

.wiki-article :deep(.wiki-post-title a) {
  color: var(--primary);
  text-decoration: none;
  transition: opacity 0.15s ease;
}

.wiki-article :deep(.wiki-post-title a:hover) {
  text-decoration: underline;
  opacity: 0.85;
}

.wiki-article :deep(.wiki-post-desc) {
  font-size: 0.75rem;
  line-height: 1.45;
  color: var(--muted-foreground);
  overflow-wrap: break-word;
}

/* Standalone .wiki-post-embed (when outside list) */
.wiki-article :deep(.wiki-post-embed) {
  display: inline-flex;
  vertical-align: middle;
  align-items: center;
  gap: 0.35rem;
  padding: 0.2rem 0.4rem;
  margin: 0.15rem 0.25rem;
  border: 1px solid var(--border);
  border-radius: 0.375rem;
  background: transparent;
  font-size: 0.75rem;
  text-decoration: none !important;
  transition: border-color 0.15s ease;
}

.wiki-article :deep(.wiki-post-embed:hover) {
  border-color: var(--primary);
}

.wiki-article :deep(.wiki-post-embed img) {
  width: 28px;
  height: 28px;
  object-fit: cover;
  border-radius: 0.25rem;
  display: block;
}

.wiki-article :deep(.wiki-post-embed span),
.wiki-article :deep(.wiki-post-ref) {
  color: var(--muted-foreground);
  font-size: 0.75rem;
  font-family: monospace;
}

.wiki-article :deep(.wiki-post-ref:hover) {
  color: var(--primary);
  text-decoration: underline;
}

.wiki-article :deep(img) {
  max-width: 100%;
  height: auto;
  border-radius: 0.375rem;
}

/* Details / Collapsible (Table of Contents, Spoilers) */
.wiki-article :deep(details) {
  padding: 0.45rem 0.75rem;
  border: 1px solid var(--border);
  border-radius: 0.375rem;
  margin: 0.75rem 0;
  background: transparent;
  font-size: 0.8125rem;
}

.wiki-article :deep(summary) {
  cursor: pointer;
  font-weight: 500;
  color: var(--foreground);
  user-select: none;
  outline: none;
}

.wiki-article :deep(details[open] summary) {
  margin-bottom: 0.4rem;
}

.wiki-article :deep(details ul) {
  margin: 0.25rem 0;
  padding-left: 1.25rem;
}

.wiki-article :deep(blockquote),
.wiki-article :deep(aside) {
  padding: 0.5rem 0.75rem;
  border: 1px solid var(--border);
  border-left: 3px solid var(--primary);
  border-radius: 0.375rem;
  margin: 0.75rem 0;
  background: transparent;
  font-size: 0.8125rem;
}

/* Tables */
.wiki-article :deep(table) {
  display: block;
  overflow-x: auto;
  border-collapse: collapse;
  margin: 0.85rem 0;
  width: 100%;
  font-size: 0.8125rem;
}

.wiki-article :deep(th) {
  background: var(--muted);
  font-weight: 600;
  text-align: left;
  padding: 0.4rem 0.75rem;
  border: 1px solid var(--border);
}

.wiki-article :deep(td) {
  padding: 0.4rem 0.75rem;
  border: 1px solid var(--border);
}

/* Code */
.wiki-article :deep(pre) {
  overflow-x: auto;
  padding: 0.5rem 0.75rem;
  background: var(--muted);
  border-radius: 0.375rem;
  border: 1px solid var(--border);
  font-family: monospace;
  font-size: 0.8rem;
  margin: 0.65rem 0;
}

.wiki-article :deep(code) {
  padding: 0.1rem 0.3rem;
  background: var(--muted);
  border-radius: 0.25rem;
  font-family: monospace;
  font-size: 0.8em;
}

.wiki-article :deep(pre code) {
  padding: 0;
  background: transparent;
}
</style>
