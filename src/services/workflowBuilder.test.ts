import assert from 'node:assert/strict';
import { createWorkflowSnapshot } from '../composables/useComfyUiWorkspace';
import type { WorkflowState } from '../types/workflow';
import { buildFaceDetailerPrompt } from './faceDetailerWorkflow';
import { buildUltimateUpscalePrompt } from './ultimateUpscaleWorkflow';
import {
  buildWorkflowPrompt,
  prepareWorkflowForQueue
} from './workflowBuilder';

const state: WorkflowState = {
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

state.sampler.seed = -1;
state.sampler.randomizeSeed = true;
const randomSeedState = prepareWorkflowForQueue(state);
assert.equal(state.sampler.seed, -1);
assert.ok(randomSeedState.sampler.seed >= 0);
assert.ok(randomSeedState.sampler.seed < 10_000_000_000);
state.sampler.seed = 1;
state.sampler.randomizeSeed = false;

// Dynamic prompts: resolved from the seed, template preserved.
assert.equal(prepareWorkflowForQueue(state).promptTemplates, undefined);
state.positivePrompt = '{red|blue|green} hair, {a|{b|c}}';
state.negativePrompt = 'bad, {blurry|lowres}';
state.sampler.seed = 777;
const dynamicFirst = prepareWorkflowForQueue(state);
const dynamicSecond = prepareWorkflowForQueue(state);
assert.equal(state.positivePrompt, '{red|blue|green} hair, {a|{b|c}}');
assert.equal(dynamicFirst.positivePrompt, dynamicSecond.positivePrompt);
assert.equal(dynamicFirst.negativePrompt, dynamicSecond.negativePrompt);
assert.ok(!dynamicFirst.positivePrompt.includes('{'));
assert.ok(!dynamicFirst.negativePrompt.includes('|'));
assert.match(dynamicFirst.positivePrompt, /^(red|blue|green) hair, (a|b|c)$/u);
assert.deepEqual(dynamicFirst.promptTemplates, {
  positivePrompt: '{red|blue|green} hair, {a|{b|c}}',
  negativePrompt: 'bad, {blurry|lowres}',
  faceDetailerPositivePrompt: state.faceDetailer.positivePrompt,
  faceDetailerNegativePrompt: state.faceDetailer.negativePrompt
});
const dynamicGraph = buildWorkflowPrompt(dynamicFirst) as Record<
  string,
  { inputs: Record<string, unknown> }
>;
assert.equal(dynamicGraph['21'].inputs.prompt, dynamicFirst.positivePrompt);
assert.equal(dynamicGraph['17'].inputs.prompt, dynamicFirst.negativePrompt);
assert.ok(!JSON.stringify(dynamicGraph).includes('{red'));
state.sampler.seed = 778;
const dynamicOtherSeeds = new Set(
  Array.from({ length: 30 }, (_, index) => {
    state.sampler.seed = 1000 + index;
    return prepareWorkflowForQueue(state).positivePrompt;
  })
);
assert.ok(dynamicOtherSeeds.size > 1);
state.positivePrompt = 'test';
state.negativePrompt = 'bad';
state.sampler.seed = 1;

const img2img = buildWorkflowPrompt(state) as Record<
  string,
  { class_type: string }
>;
assert.equal(img2img['30'].class_type, 'LoadImage');
assert.equal(img2img['19'].class_type, 'VAEEncode');
assert.equal(img2img['9'].class_type, 'KSampler');
assert.equal(img2img['13'], undefined);

state.loras = [
  { id: '1', name: 'test.safetensors', strength: 1, enabled: true }
];
state.advanced.cacheDiT.enabled = true;
state.advanced.auraFlowEnabled = true;
state.advanced.renormCfg.enabled = true;
const advanced = buildWorkflowPrompt(state) as Record<
  string,
  { class_type: string; inputs: Record<string, unknown> }
>;
assert.deepEqual(advanced.cache_dit.inputs.model, ['101', 0]);
assert.equal(advanced.cache_dit.inputs.strategy, 'adaptive');
assert.equal(advanced.cache_dit.inputs.threshold, 0.25);
assert.equal(advanced.cache_dit.inputs.noise_scale, 0.001);
assert.deepEqual(advanced['13'].inputs.model, ['cache_dit', 0]);
assert.deepEqual(advanced.renorm_cfg.inputs.model, ['13', 0]);
assert.deepEqual(advanced['9'].inputs.model, ['renorm_cfg', 0]);

state.sampler.variationEnabled = true;
const variation = buildWorkflowPrompt(state) as Record<
  string,
  { class_type: string; inputs: Record<string, unknown> }
>;
assert.equal(variation['9'].class_type, 'YEKSampler');
assert.equal(variation['9'].inputs.variation_seed, 2);
assert.equal(variation['9'].inputs.variation_strength, 0.35);

state.sampler.variationSeed = -1;
const randomVariation = buildWorkflowPrompt(state) as Record<
  string,
  { inputs: Record<string, unknown> }
>;
assert.equal(randomVariation['9'].inputs.variation_seed, -1);

state.faceDetailer.enabled = true;
state.faceDetailer.turboEnabled = true;
state.positivePrompt = '';
const detailed = buildWorkflowPrompt(state) as Record<
  string,
  { class_type: string; inputs: Record<string, unknown> }
>;
assert.equal(detailed['face_detailer_apply'].class_type, 'FaceDetailer');
assert.equal(detailed['face_detailer_turbo'].class_type, 'YELoadLoraModel');
assert.equal(detailed['face_detailer_apply'].inputs.steps, 8);
assert.equal(detailed['face_detailer_apply'].inputs.cfg, 1);
assert.deepEqual(detailed['face_detailer_apply'].inputs.positive, [
  'face_detailer_positive_zero',
  0
]);
assert.equal(detailed['face_detailer_segm'], undefined);

state.imageInput.mode = 'inpaint';
state.imageInput.maskName = 'mask.png';
const inpaint = buildWorkflowPrompt(state) as Record<
  string,
  { class_type: string; inputs: Record<string, unknown> }
>;
assert.equal(inpaint['31'].class_type, 'LoadImageMask');
assert.equal(inpaint['33'].class_type, 'AnimaLLLiteApply');
assert.equal(inpaint['34'].class_type, 'LoraLoaderModelOnly');
assert.equal(inpaint['21'].class_type, 'YEClipTextEncodePrompt');
assert.equal(inpaint['17'].class_type, 'YEClipTextEncodePrompt');
assert.equal(inpaint['9'].class_type, 'YEKSampler');
assert.equal(inpaint['19'].class_type, 'EmptyLatentImage');
assert.deepEqual(inpaint['19'].inputs, {
  width: 512,
  height: 768,
  batch_size: 1
});
assert.deepEqual(inpaint['9'].inputs.model, ['34', 0]);
assert.equal(inpaint['9'].inputs.steps, 8);
assert.equal(inpaint['9'].inputs.cfg, 1);
assert.equal(inpaint['9'].inputs.denoise, 1);
assert.equal(inpaint['13'], undefined);

state.imageInput.turboEnabled = false;
const standardInpaint = buildWorkflowPrompt(state) as Record<
  string,
  { inputs: Record<string, unknown> }
>;
assert.equal(standardInpaint['34'], undefined);
assert.deepEqual(standardInpaint['9'].inputs.model, ['33', 0]);
assert.equal(standardInpaint['9'].inputs.steps, 30);
assert.equal(standardInpaint['9'].inputs.cfg, 4);

// Each Detailer prompt has its own conditioning, independent of generation.
for (const mode of ['text2img', 'img2img', 'inpaint'] as const) {
  state.imageInput.mode = mode;
  state.sampler.randomizeSeed = true;
  const beforeSnapshot = structuredClone(state);
  const snapshot = createWorkflowSnapshot(state, 'http://127.0.0.1:8188/');
  assert.deepEqual(snapshot.prompt, buildWorkflowPrompt(state));
  assert.deepEqual(
    state,
    beforeSnapshot,
    'Viewing must not mutate state or randomize the seed'
  );
  assert.equal(snapshot.serverUrl, 'http://127.0.0.1:8188');
  assert.notEqual(
    snapshot.filename,
    createWorkflowSnapshot(state, snapshot.serverUrl).filename
  );
  state.positivePrompt = 'generation positive';
  state.negativePrompt = 'generation negative';
  state.advanced.auraFlowEnabled = false;
  state.advanced.cacheDiT.enabled = false;
  state.advanced.renormCfg.enabled = false;
  for (const [positive, negative] of [
    ['', '   '],
    ['', 'face negative'],
    ['face positive', '   '],
    ['face positive', 'face negative']
  ]) {
    state.faceDetailer.positivePrompt = positive;
    state.faceDetailer.negativePrompt = negative;
    const graph = buildWorkflowPrompt(state) as typeof detailed;
    for (const [name, text] of [
      ['positive', positive],
      ['negative', negative]
    ]) {
      const id = `face_detailer_${name}`;
      assert.equal(graph[id].inputs.text, text);
      assert.deepEqual(graph.face_detailer_apply.inputs[name], [
        `${id}${text.trim() ? '' : '_zero'}`,
        0
      ]);
      assert.equal(Boolean(graph[`${id}_zero`]), !text.trim());
    }
    // Every connection must point to an emitted node, including model transforms disabled.
    const connections = Object.values(graph).flatMap((node) =>
      Object.values(node.inputs)
    );
    for (const value of connections.filter(
      (input) => Array.isArray(input) && typeof input[0] === 'string'
    ) as [string, number][]) {
      assert.ok(graph[value[0]], value[0]);
    }
  }
}

const standalone = buildFaceDetailerPrompt(
  'face.png',
  state.faceDetailer,
  state.models,
  [
    { id: 'off', name: 'disabled.safetensors', strength: 1, enabled: false },
    { id: 'on', name: 'face-style.safetensors', strength: 0.8, enabled: true }
  ],
  42
) as typeof detailed;
assert.equal(standalone.detail_lora_0, undefined);
assert.deepEqual(standalone.detail_lora_1.inputs.model, ['2', 0]);
assert.deepEqual(standalone.face_detailer_turbo.inputs.model, [
  'detail_lora_1',
  0
]);
assert.deepEqual(standalone.face_detailer_apply.inputs.model, [
  'face_detailer_turbo',
  0
]);
assert.equal(standalone.face_detailer_apply.inputs.seed, 42);
assert.equal(standalone['2'].inputs.unet_name, state.models.unetName);
assert.equal(standalone['20'].class_type, 'SaveImage');
// Ultimate SD Upscale replaces the plain upscaler node in the generation chain.
state.imageInput.mode = 'text2img';
state.faceDetailer.enabled = false;
state.postfx.enabled = true;
state.postfx.upscale.enabled = true;
state.postfx.upscale.upscaleModel = 'up.safetensors';
state.postfx.upscale.upscaleBy = 6;
const plainUpscale = buildWorkflowPrompt(state) as Record<
  string,
  { class_type: string; inputs: Record<string, unknown> }
>;
assert.equal(plainUpscale['8'].class_type, 'YEImageUpscale');
state.postfx.upscale.ultimate.enabled = true;
const ultimate = buildWorkflowPrompt(state) as Record<
  string,
  { class_type: string; inputs: Record<string, unknown> }
>;
assert.equal(ultimate['8'].class_type, 'UltimateSDUpscale');
assert.equal(ultimate['8_model'].class_type, 'UpscaleModelLoader');
assert.equal(ultimate['8'].inputs.upscale_by, 4);
assert.deepEqual(ultimate['8'].inputs.seed, ['14', 0]);
assert.deepEqual(ultimate['8'].inputs.positive, ['18', 0]);
assert.deepEqual(ultimate['8'].inputs.negative, ['18', 1]);
assert.deepEqual(ultimate['8'].inputs.model, ['101', 0]);
assert.deepEqual(ultimate['8'].inputs.upscale_model, ['8_model', 0]);
assert.equal(ultimate['8'].inputs.mode_type, 'Chess');
assert.deepEqual(ultimate['4'].inputs.image, ['8', 0]);
state.postfx.upscale.ultimate.turboEnabled = true;
const ultimateTurbo = buildWorkflowPrompt(state) as Record<
  string,
  { class_type: string; inputs: Record<string, unknown> }
>;
assert.equal(ultimateTurbo['8_turbo'].class_type, 'YELoadLoraModel');
assert.deepEqual(ultimateTurbo['8_turbo'].inputs.model, ['101', 0]);
assert.deepEqual(ultimateTurbo['8'].inputs.model, ['8_turbo', 0]);
assert.equal(ultimateTurbo['8'].inputs.steps, 8);
assert.equal(ultimateTurbo['8'].inputs.cfg, 1);
state.postfx.upscale.ultimate.turboEnabled = false;
state.postfx.upscale.ultimate.enabled = false;
state.postfx.upscale.enabled = false;
state.postfx.enabled = false;

const standaloneUltimate = buildUltimateUpscalePrompt({
  imageName: 'in.png',
  settings: { ...state.postfx.upscale.ultimate, enabled: true },
  models: state.models,
  loras: state.loras,
  positivePrompt: 'hi',
  negativePrompt: '',
  upscaleModel: 'up.safetensors',
  upscaleBy: 2,
  seed: 7,
  filenamePrefix: 'X'
}) as Record<string, { class_type: string; inputs: Record<string, unknown> }>;
assert.equal(
  standaloneUltimate.ultimate_upscale.class_type,
  'UltimateSDUpscale'
);
assert.equal(standaloneUltimate.ultimate_upscale.inputs.seed, 7);
assert.deepEqual(standaloneUltimate.ultimate_upscale.inputs.model, [
  'usdu_lora_0',
  0
]);
assert.deepEqual(standaloneUltimate['20'].inputs.images, [
  'ultimate_upscale',
  0
]);
assert.throws(() =>
  buildUltimateUpscalePrompt({
    imageName: 'in.png',
    settings: state.postfx.upscale.ultimate,
    models: state.models,
    loras: [],
    positivePrompt: '',
    negativePrompt: '',
    upscaleModel: '',
    upscaleBy: 2,
    seed: 0,
    filenamePrefix: ''
  })
);

console.log('Workflow and Face Detailer graph checks passed');
