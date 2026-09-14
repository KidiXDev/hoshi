import { BRAND_NAME } from '@/lib/brand';
import type {
  FaceDetailerSettings,
  LoraItem,
  ModelSettings
} from '../types/workflow';

export type WorkflowNodeRef = [string, number];

interface FaceDetailerSources {
  image: WorkflowNodeRef;
  model: WorkflowNodeRef;
  clip: WorkflowNodeRef;
  vae: WorkflowNodeRef;
  seed: number;
}

function addConditioning(
  prompt: Record<string, unknown>,
  text: string,
  clip: WorkflowNodeRef,
  nodeId: string
): WorkflowNodeRef {
  prompt[nodeId] = { inputs: { text, clip }, class_type: 'CLIPTextEncode' };
  if (text.trim()) return [nodeId, 0];
  const zeroNode = `${nodeId}_zero`;
  prompt[zeroNode] = {
    inputs: { conditioning: [nodeId, 0] },
    class_type: 'ConditioningZeroOut'
  };
  return [zeroNode, 0];
}

export function appendFaceDetailerStage(
  prompt: Record<string, unknown>,
  settings: FaceDetailerSettings,
  sources: FaceDetailerSources,
  prefix = 'face_detailer'
): WorkflowNodeRef {
  if (!settings.bboxModel) {
    throw new Error('Select a required bbox detector for Face Detailer.');
  }

  const bboxNode = `${prefix}_bbox`;
  const segmNode = `${prefix}_segm`;
  const turboNode = `${prefix}_turbo`;
  const detailerNode = `${prefix}_apply`;

  prompt[bboxNode] = {
    inputs: { model_name: settings.bboxModel },
    class_type: 'UltralyticsDetectorProvider',
    _meta: { title: 'Load Face BBox Detector' }
  };

  if (settings.segmModel) {
    prompt[segmNode] = {
      inputs: { model_name: settings.segmModel },
      class_type: 'UltralyticsDetectorProvider',
      _meta: { title: 'Load Optional Face Segmentation Detector' }
    };
  }

  let modelSource = sources.model;
  if (settings.turboEnabled) {
    if (!settings.turboLora) {
      throw new Error('Select a Turbo LoRA for Face Detailer.');
    }
    prompt[turboNode] = {
      inputs: {
        lora_name: settings.turboLora,
        strength_model: 1,
        model: sources.model
      },
      class_type: 'YELoadLoraModel',
      _meta: { title: 'Load Face Detailer Turbo LoRA' }
    };
    modelSource = [turboNode, 0];
  }

  const inputs: Record<string, unknown> = {
    guide_size: settings.guideSize,
    guide_size_for: true,
    max_size: 1024,
    seed: Math.max(0, Math.trunc(sources.seed)),
    steps: settings.turboEnabled ? settings.turboSteps : settings.steps,
    cfg: settings.turboEnabled ? 1 : settings.cfg,
    sampler_name: settings.samplerName,
    scheduler: settings.scheduler,
    denoise: settings.denoise,
    feather: settings.feather,
    noise_mask: true,
    force_inpaint: true,
    bbox_threshold: settings.bboxThreshold,
    bbox_dilation: 10,
    bbox_crop_factor: 3,
    sam_detection_hint: 'center-1',
    sam_dilation: 0,
    sam_threshold: 0.93,
    sam_bbox_expansion: 0,
    sam_mask_hint_threshold: 0.7,
    sam_mask_hint_use_negative: 'False',
    drop_size: 10,
    wildcard: '',
    cycle: 1,
    inpaint_model: false,
    noise_mask_feather: 20,
    tiled_encode: false,
    tiled_decode: false,
    image: sources.image,
    model: modelSource,
    clip: sources.clip,
    vae: sources.vae,
    positive: addConditioning(
      prompt,
      settings.positivePrompt ?? '',
      sources.clip,
      `${prefix}_positive`
    ),
    negative: addConditioning(
      prompt,
      settings.negativePrompt ?? '',
      sources.clip,
      `${prefix}_negative`
    ),
    bbox_detector: [bboxNode, 0]
  };
  if (settings.segmModel) inputs.segm_detector_opt = [segmNode, 1];

  prompt[detailerNode] = {
    inputs,
    class_type: 'FaceDetailer',
    _meta: { title: 'Face Detailer' }
  };
  return [detailerNode, 0];
}

export function buildFaceDetailerPrompt(
  imageName: string,
  settings: FaceDetailerSettings,
  models: ModelSettings,
  loras: LoraItem[],
  seed: number
) {
  const prompt: Record<string, unknown> = {
    '1': {
      inputs: { image: imageName },
      class_type: 'LoadImage',
      _meta: { title: 'Load Image' }
    },
    '2': {
      inputs: { unet_name: models.unetName, weight_dtype: 'default' },
      class_type: 'UNETLoader',
      _meta: { title: 'Load Diffusion Model' }
    },
    '3': {
      inputs: { clip_name: models.clipName, type: 'cosmos', device: 'default' },
      class_type: 'CLIPLoader',
      _meta: { title: 'Load CLIP' }
    },
    '4': {
      inputs: { vae_name: models.vaeName },
      class_type: 'VAELoader',
      _meta: { title: 'Load VAE' }
    }
  };
  let model: WorkflowNodeRef = ['2', 0];
  for (const [index, lora] of loras.entries()) {
    if (!lora.enabled || !lora.name) continue;
    const id = `detail_lora_${index}`;
    prompt[id] = {
      inputs: { model, lora_name: lora.name, strength_model: lora.strength },
      class_type: 'YELoadLoraModel'
    };
    model = [id, 0];
  }
  const result = appendFaceDetailerStage(prompt, settings, {
    image: ['1', 0],
    model,
    clip: ['3', 0],
    vae: ['4', 0],
    seed
  });
  prompt['20'] = {
    inputs: { filename_prefix: `${BRAND_NAME}_FaceDetailer`, images: result },
    class_type: 'SaveImage',
    _meta: { title: 'Save Detailed Image' }
  };
  return prompt;
}
