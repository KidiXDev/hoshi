import { useDebounceFn } from '@vueuse/core';
import { defineStore } from 'pinia';
import { ref, watch } from 'vue';
import { loadAppData, saveAppData } from '../services/appStorage';
import type {
  AdvancedSettings,
  FaceDetailerSettings,
  ImageInputSettings,
  LoraItem,
  LoraPreset,
  ModelSettings,
  PostFxSettings,
  ResolutionSettings,
  SamplerSettings,
  UltimateUpscaleSettings,
  WorkflowState
} from '../types/workflow';

const DEFAULT_POSITIVE_PROMPT =
  'beautiful scenery nature glass bottle landscape, purple galaxy bottle';

const DEFAULT_NEGATIVE_PROMPT =
  'worst quality, bad anatomy, watermark, logo, signature, low quality';

const DEFAULT_MODELS: ModelSettings = {
  unetName: '',
  clipName: '',
  vaeName: '',
  shift: 2.5
};

const DEFAULT_ADVANCED: AdvancedSettings = {
  auraFlowEnabled: false,
  cacheDiT: {
    enabled: false,
    modelType: 'Auto',
    warmupSteps: 3,
    skipInterval: 2,
    printSummary: true,
    threshold: 0.25,
    noiseScale: 0.001,
    strategy: 'adaptive'
  },
  renormCfg: { enabled: false, cfgTrunc: 100, renormCfg: 1 }
};

const DEFAULT_SAMPLER: SamplerSettings = {
  steps: 20,
  cfg: 4.0,
  samplerName: 'er_sde',
  scheduler: 'simple',
  denoise: 1.0,
  seed: -1,
  randomizeSeed: true,
  variationEnabled: false,
  variationSeed: -1,
  variationStrength: 0.35
};

const DEFAULT_RESOLUTION: ResolutionSettings = {
  preset: '832 x 1216 (13:19 Portrait)',
  batchSize: 1,
  width: 832,
  height: 1216,
  isCustom: false
};

const DEFAULT_IMAGE_INPUT: ImageInputSettings = {
  mode: 'text2img',
  imageName: '',
  imageWidth: 0,
  imageHeight: 0,
  maskName: '',
  modelPatch: 'anima-lllite-inpainting-v2.safetensors',
  llliteStrength: 1,
  llliteStart: 0,
  llliteEnd: 1,
  turboEnabled: true,
  turboLora: 'anima-turbo-lora-v0.2.safetensors',
  inpaintSteps: 30,
  inpaintCfg: 4,
  turboSteps: 8,
  turboCfg: 1
};

export const DEFAULT_ULTIMATE_UPSCALE: UltimateUpscaleSettings = {
  enabled: false,
  steps: 20,
  cfg: 4,
  samplerName: 'er_sde',
  scheduler: 'simple',
  denoise: 0.2,
  modeType: 'Chess',
  tileWidth: 1024,
  tileHeight: 1024,
  maskBlur: 8,
  tilePadding: 32,
  seamFixMode: 'None',
  seamFixDenoise: 1,
  seamFixWidth: 64,
  seamFixMaskBlur: 8,
  seamFixPadding: 16,
  forceUniformTiles: true,
  tiledDecode: false,
  batchSize: 1,
  turboEnabled: false,
  turboLora: 'anima-turbo-lora-v0.2.safetensors',
  turboSteps: 8
};

const DEFAULT_POSTFX: PostFxSettings = {
  enabled: false,
  styleStage: {
    enabled: true,
    vignetteStrength: 0.1,
    vignetteSoftness: 0.5,
    filmGrain: 0,
    bloomStrength: 0,
    bloomRadius: 1.5,
    bloomThreshold: 0.7,
    chromaticAberration: 0
  },
  adjustStage: {
    enabled: true,
    brightness: 0,
    contrast: 1.0,
    saturation: 1.05,
    sharpness: 0.05
  },
  upscale: {
    enabled: false,
    upscaleModel: '',
    upscaleBy: 2.0,
    ultimate: { ...DEFAULT_ULTIMATE_UPSCALE }
  }
};

export const DEFAULT_FACE_DETAILER: FaceDetailerSettings = {
  positivePrompt: '',
  negativePrompt: '',
  enabled: false,
  bboxModel: 'bbox/face_yolov8m.pt',
  segmModel: '',
  steps: 20,
  turboSteps: 8,
  cfg: 4,
  samplerName: 'er_sde',
  scheduler: 'simple',
  bboxThreshold: 0.5,
  denoise: 0.31,
  feather: 5,
  guideSize: 512,
  turboEnabled: false,
  turboLora: 'anima-turbo-lora-v0.2.safetensors'
};

const SESSION_STORAGE_KEY = 'workflow_session_state';
const PRESETS_STORAGE_KEY = 'lora_presets';

