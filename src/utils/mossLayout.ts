import type {
  LayoutBox,
  LayoutBoxKind,
  LayoutCanvas,
  LayoutSummaryExtras,
  WorkflowState
} from '../types/workflow';

type Bbox = [number, number, number, number];

export interface MossLayoutItem {
  label: LayoutBoxKind;
  caption: string;
  text?: string;
  tags?: string[];
  palette?: string[];
  bbox: Bbox;
}

export interface MossLayoutSummary extends LayoutSummaryExtras {
  caption: string;
}

export interface MossLayoutDraft {
  width: number;
  height: number;
  bbox_coord_space: 'abs';
  bbox_format: 'xyxy';
  summary: MossLayoutSummary;
  items: MossLayoutItem[];
}

export interface MossLayout {
  caption: string;
  summary: LayoutSummaryExtras;
  width: number;
  height: number;
  boxes: LayoutBox[];
}

type LayoutState = Pick<
  WorkflowState,
  'moss' | 'positivePrompt' | 'imageInput' | 'resolution'
>;

const LABELS: readonly LayoutBoxKind[] = ['object', 'character', 'text'];
export const LAYOUT_CANVASES: readonly LayoutCanvas[] = [
  'single',
  'multi_panel',
  'collage'
];
const ROOT_FIELDS = [
  'width',
  'height',
  'bbox_coord_space',
  'bbox_format',
  'summary',
  'items'
];
const SUMMARY_FIELDS = ['caption', 'meta', 'canvas', 'palette'];
const ITEM_FIELDS = ['label', 'caption', 'bbox', 'text', 'tags', 'palette'];

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isCanvasSide = (value: unknown): value is number =>
  Number.isInteger(value) &&
  (value as number) > 0 &&
  (value as number) % 16 === 0;

const isFilled = (value: unknown): value is string =>
  typeof value === 'string' && value.trim() !== '';

const isLabel = (value: unknown): value is LayoutBoxKind =>
  LABELS.includes(value as LayoutBoxKind);

const roundEdge = (value: number) => Math.round(value * 1e9) / 1e9;

function fail(reason: string): never {
  throw new Error(`Invalid MOSS layout draft: ${reason}.`);
}

function checkFields(
  value: Record<string, unknown>,
  allowed: string[],
  at: string
) {
  const unknown = Object.keys(value).filter((key) => !allowed.includes(key));
  if (unknown.length > 0)
    fail(`${at} has unknown fields ${unknown.join(', ')}`);
}

function stringList(value: unknown, at: string): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || !value.every((item) => isFilled(item))) {
    fail(`${at} must be a list of non-empty strings`);
  }
  return value;
}

const withLists = (lists: Record<string, string[] | undefined>) =>
  Object.fromEntries(Object.entries(lists).filter(([, list]) => list?.length));

function parseJsonObject(text: string): Record<string, unknown> | null {
  const source = text
    .trim()
    .replace(/^```(?:json)?\s*([\s\S]*?)\s*```$/u, '$1');
  if (!source.startsWith('{')) return null;
  try {
    const value: unknown = JSON.parse(source);
    return isRecord(value) ? value : null;
  } catch {
    return null;
  }
}

function parseSummary(value: unknown): MossLayoutSummary {
  if (!isRecord(value) || !isFilled(value.caption)) {
    fail('summary.caption is required');
  }
  checkFields(value, SUMMARY_FIELDS, 'summary');
  const { caption, canvas } = value;
  if (
    canvas !== undefined &&
    !LAYOUT_CANVASES.includes(canvas as LayoutCanvas)
  ) {
    fail('summary.canvas must be single, multi_panel or collage');
  }
  return {
    ...withLists({ meta: stringList(value.meta, 'summary.meta') }),
    ...(canvas === undefined ? {} : { canvas: canvas as LayoutCanvas }),
    caption,
    ...withLists({ palette: stringList(value.palette, 'summary.palette') })
  };
}

function parseItem(
  value: unknown,
  index: number,
  width: number,
  height: number
): MossLayoutItem {
  const at = `item ${index + 1}`;
  if (!isRecord(value)) fail(`${at} must be an object`);
  checkFields(value, ITEM_FIELDS, at);
  const { label, caption, text, bbox } = value;
  if (!isLabel(label)) fail(`${at} label must be object, character or text`);
  if (!isFilled(caption)) fail(`${at} needs a caption`);
  if (label === 'text' && !isFilled(text)) {
    fail(`${at} needs the exact text to render`);
  }
  if (text !== undefined && !isFilled(text)) fail(`${at} text is empty`);
  if (
    !Array.isArray(bbox) ||
    bbox.length !== 4 ||
    !bbox.every((coordinate) => Number.isFinite(coordinate))
  ) {
    fail(`${at} bbox must be four numbers`);
  }
  const [x1, y1, x2, y2] = bbox as number[];
  if (
    !(0 <= x1 && x1 < x2 && x2 <= width && 0 <= y1 && y1 < y2 && y2 <= height)
  ) {
    fail(`${at} bbox must lie inside the ${width}×${height} canvas`);
  }
  return {
    label,
    caption,
    ...(text === undefined ? {} : { text }),
    ...withLists({
      tags: stringList(value.tags, `${at} tags`),
      palette: stringList(value.palette, `${at} palette`)
    }),
    bbox: [x1, y1, x2, y2]
  };
}

