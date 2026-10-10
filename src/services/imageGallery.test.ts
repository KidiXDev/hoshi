/**
 * @vitest-environment happy-dom
 */
import { describe, expect, it } from 'vitest';
import {
  GALLERY_IMAGE_MIME,
  dragOutputImage,
  localImageUrl,
  type OutputImage
} from './imageGallery';

const image: OutputImage = {
  localId: 'abc',
  path: 'C:/ComfyUI/output/x.png',
  filename: 'x.png',
  subfolder: '',
  extension: 'png',
  fileSize: 1,
  modifiedMs: 0,
  prompt: '',
  model: ''
};

const dragStart = (dataTransfer: DataTransfer | null) =>
  ({ dataTransfer }) as DragEvent;

describe('dragOutputImage', () => {
  it('exposes the full image URL and the gallery id to drop targets', () => {
    const dataTransfer = new DataTransfer();

    dragOutputImage(dragStart(dataTransfer), image);

    const url = `${localImageUrl('abc', false)}?filename=x.png`;
    expect(dataTransfer.getData(GALLERY_IMAGE_MIME)).toBe('abc');
    expect(dataTransfer.getData('text/uri-list')).toBe(url);
    expect(dataTransfer.getData('text/plain')).toBe(url);
    expect(dataTransfer.effectAllowed).toBe('copyLink');
  });

  it('ignores drags without a dataTransfer', () => {
    expect(() => dragOutputImage(dragStart(null), image)).not.toThrow();
  });
});
