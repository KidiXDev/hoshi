import { usePersistedState } from '@/composables/usePersistedState';
import type {
  LoraItem,
  ModelSettings,
  UltimateUpscaleSettings
} from '@/types/workflow';
import { defineStore } from 'pinia';
import { DEFAULT_ULTIMATE_UPSCALE, normalizeLoras } from './workflowStore';

interface UltimateUpscalePreferences {
  models: ModelSettings;
  loras: LoraItem[];
  settings: UltimateUpscaleSettings;
  positivePrompt: string;
  negativePrompt: string;
  seed: number;
}

export const useUltimateUpscaleStore = defineStore('ultimate-upscale', () => {
  const { state, loaded } = usePersistedState<UltimateUpscalePreferences>(
    'ultimate_upscale_preferences',
    () => ({
      models: { unetName: '', clipName: '', vaeName: '', shift: 3 },
      loras: [],
      settings: { ...DEFAULT_ULTIMATE_UPSCALE, enabled: true },
      positivePrompt: '',
      negativePrompt: '',
      seed: -1
    }),
    (saved, defaults) => ({
      models: { ...defaults.models, ...saved.models },
      settings: { ...defaults.settings, ...saved.settings, enabled: true },
      loras: normalizeLoras(saved.loras),
      positivePrompt: saved.positivePrompt ?? defaults.positivePrompt,
      negativePrompt: saved.negativePrompt ?? defaults.negativePrompt,
      seed: typeof saved.seed === 'number' ? saved.seed : defaults.seed
    })
  );
  return { state, loaded };
});
