import { buildWorkflowPrompt } from '../services/workflowBuilder';
import type { LayoutBox, LoraItem, WorkflowState } from '../types/workflow';

export type Graph = Record<
  string,
  { class_type: string; inputs: Record<string, unknown> }
>;

export const BASE_STATE: WorkflowState = {
  profile: 'anima',
  moss: {
    skipLayerGuidance: true,
    slgSingleLayers: '22',
    slgStartPercent: 0,
    slgEndPercent: 0.5,
    layoutEnabled: false,
    layoutBoxes: [],
    layoutSummary: {},
    controlEnabled: false,
    controlAdapter: '',
    controlColorMap: '',
    controlDepthMap: '',
    controlStrength: 1,
    controlStartPercent: 0,
    controlEndPercent: 1,
    spectrumEnabled: false,
    spectrumMode: 'adaptive',
    spectrumWarmupSteps: 8,
    spectrumTailActualSteps: 1,
    spectrumCacheDevice: 'main_device',
    spectrumDetailGuardSteps: 8,
    spectrumPostGuardHorizonCap: 6,
    spectrumErrorTolerance: 1,
    spectrumMaxConsecutiveForecasts: 2,
    tsrEnabled: false,
    tsrK: 0.95,
    tsrSigma: 1,
    auraFlowEnabled: false,
    auraFlowShift: 5,
    editLora: 'moss-edit.safetensors',
    editFormat: 'Moss-Image-Edit',
    editImageStrength: 1
  },
  positivePrompt: 'test',
  negativePrompt: 'bad',
  models: {
    unetName: 'anima.safetensors',
    clipName: 'clip.safetensors',
    vaeName: 'vae.safetensors',
    shift: 2.5
  },
  advanced: {
    auraFlowEnabled: false,
    cacheDiT: {
      enabled: false,
      modelType: 'Auto',
      warmupSteps: 0,
      skipInterval: 0,
      printSummary: true,
      threshold: 0.25,
      noiseScale: 0.001,
      strategy: 'adaptive'
    },
    renormCfg: { enabled: false, cfgTrunc: 100, renormCfg: 1 }
  },
  loras: [],
  sampler: {
    steps: 20,
    cfg: 4,
    samplerName: 'euler',
    scheduler: 'simple',
    denoise: 0.7,
    seed: 1,
    randomizeSeed: false,
    variationEnabled: false,
    variationSeed: 2,
    variationStrength: 0.35
  },
  imageInput: {
    mode: 'img2img',
    imageName: 'input.png',
    imageWidth: 512,
    imageHeight: 768,
    maskName: '',
    modelPatch: 'patch.safetensors',
    llliteStrength: 1,
    llliteStart: 0,
    llliteEnd: 1,
    turboEnabled: true,
    turboLora: 'turbo.safetensors',
    inpaintSteps: 30,
    inpaintCfg: 4,
    turboSteps: 8,
    turboCfg: 1
  },
  resolution: {
    preset: 'Custom',
    batchSize: 1,
    width: 512,
    height: 768,
    isCustom: true
  },
  postfx: {
    enabled: false,
    styleStage: {
      enabled: false,
      vignetteStrength: 0,
      vignetteSoftness: 0.5,
      filmGrain: 0,
      bloomStrength: 0,
      bloomRadius: 1.5,
      bloomThreshold: 0.7,
      chromaticAberration: 0
    },
    adjustStage: {
      enabled: false,
      brightness: 0,
      contrast: 1,
      saturation: 1,
      sharpness: 0
    },
    upscale: {
      enabled: false,
      upscaleModel: '',
      upscaleBy: 1,
      ultimate: {
        enabled: false,
        steps: 20,
        cfg: 4,
        samplerName: 'euler',
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
        turboLora: 'turbo.safetensors',
        turboSteps: 8
      }
    }
  },
  faceDetailer: {
    positivePrompt: '',
    negativePrompt: '',
    enabled: false,
    bboxModel: 'bbox/face.pt',
    segmModel: '',
    steps: 20,
    turboSteps: 8,
    cfg: 4,
    samplerName: 'euler',
    scheduler: 'simple',
    bboxThreshold: 0.5,
    denoise: 0.31,
    feather: 5,
    guideSize: 512,
    turboEnabled: false,
    turboLora: 'turbo.safetensors'
  }
};

export const TEST_LORA: LoraItem = {
  id: '1',
  name: 'test.safetensors',
  strength: 1,
  enabled: true
};

export const MODES = ['text2img', 'img2img', 'inpaint'] as const;

export function createState(configure?: (state: WorkflowState) => void) {
  const state = structuredClone(BASE_STATE);
  configure?.(state);
  return state;
}

export function enableModelPatches(state: WorkflowState) {
  state.loras = [{ ...TEST_LORA }];
  state.advanced.cacheDiT.enabled = true;
  state.advanced.auraFlowEnabled = true;
  state.advanced.renormCfg.enabled = true;
}

export function enableTurboFaceDetailer(state: WorkflowState) {
  state.faceDetailer.enabled = true;
  state.faceDetailer.turboEnabled = true;
}

export function enableInpaint(state: WorkflowState) {
  state.imageInput.mode = 'inpaint';
  state.imageInput.maskName = 'mask.png';
}

export function enableUpscale(state: WorkflowState) {
  state.imageInput.mode = 'text2img';
  state.loras = [{ ...TEST_LORA }];
  state.postfx.enabled = true;
  state.postfx.upscale.enabled = true;
  state.postfx.upscale.upscaleModel = 'up.safetensors';
  state.postfx.upscale.upscaleBy = 6;
}

export function withControl(state: WorkflowState) {
  state.moss.controlEnabled = true;
  state.moss.controlAdapter = 'moss-control.safetensors';
  state.moss.controlColorMap = 'color.png';
  state.moss.controlDepthMap = 'depth.png';
  state.moss.controlStrength = 0.8;
  state.moss.controlStartPercent = 0.1;
  state.moss.controlEndPercent = 0.6;
}

export const inpaintState = (turbo: boolean) =>
  createState((s) => {
    enableModelPatches(s);
    enableInpaint(s);
    s.sampler.variationEnabled = true;
    s.imageInput.turboEnabled = turbo;
  });

export const mossState = (configure?: (state: WorkflowState) => void) =>
  createState((s) => {
    s.profile = 'moss';
    s.imageInput.mode = 'text2img';
    configure?.(s);
  });

export const graphOf = (state: WorkflowState) =>
  buildWorkflowPrompt(state) as Graph;

export function connections(graph: Graph) {
  return Object.values(graph)
    .flatMap((node) => Object.values(node.inputs))
    .filter(
      (input): input is [string, number] =>
        Array.isArray(input) && typeof input[0] === 'string'
    );
}

export const LAYOUT_BOXES: LayoutBox[] = [
  {
    id: 'title',
    kind: 'text',
    x: 0,
    y: 0,
    width: 1,
    height: 0.25,
    caption: 'cream serif capitals',
    text: 'MOSS'
  },
  {
    id: 'knight',
    kind: 'character',
    x: 0.25,
    y: 0.25,
    width: 0.5,
    height: 0.75,
    caption: 'a kneeling knight',
    text: 'ignored'
  }
];

export const withLayout = (s: WorkflowState) => {
  s.resolution.width = 1024;
  s.resolution.height = 512;
  s.moss.layoutEnabled = true;
  s.moss.layoutBoxes = structuredClone(LAYOUT_BOXES);
};
