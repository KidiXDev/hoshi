import assert from 'node:assert/strict';
import { civitaiImageId, normalizeModelFilename } from './civitai';

assert.equal(
  normalizeModelFilename('external\\portraits\\Model.SAFETENSORS'),
  'model.safetensors'
);
assert.equal(
  normalizeModelFilename('portraits/model.safetensors'),
  'model.safetensors'
);

const cdn = 'https://image.civitai.com/xG1n/73328087-0980/original=true';
assert.equal(
  civitaiImageId({ url: `${cdn}/140742447.jpeg`, width: 1, height: 1 }),
  140742447
);
assert.equal(
  civitaiImageId({ id: 7, url: `${cdn}/140742447.jpeg`, width: 1, height: 1 }),
  7
);
assert.equal(
  civitaiImageId({ url: `${cdn}/a84ad265-2ae7.jpeg`, width: 1, height: 1 }),
  null
);

console.log('Civitai model filename matching and image ids: OK');
