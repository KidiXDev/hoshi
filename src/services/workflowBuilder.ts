import type { MossSettings, WorkflowState } from '../types/workflow';
import {
  hasDynamicPrompt,
  hasWildcards,
  resolveDynamicPromptWithSeed,
  type WildcardMap
} from '../utils/dynamicPrompt';
import { boxPixels, layoutCanvasSize } from '../utils/mossLayout';
import { formatPrompt, removeNegativeOverlap } from '../utils/promptFormat';
import { randomSeed } from '../utils/seed';
import {
  appendFaceDetailerStage,
  type WorkflowNodeRef
} from './faceDetailerWorkflow';
import {
  appendModelUpscaleStage,
  appendUltimateUpscaleStage
} from './ultimateUpscaleWorkflow';

function samplerNode(state: WorkflowState) {
  if (!state.sampler.variationEnabled) {
    return { inputs: {}, class_type: 'KSampler', _meta: { title: 'KSampler' } };
  }
  return {
    inputs: {
      variation_seed: Math.max(0, Math.trunc(state.sampler.variationSeed)),
      variation_strength: Math.min(
        1,
        Math.max(0, state.sampler.variationStrength || 0)
      )
    },
    class_type: 'KoharuKSampler',
    _meta: { title: 'KSampler (Variation)' }
  };
}

export function prepareWorkflowForQueue(
  state: WorkflowState,
  wildcards: WildcardMap = {}
): WorkflowState {
  const queuedState = structuredClone(state);
  if (queuedState.sampler.randomizeSeed || queuedState.sampler.seed < 0) {
    queuedState.sampler.seed = randomSeed();
  }
  if (
    queuedState.sampler.variationEnabled &&
    queuedState.sampler.variationSeed < 0
  ) {
    queuedState.sampler.variationSeed = randomSeed();
  }
  resolveDynamicPrompts(queuedState, wildcards);
  return queuedState;
}

/**
 * Resolves `__wildcards__` and `{a|b}` groups in every prompt field using the
 * (now concrete) seed, remembering the templates so history can restore them.
 */
function resolveDynamicPrompts(state: WorkflowState, wildcards: WildcardMap) {
  const templates = {
    positivePrompt: state.positivePrompt,
    negativePrompt: state.negativePrompt,
    faceDetailerPositivePrompt: state.faceDetailer?.positivePrompt ?? '',
    faceDetailerNegativePrompt: state.faceDetailer?.negativePrompt ?? ''
  };
  if (
    !Object.values(templates).some(
      (text) => hasDynamicPrompt(text) || hasWildcards(text)
    )
  ) {
    delete state.promptTemplates;
    return;
  }
  const seed = state.sampler.seed;
  state.promptTemplates = templates;
  state.positivePrompt = resolveDynamicPromptWithSeed(
    templates.positivePrompt,
    seed,
    'positive',
    wildcards
  );
  state.negativePrompt = resolveDynamicPromptWithSeed(
    templates.negativePrompt,
    seed,
    'negative',
    wildcards
  );
  if (state.faceDetailer) {
    state.faceDetailer.positivePrompt = resolveDynamicPromptWithSeed(
      templates.faceDetailerPositivePrompt,
      seed,
      'fd-positive',
      wildcards
    );
    state.faceDetailer.negativePrompt = resolveDynamicPromptWithSeed(
      templates.faceDetailerNegativePrompt,
      seed,
      'fd-negative',
      wildcards
    );
  }
}

