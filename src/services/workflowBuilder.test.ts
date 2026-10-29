import { describe, expect, it } from 'vitest';
import { createWorkflowSnapshot } from '../composables/useComfyUiWorkspace';
import type { LayoutBox, LoraItem, WorkflowState } from '../types/workflow';
import { buildFaceDetailerPrompt } from './faceDetailerWorkflow';
import { buildUltimateUpscalePrompt } from './ultimateUpscaleWorkflow';
import {
  buildWorkflowPrompt,
  prepareWorkflowForQueue
} from './workflowBuilder';

type Graph = Record<
  string,
  { class_type: string; inputs: Record<string, unknown> }
>;

const BASE_STATE: WorkflowState = {
  profile: 'anima',
  moss: { skipLayerGuidance: true, layoutEnabled: false, layoutBoxes: [] },
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

const TEST_LORA: LoraItem = {
  id: '1',
  name: 'test.safetensors',
  strength: 1,
  enabled: true
};

const MODES = ['text2img', 'img2img', 'inpaint'] as const;

function createState(configure?: (state: WorkflowState) => void) {
  const state = structuredClone(BASE_STATE);
  configure?.(state);
  return state;
}

function enableModelPatches(state: WorkflowState) {
  state.loras = [{ ...TEST_LORA }];
  state.advanced.cacheDiT.enabled = true;
  state.advanced.auraFlowEnabled = true;
  state.advanced.renormCfg.enabled = true;
}

function enableTurboFaceDetailer(state: WorkflowState) {
  state.faceDetailer.enabled = true;
  state.faceDetailer.turboEnabled = true;
}

function enableInpaint(state: WorkflowState) {
  state.imageInput.mode = 'inpaint';
  state.imageInput.maskName = 'mask.png';
}

function enableUpscale(state: WorkflowState) {
  state.imageInput.mode = 'text2img';
  state.loras = [{ ...TEST_LORA }];
  state.postfx.enabled = true;
  state.postfx.upscale.enabled = true;
  state.postfx.upscale.upscaleModel = 'up.safetensors';
  state.postfx.upscale.upscaleBy = 6;
}

const graphOf = (state: WorkflowState) => buildWorkflowPrompt(state) as Graph;

function connections(graph: Graph) {
  return Object.values(graph)
    .flatMap((node) => Object.values(node.inputs))
    .filter(
      (input): input is [string, number] =>
        Array.isArray(input) && typeof input[0] === 'string'
    );
}

describe('prepareWorkflowForQueue', () => {
  it('draws a random seed without mutating the editor state', () => {
    const state = createState((s) => {
      s.sampler.seed = -1;
      s.sampler.randomizeSeed = true;
    });

    const queued = prepareWorkflowForQueue(state);

    expect(state.sampler.seed).toBe(-1);
    expect(queued.sampler.seed).toBeGreaterThanOrEqual(0);
    expect(queued.sampler.seed).toBeLessThan(10_000_000_000);
  });

  it('keeps no prompt templates for static prompts', () => {
    expect(
      prepareWorkflowForQueue(createState()).promptTemplates
    ).toBeUndefined();
  });

  describe('dynamic prompts', () => {
    const positive = '{red|blue|green} hair, {a|{b|c}}';
    const negative = 'bad, {blurry|lowres}';
    const dynamicState = (seed: number) =>
      createState((s) => {
        s.positivePrompt = positive;
        s.negativePrompt = negative;
        s.sampler.seed = seed;
      });

    it('resolves them reproducibly from the seed and keeps the templates', () => {
      const state = dynamicState(777);

      const first = prepareWorkflowForQueue(state);
      const second = prepareWorkflowForQueue(state);

      expect(state.positivePrompt).toBe(positive);
      expect(first.positivePrompt).toBe(second.positivePrompt);
      expect(first.negativePrompt).toBe(second.negativePrompt);
      expect(first.positivePrompt).toMatch(/^(red|blue|green) hair, (a|b|c)$/u);
      expect(first.negativePrompt).not.toContain('|');
      expect(first.promptTemplates).toEqual({
        positivePrompt: positive,
        negativePrompt: negative,
        faceDetailerPositivePrompt: '',
        faceDetailerNegativePrompt: ''
      });
    });

    it('sends only the resolved text to ComfyUI', () => {
      const queued = prepareWorkflowForQueue(dynamicState(777));

      const graph = graphOf(queued);

      expect(graph['21']?.inputs.prompt).toBe(queued.positivePrompt);
      expect(graph['17']?.inputs.prompt).toBe(queued.negativePrompt);
      expect(JSON.stringify(graph)).not.toContain('{red');
    });

    it('varies across seeds', () => {
      const prompts = new Set(
        Array.from(
          { length: 30 },
          (_, index) =>
            prepareWorkflowForQueue(dynamicState(1000 + index)).positivePrompt
        )
      );
      expect(prompts.size).toBeGreaterThan(1);
    });
  });
});

describe('buildWorkflowPrompt', () => {
  it('loads and encodes the input image for img2img', () => {
    const graph = graphOf(createState());

    expect(graph['30']?.class_type).toBe('LoadImage');
    expect(graph['19']?.class_type).toBe('VAEEncode');
    expect(graph['9']?.class_type).toBe('KSampler');
    expect(graph['13']).toBeUndefined();
  });

  it('chains LoRA → CacheDiT → AuraFlow → RenormCFG → sampler', () => {
    const graph = graphOf(createState(enableModelPatches));

    expect(graph.cache_dit?.inputs).toMatchObject({
      model: ['101', 0],
      strategy: 'adaptive',
      threshold: 0.25,
      noise_scale: 0.001
    });
    expect(graph['13']?.inputs.model).toEqual(['cache_dit', 0]);
    expect(graph.renorm_cfg?.inputs.model).toEqual(['13', 0]);
    expect(graph['9']?.inputs.model).toEqual(['renorm_cfg', 0]);
  });

  describe('variation seed', () => {
    it('switches to the variation sampler', () => {
      const graph = graphOf(
        createState((s) => {
          s.sampler.variationEnabled = true;
        })
      );

      expect(graph['9']?.class_type).toBe('YEKSampler');
      expect(graph['9']?.inputs).toMatchObject({
        variation_seed: 2,
        variation_strength: 0.35
      });
    });

    it('passes a random variation seed through for ComfyUI to draw', () => {
      const graph = graphOf(
        createState((s) => {
          s.sampler.variationEnabled = true;
          s.sampler.variationSeed = -1;
        })
      );

      expect(graph['9']?.inputs.variation_seed).toBe(-1);
    });
  });

  it('runs the face detailer with turbo settings and zeroed empty prompts', () => {
    const graph = graphOf(createState(enableTurboFaceDetailer));

    expect(graph.face_detailer_apply?.class_type).toBe('FaceDetailer');
    expect(graph.face_detailer_turbo?.class_type).toBe('YELoadLoraModel');
    expect(graph.face_detailer_apply?.inputs).toMatchObject({
      steps: 8,
      cfg: 1,
      positive: ['face_detailer_positive_zero', 0]
    });
    expect(graph.face_detailer_segm).toBeUndefined();
  });

  describe('inpaint', () => {
    const inpaintState = (turbo: boolean) =>
      createState((s) => {
        enableModelPatches(s);
        enableInpaint(s);
        s.sampler.variationEnabled = true;
        s.imageInput.turboEnabled = turbo;
      });

    it('patches the model with LLLite and the turbo LoRA, bypassing model patches', () => {
      const graph = graphOf(inpaintState(true));

      expect(graph['31']?.class_type).toBe('LoadImageMask');
      expect(graph['33']?.class_type).toBe('AnimaLLLiteApply');
      expect(graph['34']?.class_type).toBe('LoraLoaderModelOnly');
      expect(graph['21']?.class_type).toBe('YEClipTextEncodePrompt');
      expect(graph['17']?.class_type).toBe('YEClipTextEncodePrompt');
      expect(graph['9']?.class_type).toBe('YEKSampler');
      expect(graph['9']?.inputs).toMatchObject({
        model: ['34', 0],
        steps: 8,
        cfg: 1,
        denoise: 1
      });
      expect(graph['13']).toBeUndefined();
    });

    it('starts from an empty latent at the input size', () => {
      const graph = graphOf(inpaintState(true));

      expect(graph['19']?.class_type).toBe('EmptyLatentImage');
      expect(graph['19']?.inputs).toEqual({
        width: 512,
        height: 768,
        batch_size: 1
      });
    });

    it('uses the inpaint steps and CFG without turbo', () => {
      const graph = graphOf(inpaintState(false));

      expect(graph['34']).toBeUndefined();
      expect(graph['9']?.inputs).toMatchObject({
        model: ['33', 0],
        steps: 30,
        cfg: 4
      });
    });
  });

  describe.each(MODES)('%s graph integrity', (mode) => {
    it.each([false, true])(
      'connects every input to an emitted node (model patches: %s)',
      (patches) => {
        const graph = graphOf(
          createState((s) => {
            if (patches) enableModelPatches(s);
            else s.loras = [{ ...TEST_LORA }];
            enableTurboFaceDetailer(s);
            enableInpaint(s);
            s.imageInput.mode = mode;
            s.sampler.variationEnabled = true;
            s.sampler.variationSeed = -1;
          })
        );

        for (const [nodeId] of connections(graph)) {
          expect(graph, `missing node ${nodeId}`).toHaveProperty([nodeId]);
        }
      }
    );

    it.each([
      ['', '   '],
      ['', 'face negative'],
      ['face positive', '   '],
      ['face positive', 'face negative']
    ])(
      'gives the face detailer its own conditioning (%j / %j)',
      (positive, negative) => {
        const graph = graphOf(
          createState((s) => {
            enableTurboFaceDetailer(s);
            enableInpaint(s);
            s.imageInput.mode = mode;
            s.positivePrompt = 'generation positive';
            s.negativePrompt = 'generation negative';
            s.faceDetailer.positivePrompt = positive;
            s.faceDetailer.negativePrompt = negative;
          })
        );

        for (const [name, text] of [
          ['positive', positive],
          ['negative', negative]
        ] as const) {
          const id = `face_detailer_${name}`;
          const isEmpty = !text.trim();
          expect(graph[id]?.inputs.text).toBe(text);
          expect(graph.face_detailer_apply?.inputs[name]).toEqual([
            isEmpty ? `${id}_zero` : id,
            0
          ]);
          expect(Boolean(graph[`${id}_zero`])).toBe(isEmpty);
        }
      }
    );
  });
});

describe('MOSS profile', () => {
  const LAYOUT_BOXES: LayoutBox[] = [
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

  const mossState = (configure?: (state: WorkflowState) => void) =>
    createState((s) => {
      s.profile = 'moss';
      s.imageInput.mode = 'text2img';
      configure?.(s);
    });

  const withLayout = (s: WorkflowState) => {
    s.resolution.width = 1024;
    s.resolution.height = 512;
    s.moss.layoutEnabled = true;
    s.moss.layoutBoxes = structuredClone(LAYOUT_BOXES);
  };

  it('loads the MOSS text encoder and a Flux 2 latent', () => {
    const graph = graphOf(mossState());

    expect(graph['28']?.inputs.type).toBe('moss_image');
    expect(graph['19']?.class_type).toBe('EmptyFlux2LatentImage');
    expect(graph['19']?.inputs).toEqual({
      width: 512,
      height: 768,
      batch_size: 1
    });
  });

  it('encodes prompts with CLIPTextEncode for the sampler and Ultimate Upscale', () => {
    const graph = graphOf(
      mossState((s) => {
        enableUpscale(s);
        s.postfx.upscale.ultimate.enabled = true;
      })
    );

    expect(graph['18']).toBeUndefined();
    expect(graph.moss_positive?.inputs.text).toBe('test');
    expect(graph.moss_negative?.inputs.text).toBe('bad');
    for (const node of [graph['9'], graph['8']]) {
      expect(node?.inputs).toMatchObject({
        positive: ['moss_positive', 0],
        negative: ['moss_negative', 0]
      });
    }
  });

  it('chains skip layer guidance after LoRAs and skips Anima-only patches', () => {
    const graph = graphOf(mossState(enableModelPatches));

    expect(graph.moss_slg?.class_type).toBe('SkipLayerGuidanceDiTSimple');
    expect(graph.moss_slg?.inputs.model).toEqual(['101', 0]);
    expect(graph.cache_dit).toBeUndefined();
    expect(graph['13']).toBeUndefined();
    expect(graph.renorm_cfg).toBeUndefined();
    expect(graph['9']?.inputs.model).toEqual(['moss_slg', 0]);
  });

  it('leaves skip layer guidance out when it is off', () => {
    const graph = graphOf(
      mossState((s) => {
        s.moss.skipLayerGuidance = false;
      })
    );

    expect(graph.moss_slg).toBeUndefined();
    expect(graph['9']?.inputs.model).toEqual(['29', 0]);
  });

  it('treats inpaint mode as img2img instead of the Anima LLLite graph', () => {
    const graph = graphOf(mossState(enableInpaint));

    expect(graph['33']).toBeUndefined();
    expect(graph['19']?.class_type).toBe('VAEEncode');
  });

  it('turns layout boxes into bounding boxes and a layout prompt', () => {
    const graph = graphOf(mossState(withLayout));

    expect(graph.moss_boxes?.inputs).toEqual({
      width: 1024,
      height: 512,
      editor_state: {
        __value__: [
          {
            x: 0,
            y: 0,
            width: 1024,
            height: 128,
            metadata: {
              type: 'text',
              text: 'MOSS',
              desc: 'cream serif capitals',
              palette: []
            }
          },
          {
            x: 256,
            y: 128,
            width: 512,
            height: 384,
            metadata: {
              type: 'obj',
              text: '',
              desc: 'a kneeling knight',
              palette: []
            }
          }
        ]
      }
    });
    expect(graph.moss_layout?.inputs).toEqual({
      prompt: 'test',
      width: 1024,
      height: 512,
      character_boxes: '2',
      element: ['moss_boxes', 2]
    });
    expect(graph.moss_positive?.inputs.text).toEqual(['moss_layout', 0]);
  });

  it('sends the plain prompt when the layout has no boxes', () => {
    const graph = graphOf(
      mossState((s) => {
        s.moss.layoutEnabled = true;
      })
    );

    expect(graph.moss_boxes).toBeUndefined();
    expect(graph.moss_positive?.inputs.text).toBe('test');
  });

  it.each(['text2img', 'img2img'] as const)(
    'connects every input to an emitted node (%s)',
    (mode) => {
      const graph = graphOf(
        mossState((s) => {
          enableModelPatches(s);
          enableTurboFaceDetailer(s);
          enableUpscale(s);
          withLayout(s);
          s.imageInput.mode = mode;
          s.sampler.variationEnabled = true;
        })
      );

      for (const [nodeId] of connections(graph)) {
        expect(graph, `missing node ${nodeId}`).toHaveProperty([nodeId]);
      }
    }
  );

  it('keeps a JSON prompt intact through queue preparation', () => {
    const json = '{"summary":{"caption":"a {red|blue} cup"},"items":[]}';
    const queued = prepareWorkflowForQueue(
      mossState((s) => {
        s.positivePrompt = json;
      })
    );

    expect(queued.positivePrompt).toBe(json);
    expect(graphOf(queued).moss_positive?.inputs.text).toBe(json);
  });
});

describe.each(MODES)('createWorkflowSnapshot (%s)', (mode) => {
  const snapshotState = () =>
    createState((s) => {
      enableModelPatches(s);
      enableTurboFaceDetailer(s);
      enableInpaint(s);
      s.imageInput.mode = mode;
      s.sampler.randomizeSeed = true;
    });

  it('matches the queued graph without mutating state or drawing a seed', () => {
    const state = snapshotState();
    const before = structuredClone(state);

    const snapshot = createWorkflowSnapshot(state, 'http://127.0.0.1:8188/');

    expect(snapshot.prompt).toEqual(buildWorkflowPrompt(state));
    expect(state).toEqual(before);
    expect(snapshot.serverUrl).toBe('http://127.0.0.1:8188');
  });

  it('names every snapshot uniquely', () => {
    const state = snapshotState();

    expect(createWorkflowSnapshot(state, '').filename).not.toBe(
      createWorkflowSnapshot(state, '').filename
    );
  });
});

describe('buildFaceDetailerPrompt', () => {
  const graph = buildFaceDetailerPrompt(
    'face.png',
    { ...BASE_STATE.faceDetailer, enabled: true, turboEnabled: true },
    BASE_STATE.models,
    [
      { id: 'off', name: 'disabled.safetensors', strength: 1, enabled: false },
      { id: 'on', name: 'face-style.safetensors', strength: 0.8, enabled: true }
    ],
    42
  ) as Graph;

  it('loads the base model and saves the result', () => {
    expect(graph['2']?.inputs.unet_name).toBe(BASE_STATE.models.unetName);
    expect(graph['20']?.class_type).toBe('SaveImage');
  });

  it('chains only enabled LoRAs, then turbo, into the detailer', () => {
    expect(graph.detail_lora_0).toBeUndefined();
    expect(graph.detail_lora_1?.inputs.model).toEqual(['2', 0]);
    expect(graph.face_detailer_turbo?.inputs.model).toEqual([
      'detail_lora_1',
      0
    ]);
    expect(graph.face_detailer_apply?.inputs).toMatchObject({
      model: ['face_detailer_turbo', 0],
      seed: 42
    });
  });
});

describe('Ultimate SD Upscale', () => {
  it('keeps the plain upscaler when Ultimate is off', () => {
    expect(graphOf(createState(enableUpscale))['8']?.class_type).toBe(
      'YEImageUpscale'
    );
  });

  it('replaces the upscaler node in the generation chain', () => {
    const graph = graphOf(
      createState((s) => {
        enableUpscale(s);
        s.postfx.upscale.ultimate.enabled = true;
      })
    );

    expect(graph['8']?.class_type).toBe('UltimateSDUpscale');
    expect(graph['8_model']?.class_type).toBe('UpscaleModelLoader');
    expect(graph['8']?.inputs).toMatchObject({
      upscale_by: 4,
      seed: ['14', 0],
      positive: ['18', 0],
      negative: ['18', 1],
      model: ['101', 0],
      upscale_model: ['8_model', 0],
      mode_type: 'Chess'
    });
    expect(graph['4']?.inputs.image).toEqual(['8', 0]);
  });

  it('inserts the turbo LoRA with turbo steps and CFG', () => {
    const graph = graphOf(
      createState((s) => {
        enableUpscale(s);
        s.postfx.upscale.ultimate.enabled = true;
        s.postfx.upscale.ultimate.turboEnabled = true;
      })
    );

    expect(graph['8_turbo']?.class_type).toBe('YELoadLoraModel');
    expect(graph['8_turbo']?.inputs.model).toEqual(['101', 0]);
    expect(graph['8']?.inputs).toMatchObject({
      model: ['8_turbo', 0],
      steps: 8,
      cfg: 1
    });
  });

  describe('buildUltimateUpscalePrompt', () => {
    const options = {
      imageName: 'in.png',
      settings: { ...BASE_STATE.postfx.upscale.ultimate, enabled: true },
      models: BASE_STATE.models,
      loras: [TEST_LORA],
      positivePrompt: 'hi',
      negativePrompt: '',
      upscaleModel: 'up.safetensors',
      upscaleBy: 2,
      seed: 7,
      filenamePrefix: 'X'
    };

    it('builds a standalone graph from the input image', () => {
      const graph = buildUltimateUpscalePrompt(options) as Graph;

      expect(graph.ultimate_upscale?.class_type).toBe('UltimateSDUpscale');
      expect(graph.ultimate_upscale?.inputs).toMatchObject({
        seed: 7,
        model: ['usdu_lora_0', 0]
      });
      expect(graph['20']?.inputs.images).toEqual(['ultimate_upscale', 0]);
    });

    it('requires an upscale model', () => {
      expect(() =>
        buildUltimateUpscalePrompt({ ...options, upscaleModel: '' })
      ).toThrow();
    });
  });
});
