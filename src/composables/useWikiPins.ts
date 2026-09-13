import { loadAppData, saveAppData } from '@/services/appStorage';
import { normalizeWikiTitle } from '@/services/danbooruWiki';
import { ref } from 'vue';

// Module-level so every wiki component shares one list.
const pins = ref<string[]>([]);
let loaded: Promise<void> | undefined;

export function useWikiPins() {
  loaded ??= loadAppData<{ pins?: unknown }>('danbooru_wiki_state')
    .then((state) => {
      if (Array.isArray(state?.pins))
        pins.value = state.pins.filter(
          (p): p is string => typeof p === 'string'
        );
    })
    .catch((error) => console.error('Failed to load wiki pins:', error));

  function isPinned(title: string) {
    return pins.value.includes(normalizeWikiTitle(title));
  }

  function togglePin(title: string) {
    const tag = normalizeWikiTitle(title);
    pins.value = pins.value.includes(tag)
      ? pins.value.filter((p) => p !== tag)
      : [...pins.value, tag];
    void saveAppData('danbooru_wiki_state', { pins: pins.value }).catch(
      (error) => console.error('Failed to save wiki pins:', error)
    );
    return pins.value.includes(tag);
  }

  return { pins, isPinned, togglePin };
}