function appendMossLayoutStage(
  prompt: Record<string, unknown>,
  state: WorkflowState
): WorkflowNodeRef | null {
  const boxes = state.moss.layoutBoxes;
  if (
    state.imageInput.mode === 'edit' ||
    !state.moss.layoutEnabled ||
    boxes.length === 0
  ) {
    return null;
  }
  const { width, height } = layoutCanvasSize(state);

  prompt['moss_boxes'] = {
    inputs: {
      width,
      height,
      editor_state: {
        __value__: boxes.map((box) => ({
          ...boxPixels(box, width, height),
          metadata: {
            type: box.kind === 'text' ? 'text' : 'obj',
            text: box.kind === 'text' ? box.text : '',
            desc: box.caption,
            palette: []
          }
        }))
      }
    },
    class_type: 'CreateBoundingBoxes',
    _meta: { title: 'Create Bounding Boxes' }
  };

  prompt['moss_layout'] = {
    inputs: {
      prompt: state.positivePrompt,
      width,
      height,
      character_boxes: boxes
        .flatMap((box, index) => (box.kind === 'character' ? [index + 1] : []))
        .join(', '),
      element: ['moss_boxes', 2]
    },
    class_type: 'MOSSImageLayoutPrompt',
    _meta: { title: 'MOSS-Image Layout Prompt' }
  };
  return ['moss_layout', 0];
}

interface SamplerInputs {
  model: WorkflowNodeRef;
  positive: WorkflowNodeRef;
  negative: WorkflowNodeRef;
}

function appendMossControlStage(
  prompt: Record<string, unknown>,
  state: WorkflowState,
  sampler: SamplerInputs
): SamplerInputs {
  const { moss } = state;
  const maps = {
    color_map: moss.controlColorMap,
    depth_map: moss.controlDepthMap
  };
  if (!moss.controlEnabled || (!maps.color_map && !maps.depth_map)) {
    return sampler;
  }
  if (!moss.controlAdapter) {
    throw new Error(
      'Select a MOSS color/depth control adapter before generating.'
    );
  }

  prompt['moss_control_adapter'] = {
    inputs: {
      lora_name: moss.controlAdapter,
      strength_model: 1,
      model: sampler.model
    },
    class_type: 'LoraLoaderModelOnly',
    _meta: { title: 'Load MOSS Color/Depth Control Adapter' }
  };

  const mapInputs: Record<string, WorkflowNodeRef> = {};
  for (const [input, image] of Object.entries(maps)) {
    if (!image) continue;
    prompt[`moss_${input}`] = {
      inputs: { image },
      class_type: 'LoadImage',
      _meta: { title: `Load MOSS ${input.replace('_', ' ')}` }
    };
    mapInputs[input] = [`moss_${input}`, 0];
  }

  prompt['moss_control'] = {
    inputs: {
      positive: sampler.positive,
      negative: sampler.negative,
      vae: ['27', 0],
      ...mapInputs,
      strength: moss.controlStrength,
      start_percent: moss.controlStartPercent,
      end_percent: moss.controlEndPercent
    },
    class_type: 'MOSSImageControl',
    _meta: { title: 'MOSS-Image Color/Depth Control' }
  };

  return {
    model: ['moss_control_adapter', 0],
    positive: ['moss_control', 0],
    negative: ['moss_control', 1]
  };
}

function appendMossEditStage(
  prompt: Record<string, unknown>,
  state: WorkflowState,
  sampler: SamplerInputs,
  texts: { positive: string; negative: string }
): SamplerInputs {
  const { moss } = state;
  if (!moss.editLora) {
    throw new Error('Select a MOSS edit LoRA before generating.');
  }

  prompt['moss_edit_scale'] = {
    inputs: {
      upscale_method: 'lanczos',
      megapixels: 1,
      resolution_steps: 16,
      image: ['30', 0]
    },
    class_type: 'ImageScaleToTotalPixels',
    _meta: { title: 'Scale MOSS Edit Reference' }
  };

  prompt['moss_edit_size'] = {
    inputs: { image: ['moss_edit_scale', 0] },
    class_type: 'GetImageSize',
    _meta: { title: 'Get MOSS Edit Size' }
  };

  prompt['moss_edit_lora'] = {
    inputs: {
      lora_name: moss.editLora,
      strength_model: 1,
      model: sampler.model
    },
    class_type: 'LoraLoaderModelOnly',
    _meta: { title: 'Load MOSS Edit LoRA' }
  };

  const encodeEdit = (text: string, title: string) => ({
    inputs: {
      prompt: text,
      edit_format: moss.editFormat,
      image_strength: moss.editImageStrength,
      clip: ['28', 0],
      vae: ['27', 0],
      'images.image_0': ['moss_edit_scale', 0]
    },
    class_type: 'TextEncodeMOSSImageEdit',
    _meta: { title }
  });
  prompt['moss_edit_positive'] = encodeEdit(texts.positive, 'Edit Instruction');
  prompt['moss_edit_negative'] = encodeEdit(texts.negative, 'Negative Prompt');

  return {
    model: ['moss_edit_lora', 0],
    positive: ['moss_edit_positive', 0],
    negative: ['moss_edit_negative', 0]
  };
}

