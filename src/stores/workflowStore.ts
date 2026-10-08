import { useDebounceFn } from '@vueuse/core';
import { defineStore } from 'pinia';
import { ref, watch } from 'vue';
import {
  deleteAppData,
  loadAppData,
  saveAppData
} from '../services/appStorage';
import { LibraryService } from '../services/libraryService';
import type { LoraData } from '../types/library';
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
import { randomSeed } from '../utils/seed';

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
const LEGACY_PRESETS_STORAGE_KEY = 'lora_presets';

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export function normalizeLoras(loras: unknown): LoraItem[] {
  if (!Array.isArray(loras)) return [];
  return loras.map((lora: Partial<LoraItem>, index) => ({
    id: lora.id || `lora-${index}-${Date.now()}`,
    name: lora.name ?? '',
    strength: typeof lora.strength === 'number' ? lora.strength : 1.0,
    enabled: typeof lora.enabled === 'boolean' ? lora.enabled : true
  }));
}

export function normalizeWorkflowState(
  saved: Partial<WorkflowState>
): WorkflowState {
  const state = clone(saved);
  return {
    positivePrompt:
      typeof state.positivePrompt === 'string'
        ? state.positivePrompt
        : DEFAULT_POSITIVE_PROMPT,
    negativePrompt:
      typeof state.negativePrompt === 'string'
        ? state.negativePrompt
        : DEFAULT_NEGATIVE_PROMPT,
    models: { ...DEFAULT_MODELS, ...state.models },
    advanced: {
      ...DEFAULT_ADVANCED,
      ...state.advanced,
      cacheDiT: { ...DEFAULT_ADVANCED.cacheDiT, ...state.advanced?.cacheDiT },
      renormCfg: { ...DEFAULT_ADVANCED.renormCfg, ...state.advanced?.renormCfg }
    },
    loras: normalizeLoras(state.loras),
    sampler: { ...DEFAULT_SAMPLER, ...state.sampler },
    imageInput: { ...DEFAULT_IMAGE_INPUT, ...state.imageInput },
    resolution: { ...DEFAULT_RESOLUTION, ...state.resolution },
    postfx: {
      ...DEFAULT_POSTFX,
      ...state.postfx,
      styleStage: { ...DEFAULT_POSTFX.styleStage, ...state.postfx?.styleStage },
      adjustStage: {
        ...DEFAULT_POSTFX.adjustStage,
        ...state.postfx?.adjustStage
      },
      upscale: {
        ...DEFAULT_POSTFX.upscale,
        ...state.postfx?.upscale,
        ultimate: {
          ...DEFAULT_ULTIMATE_UPSCALE,
          ...state.postfx?.upscale?.ultimate
        }
      }
    },
    faceDetailer: { ...DEFAULT_FACE_DETAILER, ...state.faceDetailer },
    promptTemplates: state.promptTemplates
  };
}

async function migrateLegacyLoraPresets() {
  const legacy = await loadAppData<LoraPreset[]>(LEGACY_PRESETS_STORAGE_KEY);
  if (!Array.isArray(legacy)) return;
  for (const preset of legacy) {
    await LibraryService.saveItem<LoraData>({
      category: 'loras',
      name: preset.name,
      description: preset.description,
      data: { loras: preset.loras },
      createdAt: preset.createdAt
    });
  }
  await deleteAppData(LEGACY_PRESETS_STORAGE_KEY);
}

export const useWorkflowStore = defineStore('workflow', () => {
  const isLoaded = ref(false);
  const initial = normalizeWorkflowState({});

  const positivePrompt = ref(initial.positivePrompt);
  const negativePrompt = ref(initial.negativePrompt);
  const models = ref<ModelSettings>(initial.models);
  const advanced = ref<AdvancedSettings>(initial.advanced);
  const loras = ref<LoraItem[]>(initial.loras);
  const sampler = ref<SamplerSettings>(initial.sampler);
  const imageInput = ref<ImageInputSettings>(initial.imageInput);
  const resolution = ref<ResolutionSettings>(initial.resolution);
  const postfx = ref<PostFxSettings>(initial.postfx);
  const faceDetailer = ref<FaceDetailerSettings>(initial.faceDetailer);

  function assignState(state: WorkflowState) {
    positivePrompt.value = state.positivePrompt;
    negativePrompt.value = state.negativePrompt;
    models.value = state.models;
    advanced.value = state.advanced;
    loras.value = state.loras;
    sampler.value = state.sampler;
    imageInput.value = state.imageInput;
    resolution.value = state.resolution;
    postfx.value = state.postfx;
    faceDetailer.value = state.faceDetailer;
  }

  async function loadSession() {
    try {
      const saved =
        await loadAppData<Partial<WorkflowState>>(SESSION_STORAGE_KEY);
      if (saved) assignState(normalizeWorkflowState(saved));
    } catch (err) {
      console.warn('Failed to load workflow session state:', err);
    } finally {
      isLoaded.value = true;
    }
  }

  async function saveSession() {
    if (!isLoaded.value) return;
    try {
      await saveAppData(SESSION_STORAGE_KEY, getFullWorkflowState());
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

  function randomizeSeedValue() {
    sampler.value.seed = randomSeed();
    sampler.value.randomizeSeed = false;
  }

  function getFullWorkflowState(): WorkflowState {
    return clone({
      positivePrompt: positivePrompt.value,
      negativePrompt: negativePrompt.value,
      models: models.value,
      advanced: advanced.value,
      loras: loras.value,
      sampler: sampler.value,
      imageInput: imageInput.value,
      resolution: resolution.value,
      postfx: postfx.value,
      faceDetailer: faceDetailer.value
    });
  }

  function applyWorkflowState(state: WorkflowState) {
    const next = normalizeWorkflowState(state);
    const templates = next.promptTemplates;
    if (templates) {
      next.positivePrompt = templates.positivePrompt;
      next.negativePrompt = templates.negativePrompt;
      next.faceDetailer.positivePrompt = templates.faceDetailerPositivePrompt;
      next.faceDetailer.negativePrompt = templates.faceDetailerNegativePrompt;
    }
    next.sampler.randomizeSeed = next.sampler.seed < 0;
    assignState(next);
    void saveSession();
  }

  async function initialize() {
    await Promise.all([
      loadSession(),
      migrateLegacyLoraPresets().catch((error) =>
        console.warn('Could not migrate legacy LoRA presets:', error)
      )
    ]);
  }

  let initialization: Promise<void> | undefined;
  function init() {
    initialization ??= initialize();
    return initialization;
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
    init,
    loadSession,
    saveSession,
    addLora,
    removeLora,
    moveLora,
    randomizeSeedValue,
    getFullWorkflowState,
    applyWorkflowState
  };
});
