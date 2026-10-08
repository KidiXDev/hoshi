import assert from 'node:assert/strict';
import { renderWikiDtext } from '../src/services/danbooruDtext';
import {
  parseWikiGroups,
  wikiPath,
  wikiPostIds
} from '../src/services/danbooruWiki';

const groups = parseWikiGroups(
  '[expand=Table of Contents]\r\n* [[Ignore]]\r\n[/expand]\r\nh5#visual. Visual characteristics\r\nh6#body. Body\r\n* [[Tag group:Hair]]\r\n** [[blue eyes|Blue eyes]]\r\nh5#meta. Metatags\r\n* [[tag group:metatags]]'
);
assert.equal(groups.length, 2);
assert.equal(groups[0]?.category, 'Visual characteristics');
assert.deepEqual(groups[0]?.links[1], {
  title: 'blue eyes',
  label: 'Blue eyes',
  depth: 1
});
assert.equal(wikiPath('Tag group:Hair'), '/danbooru-wiki/tag_group%3Ahair');
assert.deepEqual(
  wikiPostIds('!post #6031212: blue\npost #6031212\n!post #5422440\npost:123'),
  [6031212, 5422440, 123]
);
const html = renderWikiDtext(
  'h4#examples. Examples\n\n* !post #6031212: blue\n* !post #999\n\n[[blue eyes|Eyes]]\n\n[expand=More]\n[b]Bold[/b]\n[/expand]',
  [{ id: 6031212, preview_file_url: 'https://cdn.donmai.us/test.jpg' }]
);
assert.ok(html.includes('id="dtext-examples"'));
assert.ok(html.includes('src="https://cdn.donmai.us/test.jpg"'));
assert.ok(html.includes('<span class="wiki-no-thumb">#999</span>'));
assert.ok(html.includes('href="/danbooru-wiki/blue_eyes"'));
assert.ok(html.includes('<details>'));
assert.ok(html.includes('<b>Bold</b>'));
assert.ok(
  !renderWikiDtext('!post #1', [
    { id: 1, preview_file_url: 'javascript:alert(1)' }
  ]).includes('<img')
);
console.log('Danbooru wiki parser checks passed');
