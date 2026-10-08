import {
  loadAppData,
  saveAppData,
  type AppDataName
} from '@/services/appStorage';
import { watchDebounced } from '@vueuse/core';
import { ref, type Ref } from 'vue';

export function usePersistedState<T extends object>(
  key: AppDataName,
  defaults: () => T,
  normalize: (saved: Partial<T>, defaults: T) => T
) {
  const state = ref(defaults()) as Ref<T>;
  const loaded = ref(false);
  watchDebounced(
    () => state.value,
    () => {
      if (loaded.value) void saveAppData(key, state.value).catch(console.error);
    },
    { deep: true, debounce: 400 }
  );
  const ready = loadAppData<Partial<T>>(key)
    .then((saved) => {
      if (saved) state.value = normalize(saved, defaults());
    })
    .catch((error) => console.error(`Could not load ${key}`, error))
    .finally(() => {
      loaded.value = true;
    });
  return { state, loaded, ready };
}
