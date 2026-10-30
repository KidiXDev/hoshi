<script setup lang="ts">
import { computed } from 'vue';
import { useRouter } from 'vue-router';
import DOMPurify from 'dompurify';
import { openUrl } from '@tauri-apps/plugin-opener';
import { civitaiModelLink } from '@/services/civitai';

const router = useRouter();
const props = defineProps<{ html?: string }>();
function sanitizeCivitaiHtml(rawHtml?: string): string {
  if (!rawHtml) return '';
  return DOMPurify.sanitize(rawHtml, {
    ALLOWED_TAGS: [
      'p',
      'br',
      'b',
      'i',
      'strong',
      'em',
      'u',
      's',
      'strike',
      'h1',
      'h2',
      'h3',
      'h4',
      'h5',
      'h6',
      'ul',
      'ol',
      'li',
      'blockquote',
      'pre',
      'code',
      'table',
      'thead',
      'tbody',
      'tr',
      'th',
      'td',
      'a',
      'img',
      'span',
      'div',
      'hr'
    ],
    ALLOWED_ATTR: [
      'href',
      'title',
      'alt',
      'src',
      'target',
      'rel',
      'class',
      'style',
      'width',
      'height'
    ],
    ALLOWED_URI_REGEXP:
      /^(?:(?:(?:f|ht)tps?|mailto|tel|callto|sms|cid|xmpp):|[^a-z]|[a-z+.-]+(?:[^a-z+.-:]|$))/iu,
    FORBID_TAGS: [
      'script',
      'iframe',
      'object',
      'embed',
      'form',
      'input',
      'button'
    ],
    FORBID_ATTR: [
      'onerror',
      'onload',
      'onclick',
      'onmouseover',
      'onfocus',
      'onblur'
    ]
  });
}
function handleDescriptionClick(event: MouseEvent) {
  const href = (event.target as HTMLElement).closest('a')?.getAttribute('href');
  if (!href) return;
  event.preventDefault();
  event.stopPropagation();
  let url: URL;
  try {
    url = new URL(href, 'https://civitai.com');
  } catch {
    return;
  }
  const link = civitaiModelLink(url);
  if (!link) {
    void openUrl(url.href);
    return;
  }
  void router.push({
    name: 'civitai-model-detail',
    params: { id: link.modelId },
    query: link.versionId ? { modelVersionId: link.versionId } : {}
  });
}
const sanitizedHtml = computed(() => sanitizeCivitaiHtml(props.html));
</script>
<template>
  <div class="civitai-rich-text select-text" @click="handleDescriptionClick">
    <div v-if="sanitizedHtml" v-html="sanitizedHtml" />
    <slot v-else />
  </div>
</template>
<style scoped>
.civitai-rich-text {
  font-size: 0.875rem;
  line-height: 1.625;
  color: var(--color-foreground);
  word-break: break-word;
}
.civitai-rich-text :deep(p) {
  margin-bottom: 0.75rem;
}
.civitai-rich-text :deep(h1) {
  font-size: 1.25rem;
  font-weight: 700;
  margin-top: 1.5rem;
  margin-bottom: 0.75rem;
  color: var(--color-foreground);
}
.civitai-rich-text :deep(h2) {
  font-size: 1.125rem;
  font-weight: 700;
  margin-top: 1.25rem;
  margin-bottom: 0.625rem;
  color: var(--color-foreground);
}
.civitai-rich-text :deep(h3),
.civitai-rich-text :deep(h4) {
  font-size: 1rem;
  font-weight: 600;
  margin-top: 1rem;
  margin-bottom: 0.5rem;
  color: var(--color-foreground);
}
.civitai-rich-text :deep(ul) {
  list-style-type: disc;
  padding-left: 1.5rem;
  margin-bottom: 0.75rem;
}
.civitai-rich-text :deep(ol) {
  list-style-type: decimal;
  padding-left: 1.5rem;
  margin-bottom: 0.75rem;
}
.civitai-rich-text :deep(li) {
  margin-bottom: 0.25rem;
}
.civitai-rich-text :deep(a) {
  color: var(--color-primary);
  text-decoration: underline;
  text-underline-offset: 3px;
  transition: opacity 0.15s ease;
}
.civitai-rich-text :deep(a:hover) {
  opacity: 0.8;
}
.civitai-rich-text :deep(blockquote) {
  border-left: 3px solid var(--color-primary);
  padding-left: 0.875rem;
  margin: 0.75rem 0;
  color: var(--color-muted-foreground);
  font-style: italic;
}
.civitai-rich-text :deep(code) {
  background-color: var(--color-muted);
  border: 1px solid var(--color-border);
  padding: 0.125rem 0.375rem;
  border-radius: 0.375rem;
  font-family: monospace;
  font-size: 0.75rem;
}
.civitai-rich-text :deep(pre) {
  background-color: var(--color-muted);
  border: 1px solid var(--color-border);
  padding: 0.75rem;
  border-radius: 0.5rem;
  overflow-x: auto;
  margin: 0.75rem 0;
  font-family: monospace;
  font-size: 0.75rem;
}
.civitai-rich-text :deep(img) {
  max-width: 100%;
  border-radius: 0.5rem;
  margin: 0.75rem 0;
  border: 1px solid var(--color-border);
}
.civitai-rich-text :deep(table) {
  width: 100%;
  border-collapse: collapse;
  margin: 0.75rem 0;
  font-size: 0.75rem;
}
.civitai-rich-text :deep(th),
.civitai-rich-text :deep(td) {
  border: 1px solid var(--color-border);
  padding: 0.5rem;
}
.civitai-rich-text :deep(th) {
  background-color: var(--color-muted);
  font-weight: 600;
  text-align: left;
}
.civitai-rich-text :deep(hr) {
  border-color: var(--color-border);
  margin: 1.25rem 0;
}
</style>
