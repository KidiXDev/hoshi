import type { WorkflowState } from '../types/workflow';
import {
  hasDynamicPrompt,
  resolveDynamicPromptWithSeed
} from '../utils/dynamicPrompt';
import {
  appendFaceDetailerStage,
  type WorkflowNodeRef
} from './faceDetailerWorkflow';
import { appendUltimateUpscaleStage } from './ultimateUpscaleWorkflow';

function variationInputs(state: WorkflowState) {
  if (!state.sampler.variationEnabled) return {};
  return {
    variation_seed: Math.max(-1, Math.trunc(state.sampler.variationSeed)),
    variation_strength: Math.min(
      1,
      Math.max(0, state.sampler.variationStrength || 0)
    )
  };
}

export function prepareWorkflowForQueue(state: WorkflowState): WorkflowState {
  const queuedState = structuredClone(state);
  if (queuedState.sampler.randomizeSeed || queuedState.sampler.seed < 0) {
    queuedState.sampler.seed = Math.floor(Math.random() * 10_000_000_000);
  }
  resolveDynamicPrompts(queuedState);
  return queuedState;
}

/**
 * Resolves `{a|b}` groups in every prompt field using the (now concrete) seed,
 * remembering the templates so history can restore them.
 */
function resolveDynamicPrompts(state: WorkflowState) {
  const templates = {
    positivePrompt: state.positivePrompt,
    negativePrompt: state.negativePrompt,
    faceDetailerPositivePrompt: state.faceDetailer?.positivePrompt ?? '',
    faceDetailerNegativePrompt: state.faceDetailer?.negativePrompt ?? ''
  };
  if (!Object.values(templates).some((text) => hasDynamicPrompt(text))) {
    delete state.promptTemplates;
    return;
  }
  const seed = state.sampler.seed;
  state.promptTemplates = templates;
  state.positivePrompt = resolveDynamicPromptWithSeed(
    templates.positivePrompt,
    seed,
    'positive'
  );
  state.negativePrompt = resolveDynamicPromptWithSeed(
    templates.negativePrompt,
    seed,
    'negative'
  );
  if (state.faceDetailer) {
    state.faceDetailer.positivePrompt = resolveDynamicPromptWithSeed(
      templates.faceDetailerPositivePrompt,
      seed,
      'fd-positive'
    );
    state.faceDetailer.negativePrompt = resolveDynamicPromptWithSeed(
      templates.faceDetailerNegativePrompt,
      seed,
      'fd-negative'
    );
  }
}