function mossSpectrumNode(moss: MossSettings, model: WorkflowNodeRef) {
  const shared = {
    model,
    warmup_steps: moss.spectrumWarmupSteps,
    tail_actual_steps: moss.spectrumTailActualSteps,
    window_size: 2,
    cache_device: moss.spectrumCacheDevice,
    debug: false,
    warn_unverified_sampler: true
  };
  if (moss.spectrumMode === 'manual') {
    return {
      inputs: {
        ...shared,
        flex_window: 0.75,
        max_consecutive_forecasts: moss.spectrumMaxConsecutiveForecasts,
        history_points: 8,
        chebyshev_degree: 4,
        ridge_lambda: 0.1,
        blend_weight: 0.5,
        force_actual_on_control: true
      },
      class_type: 'SpectrumMOSSImageManual',
      _meta: { title: 'Spectrum MOSS-Image (Manual)' }
    };
  }
  return {
    inputs: {
      ...shared,
      flex_window: 0.5,
      detail_guard_steps: moss.spectrumDetailGuardSteps,
      post_guard_horizon_cap: moss.spectrumPostGuardHorizonCap,
      error_tolerance: moss.spectrumErrorTolerance
    },
    class_type: 'SpectrumMOSSImageAdaptive',
    _meta: { title: 'Spectrum MOSS-Image (Adaptive)' }
  };
}

