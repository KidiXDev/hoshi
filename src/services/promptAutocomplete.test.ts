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
assert.deepEqual(replacePromptToken(text, range, 'blue_hair', true), {
  text: 'masterpiece, blue hair, cinematic',
  cursor: 24
});

const artistRange = getPromptTokenRange('masterpiece, @sak', 17);
assert.ok(artistRange);
assert.deepEqual(
  replacePromptToken('masterpiece, @sak', artistRange, 'sakura', false),
  {
    text: 'masterpiece, @sakura, ',
    cursor: 22
  }
);
assert.deepEqual(
  replacePromptToken('masterpiece, @sak', artistRange, 'sakura', false, false),
  {
    text: 'masterpiece, sakura, ',
    cursor: 21
  }
);

const wildcardRange = getPromptTokenRange('$pose', 5);
assert.ok(wildcardRange);
assert.equal(wildcardRange.mode, 'wildcard');
assert.deepEqual(replacePromptToken('$pose', wildcardRange, '__pose__', true), {
  text: '__pose__, ',
  cursor: 10
});

// Dynamic prompt groups: `{`, `|` and `}` bound the token being completed.
const dynamicText = '1girl, {red ha|blue hair} eyes';
const dynamicRange = getPromptTokenRange(dynamicText, 14);
assert.ok(dynamicRange);
assert.equal(dynamicRange.query, 'red_ha');
assert.deepEqual(replacePromptToken(dynamicText, dynamicRange, 'red_hair'), {
  text: '1girl, {red_hair|blue hair} eyes',
  cursor: 16
});
