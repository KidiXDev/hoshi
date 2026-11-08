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
  mode: 'text2img' | 'img2img' | 'inpaint' | 'edit';
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
  | 'None'
  | 'Band Pass'
  | 'Half Tile'
  | 'Half Tile + Intersections';

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

export type WorkflowProfile = 'anima' | 'moss';

export type LayoutBoxKind = 'object' | 'character' | 'text';

export interface LayoutBox {
  id: string;
  kind: LayoutBoxKind;
  x: number;
  y: number;
  width: number;
  height: number;
  caption: string;
  text: string;
  tags?: string[];
  palette?: string[];
}

export type LayoutCanvas = 'single' | 'multi_panel' | 'collage';

export interface LayoutSummaryExtras {
  meta?: string[];
  canvas?: LayoutCanvas;
  palette?: string[];
}

export interface MossSettings {
  skipLayerGuidance: boolean;
  slgSingleLayers: string;
  slgStartPercent: number;
  slgEndPercent: number;
  layoutEnabled: boolean;
  layoutBoxes: LayoutBox[];
  layoutSummary: LayoutSummaryExtras;
  controlEnabled: boolean;
  controlAdapter: string;
  controlColorMap: string;
  controlDepthMap: string;
  controlStrength: number;
  controlStartPercent: number;
  controlEndPercent: number;
  spectrumEnabled: boolean;
  spectrumMode: 'adaptive' | 'manual';
  spectrumWarmupSteps: number;
  spectrumTailActualSteps: number;
  spectrumCacheDevice: 'main_device' | 'offload_device' | 'cpu';
  spectrumDetailGuardSteps: number;
  spectrumPostGuardHorizonCap: number;
  spectrumErrorTolerance: number;
  spectrumMaxConsecutiveForecasts: number;
  tsrEnabled: boolean;
  tsrK: number;
  tsrSigma: number;
  auraFlowEnabled: boolean;
  auraFlowShift: number;
  editLora: string;
  editFormat: 'Moss-Image-Edit' | 'ai-toolkit' | 'ai-toolkit (kv_cache off)';
  editImageStrength: number;
}

export interface WorkflowState {
  profile: WorkflowProfile;
  moss: MossSettings;
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
