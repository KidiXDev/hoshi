export type BooruLayoutMode = 'masonry' | 'justified' | 'cards';
export type BooruGridDensity = 'compact' | 'comfortable' | 'spacious';

export interface SizablePost {
  key: string;
  width: number;
  height: number;
}

export interface PositionedBox {
  index: number;
  key: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface VirtualGridLayout {
  boxes: PositionedBox[];
  totalHeight: number;
  columns: number;
}

const MIN_ASPECT_HW = 0.42;
const MAX_ASPECT_HW = 2.4;
const DEFAULT_ASPECT_HW = 4 / 3;

export function clampHeightToWidthRatio(width: number, height: number): number {
  if (width <= 0 || height <= 0) return DEFAULT_ASPECT_HW;
  const ratio = height / width;
  return Math.min(MAX_ASPECT_HW, Math.max(MIN_ASPECT_HW, ratio));
}

export function resolveColumnCount(
  containerWidth: number,
  density: BooruGridDensity = 'comfortable'
): number {
  const base =
    containerWidth < 540
      ? 2
      : containerWidth < 840
        ? 3
        : containerWidth < 1140
          ? 4
          : containerWidth < 1500
            ? 5
            : containerWidth < 1860
              ? 6
              : 7;

  if (density === 'compact') return Math.min(9, base + 1);
  if (density === 'spacious') return Math.max(2, base - 1);
  return base;
}

export function computeMasonryLayout(
  items: SizablePost[],
  containerWidth: number,
  columns: number,
  gap: number,
  uniformHeightToWidth?: number
): VirtualGridLayout {
  const safeColumns = Math.max(1, columns);
  const totalGap = gap * (safeColumns - 1);
  const columnWidth = Math.max(80, (containerWidth - totalGap) / safeColumns);
  const colHeights = Array.from({ length: safeColumns }, () => 0);

  const boxes: PositionedBox[] = items.map((item, index) => {
    let shortestCol = 0;
    for (let col = 1; col < safeColumns; col++) {
      if ((colHeights[col] ?? 0) < (colHeights[shortestCol] ?? 0)) {
        shortestCol = col;
      }
    }

    const hwRatio =
      uniformHeightToWidth ?? clampHeightToWidthRatio(item.width, item.height);
    const height = Math.round(columnWidth * hwRatio);
    const x = Math.round(shortestCol * (columnWidth + gap));
    const y = Math.round(colHeights[shortestCol] ?? 0);

    colHeights[shortestCol] = y + height + gap;

    return {
      index,
      key: item.key,
      x,
      y,
      width: Math.round(columnWidth),
      height
    };
  });

  const maxColHeight = Math.max(0, ...colHeights);
  return {
    boxes,
    totalHeight: maxColHeight > 0 ? maxColHeight - gap : 0,
    columns: safeColumns
  };
}

export function computeJustifiedLayout(
  items: SizablePost[],
  containerWidth: number,
  targetRowHeight: number,
  gap: number
): VirtualGridLayout {
  const safeWidth = Math.max(240, containerWidth);
  const boxes: PositionedBox[] = [];
  let currentRow: { index: number; key: string; whRatio: number }[] = [];
  let rowAspectSum = 0;
  let yCursor = 0;

  function flushRow(isLastRow: boolean) {
    if (currentRow.length === 0) return;
    const totalGap = gap * (currentRow.length - 1);
    const availableWidth = Math.max(80, safeWidth - totalGap);
    const naturalWidth = rowAspectSum * targetRowHeight;
    const rowHeight =
      isLastRow && naturalWidth < availableWidth * 0.85
        ? targetRowHeight
        : Math.min(targetRowHeight * 1.45, availableWidth / rowAspectSum);

    let xCursor = 0;
    currentRow.forEach((entry, idx) => {
      const isLastInRow = idx === currentRow.length - 1;
      const rawWidth = rowHeight * entry.whRatio;
      const width =
        !isLastRow && isLastInRow
          ? Math.max(40, Math.round(safeWidth - xCursor))
          : Math.max(40, Math.round(rawWidth));

      boxes.push({
        index: entry.index,
        key: entry.key,
        x: Math.round(xCursor),
        y: Math.round(yCursor),
        width,
        height: Math.round(rowHeight)
      });
      xCursor += width + gap;
    });

    yCursor += Math.round(rowHeight) + gap;
    currentRow = [];
    rowAspectSum = 0;
  }

  items.forEach((item, index) => {
    const hwRatio = clampHeightToWidthRatio(item.width, item.height);
    const whRatio = 1 / hwRatio;
    currentRow.push({ index, key: item.key, whRatio });
    rowAspectSum += whRatio;

    const estimatedWidth =
      rowAspectSum * targetRowHeight + gap * (currentRow.length - 1);
    if (estimatedWidth >= safeWidth) {
      flushRow(false);
    }
  });

  flushRow(true);

  return {
    boxes,
    totalHeight: yCursor > 0 ? yCursor - gap : 0,
    columns: Math.max(1, Math.round(safeWidth / targetRowHeight))
  };
}

export function computeBooruGridLayout(options: {
  items: SizablePost[];
  containerWidth: number;
  mode: BooruLayoutMode;
  density: BooruGridDensity;
  gap: number;
}): VirtualGridLayout {
  const { items, containerWidth, mode, density, gap } = options;
  const columns = resolveColumnCount(containerWidth, density);

  if (mode === 'cards') {
    return computeMasonryLayout(
      items,
      containerWidth,
      columns,
      gap,
      DEFAULT_ASPECT_HW
    );
  }

  if (mode === 'justified') {
    const targetRowHeight =
      density === 'compact' ? 190 : density === 'spacious' ? 290 : 235;
    return computeJustifiedLayout(items, containerWidth, targetRowHeight, gap);
  }

  return computeMasonryLayout(items, containerWidth, columns, gap);
}

export function filterVisibleBoxes(
  boxes: PositionedBox[],
  scrollTop: number,
  viewportHeight: number,
  overscanPx = 700
): PositionedBox[] {
  const minY = Math.max(0, scrollTop - overscanPx);
  const maxY = scrollTop + Math.max(600, viewportHeight) + overscanPx;
  return boxes.filter((box) => box.y + box.height >= minY && box.y <= maxY);
}
