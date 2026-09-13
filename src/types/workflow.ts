export interface LoraItem {
  id: string;
  name: string;
  strength: number;
  enabled: boolean;
}

export interface LoraPreset {
  id: string;
  name: string;
  loras: Array<{
    name: string;
    strength: number;
    enabled: boolean;
  }>;
  description?: string;
  createdAt?: number;
}

export interface PromptPreset {
  id: string;
  name: string;
  type: 'both' | 'positive' | 'negative';
  positive?: string;
  negative?: string;
  description?: string;
  createdAt?: number;
}

export interface SamplerSettings {
  steps: number;
  cfg: number;
  samplerName: string;
  scheduler: string;
  denoise: number;
  seed: number;
  randomizeSeed: boolean;
  variationEnabled: boolean;
  variationSeed: number;
  variationStrength: number;
}

export interface ImageInputSettings {
  mode: 'text2img' | 'img2img' | 'inpaint';
  imageName: string;
  imageWidth: number;
  imageHeight: number;
  maskName: string;
  modelPatch: string;
  llliteStrength: number;
  llliteStart: number;
  llliteEnd: number;
  turboEnabled: boolean;
  turboLora: string;
  inpaintSteps: number;
  inpaintCfg: number;
  turboSteps: number;
  turboCfg: number;
}

export interface ModelSettings {
  unetName: string;
  clipName: string;
  vaeName: string;
  shift: number;
}

export interface AdvancedSettings {
  auraFlowEnabled: boolean;
  cacheDiT: {
    enabled: boolean;
    modelType: string;
    warmupSteps: number;
    skipInterval: number;
    printSummary: boolean;
    threshold: number;
    noiseScale: number;
    strategy: 'preset' | 'adaptive' | 'static' | 'dynamic';
  };
  renormCfg: {
    enabled: boolean;
    cfgTrunc: number;
    renormCfg: number;
  };
}

export interface ResolutionSettings {
  preset: string;
  batchSize: number;
  width?: number;
  height?: number;
  isCustom?: boolean;
}

export type UltimateUpscaleMode = 'Linear' | 'Chess' | 'None';
export type UltimateSeamFixMode =
  'None' | 'Band Pass' | 'Half Tile' | 'Half Tile + Intersections';

export interface UltimateUpscaleSettings {
  enabled: boolean;
  steps: number;
  cfg: number;
  samplerName: string;
  scheduler: string;
  denoise: number;
  modeType: UltimateUpscaleMode;
  tileWidth: number;
  tileHeight: number;
  maskBlur: number;
  tilePadding: number;
  seamFixMode: UltimateSeamFixMode;
  seamFixDenoise: number;
  seamFixWidth: number;
  seamFixMaskBlur: number;
  seamFixPadding: number;
  forceUniformTiles: boolean;
  tiledDecode: boolean;
  batchSize: number;
  turboEnabled: boolean;
  turboLora: string;
  turboSteps: number;
}

export interface PostFxSettings {
  enabled: boolean;
  styleStage: {
    enabled: boolean;
    vignetteStrength: number;
    vignetteSoftness: number;
    filmGrain: number;
    bloomStrength: number;
    bloomRadius: number;
    bloomThreshold: number;
    chromaticAberration: number;
  };
  adjustStage: {
    enabled: boolean;
    brightness: number;
    contrast: number;
    saturation: number;
    sharpness: number;
  };
  upscale: {
    enabled: boolean;
    upscaleModel: string;
    upscaleBy: number;
    ultimate: UltimateUpscaleSettings;
  };
}

export interface FaceDetailerSettings {
  positivePrompt: string;
  negativePrompt: string;
  enabled: boolean;
  bboxModel: string;
  segmModel: string;
  steps: number;
  turboSteps: number;
  cfg: number;
  samplerName: string;
  scheduler: string;
  bboxThreshold: number;
  denoise: number;
  feather: number;
  guideSize: number;
  turboEnabled: boolean;
  turboLora: string;
}

/**
 * Original `{a|b}` dynamic-prompt templates, kept alongside the resolved
 * prompts on queued/history states so "reuse settings" restores the template.
 * Absent when the prompts contained no dynamic groups.
 */
export interface PromptTemplates {
  positivePrompt: string;
  negativePrompt: string;
  faceDetailerPositivePrompt: string;
  faceDetailerNegativePrompt: string;
}

export interface WorkflowState {
  positivePrompt: string;
  negativePrompt: string;
  models: ModelSettings;
  advanced: AdvancedSettings;
  loras: LoraItem[];
  sampler: SamplerSettings;
  imageInput: ImageInputSettings;
  resolution: ResolutionSettings;
  postfx: PostFxSettings;
  faceDetailer: FaceDetailerSettings;
  promptTemplates?: PromptTemplates;
}

export interface HistoryItem {
  id: string;
  timestamp: number;
  imageUrl: string;
  filename: string;
  subfolder: string;
  type: string;
  promptId: string;
  workflowState: WorkflowState;
  durationMs?: number;
}
