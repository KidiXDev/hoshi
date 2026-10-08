import { usePersistedState } from '@/composables/usePersistedState';
import type {
  FaceDetailerSettings,
  LoraItem,
  ModelSettings
} from '@/types/workflow';
import { defineStore } from 'pinia';
import { DEFAULT_FACE_DETAILER, normalizeLoras } from './workflowStore';

interface DetailerPreferences {
  models: ModelSettings;
  loras: LoraItem[];
  settings: FaceDetailerSettings;
  seed: number;
}

export const useFaceDetailerStore = defineStore('face-detailer', () => {
  const { state, loaded } = usePersistedState<DetailerPreferences>(
    'face_detailer_preferences',
    () => ({
      models: { unetName: '', clipName: '', vaeName: '', shift: 3 },
      loras: [],
      settings: { ...DEFAULT_FACE_DETAILER },
      seed: -1
    }),
    (saved, defaults) => ({
      models: { ...defaults.models, ...saved.models },
      settings: { ...defaults.settings, ...saved.settings },
      loras: normalizeLoras(saved.loras),
      seed: typeof saved.seed === 'number' ? saved.seed : defaults.seed
    })
  );
  return { state, loaded };
});
