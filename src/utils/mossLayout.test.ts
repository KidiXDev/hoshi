import { describe, expect, it } from 'vitest';
import type { WorkflowState } from '../types/workflow';
import {
  layoutDraftToMoss,
  mossLayoutToDraft,
  parseMossLayoutDraft
} from './mossLayout';

const draft = (overrides: Record<string, unknown> = {}) => ({
  width: 1024,
  height: 512,
  bbox_coord_space: 'abs',
  bbox_format: 'xyxy',
  summary: { caption: 'A poster.' },
  items: [
    {
      label: 'text',
      caption: 'Cream serif capitals',
      text: 'MOSS',
      bbox: [0, 0, 1024, 128]
    },
    { label: 'character', caption: 'A knight', bbox: [256, 128, 768, 512] }
  ],
  ...overrides
});

const parse = (overrides?: Record<string, unknown>) =>
  parseMossLayoutDraft(JSON.stringify(draft(overrides)));

function validLayout() {
  const parsed = parse();
  if (!parsed) throw new Error('Expected a layout draft');
  return layoutDraftToMoss(parsed);
}

describe('parseMossLayoutDraft', () => {
  it('reads a valid draft', () => {
    expect(parse()).toEqual(draft());
  });

  it('strips a surrounding code fence', () => {
    const fenced = `\`\`\`json\n${JSON.stringify(draft())}\n\`\`\``;

    expect(parseMossLayoutDraft(fenced)).toEqual(draft());
  });

  it.each([
    ['plain captions', 'A knight kneeling in a mossy ruin.'],
    ['broken JSON', '{"items": ['],
    [
      'compiled layout prompts',
      '{"summary":{"caption":"x"},"items":[],"bbox_coord_space":"abs_centralized","bbox_format":"yxyx"}'
    ]
  ])('ignores %s', (_, text) => {
    expect(parseMossLayoutDraft(text)).toBeNull();
  });

  it.each([
    ['a width that is not a multiple of 16', { width: 1000 }],
    ['centered coordinates', { bbox_coord_space: 'abs_centralized' }],
    ['a missing scene caption', { summary: {} }],
    ['an empty item list', { items: [] }],
    [
      'an unknown label',
      { items: [{ label: 'person', caption: 'x', bbox: [0, 0, 10, 10] }] }
    ],
    [
      'a text box without text',
      { items: [{ label: 'text', caption: 'x', bbox: [0, 0, 10, 10] }] }
    ],
    [
      'a box outside the canvas',
      { items: [{ label: 'object', caption: 'x', bbox: [0, 0, 2048, 10] }] }
    ],
    [
      'an inverted box',
      { items: [{ label: 'object', caption: 'x', bbox: [10, 0, 5, 10] }] }
    ]
  ])('rejects %s', (_, overrides) => {
    expect(() => parse(overrides)).toThrow(/Invalid MOSS layout draft/u);
  });
});

describe('layoutDraftToMoss', () => {
  it('normalizes boxes to canvas fractions', () => {
    const layout = validLayout();

    expect(layout).toMatchObject({
      caption: 'A poster.',
      width: 1024,
      height: 512
    });
    expect(layout.boxes).toMatchObject([
      { kind: 'text', x: 0, y: 0, width: 1, height: 0.25, text: 'MOSS' },
      {
        kind: 'character',
        x: 0.25,
        y: 0.25,
        width: 0.5,
        height: 0.75,
        caption: 'A knight',
        text: ''
      }
    ]);
  });
});

describe('mossLayoutToDraft', () => {
  const stateFor = (layoutEnabled: boolean) => {
    const layout = validLayout();
    return {
      positivePrompt: layout.caption,
      moss: {
        skipLayerGuidance: true,
        layoutEnabled,
        layoutBoxes: layout.boxes
      },
      imageInput: { mode: 'text2img', imageWidth: 0, imageHeight: 0 },
      resolution: { preset: 'Custom', batchSize: 1, width: 1024, height: 512 }
    } as Pick<
      WorkflowState,
      'moss' | 'positivePrompt' | 'imageInput' | 'resolution'
    >;
  };

  it('round-trips the editor boxes back to a draft', () => {
    expect(mossLayoutToDraft(stateFor(true))).toEqual(draft());
  });

  it('returns null while the layout is off', () => {
    expect(mossLayoutToDraft(stateFor(false))).toBeNull();
  });
});
