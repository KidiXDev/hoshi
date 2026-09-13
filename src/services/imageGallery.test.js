import { describe, expect, mock, test } from 'bun:test';

mock.module('@tauri-apps/api/core', () => ({ invoke: async () => null }));
globalThis.navigator ??= { userAgent: 'Windows' };

const { GALLERY_IMAGE_MIME, dragOutputImage, localImageUrl } =
  await import('./imageGallery');

describe('dragOutputImage', () => {
  test('sets uri-list, plain text and the gallery id', () => {
    const data = new Map();
    const event = {
      dataTransfer: {
        effectAllowed: 'none',
        setData: (type, value) => data.set(type, value)
      }
    };
    const image = { localId: 'abc', path: 'x', filename: 'x.png' };
    dragOutputImage(event, image);
    expect(data.get(GALLERY_IMAGE_MIME)).toBe('abc');
    expect(data.get('text/uri-list')).toBe(localImageUrl('abc', false));
    expect(data.get('text/plain')).toBe(localImageUrl('abc', false));
    expect(event.dataTransfer.effectAllowed).toBe('copyLink');
  });

  test('ignores events without dataTransfer', () => {
    expect(() =>
      dragOutputImage({ dataTransfer: null }, { localId: 'a' })
    ).not.toThrow();
  });
});