export function buildWorkflowPrompt(
  state: WorkflowState
): Record<string, unknown> {
  const isMoss = state.profile === 'moss';
  const isMossEdit = isMoss && state.imageInput.mode === 'edit';
  if (state.imageInput.mode === 'inpaint' && !isMoss) {
    return buildInpaintPrompt(state);
  }

  // 1. UNET Loader (Node 29)
  const prompt: Record<string, unknown> = {
    '29': {
      inputs: {
        unet_name: state.models.unetName,
        weight_dtype: 'default'
      },
      class_type: 'UNETLoader',
      _meta: { title: 'Load Diffusion Model' }
    }
  };

  const usesInputImage = state.imageInput.mode !== 'text2img';
  if (usesInputImage && !state.imageInput.imageName) {
    throw new Error('Upload an input image before generating.');
  }

  if (usesInputImage) {
    prompt['30'] = {
      inputs: { image: state.imageInput.imageName },
      class_type: 'LoadImage',
      _meta: { title: 'Load Input Image' }
    };
  }

  // 2. Dynamic LoRA Chain
  const activeLoras = state.loras.filter((l) => l.enabled && l.name);
  let lastModelNodeId = '29';

  activeLoras.forEach((lora, index) => {
    const loraNodeId = `10${index + 1}`;
    prompt[loraNodeId] = {
      inputs: {
        lora_name: lora.name,
        strength_model: lora.strength,
        model: [lastModelNodeId, 0]
      },
      class_type: 'LoraLoaderModelOnly',
      _meta: { title: `Load LoRA (${lora.name})` }
    };
    lastModelNodeId = loraNodeId;
  });

  if (!isMoss && state.advanced.cacheDiT.enabled) {
    prompt['cache_dit'] = {
      inputs: {
        model: [lastModelNodeId, 0],
        enable: true,
        model_type: state.advanced.cacheDiT.modelType,
        warmup_steps: state.advanced.cacheDiT.warmupSteps,
        skip_interval: state.advanced.cacheDiT.skipInterval,
        print_summary: state.advanced.cacheDiT.printSummary,
        threshold: state.advanced.cacheDiT.threshold,
        noise_scale: state.advanced.cacheDiT.noiseScale,
        strategy: state.advanced.cacheDiT.strategy
      },
      class_type: 'CacheDiT_Model_Optimizer',
      _meta: { title: '⚡ CacheDiT Accelerator' }
    };
    lastModelNodeId = 'cache_dit';
  }

  if (isMoss && state.moss.tsrEnabled) {
    prompt['moss_tsr'] = {
      inputs: {
        tsr_k: state.moss.tsrK,
        tsr_sigma: state.moss.tsrSigma,
        model: [lastModelNodeId, 0]
      },
      class_type: 'TemporalScoreRescaling',
      _meta: { title: 'TSR - Temporal Score Rescaling' }
    };
    lastModelNodeId = 'moss_tsr';
  }

  if (isMoss && state.moss.auraFlowEnabled) {
    prompt['moss_aura_flow'] = {
      inputs: {
        shift: state.moss.auraFlowShift,
        model: [lastModelNodeId, 0]
      },
      class_type: 'ModelSamplingAuraFlow',
      _meta: { title: 'ModelSamplingAuraFlow' }
    };
    lastModelNodeId = 'moss_aura_flow';
  }

  if (isMoss && state.moss.skipLayerGuidance) {
    const fullRange = state.moss.spectrumEnabled || isMossEdit;
    prompt['moss_slg'] = {
      inputs: {
        double_layers: '',
        single_layers: state.moss.slgSingleLayers,
        start_percent: fullRange ? 0 : state.moss.slgStartPercent,
        end_percent: fullRange ? 1 : state.moss.slgEndPercent,
        model: [lastModelNodeId, 0]
      },
      class_type: 'SkipLayerGuidanceDiTSimple',
      _meta: { title: 'MOSS Skip Layer Guidance' }
    };
    lastModelNodeId = 'moss_slg';
  }

  if (isMoss && state.moss.spectrumEnabled) {
    prompt['moss_spectrum'] = mossSpectrumNode(state.moss, [
      lastModelNodeId,
      0
    ]);
    lastModelNodeId = 'moss_spectrum';
  }

  if (!isMoss && state.advanced.auraFlowEnabled) {
    prompt['13'] = {
      inputs: {
        shift: state.models.shift,
        model: [lastModelNodeId, 0]
      },
      class_type: 'ModelSamplingAuraFlow',
      _meta: { title: 'ModelSamplingAuraFlow' }
    };
    lastModelNodeId = '13';
  }

  if (!isMoss && state.advanced.renormCfg.enabled) {
    prompt['renorm_cfg'] = {
      inputs: {
        model: [lastModelNodeId, 0],
        cfg_trunc: state.advanced.renormCfg.cfgTrunc,
        renorm_cfg: state.advanced.renormCfg.renormCfg
      },
      class_type: 'RenormCFG',
      _meta: { title: 'RenormCFG' }
    };
    lastModelNodeId = 'renorm_cfg';
  }

  // 4. CLIP Loader (Node 28)
  prompt['28'] = {
    inputs: {
      clip_name: state.models.clipName,
      type: isMoss ? 'moss_image' : 'cosmos',
      device: 'default'
    },
    class_type: 'CLIPLoader',
    _meta: { title: 'Load CLIP' }
  };

  // 5. VAE Loader (Node 27)
  prompt['27'] = {
    inputs: {
      vae_name: state.models.vaeName
    },
    class_type: 'VAELoader',
    _meta: { title: 'Load VAE' }
  };

  // 6. Prompts
  const positiveText = isMoss
    ? state.positivePrompt
    : formatPrompt(state.positivePrompt);
  const negativeText = isMoss
    ? state.negativePrompt
    : removeNegativeOverlap(positiveText, formatPrompt(state.negativePrompt));

  // 7. Conditioning (Nodes 21, 17)
  let positiveConditioning: WorkflowNodeRef = ['21', 0];
  let negativeConditioning: WorkflowNodeRef = ['17', 0];
  if (isMoss) {
    prompt['moss_positive'] = {
      inputs: {
        text: appendMossLayoutStage(prompt, state) ?? positiveText,
        clip: ['28', 0]
      },
      class_type: 'CLIPTextEncode',
      _meta: { title: 'Positive Prompt' }
    };
    prompt['moss_negative'] = {
      inputs: { text: negativeText, clip: ['28', 0] },
      class_type: 'CLIPTextEncode',
      _meta: { title: 'Negative Prompt' }
    };
    positiveConditioning = ['moss_positive', 0];
    negativeConditioning = ['moss_negative', 0];
  } else {
    prompt['21'] = {
      inputs: { text: positiveText, clip: ['28', 0] },
      class_type: 'CLIPTextEncode',
      _meta: { title: 'Positive Prompt' }
    };
    prompt['17'] = {
      inputs: { text: negativeText, clip: ['28', 0] },
      class_type: 'CLIPTextEncode',
      _meta: { title: 'Negative Prompt' }
    };
  }

  // 8. Empty Latent Image (Node 19)
  if (usesInputImage && !isMossEdit) {
    prompt['19'] = {
      inputs: {
        pixels: ['30', 0],
        vae: ['27', 0]
      },
      class_type: 'VAEEncode',
      _meta: { title: 'VAE Encode Input Image' }
    };
  } else if (isMoss) {
    prompt['19'] = {
      inputs: {
        width: isMossEdit
          ? ['moss_edit_size', 0]
          : state.resolution.width || 1024,
        height: isMossEdit
          ? ['moss_edit_size', 1]
          : state.resolution.height || 1024,
        batch_size: state.resolution.batchSize
      },
      class_type: 'EmptyFlux2LatentImage',
      _meta: { title: 'Empty Flux 2 Latent' }
    };
  } else {
    prompt['19'] = {
      inputs: {
        width: state.resolution.width || 1024,
        height: state.resolution.height || 1024,
        batch_size: state.resolution.batchSize
      },
      class_type: 'EmptyLatentImage',
      _meta: { title: 'Empty Latent Image' }
    };
  }

  // 9. KSampler (Node 9)
  const samplerInputs: SamplerInputs = {
    model: [lastModelNodeId, 0],
    positive: positiveConditioning,
    negative: negativeConditioning
  };
  const appendMossSamplerStage = () =>
    isMossEdit
      ? appendMossEditStage(prompt, state, samplerInputs, {
          positive: positiveText,
          negative: negativeText
        })
      : appendMossControlStage(prompt, state, samplerInputs);
  const sampler = samplerNode(state);
  prompt['9'] = {
    ...sampler,
    inputs: {
      seed: state.sampler.seed,
      steps: state.sampler.steps,
      cfg: state.sampler.cfg,
      sampler_name: state.sampler.samplerName,
      scheduler: state.sampler.scheduler,
      denoise: isMossEdit ? 1 : state.sampler.denoise,
      ...(isMoss ? appendMossSamplerStage() : samplerInputs),
      latent_image: ['19', 0],
      ...sampler.inputs
    }
  };

  // 10. VAE Decode (Node 6)
  prompt['6'] = {
    inputs: {
      samples: ['9', 0],
      vae: ['27', 0]
    },
    class_type: 'VAEDecode',
    _meta: { title: 'VAE Decode' }
  };

  let decodedImageSource: WorkflowNodeRef = ['6', 0];
  if (state.faceDetailer.enabled) {
    decodedImageSource = appendFaceDetailerStage(prompt, state.faceDetailer, {
      image: decodedImageSource,
      model: [lastModelNodeId, 0],
      clip: ['28', 0],
      vae: ['27', 0],
      seed: state.sampler.seed
    });
  }

  // 11. Preview Image (Node 7)
  prompt['7'] = {
    inputs: {
      images: decodedImageSource
    },
    class_type: 'PreviewImage',
    _meta: { title: 'Preview Image' }
  };

  // 12. Upscale (Node 8)
  let imageSourceForPostFx: WorkflowNodeRef = decodedImageSource;
  if (
    state.postfx.upscale.enabled &&
    state.postfx.upscale.upscaleModel &&
    state.postfx.upscale.ultimate.enabled
  ) {
    imageSourceForPostFx = appendUltimateUpscaleStage(
      prompt,
      state.postfx.upscale.ultimate,
      {
        image: decodedImageSource,
        model: [lastModelNodeId, 0],
        positive: positiveConditioning,
        negative: negativeConditioning,
        vae: ['27', 0],
        upscaleModel: state.postfx.upscale.upscaleModel,
        upscaleBy: state.postfx.upscale.upscaleBy,
        seed: state.sampler.seed
      },
      '8'
    );
  } else if (
    state.postfx.upscale.enabled &&
    state.postfx.upscale.upscaleModel
  ) {
    imageSourceForPostFx = appendModelUpscaleStage(
      prompt,
      {
        image: decodedImageSource,
        upscaleModel: state.postfx.upscale.upscaleModel,
        upscaleBy: state.postfx.upscale.upscaleBy
      },
      '8'
    );
  }

  // 13. PostFX (Node 4)
  let finalImageSource = imageSourceForPostFx;

  if (state.postfx.enabled) {
    const { styleStage, adjustStage } = state.postfx;
    prompt['4'] = {
      inputs: {
        image: imageSourceForPostFx,
        style_enabled: styleStage.enabled,
        vignette_strength: styleStage.vignetteStrength,
        vignette_softness: styleStage.vignetteSoftness,
        film_grain: styleStage.filmGrain,
        grain_seed: 0,
        chromatic_aberration: styleStage.chromaticAberration,
        ca_angle: 0,
        bloom_strength: styleStage.bloomStrength,
        bloom_radius: styleStage.bloomRadius,
        bloom_threshold: styleStage.bloomThreshold,
        adjust_enabled: adjustStage.enabled,
        brightness: adjustStage.brightness,
        contrast: adjustStage.contrast,
        saturation: adjustStage.saturation,
        sharpness: adjustStage.sharpness
      },
      class_type: 'KoharuPostFX',
      _meta: { title: 'PostFX' }
    };

    finalImageSource = ['4', 0];
  }

  // 14. Save Image With Metadata (Node 5)
  prompt['5'] = {
    inputs: {
      filename_prefix: 'ComfyUI',
      images: finalImageSource,
      positive: positiveText,
      negative: negativeText,
      seed: state.sampler.seed,
      steps: state.sampler.steps,
      cfg: state.sampler.cfg,
      sampler_name: state.sampler.samplerName,
      scheduler: state.sampler.scheduler,
      denoise: state.sampler.denoise,
      model_name: state.models.unetName
    },
    class_type: 'KoharuSaveImage',
    _meta: { title: 'Save Image' }
  };

  return prompt;
}