export function buildWorkflowPrompt(
  state: WorkflowState
): Record<string, unknown> {
  if (state.imageInput.mode === 'inpaint') return buildInpaintPrompt(state);

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
      class_type: 'YELoadLoraModel',
      _meta: { title: `YE Load LoRA (${lora.name})` }
    };
    lastModelNodeId = loraNodeId;
  });

  if (state.advanced.cacheDiT.enabled) {
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

  if (state.advanced.auraFlowEnabled) {
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

  if (state.advanced.renormCfg.enabled) {
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
      type: 'cosmos',
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

  // 6. Positive Prompt (Node 21)
  prompt['21'] = {
    inputs: {
      prompt: state.positivePrompt
    },
    class_type: 'YEPrompt',
    _meta: { title: 'YE Positive Prompt' }
  };

  // 7. Negative Prompt (Node 17)
  prompt['17'] = {
    inputs: {
      prompt: state.negativePrompt
    },
    class_type: 'YEPrompt',
    _meta: { title: 'YE Negative Prompt' }
  };

  // 8. CLIP Text Util (Node 18)
  prompt['18'] = {
    inputs: {
      format_prompt: true,
      clip: ['28', 0],
      positive: ['21', 1],
      negative: ['17', 1]
    },
    class_type: 'YEClipTextUtil',
    _meta: { title: 'YE Clip Text Util' }
  };

  // 9. Seed Generator (Node 14)
  prompt['14'] = {
    inputs: {
      seed: state.sampler.seed
    },
    class_type: 'YESeedGenerator',
    _meta: { title: 'YE Seed Generator' }
  };

  // 10. Empty Latent Image (Node 19)
  const isCustomResolution =
    state.resolution.preset === 'Custom' ||
    state.resolution.preset.toLowerCase().startsWith('custom') ||
    state.resolution.isCustom;

  if (state.imageInput.mode === 'img2img') {
    prompt['19'] = {
      inputs: {
        pixels: ['30', 0],
        vae: ['27', 0]
      },
      class_type: 'VAEEncode',
      _meta: { title: 'VAE Encode Input Image' }
    };
  } else if (isCustomResolution) {
    prompt['19'] = {
      inputs: {
        width: state.resolution.width || 1024,
        height: state.resolution.height || 1024,
        batch_size: state.resolution.batchSize
      },
      class_type: 'EmptyLatentImage',
      _meta: { title: 'Empty Latent Image' }
    };
  } else {
    prompt['19'] = {
      inputs: {
        preset: state.resolution.preset,
        batch_size: state.resolution.batchSize
      },
      class_type: 'YEEmptyLatentImage',
      _meta: { title: 'YE Empty Latent Image' }
    };
  }

  // 11. KSampler (Node 9)
  prompt['9'] = {
    inputs: {
      seed: ['14', 0],
      steps: state.sampler.steps,
      cfg: state.sampler.cfg,
      sampler_name: state.sampler.samplerName,
      scheduler: state.sampler.scheduler,
      denoise: state.sampler.denoise,
      model: [lastModelNodeId, 0],
      positive: ['18', 0],
      negative: ['18', 1],
      latent_image: ['19', 0],
      ...variationInputs(state)
    },
    class_type: state.sampler.variationEnabled ? 'YEKSampler' : 'KSampler',
    _meta: {
      title: state.sampler.variationEnabled ? 'YE KSampler' : 'KSampler'
    }
  };

  // 12. VAE Decode (Node 6)
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

  // 13. Preview Image (Node 7)
  prompt['7'] = {
    inputs: {
      images: decodedImageSource
    },
    class_type: 'PreviewImage',
    _meta: { title: 'Preview Image' }
  };

  // 14. Upscale (Node 8)
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
        positive: ['18', 0],
        negative: ['18', 1],
        vae: ['27', 0],
        upscaleModel: state.postfx.upscale.upscaleModel,
        upscaleBy: state.postfx.upscale.upscaleBy,
        seed: ['14', 0]
      },
      '8'
    );
  } else if (
    state.postfx.upscale.enabled &&
    state.postfx.upscale.upscaleModel
  ) {
    prompt['8'] = {
      inputs: {
        upscale_model: state.postfx.upscale.upscaleModel,
        upscale_by: state.postfx.upscale.upscaleBy,
        image: decodedImageSource
      },
      class_type: 'YEImageUpscale',
      _meta: { title: 'YE Image Upscale' }
    };
    imageSourceForPostFx = ['8', 0];
  }

  // 15. PostFX Pipeline
  let finalImageSource = imageSourceForPostFx;

  if (state.postfx.enabled) {
    prompt['3'] = {
      inputs: {
        enabled: state.postfx.styleStage.enabled,
        vignette_strength: state.postfx.styleStage.vignetteStrength,
        vignette_softness: state.postfx.styleStage.vignetteSoftness,
        film_grain: state.postfx.styleStage.filmGrain,
        grain_seed: 0,
        chromatic_aberration: state.postfx.styleStage.chromaticAberration,
        ca_angle: 0,
        bloom_strength: state.postfx.styleStage.bloomStrength,
        bloom_radius: state.postfx.styleStage.bloomRadius,
        bloom_threshold: state.postfx.styleStage.bloomThreshold
      },
      class_type: 'YEPostFXAddStyleStage',
      _meta: { title: 'YE PostFX - Add Style Stage' }
    };

    prompt['11'] = {
      inputs: {
        enabled: state.postfx.adjustStage.enabled,
        brightness: state.postfx.adjustStage.brightness,
        contrast: state.postfx.adjustStage.contrast,
        saturation: state.postfx.adjustStage.saturation,
        sharpness: state.postfx.adjustStage.sharpness,
        pipeline: ['3', 0]
      },
      class_type: 'YEPostFXAddAdjustStage',
      _meta: { title: 'YE PostFX - Add Adjust Stage' }
    };

    prompt['4'] = {
      inputs: {
        image: imageSourceForPostFx,
        pipeline: ['11', 0]
      },
      class_type: 'YEPostFXApplyPipeline',
      _meta: { title: 'YE PostFX - Apply Pipeline' }
    };

    finalImageSource = ['4', 0];
  }

  // 16. Metadata Connector (Node 1)
  prompt['1'] = {
    inputs: {
      positive: ['21', 0],
      negative: ['17', 0],
      seed: ['14', 0],
      steps: state.sampler.steps,
      cfg: state.sampler.cfg,
      sampler_name: state.sampler.samplerName,
      scheduler: state.sampler.scheduler,
      denoise: state.sampler.denoise,
      model: ['29', 0]
    },
    class_type: 'YEImageMetadataConnector',
    _meta: { title: 'YE Image Metadata Connector' }
  };

  // 17. Save Image (Node 5)
  prompt['5'] = {
    inputs: {
      filename_prefix: 'ComfyUI',
      images: finalImageSource,
      metadata_pipe: ['1', 0]
    },
    class_type: 'YEImageSave',
    _meta: { title: 'YE Save Image' }
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
      inputs: {
        prompt: state.positivePrompt,
        clip: ['28', 0],
        format_prompt: true
      },
      class_type: 'YEClipTextEncodePrompt',
      _meta: { title: 'YE Clip Text Encode (Positive Prompt)' }
    },
    '17': {
      inputs: {
        prompt: state.negativePrompt,
        clip: ['28', 0],
        format_prompt: true
      },
      class_type: 'YEClipTextEncodePrompt',
      _meta: { title: 'YE Clip Text Encode (Negative Prompt)' }
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
        ...variationInputs(state)
      },
      class_type: state.sampler.variationEnabled ? 'YEKSampler' : 'KSampler',
      _meta: {
        title: state.sampler.variationEnabled ? 'YE KSampler' : 'KSampler'
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