export const useWorkflowStore = defineStore('workflow', () => {
  const isLoaded = ref(false);

  const positivePrompt = ref(DEFAULT_POSITIVE_PROMPT);
  const negativePrompt = ref(DEFAULT_NEGATIVE_PROMPT);
  const models = ref<ModelSettings>({ ...DEFAULT_MODELS });
  const advanced = ref<AdvancedSettings>(
    JSON.parse(JSON.stringify(DEFAULT_ADVANCED))
  );
  const loras = ref<LoraItem[]>([]);
  const sampler = ref<SamplerSettings>({ ...DEFAULT_SAMPLER });
  const imageInput = ref<ImageInputSettings>({ ...DEFAULT_IMAGE_INPUT });
  const resolution = ref<ResolutionSettings>({ ...DEFAULT_RESOLUTION });
  const postfx = ref<PostFxSettings>(
    JSON.parse(JSON.stringify(DEFAULT_POSTFX))
  );
  const faceDetailer = ref<FaceDetailerSettings>({ ...DEFAULT_FACE_DETAILER });

  const customPresets = ref<LoraPreset[]>([]);

  async function loadPresets() {
    try {
      const saved = await loadAppData<LoraPreset[]>(PRESETS_STORAGE_KEY);
      if (saved && Array.isArray(saved)) {
        customPresets.value = saved;
      }
    } catch {}
  }

  async function savePresets() {
    await saveAppData(PRESETS_STORAGE_KEY, customPresets.value);
  }

  async function loadSession() {
    try {
      const saved =
        await loadAppData<Partial<WorkflowState>>(SESSION_STORAGE_KEY);
      if (saved) {
        if (typeof saved.positivePrompt === 'string') {
          positivePrompt.value = saved.positivePrompt;
        }
        if (typeof saved.negativePrompt === 'string') {
          negativePrompt.value = saved.negativePrompt;
        }
        if (saved.models && typeof saved.models === 'object') {
          models.value = { ...DEFAULT_MODELS, ...saved.models };
        }
        if (saved.advanced && typeof saved.advanced === 'object') {
          advanced.value = {
            ...DEFAULT_ADVANCED,
            ...saved.advanced,
            cacheDiT: {
              ...DEFAULT_ADVANCED.cacheDiT,
              ...saved.advanced.cacheDiT
            },
            renormCfg: {
              ...DEFAULT_ADVANCED.renormCfg,
              ...saved.advanced.renormCfg
            }
          };
        }
        if (Array.isArray(saved.loras)) {
          loras.value = saved.loras.map((l, index) => ({
            id: l.id || `lora-${index}-${Date.now()}`,
            name: l.name ?? '',
            strength: typeof l.strength === 'number' ? l.strength : 1.0,
            enabled: typeof l.enabled === 'boolean' ? l.enabled : true
          }));
        }
        if (saved.sampler && typeof saved.sampler === 'object') {
          sampler.value = { ...DEFAULT_SAMPLER, ...saved.sampler };
        }
        if (saved.resolution && typeof saved.resolution === 'object') {
          resolution.value = { ...DEFAULT_RESOLUTION, ...saved.resolution };
        }
        if (saved.imageInput && typeof saved.imageInput === 'object') {
          imageInput.value = { ...DEFAULT_IMAGE_INPUT, ...saved.imageInput };
        }
        if (saved.postfx && typeof saved.postfx === 'object') {
          postfx.value = {
            ...DEFAULT_POSTFX,
            ...saved.postfx,
            styleStage: {
              ...DEFAULT_POSTFX.styleStage,
              ...saved.postfx.styleStage
            },
            adjustStage: {
              ...DEFAULT_POSTFX.adjustStage,
              ...saved.postfx.adjustStage
            },
            upscale: {
              ...DEFAULT_POSTFX.upscale,
              ...saved.postfx.upscale,
              ultimate: {
                ...DEFAULT_ULTIMATE_UPSCALE,
                ...saved.postfx.upscale?.ultimate
              }
            }
          };
        }
        if (saved.faceDetailer && typeof saved.faceDetailer === 'object') {
          faceDetailer.value = {
            ...DEFAULT_FACE_DETAILER,
            ...saved.faceDetailer
          };
        }
      }
    } catch (err) {
      console.warn('Failed to load workflow session state:', err);
    } finally {
      isLoaded.value = true;
    }
  }

  async function saveSession() {
    if (!isLoaded.value) return;
    const state = getFullWorkflowState();
    try {
      await saveAppData(SESSION_STORAGE_KEY, state);
    } catch (err) {
      console.error('Failed to save workflow session state:', err);
    }
  }

  const debouncedSaveSession = useDebounceFn(() => {
    void saveSession();
  }, 400);

  watch(
    [
      positivePrompt,
      negativePrompt,
      models,
      advanced,
      loras,
      sampler,
      imageInput,
      resolution,
      postfx,
      faceDetailer
    ],
    () => {
      if (isLoaded.value) {
        debouncedSaveSession();
      }
    },
    { deep: true }
  );

  // Ensure synchronous or immediate flush on window unload / exit
  if (typeof window !== 'undefined') {
    window.addEventListener('beforeunload', () => {
      void saveSession();
    });
  }

  function addLora(name = '', strength = 1.0, stack?: LoraItem[]) {
    stack ??= loras.value;
    stack.push({
      id: `lora-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      name,
      strength,
      enabled: true
    });
  }

  function removeLora(id: string, stack?: LoraItem[]) {
    stack ??= loras.value;
    const index = stack.findIndex((l) => l.id === id);
    if (index !== -1) stack.splice(index, 1);
  }

  function moveLora(
    index: number,
    direction: 'up' | 'down',
    stack?: LoraItem[]
  ) {
    stack ??= loras.value;
    if (direction === 'up' && index > 0) {
      const item = stack.splice(index, 1)[0];
      stack.splice(index - 1, 0, item);
    } else if (direction === 'down' && index < stack.length - 1) {
      const item = stack.splice(index, 1)[0];
      stack.splice(index + 1, 0, item);
    }
  }

  function saveCustomPreset(name: string) {
    if (!name.trim()) return;
    const newPreset: LoraPreset = {
      id: `preset-${Date.now()}`,
      name: name.trim(),
      loras: loras.value.map((l) => ({
        name: l.name,
        strength: l.strength,
        enabled: l.enabled
      }))
    };
    customPresets.value.push(newPreset);
    void savePresets();
  }

  function loadCustomPreset(presetId: string, stack = loras.value) {
    const preset = customPresets.value.find((p) => p.id === presetId);
    if (!preset) return;
    stack.splice(
      0,
      stack.length,
      ...preset.loras.map((l, index) => ({
        id: `lora-${index}-${Date.now()}`,
        name: l.name,
        strength: l.strength,
        enabled: l.enabled
      }))
    );
  }

  function deleteCustomPreset(presetId: string) {
    customPresets.value = customPresets.value.filter((p) => p.id !== presetId);
    void savePresets();
  }

  function randomizeSeedValue() {
    sampler.value.seed = Math.floor(Math.random() * 9007199254740991);
    sampler.value.randomizeSeed = false;
  }

  function getFullWorkflowState(): WorkflowState {
    return {
      positivePrompt: positivePrompt.value,
      negativePrompt: negativePrompt.value,
      models: JSON.parse(JSON.stringify(models.value)),
      advanced: JSON.parse(JSON.stringify(advanced.value)),
      loras: JSON.parse(JSON.stringify(loras.value)),
      sampler: JSON.parse(JSON.stringify(sampler.value)),
      imageInput: JSON.parse(JSON.stringify(imageInput.value)),
      resolution: JSON.parse(JSON.stringify(resolution.value)),
      postfx: JSON.parse(JSON.stringify(postfx.value)),
      faceDetailer: JSON.parse(JSON.stringify(faceDetailer.value))
    };
  }

  function applyWorkflowState(state: WorkflowState) {
    // Prefer the `{a|b}` template over the resolved text from a queued state.
    positivePrompt.value =
      state.promptTemplates?.positivePrompt ?? state.positivePrompt;
    negativePrompt.value =
      state.promptTemplates?.negativePrompt ?? state.negativePrompt;
    models.value = JSON.parse(JSON.stringify(state.models));
    advanced.value = {
      ...DEFAULT_ADVANCED,
      ...JSON.parse(JSON.stringify(state.advanced || {})),
      cacheDiT: {
        ...DEFAULT_ADVANCED.cacheDiT,
        ...JSON.parse(JSON.stringify(state.advanced?.cacheDiT || {}))
      },
      renormCfg: {
        ...DEFAULT_ADVANCED.renormCfg,
        ...JSON.parse(JSON.stringify(state.advanced?.renormCfg || {}))
      }
    };
    loras.value = JSON.parse(JSON.stringify(state.loras));
    sampler.value = {
      ...DEFAULT_SAMPLER,
      ...JSON.parse(JSON.stringify(state.sampler))
    };
    imageInput.value = {
      ...DEFAULT_IMAGE_INPUT,
      ...JSON.parse(JSON.stringify(state.imageInput || {}))
    };
    resolution.value = JSON.parse(JSON.stringify(state.resolution));
    postfx.value = JSON.parse(JSON.stringify(state.postfx));
    faceDetailer.value = {
      ...DEFAULT_FACE_DETAILER,
      ...JSON.parse(JSON.stringify(state.faceDetailer || {}))
    };
    if (state.promptTemplates) {
      faceDetailer.value.positivePrompt =
        state.promptTemplates.faceDetailerPositivePrompt;
      faceDetailer.value.negativePrompt =
        state.promptTemplates.faceDetailerNegativePrompt;
    }
    void saveSession();
  }

  async function init() {
    await Promise.all([loadPresets(), loadSession()]);
  }

  void init();

  return {
    isLoaded,
    positivePrompt,
    negativePrompt,
    models,
    advanced,
    loras,
    sampler,
    imageInput,
    resolution,
    postfx,
    faceDetailer,
    customPresets,
    init,
    loadSession,
    saveSession,
    addLora,
    removeLora,
    moveLora,
    saveCustomPreset,
    loadCustomPreset,
    deleteCustomPreset,
    randomizeSeedValue,
    getFullWorkflowState,
    applyWorkflowState
  };
});
