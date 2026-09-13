import { marked } from 'marked';
import {
  DANBOORU_URL,
  danbooruMediaUrl,
  wikiPath,
  type WikiPost
} from './danbooruWiki';

function escapeHtml(text: string) {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export function renderWikiDtext(body: string, posts: WikiPost[] = []) {
  const previews = new Map(
    posts.map((post) => [post.id, danbooruMediaUrl(post.preview_file_url)])
  );

  const literals: string[] = [];
  function addLiteral(html: string): string {
    literals.push(html);
    return `%%DANBOORU_LIT_${literals.length - 1}%%`;
  }

  const text = body
    .replaceAll('\r\n', '\n')
    // 1. Code blocks and raw text (protect from any processing)
    .replaceAll(
      /\[(code|nodtext)\]([\s\S]*?)\[\/\1\]/giu,
      (_, tag: string, content: string) => {
        const html =
          tag.toLowerCase() === 'code'
            ? `<pre><code>${escapeHtml(content)}</code></pre>`
            : escapeHtml(content);
        return addLiteral(html);
      }
    )
    // 2. Danbooru wiki page links [[title|label]]
    .replaceAll(
      /\[\[([^\]|]+)(?:\|([^\]]*))?\]\]/gu,
      (_, title: string, label?: string) => {
        const [page, anchor] = title.split('#');
        const path =
          wikiPath(page ?? title) +
          (anchor ? `#dtext-${encodeURIComponent(anchor)}` : '');
        const linkText = escapeHtml((label ?? title).replaceAll('_', ' '));
        return addLiteral(`<a href="${escapeHtml(path)}">${linkText}</a>`);
      }
    )
    // 3. Post tag search links {{tags|label}}
    .replaceAll(
      /\{\{([^}|]+)(?:\|([^}]+))?\}\}/gu,
      (_, tags: string, label?: string) => {
        const url = `${DANBOORU_URL}/posts?tags=${encodeURIComponent(tags)}`;
        return addLiteral(
          `<a href="${escapeHtml(url)}">${escapeHtml(label || tags)}</a>`
        );
      }
    )
    // 4. Quoted web links "label":url
    .replaceAll(
      /"([^"\n]+)":(?:\[([^\]\n]+)\]|((?:https?:\/\/|\/|#)[^\s]+))/gu,
      (_, label: string, bracketUrl: string, plainUrl: string) => {
        const rawUrl = bracketUrl || plainUrl;
        const url = rawUrl.startsWith('/') ? DANBOORU_URL + rawUrl : rawUrl;
        return addLiteral(
          `<a href="${escapeHtml(url)}">${escapeHtml(label)}</a>`
        );
      }
    )
    // 5. Illustrated list items: * !post #1234: <rest of line>
    .replaceAll(
      /^(\*+)\s*!post\s*(?:#|:)(\d+)(?:\s*:\s*)?(.*)$/gmu,
      (_, stars: string, id: string, rest: string) => {
        const cleanRest = rest.trim();
        const splitMatch = cleanRest.match(
          /^((?:%%DANBOORU_LIT_\d+%%|\[\[[^\]]+\]\]|\([^)]+\)|[a-z0-9_\s,]|and)+?)(?:\s*:\s*|\s+-\s+|\s+—\s+)(.+)$/iu
        );

        let tagPart = cleanRest;
        let descPart = '';
        if (splitMatch) {
          tagPart = splitMatch[1].trim().replace(/[:\s—-]+$/u, '');
          descPart = splitMatch[2].trim().replace(/^[:\s—-]+/u, '');
        }

        const preview = previews.get(Number(id));
        const hasValidUrl =
          preview &&
          (preview.includes('donmai.us') ||
            preview.includes('danbooru-image') ||
            preview.startsWith('http://') ||
            preview.startsWith('https://'));
        const image = hasValidUrl
          ? `<img src="${escapeHtml(preview)}" alt="Post #${id}" loading="lazy" />`
          : `<span class="wiki-no-thumb">#${id}</span>`;

        const titleContent =
          tagPart || `<a href="${DANBOORU_URL}/posts/${id}">Post #${id}</a>`;
        const descContent = descPart
          ? `<div class="wiki-post-desc">${descPart}</div>`
          : '';

        const itemHtml = `<div class="wiki-post-item"><a class="wiki-post-thumb" href="${DANBOORU_URL}/posts/${id}" target="_blank" rel="noopener noreferrer">${image}<span class="wiki-post-id">#${id}</span></a><div class="wiki-post-content"><div class="wiki-post-title">${titleContent}</div>${descContent}</div></div>`;
        return `${stars} ${addLiteral(itemHtml)}`;
      }
    )
    // 6. Generic post mentions: !post #1234 or post #1234
    .replaceAll(
      /(!?)post\s*(?:#|:)(\d+)(:\s*)?/giu,
      (_, embedded: string, id: string, colon: string) => {
        const preview = previews.get(Number(id));
        const hasValidUrl =
          preview &&
          (preview.includes('donmai.us') ||
            preview.includes('danbooru-image') ||
            preview.startsWith('http://') ||
            preview.startsWith('https://'));
        const image =
          embedded && hasValidUrl
            ? `<img src="${escapeHtml(preview)}" alt="Post #${id}" loading="lazy" />`
            : '';
        const trailingColon = !embedded && colon ? colon : '';
        const html = `<a class="${embedded ? 'wiki-post' : ''}" href="${DANBOORU_URL}/posts/${id}">${image}<span>Post #${id}${embedded && !image ? ' · preview unavailable' : ''}</span></a>${trailingColon}`;
        return addLiteral(html);
      }
    )
    // 7. Headings h1-h6
    .replaceAll(
      /^h([1-6])(?:#([\w-]+))?\.\s+(.+)$/gmu,
      (_, level: string, anchor: string, headingTitle: string) =>
        `<h${level}${anchor ? ` id="dtext-${anchor}"` : ''}>${headingTitle}</h${level}>\n`
    )
    // 8. Bullet points
    .replaceAll(
      /^(\*+) /gmu,
      (_, stars: string) => `${'  '.repeat(stars.length - 1)}- `
    )
    // 9. Collapsible expand sections
    .replaceAll(
      /\[expand(?:=([^\]]+))?\]/giu,
      (_, expandTitle: string) =>
        `<details><summary>${escapeHtml(expandTitle || 'Show more')}</summary>\n\n`
    )
    .replaceAll(/\[\/expand\]/giu, '\n\n</details>\n')
    // 10. Formatting tags
    .replaceAll(
      /\[(\/)?(b|i|u|s|table|thead|tbody|tr|th|td|br|hr)(\s[^\]]*)?\]/giu,
      '<$1$2$3>'
    )
    .replaceAll(/\[(\/)?quote\]/giu, '<$1blockquote>')
    .replaceAll(/\[(\/)?tn\]/giu, '<$1aside>')
    .replaceAll(/\[spoilers?\]/giu, '<details><summary>Spoiler</summary>\n\n')
    .replaceAll(/\[\/spoilers?\]/giu, '\n\n</details>');

  // Parse markdown
  let parsed = marked.parse(text, { async: false, breaks: true }) as string;

  // Restore protected literal tokens recursively (in case literals were nested inside literals)
  while (/%%DANBOORU_LIT_(\d+)%%/u.test(parsed)) {
    parsed = parsed.replaceAll(
      /%%DANBOORU_LIT_(\d+)%%/gu,
      (_, index: string) => literals[Number(index)] || ''
    );
  }

  return parsed;
}
