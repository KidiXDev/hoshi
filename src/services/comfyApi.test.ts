import { describe, expect, it } from 'vitest';
import { firstOutputImage } from './comfyApi';

const preview = {
  filename: 'ComfyUI_temp_00001_.png',
  subfolder: '',
  type: 'temp'
};
const saved = { filename: 'ComfyUI_00001_.png', subfolder: '', type: 'output' };

describe('firstOutputImage', () => {
  it('prefers a saved output image over an earlier temp preview', () => {
    expect(
      firstOutputImage({ '7': { images: [preview] }, '5': { images: [saved] } })
    ).toEqual(saved);
  });

  it('falls back to the temp preview when nothing was saved', () => {
    expect(firstOutputImage({ '7': { images: [preview] } })).toEqual(preview);
  });
});
