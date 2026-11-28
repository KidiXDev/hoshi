import { describe, expect, it } from 'vitest';
import {
  clampHeightToWidthRatio,
  computeBooruGridLayout,
  filterVisibleBoxes,
  resolveColumnCount
} from './booruGridLayout';

describe('clampHeightToWidthRatio', () => {
  it('preserves normal aspect ratios and falls back to 4:3 when dimensions are missing', () => {
    expect(clampHeightToWidthRatio(1000, 1500)).toBeCloseTo(1.5);
    expect(clampHeightToWidthRatio(1600, 900)).toBeCloseTo(0.5625);
    expect(clampHeightToWidthRatio(0, 0)).toBeCloseTo(4 / 3);
  });

  it('clamps extreme ratios to readable bounds', () => {
    expect(clampHeightToWidthRatio(1000, 5000)).toBe(2.4);
    expect(clampHeightToWidthRatio(5000, 500)).toBe(0.42);
  });
});

describe('computeBooruGridLayout', () => {
  const sampleItems = [
    { key: 'a', width: 1600, height: 900 },
    { key: 'b', width: 900, height: 1600 },
    { key: 'c', width: 1200, height: 1200 },
    { key: 'd', width: 1000, height: 1400 }
  ];

  it('places items into shortest columns in masonry mode while preserving aspect ratios', () => {
    const layout = computeBooruGridLayout({
      items: sampleItems,
      containerWidth: 1000,
      mode: 'masonry',
      density: 'comfortable',
      gap: 12
    });

    expect(layout.boxes).toHaveLength(4);
    expect(layout.boxes[0]?.height ?? 0).toBeLessThan(
      layout.boxes[1]?.height ?? 0
    );
    expect(layout.totalHeight).toBeGreaterThan(0);
  });

  it('aligns items into flush rows in justified mode', () => {
    const layout = computeBooruGridLayout({
      items: sampleItems,
      containerWidth: 900,
      mode: 'justified',
      density: 'comfortable',
      gap: 12
    });

    expect(layout.boxes).toHaveLength(4);
    expect(layout.boxes[0]?.width ?? 0).toBeGreaterThan(
      layout.boxes[1]?.width ?? 0
    );
  });

  it('uses uniform 3:4 heights in cards mode', () => {
    const layout = computeBooruGridLayout({
      items: sampleItems,
      containerWidth: 1000,
      mode: 'cards',
      density: 'comfortable',
      gap: 12
    });

    expect(layout.boxes[0]?.height).toBe(layout.boxes[1]?.height);
  });
});

describe('resolveColumnCount and filterVisibleBoxes', () => {
  it('adjusts column count by density and filters boxes in viewport range', () => {
    expect(resolveColumnCount(1200, 'compact')).toBeGreaterThan(
      resolveColumnCount(1200, 'spacious')
    );

    const boxes = [
      { index: 0, key: '1', x: 0, y: 0, width: 200, height: 200 },
      { index: 1, key: '2', x: 0, y: 3000, width: 200, height: 200 }
    ];
    expect(filterVisibleBoxes(boxes, 0, 800, 400).map((b) => b.key)).toEqual([
      '1'
    ]);
  });
});
