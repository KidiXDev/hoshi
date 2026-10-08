import { VueQueryPlugin } from '@tanstack/vue-query';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { createPinia } from 'pinia';
import { createApp } from 'vue';
import 'vue-sonner/style.css';
import App from './App.vue';
import { queryClient } from './lib/queryClient';
import './main.css';
import router from './router';
import { isNativeBrowserShortcut } from './utils/browserShortcuts';

const app = createApp(App);

function blockStrayDrop(event: DragEvent) {
  const types = event.dataTransfer?.types ?? [];
  if (
    event.defaultPrevented ||
    !(types.includes('Files') || types.includes('text/uri-list')) ||
    (event.target as Element | null)?.closest?.(
      'input, textarea, [contenteditable]'
    )
  )
    return;
  event.preventDefault();
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'none';
}
window.addEventListener('dragover', blockStrayDrop);
window.addEventListener('drop', blockStrayDrop);

if (import.meta.env.PROD) {
  document.addEventListener('contextmenu', (event) => event.preventDefault());
  window.addEventListener(
    'keydown',
    (event) => {
      if (isNativeBrowserShortcut(event)) event.preventDefault();
    },
    { capture: true }
  );
}

app.use(createPinia());
app.use(router);
app.use(VueQueryPlugin, { queryClient });

app.mount('#app');

requestAnimationFrame(() => {
  void getCurrentWindow()
    .show()
    .catch(() => {
      // Browser preview mode.
    });
});
