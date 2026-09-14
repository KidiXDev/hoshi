import * as tauriCore from '@tauri-apps/api/core';
import { mock, test } from 'bun:test';
import assert from 'node:assert/strict';
import { createPinia, setActivePinia } from 'pinia';
import { nextTick } from 'vue';

let registerImages;
let savedItems;
const registered = new Promise((resolve) => {
  registerImages = resolve;
});
mock.module('../src/services/appStorage', () => ({
  loadAppData: async () => [
    {
      id: 'image-1',
      filename: 'face.png',
      subfolder: '',
      type: 'output',
      imageUrl: 'http://koharu-image.localhost/full/history-old'
    }
  ],
  saveAppData: async (_, items) => {
    savedItems = JSON.parse(JSON.stringify(items));
  },
  deleteAppData: async () => {}
}));
mock.module('@tauri-apps/api/core', () => ({
  ...tauriCore,
  invoke: async (command) => {
    assert.equal(command, 'resolve_history_images');
    await registered;
    return { 'image-1': 'history-old' };
  }
}));
const { useHistoryStore } = await import('../src/stores/historyStore');
const { useLauncherStore } = await import('../src/stores/launcherStore');
test('restores history only after file registration and removes individual items', async () => {
  setActivePinia(createPinia());
  const history = useHistoryStore();
  await nextTick();
  assert.equal(history.items.length, 1);
  assert.equal(history.items[0].imageUrl, '');
  useLauncherStore().config.workingDir = 'configured-comfy';
  await nextTick();
  assert.equal(
    history.items[0].imageUrl,
    '',
    'Do not render a URL before backend registration'
  );
  registerImages();
  await new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
  assert.match(history.items[0].imageUrl, /history-old\?session=\d+$/u);
  history.removeHistory('image-1');
  assert.equal(history.items.length, 0);
  assert.deepEqual(savedItems, []);
  console.log('History startup registration and item removal checks passed');
});