function buildInpaintPrompt(state: WorkflowState): Record<string, unknown> {
  if (!state.imageInput.imageName) {
    throw new Error('Upload an input image before generating.');
  }
  if (!state.imageInput.maskName) {
    throw new Error('Paint and save a mask before generating.');
  }

  const modelNode = state.imageInput.turboEnabled ? '34' : '33';
  const steps = state.imageInput.turboEnabled
    ? state.imageInput.turboSteps
    : state.imageInput.inpaintSteps;
  const cfg = state.imageInput.turboEnabled
    ? state.imageInput.turboCfg
    : state.imageInput.inpaintCfg;
  const sampler = samplerNode(state);
  const prompt: Record<string, unknown> = {
    '29': {
      inputs: { unet_name: state.models.unetName, weight_dtype: 'default' },
      class_type: 'UNETLoader',
      _meta: { title: 'Load Diffusion Model' }
    },
    '28': {
      inputs: {
        clip_name: state.models.clipName,
        type: 'stable_diffusion',
        device: 'default'
      },
      class_type: 'CLIPLoader',
      _meta: { title: 'Load CLIP' }
    },
    '27': {
      inputs: { vae_name: state.models.vaeName },
      class_type: 'VAELoader',
      _meta: { title: 'Load VAE' }
    },
    '30': {
      inputs: { image: state.imageInput.imageName },
      class_type: 'LoadImage',
      _meta: { title: 'Load Input Image' }
    },
    '31': {
      inputs: { image: state.imageInput.maskName, channel: 'red' },
      class_type: 'LoadImageMask',
      _meta: { title: 'Load Inpainting Mask' }
    },
    '32': {
      inputs: { name: state.imageInput.modelPatch },
      class_type: 'ModelPatchLoader',
      _meta: { title: 'Load Anima LLLite Inpainting Patch' }
    },
    '33': {
      inputs: {
        strength: state.imageInput.llliteStrength,
        start_percent: state.imageInput.llliteStart,
        end_percent: state.imageInput.llliteEnd,
        model: ['29', 0],
        model_patch: ['32', 0],
        image: ['30', 0],
        mask: ['31', 0]
      },
      class_type: 'AnimaLLLiteApply',
      _meta: { title: 'Apply Anima LLLite Inpainting' }
    },
    '21': {
      inputs: { text: formatPrompt(state.positivePrompt), clip: ['28', 0] },
      class_type: 'CLIPTextEncode',
      _meta: { title: 'Positive Prompt' }
    },
    '17': {
      inputs: { text: formatPrompt(state.negativePrompt), clip: ['28', 0] },
      class_type: 'CLIPTextEncode',
      _meta: { title: 'Negative Prompt' }
    },
    '19': {
      inputs: {
        width: state.imageInput.imageWidth || state.resolution.width || 1024,
        height: state.imageInput.imageHeight || state.resolution.height || 1024,
        batch_size: 1
      },
      class_type: 'EmptyLatentImage',
      _meta: { title: 'Empty Latent Image' }
    },
    '9': {
      ...sampler,
      inputs: {
        seed: state.sampler.seed,
        steps,
        cfg,
        sampler_name: 'euler',
        scheduler: 'simple',
        denoise: 1,
        model: [modelNode, 0],
        positive: ['21', 0],
        negative: ['17', 0],
        latent_image: ['19', 0],
        ...sampler.inputs
      }
    },
    '6': {
      inputs: { samples: ['9', 0], vae: ['27', 0] },
      class_type: 'VAEDecode',
      _meta: { title: 'VAE Decode' }
    },
    '7': {
      inputs: { images: ['6', 0] },
      class_type: 'PreviewImage',
      _meta: { title: 'Preview Image' }
    },
    '5': {
      inputs: { filename_prefix: 'ComfyUI', images: ['6', 0] },
      class_type: 'SaveImage',
      _meta: { title: 'Save Image' }
    }
  };

  if (state.imageInput.turboEnabled) {
    prompt['34'] = {
      inputs: {
        lora_name: state.imageInput.turboLora,
        strength_model: 1,
        model: ['33', 0]
      },
      class_type: 'LoraLoaderModelOnly',
      _meta: { title: 'Load Anima Turbo LoRA' }
    };
  }

  if (state.faceDetailer.enabled) {
    const finalImageSource = appendFaceDetailerStage(
      prompt,
      state.faceDetailer,
      {
        image: ['6', 0],
        model: [modelNode, 0],
        clip: ['28', 0],
        vae: ['27', 0],
        seed: state.sampler.seed
      }
    );
    prompt['7'] = {
      inputs: { images: finalImageSource },
      class_type: 'PreviewImage',
      _meta: { title: 'Preview Face Detailed Image' }
    };
    prompt['5'] = {
      inputs: { filename_prefix: 'ComfyUI', images: finalImageSource },
      class_type: 'SaveImage',
      _meta: { title: 'Save Face Detailed Image' }
    };
  }

  return prompt;
}