function validateDraft(draft: Record<string, unknown>): MossLayoutDraft {
  checkFields(draft, ROOT_FIELDS, 'the draft');
  const { width, height, items } = draft;
  if (!isCanvasSide(width) || !isCanvasSide(height)) {
    fail('width and height must be positive multiples of 16');
  }
  if (draft.bbox_coord_space !== 'abs' || draft.bbox_format !== 'xyxy') {
    fail('boxes must use "abs" "xyxy" pixel coordinates');
  }
  const summary = parseSummary(draft.summary);
  if (!Array.isArray(items) || items.length === 0) {
    fail('items must be a non-empty array');
  }
  return {
    width,
    height,
    bbox_coord_space: 'abs',
    bbox_format: 'xyxy',
    summary,
    items: items.map((item, index) => parseItem(item, index, width, height))
  };
}

export function parseMossLayoutDraft(text: string): MossLayoutDraft | null {
  const draft = parseJsonObject(text);
  if (!draft || !('items' in draft) || !('width' in draft)) return null;
  return validateDraft(draft);
}

export function layoutDraftToMoss(draft: MossLayoutDraft): MossLayout {
  const { width, height } = draft;
  const { caption: sceneCaption, ...summary } = draft.summary;
  return {
    caption: sceneCaption,
    summary,
    width,
    height,
    boxes: draft.items.map(
      ({ label, caption, text, tags, palette, bbox: [x1, y1, x2, y2] }) => ({
        id: crypto.randomUUID(),
        kind: label,
        x: x1 / width,
        y: y1 / height,
        width: (x2 - x1) / width,
        height: (y2 - y1) / height,
        caption,
        text: text ?? '',
        ...withLists({ tags, palette })
      })
    )
  };
}

export function layoutCanvasSize({
  imageInput,
  resolution
}: Pick<WorkflowState, 'imageInput' | 'resolution'>) {
  const fromImage =
    imageInput.mode !== 'text2img' &&
    imageInput.imageWidth > 0 &&
    imageInput.imageHeight > 0;
  return fromImage
    ? { width: imageInput.imageWidth, height: imageInput.imageHeight }
    : {
        width: resolution.width || 1024,
        height: resolution.height || 1024
      };
}

export function boxEdges(box: LayoutBox, width: number, height: number): Bbox {
  return [
    Math.floor(roundEdge(box.x * width)),
    Math.floor(roundEdge(box.y * height)),
    Math.ceil(roundEdge((box.x + box.width) * width)),
    Math.ceil(roundEdge((box.y + box.height) * height))
  ];
}

export function mossLayoutToDraft(state: LayoutState): MossLayoutDraft | null {
  const boxes = state.moss.layoutBoxes;
  if (!state.moss.layoutEnabled || boxes.length === 0) return null;
  const { width, height } = layoutCanvasSize(state);
  const { meta, canvas, palette } = state.moss.layoutSummary;
  return {
    width,
    height,
    bbox_coord_space: 'abs',
    bbox_format: 'xyxy',
    summary: {
      ...withLists({ meta }),
      ...(canvas ? { canvas } : {}),
      caption: state.positivePrompt.trim(),
      ...withLists({ palette })
    },
    items: boxes.map((box) => ({
      label: box.kind,
      caption: box.caption,
      ...(box.kind === 'text' ? { text: box.text } : {}),
      ...withLists({ tags: box.tags, palette: box.palette }),
      bbox: boxEdges(box, width, height)
    }))
  };
}

export function compileMossLayoutPrompt(state: LayoutState): string | null {
  const draft = mossLayoutToDraft(state);
  if (!draft) return null;
  const { width, height } = draft;
  const sizedByResolution = state.imageInput.mode === 'text2img';
  if (sizedByResolution && !(isCanvasSide(width) && isCanvasSide(height))) {
    fail('the image width and height must be multiples of 16');
  }
  const summary = parseSummary(draft.summary);
  const cx = Math.floor(width / 2);
  const cy = Math.floor(height / 2);
  const items = draft.items.map((item, index) => {
    const { bbox, ...rest } = parseItem(item, index, width, height);
    const [x1, y1, x2, y2] = bbox;
    return { ...rest, bbox: [y1 - cy, x1 - cx, y2 - cy, x2 - cx] };
  });
  return JSON.stringify({
    summary,
    items,
    bbox_coord_space: 'abs_centralized',
    bbox_format: 'yxyx'
  });
}
