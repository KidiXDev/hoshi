import { useLocalStorage } from '@vueuse/core';

export function useGenerationDataPanel() {
  return useLocalStorage('generation-data-panel-open', true);
}
