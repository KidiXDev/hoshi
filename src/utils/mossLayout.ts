import type {
  LayoutBox,
  LayoutBoxKind,
  WorkflowState
} from '../types/workflow';

export interface MossLayoutItem {
  label: LayoutBoxKind;
  caption: string;
  text?: string;
  bbox: [number, number, number, number];
}

export interface MossLayoutDraft {
  width: number;
  height: number;
  bbox_coord_space: 'abs';
  bbox_format: 'xyxy';
  summary: { caption: string };
  items: MossLayoutItem[];
}

export interface MossLayout {
  caption: string;
  width: number;
  height: number;
  boxes: LayoutBox[];
}

const LABELS: readonly LayoutBoxKind[] = ['object', 'character', 'text'];

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

function fail(reason: string): never {
  throw new Error(`Invalid MOSS layout draft: ${reason}.`);
}

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

function parseItem(
  value: unknown,
  index: number,
  width: number,
  height: number
): MossLayoutItem {
  const at = `item ${index + 1}`;
  if (!isRecord(value)) fail(`${at} must be an object`);
  const { label, caption, text, bbox } = value;
  if (!isLabel(label)) fail(`${at} label must be object, character or text`);
  if (!isFilled(caption)) fail(`${at} needs a caption`);
  if (label === 'text' && !isFilled(text)) {
    fail(`${at} needs the exact text to render`);
  }
  if (
    !Array.isArray(bbox) ||
    bbox.length !== 4 ||
    !bbox.every((coordinate) => Number.isFinite(coordinate))
  ) {
    fail(`${at} bbox must be four numbers`);
  }
  const [x1, y1, x2, y2] = bbox as number[];
  if (!(
    0 <= x1 &&
    x1 < x2 &&
    x2 <= width &&
    0 <= y1 &&
    y1 < y2 &&
    y2 <= height
  )) {
    fail(`${at} bbox must lie inside the ${width}×${height} canvas`);
  }
  return {
    label,
    caption,
    ...(label === 'text' ? { text: text as string } : {}),
    bbox: [x1, y1, x2, y2]
  };
}

export function parseMossLayoutDraft(text: string): MossLayoutDraft | null {
  const draft = parseJsonObject(text);
  if (!draft || !('items' in draft) || !('width' in draft)) return null;
  const { width, height, summary, items } = draft;
  if (!isCanvasSide(width) || !isCanvasSide(height)) {
    fail('width and height must be positive multiples of 16');
  }
  if (draft.bbox_coord_space !== 'abs' || draft.bbox_format !== 'xyxy') {
    fail('boxes must use "abs" "xyxy" pixel coordinates');
  }
  if (!isRecord(summary) || !isFilled(summary.caption)) {
    fail('summary.caption is required');
  }
  if (!Array.isArray(items) || items.length === 0) {
    fail('items must be a non-empty array');
  }
  return {
    width,
    height,
    bbox_coord_space: 'abs',
    bbox_format: 'xyxy',
    summary: { caption: summary.caption },
    items: items.map((item, index) => parseItem(item, index, width, height))
  };
}

export function layoutDraftToMoss(draft: MossLayoutDraft): MossLayout {
  const { width, height } = draft;
  return {
    caption: draft.summary.caption,
    width,
    height,
    boxes: draft.items.map(
      ({ label, caption, text, bbox: [x1, y1, x2, y2] }) => ({
        id: crypto.randomUUID(),
        kind: label,
        x: x1 / width,
        y: y1 / height,
        width: (x2 - x1) / width,
        height: (y2 - y1) / height,
        caption,
        text: text ?? ''
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

export function boxPixels(box: LayoutBox, width: number, height: number) {
  const x = Math.round(box.x * width);
  const y = Math.round(box.y * height);
  return {
    x,
    y,
    width: Math.max(1, Math.round((box.x + box.width) * width) - x),
    height: Math.max(1, Math.round((box.y + box.height) * height) - y)
  };
}

export function mossLayoutToDraft(
  state: Pick<
    WorkflowState,
    'moss' | 'positivePrompt' | 'imageInput' | 'resolution'
  >
): MossLayoutDraft | null {
  const boxes = state.moss.layoutBoxes;
  if (!state.moss.layoutEnabled || boxes.length === 0) return null;
  const { width, height } = layoutCanvasSize(state);
  return {
    width,
    height,
    bbox_coord_space: 'abs',
    bbox_format: 'xyxy',
    summary: { caption: state.positivePrompt },
    items: boxes.map((box) => {
      const pixels = boxPixels(box, width, height);
      return {
        label: box.kind,
        caption: box.caption,
        ...(box.kind === 'text' ? { text: box.text } : {}),
        bbox: [
          pixels.x,
          pixels.y,
          pixels.x + pixels.width,
          pixels.y + pixels.height
        ]
      };
    })
  };
}
