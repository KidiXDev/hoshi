import { describe, expect, it } from 'vitest';
import { createWorkflowSnapshot } from '../composables/useComfyUiWorkspace';
import {
  BASE_STATE,
  connections,
  createState,
  enableInpaint,
  enableModelPatches,
  enableTurboFaceDetailer,
  enableUpscale,
  graphOf,
  inpaintState,
  MODES,
  mossState,
  TEST_LORA,
  withControl,
  withLayout,
  type Graph
} from '../test/workflowFixtures';
import type { WorkflowState } from '../types/workflow';
import { buildFaceDetailerPrompt } from './faceDetailerWorkflow';
import { buildUltimateUpscalePrompt } from './ultimateUpscaleWorkflow';
import {
  buildWorkflowPrompt,
  prepareWorkflowForQueue
} from './workflowBuilder';

const layoutPromptOf = (configure?: (s: WorkflowState) => void) =>
  JSON.parse(
    graphOf(
      mossState((s) => {
        withLayout(s);
        configure?.(s);
      })
    ).moss_positive?.inputs.text as string
  ) as Record<string, unknown>;

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

  it('draws a concrete variation seed for a random one', () => {
    const state = createState((s) => {
      s.sampler.variationEnabled = true;
      s.sampler.variationSeed = -1;
    });

    const queued = prepareWorkflowForQueue(state);

    expect(state.sampler.variationSeed).toBe(-1);
    expect(queued.sampler.variationSeed).toBeGreaterThanOrEqual(0);
  });

  it('expands wildcards from the seed and keeps the template', () => {
    const state = createState((s) => {
      s.positivePrompt = '1girl, __Hair/Color__';
    });
    const wildcards = { 'hair/color': ['red hair', 'blue hair'] };

    const first = prepareWorkflowForQueue(state, wildcards);
    const second = prepareWorkflowForQueue(state, wildcards);

    expect(first.positivePrompt).toMatch(/^1girl, (red|blue) hair$/u);
    expect(second.positivePrompt).toBe(first.positivePrompt);
    expect(first.promptTemplates?.positivePrompt).toBe('1girl, __Hair/Color__');
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

      expect(graph['21']?.inputs.text).toBe(queued.positivePrompt);
      expect(graph['17']?.inputs.text).toBe(queued.negativePrompt);
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

  it('switches to the bridge variation sampler', () => {
    const graph = graphOf(
      createState((s) => {
        s.sampler.variationEnabled = true;
      })
    );

    expect(graph['9']?.class_type).toBe('KoharuKSampler');
    expect(graph['9']?.inputs).toMatchObject({
      seed: 1,
      variation_seed: 2,
      variation_strength: 0.35
    });
  });

  it('encodes formatted prompts and drops negatives already in the positive', () => {
    const graph = graphOf(
      createState((s) => {
        s.positivePrompt = ' 1girl ,, blue hair ';
        s.negativePrompt = 'Blue Hair, lowres';
      })
    );

    expect(graph['21']?.class_type).toBe('CLIPTextEncode');
    expect(graph['21']?.inputs.text).toBe('1girl, blue hair');
    expect(graph['17']?.inputs.text).toBe('lowres');
    expect(graph['9']?.inputs).toMatchObject({
      positive: ['21', 0],
      negative: ['17', 0]
    });
  });

  it('starts text2img from an empty latent at the resolution size', () => {
    const graph = graphOf(
      createState((s) => {
        s.imageInput.mode = 'text2img';
        s.resolution = {
          preset: '1216 x 832 (19:13 Landscape)',
          batchSize: 2,
          width: 1216,
          height: 832,
          isCustom: false
        };
      })
    );

    expect(graph['19']?.class_type).toBe('EmptyLatentImage');
    expect(graph['19']?.inputs).toEqual({
      width: 1216,
      height: 832,
      batch_size: 2
    });
  });

  it('saves with A1111 metadata through the bridge save node', () => {
    const graph = graphOf(createState());

    expect(graph['5']?.class_type).toBe('KoharuSaveImage');
    expect(graph['5']?.inputs).toMatchObject({
      positive: 'test',
      negative: 'bad',
      seed: 1,
      steps: 20,
      cfg: 4,
      sampler_name: 'euler',
      scheduler: 'simple',
      denoise: 0.7,
      model_name: 'anima.safetensors'
    });
  });

  it('runs PostFX as one bridge node', () => {
    const graph = graphOf(createState(enableUpscale));

    expect(graph['4']?.class_type).toBe('KoharuPostFX');
    expect(graph['4']?.inputs).toMatchObject({
      image: ['8', 0],
      style_enabled: false,
      adjust_enabled: false,
      contrast: 1
    });
    expect(graph['5']?.inputs.images).toEqual(['4', 0]);
  });

  it('runs the face detailer with turbo settings and zeroed empty prompts', () => {
    const graph = graphOf(createState(enableTurboFaceDetailer));

    expect(graph.face_detailer_apply?.class_type).toBe('FaceDetailer');
    expect(graph.face_detailer_turbo?.class_type).toBe('LoraLoaderModelOnly');
    expect(graph.face_detailer_apply?.inputs).toMatchObject({
      steps: 8,
      cfg: 1,
      positive: ['face_detailer_positive_zero', 0]
    });
    expect(graph.face_detailer_segm).toBeUndefined();
  });

  describe('inpaint', () => {
    it('patches the model with LLLite and the turbo LoRA, bypassing model patches', () => {
      const graph = graphOf(inpaintState(true));

      expect(graph['31']?.class_type).toBe('LoadImageMask');
      expect(graph['33']?.class_type).toBe('AnimaLLLiteApply');
      expect(graph['34']?.class_type).toBe('LoraLoaderModelOnly');
      expect(graph['21']?.class_type).toBe('CLIPTextEncode');
      expect(graph['17']?.class_type).toBe('CLIPTextEncode');
      expect(graph['9']?.class_type).toBe('KoharuKSampler');
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

    it.each([false, true])(
      'emits no yet_essential nodes (upscale with Ultimate: %s)',
      (ultimate) => {
        const graph = graphOf(
          createState((s) => {
            enableModelPatches(s);
            enableTurboFaceDetailer(s);
            enableUpscale(s);
            enableInpaint(s);
            s.imageInput.mode = mode;
            s.sampler.variationEnabled = true;
            s.postfx.upscale.ultimate.enabled = ultimate;
            s.postfx.upscale.ultimate.turboEnabled = ultimate;
          })
        );

        const yeNodes = Object.values(graph).filter((node) =>
          node.class_type.startsWith('YE')
        );
        expect(yeNodes).toEqual([]);
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

  it('leaves TSR and AuraFlow out by default', () => {
    const graph = graphOf(mossState());

    expect(graph.moss_tsr).toBeUndefined();
    expect(graph.moss_aura_flow).toBeUndefined();
    expect(graph.moss_slg?.inputs.model).toEqual(['29', 0]);
  });

  it('chains TSR and AuraFlow between the LoRAs and skip layer guidance', () => {
    const graph = graphOf(
      mossState((s) => {
        s.loras = [{ ...TEST_LORA }];
        s.moss.tsrEnabled = true;
        s.moss.tsrK = 0.9;
        s.moss.tsrSigma = 2;
        s.moss.auraFlowEnabled = true;
        s.moss.auraFlowShift = 6;
      })
    );

    expect(graph.moss_tsr?.class_type).toBe('TemporalScoreRescaling');
    expect(graph.moss_tsr?.inputs).toEqual({
      tsr_k: 0.9,
      tsr_sigma: 2,
      model: ['101', 0]
    });
    expect(graph.moss_aura_flow?.class_type).toBe('ModelSamplingAuraFlow');
    expect(graph.moss_aura_flow?.inputs).toEqual({
      shift: 6,
      model: ['moss_tsr', 0]
    });
    expect(graph.moss_slg?.inputs.model).toEqual(['moss_aura_flow', 0]);
  });

  it('ignores the Anima shift settings', () => {
    const graph = graphOf(
      mossState((s) => {
        s.advanced.auraFlowEnabled = true;
      })
    );

    expect(graph['13']).toBeUndefined();
    expect(graph.moss_aura_flow).toBeUndefined();
  });

  it('passes the configured skip layer guidance layers and range', () => {
    const graph = graphOf(
      mossState((s) => {
        s.moss.slgSingleLayers = '7, 8, 9';
        s.moss.slgStartPercent = 0.01;
        s.moss.slgEndPercent = 0.8;
      })
    );

    expect(graph.moss_slg?.inputs).toMatchObject({
      double_layers: '',
      single_layers: '7, 8, 9',
      start_percent: 0.01,
      end_percent: 0.8
    });
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

  it('chains adaptive Spectrum after skip layer guidance into the sampler', () => {
    const graph = graphOf(
      mossState((s) => {
        s.moss.spectrumEnabled = true;
        s.moss.spectrumErrorTolerance = 1.2;
      })
    );

    expect(graph.moss_spectrum?.class_type).toBe('SpectrumMOSSImageAdaptive');
    expect(graph.moss_spectrum?.inputs).toEqual({
      model: ['moss_slg', 0],
      warmup_steps: 8,
      detail_guard_steps: 8,
      tail_actual_steps: 1,
      post_guard_horizon_cap: 6,
      window_size: 2,
      flex_window: 0.5,
      cache_device: 'main_device',
      error_tolerance: 1.2,
      debug: false,
      warn_unverified_sampler: true
    });
    expect(graph['9']?.inputs.model).toEqual(['moss_spectrum', 0]);
  });

  it('builds the manual Spectrum node with its predictor defaults', () => {
    const graph = graphOf(
      mossState((s) => {
        s.moss.spectrumEnabled = true;
        s.moss.spectrumMode = 'manual';
        s.moss.spectrumMaxConsecutiveForecasts = 3;
        s.moss.spectrumCacheDevice = 'cpu';
      })
    );

    expect(graph.moss_spectrum?.class_type).toBe('SpectrumMOSSImageManual');
    expect(graph.moss_spectrum?.inputs).toEqual({
      model: ['moss_slg', 0],
      warmup_steps: 8,
      tail_actual_steps: 1,
      window_size: 2,
      flex_window: 0.75,
      max_consecutive_forecasts: 3,
      history_points: 8,
      chebyshev_degree: 4,
      ridge_lambda: 0.1,
      blend_weight: 0.5,
      cache_device: 'cpu',
      force_actual_on_control: true,
      debug: false,
      warn_unverified_sampler: true
    });
  });

  it('forces the full skip layer guidance range while Spectrum is on', () => {
    const graph = graphOf(
      mossState((s) => {
        s.moss.spectrumEnabled = true;
        s.moss.slgStartPercent = 0.1;
        s.moss.slgEndPercent = 0.5;
      })
    );

    expect(graph.moss_slg?.inputs).toMatchObject({
      start_percent: 0,
      end_percent: 1
    });
  });

  it('ignores Spectrum on the Anima profile', () => {
    const graph = graphOf(
      createState((s) => {
        s.moss.spectrumEnabled = true;
      })
    );

    expect(graph.moss_spectrum).toBeUndefined();
  });

  it('treats inpaint mode as img2img instead of the Anima LLLite graph', () => {
    const graph = graphOf(mossState(enableInpaint));

    expect(graph['33']).toBeUndefined();
    expect(graph['19']?.class_type).toBe('VAEEncode');
  });

  describe('layout prompt', () => {
    it('compiles the boxes into centered yxyx pixel edges', () => {
      expect(layoutPromptOf()).toEqual({
        summary: { caption: 'test' },
        items: [
          {
            label: 'text',
            caption: 'cream serif capitals',
            text: 'MOSS',
            bbox: [-256, -512, -128, 512]
          },
          {
            label: 'character',
            caption: 'a kneeling knight',
            bbox: [-128, -256, 256, 256]
          }
        ],
        bbox_coord_space: 'abs_centralized',
        bbox_format: 'yxyx'
      });
    });

    it('encloses fractional box edges in whole pixels', () => {
      const prompt = layoutPromptOf((s) => {
        Object.assign(s.moss.layoutBoxes[1] ?? {}, {
          x: 0.1004,
          y: 0.3001,
          width: 0.2,
          height: 0.2
        });
      });

      expect(prompt.items).toMatchObject([{}, { bbox: [-103, -410, 1, -204] }]);
    });

    it('keeps meta, canvas, palette and tags', () => {
      const prompt = layoutPromptOf((s) => {
        s.moss.layoutSummary = {
          meta: ['poster'],
          canvas: 'single',
          palette: ['#112233']
        };
        Object.assign(s.moss.layoutBoxes[1] ?? {}, {
          tags: ['armor'],
          palette: ['silver']
        });
      });

      expect(prompt.summary).toEqual({
        meta: ['poster'],
        canvas: 'single',
        caption: 'test',
        palette: ['#112233']
      });
      expect(prompt.items).toMatchObject([
        {},
        { tags: ['armor'], palette: ['silver'] }
      ]);
    });

    it('rejects a box without a description', () => {
      const state = mossState((s) => {
        withLayout(s);
        Object.assign(s.moss.layoutBoxes[1] ?? {}, { caption: ' ' });
      });

      expect(() => buildWorkflowPrompt(state)).toThrow(
        /item 2 needs a caption/u
      );
    });

    it('sends the plain prompt when the layout has no boxes', () => {
      const graph = graphOf(
        mossState((s) => {
          s.moss.layoutEnabled = true;
        })
      );

      expect(graph.moss_positive?.inputs.text).toBe('test');
    });
  });

  describe('color/depth control', () => {
    it('loads the adapter and both maps into the control conditioning', () => {
      const graph = graphOf(mossState(withControl));

      expect(graph.moss_control_adapter?.inputs).toEqual({
        lora_name: 'moss-control.safetensors',
        strength_model: 1,
        model: ['moss_slg', 0]
      });
      expect(graph.moss_color_map?.inputs).toEqual({ image: 'color.png' });
      expect(graph.moss_depth_map?.inputs).toEqual({ image: 'depth.png' });
      expect(graph.moss_control?.class_type).toBe('MOSSImageControl');
      expect(graph.moss_control?.inputs).toEqual({
        positive: ['moss_positive', 0],
        negative: ['moss_negative', 0],
        vae: ['27', 0],
        color_map: ['moss_color_map', 0],
        depth_map: ['moss_depth_map', 0],
        strength: 0.8,
        start_percent: 0.1,
        end_percent: 0.6
      });
      expect(graph['9']?.inputs).toMatchObject({
        model: ['moss_control_adapter', 0],
        positive: ['moss_control', 0],
        negative: ['moss_control', 1]
      });
    });

    it('keeps the face detailer and upscaler on the uncontrolled model', () => {
      const graph = graphOf(
        mossState((s) => {
          withControl(s);
          enableUpscale(s);
          s.postfx.upscale.ultimate.enabled = true;
          s.faceDetailer.enabled = true;
        })
      );

      expect(graph.face_detailer_apply?.inputs.model).toEqual(['moss_slg', 0]);
      expect(graph['8']?.inputs).toMatchObject({
        model: ['moss_slg', 0],
        positive: ['moss_positive', 0],
        negative: ['moss_negative', 0]
      });
    });

    it('leaves out a missing map', () => {
      const graph = graphOf(
        mossState((s) => {
          withControl(s);
          s.moss.controlColorMap = '';
        })
      );

      expect(graph.moss_color_map).toBeUndefined();
      expect(graph.moss_control?.inputs).not.toHaveProperty('color_map');
      expect(graph.moss_control?.inputs.depth_map).toEqual([
        'moss_depth_map',
        0
      ]);
    });

    it('skips the control without maps', () => {
      const graph = graphOf(
        mossState((s) => {
          withControl(s);
          s.moss.controlAdapter = '';
          s.moss.controlColorMap = '';
          s.moss.controlDepthMap = '';
        })
      );

      expect(graph.moss_control_adapter).toBeUndefined();
      expect(graph.moss_control).toBeUndefined();
      expect(graph['9']?.inputs.positive).toEqual(['moss_positive', 0]);
    });

    it('requires an adapter when maps are set', () => {
      const state = mossState((s) => {
        withControl(s);
        s.moss.controlAdapter = '';
      });

      expect(() => buildWorkflowPrompt(state)).toThrow('control adapter');
    });
  });

  it.each(['text2img', 'img2img', 'edit'] as const)(
    'connects every input to an emitted node (%s)',
    (mode) => {
      const graph = graphOf(
        mossState((s) => {
          enableModelPatches(s);
          enableTurboFaceDetailer(s);
          enableUpscale(s);
          withLayout(s);
          withControl(s);
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
  it('upscales with the model, then scales to the factor, when Ultimate is off', () => {
    const graph = graphOf(createState(enableUpscale));

    expect(graph['8_loader']?.inputs).toEqual({
      model_name: 'up.safetensors'
    });
    expect(graph['8_upscale']?.inputs).toEqual({
      upscale_model: ['8_loader', 0],
      image: ['6', 0]
    });
    expect(graph['8']?.class_type).toBe('KoharuScaleToReference');
    expect(graph['8']?.inputs).toEqual({
      image: ['8_upscale', 0],
      reference: ['6', 0],
      scale_by: 6
    });
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
      seed: 1,
      positive: ['21', 0],
      negative: ['17', 0],
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

    expect(graph['8_turbo']?.class_type).toBe('LoraLoaderModelOnly');
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
