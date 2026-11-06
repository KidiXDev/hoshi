import { describe, expect, it } from 'vitest';
import {
  enableUpscale,
  graphOf,
  mossState,
  withControl,
  withLayout
} from '../test/workflowFixtures';
import type { WorkflowState } from '../types/workflow';
import { buildWorkflowPrompt } from './workflowBuilder';

const editState = (configure?: (state: WorkflowState) => void) =>
  mossState((s) => {
    configure?.(s);
    s.imageInput.mode = 'edit';
    s.imageInput.imageName = 'input.png';
  });

describe('MOSS image edit', () => {
  it('samples an empty latent at the scaled input size', () => {
    const graph = graphOf(editState());

    expect(graph.moss_edit_scale?.class_type).toBe('ImageScaleToTotalPixels');
    expect(graph.moss_edit_scale?.inputs).toEqual({
      upscale_method: 'lanczos',
      megapixels: 1,
      resolution_steps: 16,
      image: ['30', 0]
    });
    expect(graph.moss_edit_size?.inputs.image).toEqual(['moss_edit_scale', 0]);
    expect(graph['19']?.class_type).toBe('EmptyFlux2LatentImage');
    expect(graph['19']?.inputs).toMatchObject({
      width: ['moss_edit_size', 0],
      height: ['moss_edit_size', 1]
    });
  });

  it('encodes both prompts with the reference image', () => {
    const graph = graphOf(
      editState((s) => {
        s.moss.editFormat = 'ai-toolkit';
        s.moss.editImageStrength = 0.8;
      })
    );

    for (const [node, prompt] of [
      [graph.moss_edit_positive, 'test'],
      [graph.moss_edit_negative, 'bad']
    ] as const) {
      expect(node?.class_type).toBe('TextEncodeMOSSImageEdit');
      expect(node?.inputs).toEqual({
        prompt,
        edit_format: 'ai-toolkit',
        image_strength: 0.8,
        clip: ['28', 0],
        vae: ['27', 0],
        'images.image_0': ['moss_edit_scale', 0]
      });
    }
  });

  it('applies the edit LoRA and conditioning to the sampler', () => {
    const graph = graphOf(editState());

    expect(graph.moss_edit_lora?.inputs).toEqual({
      lora_name: 'moss-edit.safetensors',
      strength_model: 1,
      model: ['moss_slg', 0]
    });
    expect(graph['9']?.inputs).toMatchObject({
      model: ['moss_edit_lora', 0],
      positive: ['moss_edit_positive', 0],
      negative: ['moss_edit_negative', 0],
      latent_image: ['19', 0]
    });
  });

  it('forces full denoise and the full skip layer guidance range', () => {
    const graph = graphOf(
      editState((s) => {
        s.sampler.denoise = 0.4;
        s.moss.slgStartPercent = 0.2;
        s.moss.slgEndPercent = 0.5;
      })
    );

    expect(graph['9']?.inputs.denoise).toBe(1);
    expect(graph.moss_slg?.inputs).toMatchObject({
      start_percent: 0,
      end_percent: 1
    });
  });

  it('keeps the face detailer and upscaler off the edit stage', () => {
    const graph = graphOf(
      editState((s) => {
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

  it('skips layout and color/depth control', () => {
    const graph = graphOf(
      editState((s) => {
        withLayout(s);
        withControl(s);
      })
    );

    expect(graph.moss_layout).toBeUndefined();
    expect(graph.moss_control).toBeUndefined();
    expect(graph.moss_control_adapter).toBeUndefined();
  });

  it('requires an input image', () => {
    const state = mossState((s) => {
      s.imageInput.mode = 'edit';
      s.imageInput.imageName = '';
    });

    expect(() => buildWorkflowPrompt(state)).toThrow('input image');
  });

  it('requires an edit LoRA', () => {
    const state = editState((s) => {
      s.moss.editLora = '';
    });

    expect(() => buildWorkflowPrompt(state)).toThrow('edit LoRA');
  });
});
