import { BRAND_NAME } from '@/lib/brand';
import type {
  LoraItem,
  ModelSettings,
  UltimateUpscaleSettings
} from '../types/workflow';
import type { WorkflowNodeRef } from './faceDetailerWorkflow';

interface UltimateUpscaleSources {
  image: WorkflowNodeRef;
  model: WorkflowNodeRef;
  positive: WorkflowNodeRef;
  negative: WorkflowNodeRef;
  vae: WorkflowNodeRef;
  upscaleModel: string;
  upscaleBy: number;
  seed: number | WorkflowNodeRef;
}

export const ULTIMATE_UPSCALE_MAX_SCALE = 4;

export function appendUltimateUpscaleStage(
  prompt: Record<string, unknown>,
  settings: UltimateUpscaleSettings,
  sources: UltimateUpscaleSources,
  nodeId = 'ultimate_upscale'
): WorkflowNodeRef {
  if (!sources.upscaleModel) {
    throw new Error('Select an upscale model for Ultimate SD Upscale.');
  }
  let modelSource = sources.model;
  if (settings.turboEnabled) {
    if (!settings.turboLora) {
      throw new Error('Select a Turbo LoRA for Ultimate SD Upscale.');
    }
    const turboNode = `${nodeId}_turbo`;
    prompt[turboNode] = {
      inputs: {
        lora_name: settings.turboLora,
        strength_model: 1,
        model: sources.model
      },
      class_type: 'YELoadLoraModel',
      _meta: { title: 'Load Ultimate SD Upscale Turbo LoRA' }
    };
    modelSource = [turboNode, 0];
  }
  const loaderNode = `${nodeId}_model`;
  prompt[loaderNode] = {
    inputs: { model_name: sources.upscaleModel },
    class_type: 'UpscaleModelLoader',
    _meta: { title: 'Load Upscale Model' }
  };
  prompt[nodeId] = {
    inputs: {
      upscale_by: Math.min(
        ULTIMATE_UPSCALE_MAX_SCALE,
        Math.max(0.05, sources.upscaleBy)
      ),
      seed:
        typeof sources.seed === 'number'
          ? Math.max(0, Math.trunc(sources.seed))
          : sources.seed,
      steps: settings.turboEnabled ? settings.turboSteps : settings.steps,
      cfg: settings.turboEnabled ? 1 : settings.cfg,
      sampler_name: settings.samplerName,
      scheduler: settings.scheduler,
      denoise: settings.denoise,
      mode_type: settings.modeType,
      tile_width: settings.tileWidth,
      tile_height: settings.tileHeight,
      mask_blur: settings.maskBlur,
      tile_padding: settings.tilePadding,
      seam_fix_mode: settings.seamFixMode,
      seam_fix_denoise: settings.seamFixDenoise,
      seam_fix_width: settings.seamFixWidth,
      seam_fix_mask_blur: settings.seamFixMaskBlur,
      seam_fix_padding: settings.seamFixPadding,
      force_uniform_tiles: settings.forceUniformTiles,
      tiled_decode: settings.tiledDecode,
      batch_size: settings.batchSize,
      image: sources.image,
      model: modelSource,
      positive: sources.positive,
      negative: sources.negative,
      vae: sources.vae,
      upscale_model: [loaderNode, 0]
    },
    class_type: 'UltimateSDUpscale',
    _meta: { title: 'Ultimate SD Upscale' }
  };
  return [nodeId, 0];
}

export interface UltimateUpscaleStandaloneOptions {
  imageName: string;
  settings: UltimateUpscaleSettings;
  models: ModelSettings;
  loras: LoraItem[];
  positivePrompt: string;
  negativePrompt: string;
  upscaleModel: string;
  upscaleBy: number;
  seed: number;
  filenamePrefix: string;
}

export function buildUltimateUpscalePrompt(
  options: UltimateUpscaleStandaloneOptions
) {
  const prompt: Record<string, unknown> = {
    '1': {
      inputs: { image: options.imageName },
      class_type: 'LoadImage',
      _meta: { title: 'Load Image' }
    },
    '2': {
      inputs: { unet_name: options.models.unetName, weight_dtype: 'default' },
      class_type: 'UNETLoader',
      _meta: { title: 'Load Diffusion Model' }
    },
    '3': {
      inputs: {
        clip_name: options.models.clipName,
        type: 'cosmos',
        device: 'default'
      },
      class_type: 'CLIPLoader',
      _meta: { title: 'Load CLIP' }
    },
    '4': {
      inputs: { vae_name: options.models.vaeName },
      class_type: 'VAELoader',
      _meta: { title: 'Load VAE' }
    },
    '5': {
      inputs: { text: options.positivePrompt, clip: ['3', 0] },
      class_type: 'CLIPTextEncode',
      _meta: { title: 'Positive Prompt' }
    },
    '6': {
      inputs: { text: options.negativePrompt, clip: ['3', 0] },
      class_type: 'CLIPTextEncode',
      _meta: { title: 'Negative Prompt' }
    }
  };
  let model: WorkflowNodeRef = ['2', 0];
  for (const [index, lora] of options.loras.entries()) {
    if (!lora.enabled || !lora.name) continue;
    const id = `usdu_lora_${index}`;
    prompt[id] = {
      inputs: { model, lora_name: lora.name, strength_model: lora.strength },
      class_type: 'YELoadLoraModel'
    };
    model = [id, 0];
  }
  const result = appendUltimateUpscaleStage(prompt, options.settings, {
    image: ['1', 0],
    model,
    positive: ['5', 0],
    negative: ['6', 0],
    vae: ['4', 0],
    upscaleModel: options.upscaleModel,
    upscaleBy: options.upscaleBy,
    seed: options.seed
  });
  prompt['20'] = {
    inputs: {
      filename_prefix: options.filenamePrefix || `${BRAND_NAME}_Upscale`,
      images: result
    },
    class_type: 'SaveImage',
    _meta: { title: 'Save Upscaled Image' }
  };
  return prompt;
}
