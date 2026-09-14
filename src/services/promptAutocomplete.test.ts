import assert from 'node:assert/strict';
import { getPromptTokenRange, replacePromptToken } from './promptAutocomplete';

const text = 'masterpiece, blu ha, cinematic';
const range = getPromptTokenRange(text, 19);
assert.ok(range);
assert.equal(range.query, 'blu_ha');
assert.equal(range.mode, 'tag');
assert.deepEqual(replacePromptToken(text, range, 'blue_hair'), {
  text: 'masterpiece, blue_hair, cinematic',
  cursor: 24
});
assert.deepEqual(
  replacePromptToken(text, range, 'blue_hair', {
    autocompleteReplaceUnderscores: true
  }),
  {
    text: 'masterpiece, blue hair, cinematic',
    cursor: 24
  }
);

const artistRange = getPromptTokenRange('masterpiece, @sak', 17);
assert.ok(artistRange);
assert.deepEqual(
  replacePromptToken('masterpiece, @sak', artistRange, 'sakura'),
  {
    text: 'masterpiece, @sakura, ',
    cursor: 22
  }
);
assert.deepEqual(
  replacePromptToken('masterpiece, @sak', artistRange, 'sakura', {
    autocompleteIncludeArtistPrefix: false
  }),
  {
    text: 'masterpiece, sakura, ',
    cursor: 21
  }
);

const wildcardRange = getPromptTokenRange('$pose', 5);
assert.ok(wildcardRange);
assert.equal(wildcardRange.mode, 'wildcard');
assert.deepEqual(
  replacePromptToken('$pose', wildcardRange, '__pose__', {
    autocompleteReplaceUnderscores: true
  }),
  {
    text: '__pose__, ',
    cursor: 10
  }
);

// Dynamic prompt groups: `{`, `|` and `}` bound the token being completed.
const dynamicText = '1girl, {red ha|blue hair} eyes';
const dynamicRange = getPromptTokenRange(dynamicText, 14);
assert.ok(dynamicRange);
assert.equal(dynamicRange.query, 'red_ha');
assert.deepEqual(replacePromptToken(dynamicText, dynamicRange, 'red_hair'), {
  text: '1girl, {red_hair|blue hair} eyes',
  cursor: 16
});

// Emphasis brackets: `(`/`[` open a token, `)`/`]`/`:weight` close it, escaped parens are tag text.
const openParen = getPromptTokenRange('masterpiece, (blu', 17);
assert.ok(openParen);
assert.equal(openParen.query, 'blu');
assert.deepEqual(
  replacePromptToken('masterpiece, (blu', openParen, 'blue_hair'),
  {
    text: 'masterpiece, (blue_hair',
    cursor: 23
  }
);
const closedParen = getPromptTokenRange('(blu), solo', 4);
assert.ok(closedParen);
assert.deepEqual(replacePromptToken('(blu), solo', closedParen, 'blue_hair'), {
  text: '(blue_hair), solo',
  cursor: 10
});
const weighted = getPromptTokenRange('(blue_ha:1.2), solo', 8);
assert.ok(weighted);
assert.equal(weighted.query, 'blue_ha');
assert.deepEqual(
  replacePromptToken('(blue_ha:1.2), solo', weighted, 'blue_hair'),
  { text: '(blue_hair:1.2), solo', cursor: 10 }
);
const bracket = getPromptTokenRange('[blu]', 4);
assert.ok(bracket);
assert.deepEqual(replacePromptToken('[blu]', bracket, 'blue_hair'), {
  text: '[blue_hair]',
  cursor: 10
});
const escaped = getPromptTokenRange('1girl, hatsune_miku_\\(voc', 25);
assert.ok(escaped);
assert.equal(escaped.start, 6);
assert.equal(escaped.query, 'hatsune_miku_\\(voc');
const colonTag = getPromptTokenRange('1girl, re:ze', 12);
assert.ok(colonTag);
assert.equal(colonTag.query, 're:ze');

// Parentheses in tag names are escaped for ComfyUI unless disabled; already-escaped ones stay single.
const seriesRange = getPromptTokenRange('1girl, hatsune', 14);
assert.ok(seriesRange);
assert.deepEqual(
  replacePromptToken('1girl, hatsune', seriesRange, 'hatsune_miku_(vocaloid)'),
  { text: '1girl, hatsune_miku_\\(vocaloid\\), ', cursor: 34 }
);
assert.deepEqual(
  replacePromptToken(
    '1girl, hatsune',
    seriesRange,
    'hatsune_miku_\\(vocaloid\\)'
  ),
  { text: '1girl, hatsune_miku_\\(vocaloid\\), ', cursor: 34 }
);
assert.deepEqual(
  replacePromptToken('1girl, hatsune', seriesRange, 'hatsune_miku_(vocaloid)', {
    autocompleteEscapeParentheses: false
  }),
  { text: '1girl, hatsune_miku_(vocaloid), ', cursor: 32 }
);
