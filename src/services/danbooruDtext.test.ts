import { describe, expect, it } from 'vitest';
import { renderWikiDtext } from './danbooruDtext';

describe('renderWikiDtext', () => {
  const html = renderWikiDtext(
    [
      'h4#examples. Examples',
      '',
      '* !post #6031212: blue',
      '* !post #999',
      '',
      '[[blue eyes|Eyes]]',
      '',
      '[expand=More]',
      '[b]Bold[/b]',
      '[/expand]'
    ].join('\n'),
    [{ id: 6031212, preview_file_url: 'https://cdn.donmai.us/test.jpg' }]
  );

  it('anchors headings', () => {
    expect(html).toContain('id="dtext-examples"');
  });

  it('embeds known post previews and labels unknown posts', () => {
    expect(html).toContain('src="https://cdn.donmai.us/test.jpg"');
    expect(html).toContain('<span class="wiki-no-thumb">#999</span>');
  });

  it('renders wiki links, expand blocks and inline formatting', () => {
    expect(html).toContain('href="/danbooru-wiki/blue_eyes"');
    expect(html).toContain('<details>');
    expect(html).toContain('<b>Bold</b>');
  });

  it('refuses non-http preview URLs', () => {
    expect(
      renderWikiDtext('!post #1', [
        { id: 1, preview_file_url: 'javascript:alert(1)' }
      ])
    ).not.toContain('<img');
  });
});
