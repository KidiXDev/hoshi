export const DIMENSION_MULTIPLE = 16;

export const MOSS_MEGAPIXELS = [1, 1.5, 2] as const;

export const MOSS_ASPECT_RATIOS = [
  '1:1',
  '4:5',
  '3:4',
  '2:3',
  '9:16',
  '5:4',
  '4:3',
  '3:2',
  '16:9',
  '21:9'
] as const;

const PIXELS_PER_MEGAPIXEL = 1024 * 1024;

export function isDimensionAligned(value: number) {
  return (
    Number.isInteger(value) && value > 0 && value % DIMENSION_MULTIPLE === 0
  );
}

export function snapDimension(value: number) {
  return Math.max(
    DIMENSION_MULTIPLE,
    Math.round(value / DIMENSION_MULTIPLE) * DIMENSION_MULTIPLE
  );
}

export function megapixelsOf(width: number, height: number) {
  return (width * height) / PIXELS_PER_MEGAPIXEL;
}

export function parseAspectRatio(ratio: string): [number, number] {
  const [width = 1, height = 1] = ratio.split(':').map(Number);
  return [width, height];
}

export function dimensionsForMegapixels(
  ratioWidth: number,
  ratioHeight: number,
  megapixels: number
) {
  const pixels = megapixels * PIXELS_PER_MEGAPIXEL;
  const width = Math.sqrt((pixels * ratioWidth) / ratioHeight);
  return {
    width: snapDimension(width),
    height: snapDimension(pixels / width)
  };
}

export function matchMossSize(width: number, height: number) {
  for (const ratio of MOSS_ASPECT_RATIOS) {
    for (const megapixels of MOSS_MEGAPIXELS) {
      const size = dimensionsForMegapixels(
        ...parseAspectRatio(ratio),
        megapixels
      );
      if (size.width === width && size.height === height) {
        return { ratio, megapixels };
      }
    }
  }
  return null;
}

export function nearestMossMegapixels(width: number, height: number) {
  const current = megapixelsOf(width, height);
  return MOSS_MEGAPIXELS.reduce((best, option) =>
    Math.abs(option - current) < Math.abs(best - current) ? option : best
  );
}
