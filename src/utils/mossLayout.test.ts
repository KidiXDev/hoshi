import { describe, expect, it } from 'vitest';
import type { WorkflowState } from '../types/workflow';
import {
  compileMossLayoutPrompt,
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

const richSummary = {
  meta: ['movie poster'],
  canvas: 'single',
  caption: 'A poster.',
  palette: ['#1A2B3C']
};

const richItems = [
  {
    label: 'object',
    caption: 'A sword',
    tags: ['steel'],
    palette: ['silver'],
    bbox: [0, 0, 512, 256]
  }
];

const parse = (overrides?: Record<string, unknown>) =>
  parseMossLayoutDraft(JSON.stringify(draft(overrides)));

function layoutOf(overrides?: Record<string, unknown>) {
  const parsed = parse(overrides);
  if (!parsed) throw new Error('Expected a layout draft');
  return layoutDraftToMoss(parsed);
}

describe('parseMossLayoutDraft', () => {
  it('reads a valid draft', () => {
    expect(parse()).toEqual(draft());
  });

  it('keeps summary meta, canvas, palette and item tags', () => {
    const overrides = { summary: richSummary, items: richItems };

    expect(parse(overrides)).toEqual(draft(overrides));
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
    ['an unknown canvas', { summary: { caption: 'x', canvas: 'grid' } }],
    ['an unknown summary field', { summary: { caption: 'x', mood: 'calm' } }],
    ['an unknown root field', { id: 'draft-1' }],
    ['an empty item list', { items: [] }],
    [
      'an unknown label',
      { items: [{ label: 'person', caption: 'x', bbox: [0, 0, 10, 10] }] }
    ],
    [
      'nested children',
      {
        items: [
          { label: 'object', caption: 'x', children: [], bbox: [0, 0, 10, 10] }
        ]
      }
    ],
    [
      'a non-string tag',
      {
        items: [
          { label: 'object', caption: 'x', tags: [1], bbox: [0, 0, 10, 10] }
        ]
      }
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
    const layout = layoutOf();

    expect(layout).toMatchObject({
      caption: 'A poster.',
      summary: {},
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

  it('splits the scene extras from the caption', () => {
    const layout = layoutOf({ summary: richSummary, items: richItems });

    expect(layout.summary).toEqual({
      meta: ['movie poster'],
      canvas: 'single',
      palette: ['#1A2B3C']
    });
    expect(layout.boxes[0]).toMatchObject({
      tags: ['steel'],
      palette: ['silver']
    });
  });
});

const stateFor = (
  overrides?: Record<string, unknown>,
  layoutEnabled = true
) => {
  const layout = layoutOf(overrides);
  return {
    positivePrompt: layout.caption,
    moss: {
      skipLayerGuidance: true,
      layoutEnabled,
      layoutBoxes: layout.boxes,
      layoutSummary: layout.summary
    },
    imageInput: { mode: 'text2img', imageWidth: 0, imageHeight: 0 },
    resolution: {
      preset: 'Custom',
      batchSize: 1,
      width: layout.width,
      height: layout.height
    }
  } as Pick<
    WorkflowState,
    'moss' | 'positivePrompt' | 'imageInput' | 'resolution'
  >;
};

describe('mossLayoutToDraft', () => {
  it('round-trips the editor boxes back to a draft', () => {
    expect(mossLayoutToDraft(stateFor())).toEqual(draft());
  });

  it('round-trips the scene extras and item tags', () => {
    const overrides = { summary: richSummary, items: richItems };

    expect(mossLayoutToDraft(stateFor(overrides))).toEqual(draft(overrides));
  });

  it('encloses fractional edges in whole pixels', () => {
    const state = stateFor();
    Object.assign(state.moss.layoutBoxes[1] ?? {}, {
      x: 0.1004,
      y: 0.3001,
      width: 0.2,
      height: 0.2
    });

    expect(mossLayoutToDraft(state)?.items[1]?.bbox).toEqual([
      102, 153, 308, 257
    ]);
  });

  it('returns null while the layout is off', () => {
    expect(mossLayoutToDraft(stateFor(undefined, false))).toBeNull();
  });
});

const userGuidePoster = {
  width: 1024,
  height: 1024,
  summary: {
    meta: ['poster'],
    canvas: 'single',
    caption:
      'A minimalist travel poster with a cream background, a blue mountain illustration, and the title EXPLORE at the top.'
  },
  items: [
    {
      label: 'text',
      caption: 'Large dark-blue uppercase title centered at the top.',
      text: 'EXPLORE',
      bbox: [128, 96, 896, 224]
    },
    {
      label: 'object',
      caption: 'A flat blue mountain illustration in the lower center.',
      bbox: [224, 320, 800, 896]
    }
  ]
};

const ceramicCampaign = {
  width: 1536,
  height: 1024,
  summary: {
    meta: ['product campaign', 'studio photography'],
    canvas: 'single',
    caption: 'A warm studio campaign for a handmade ceramic cup.'
  },
  items: [
    {
      label: 'object',
      caption: 'An ivory ceramic cup.',
      bbox: [176, 224, 800, 864]
    },
    {
      label: 'text',
      caption: 'Large dark-green Chinese title.',
      text: '把日常，过成诗。',
      bbox: [928, 272, 1408, 448]
    },
    {
      label: 'text',
      caption: 'Smaller dark-green supporting copy on two lines.',
      text: '一杯温暖\n一刻从容',
      bbox: [928, 512, 1376, 656]
    }
  ]
};

describe('compileMossLayoutPrompt', () => {
  it('compiles the user guide poster to its model-facing JSON', () => {
    expect(compileMossLayoutPrompt(stateFor(userGuidePoster))).toBe(
      '{"summary":{"meta":["poster"],"canvas":"single","caption":"A minimalist travel poster with a cream background, a blue mountain illustration, and the title EXPLORE at the top."},"items":[{"label":"text","caption":"Large dark-blue uppercase title centered at the top.","text":"EXPLORE","bbox":[-416,-384,-288,384]},{"label":"object","caption":"A flat blue mountain illustration in the lower center.","bbox":[-192,-288,384,288]}],"bbox_coord_space":"abs_centralized","bbox_format":"yxyx"}'
    );
  });

  it('compiles the landscape campaign with raw CJK text and escaped line breaks', () => {
    expect(compileMossLayoutPrompt(stateFor(ceramicCampaign))).toBe(
      '{"summary":{"meta":["product campaign","studio photography"],"canvas":"single","caption":"A warm studio campaign for a handmade ceramic cup."},"items":[{"label":"object","caption":"An ivory ceramic cup.","bbox":[-288,-592,352,32]},{"label":"text","caption":"Large dark-green Chinese title.","text":"把日常，过成诗。","bbox":[-240,160,-64,640]},{"label":"text","caption":"Smaller dark-green supporting copy on two lines.","text":"一杯温暖\\n一刻从容","bbox":[0,160,144,608]}],"bbox_coord_space":"abs_centralized","bbox_format":"yxyx"}'
    );
  });

  it('rejects a text-to-image size that is not a multiple of 16', () => {
    const state = stateFor();
    state.resolution.width = 1000;

    expect(() => compileMossLayoutPrompt(state)).toThrow(/multiples of 16/u);
  });

  it('centers on the input image size for image-to-image', () => {
    const state = stateFor();
    state.imageInput = {
      ...state.imageInput,
      mode: 'img2img',
      imageWidth: 1000,
      imageHeight: 500
    };
    Object.assign(state.moss.layoutBoxes[0] ?? {}, {
      x: 0,
      y: 0,
      width: 0.5,
      height: 0.5
    });

    expect(compileMossLayoutPrompt(state)).toContain('"bbox":[-250,-500,0,0]');
  });
});
