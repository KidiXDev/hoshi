import { describe, expect, it } from 'vitest';
import { fileNameFromUrl, normalizeDownloadUrl } from './downloadManager';

describe('normalizeDownloadUrl', () => {
  it('turns a Hugging Face file page into its download link', () => {
    expect(
      normalizeDownloadUrl(
        'https://huggingface.co/org/repo/blob/main/model.safetensors'
      )
    ).toBe('https://huggingface.co/org/repo/resolve/main/model.safetensors');
  });

  it('leaves other hosts unchanged', () => {
    const url = 'https://example.com/blob/model.safetensors';
    expect(normalizeDownloadUrl(url)).toBe(url);
  });

  it('trims pasted whitespace', () => {
    expect(normalizeDownloadUrl('  https://example.com/a.pt\n')).toBe(
      'https://example.com/a.pt'
    );
  });
});

describe('fileNameFromUrl', () => {
  it('reads the last path segment and ignores the query', () => {
    expect(
      fileNameFromUrl(
        'https://huggingface.co/org/repo/resolve/main/model.safetensors?download=true'
      )
    ).toBe('model.safetensors');
  });

  it('decodes escaped characters', () => {
    expect(fileNameFromUrl('https://example.com/my%20model.pt')).toBe(
      'my model.pt'
    );
  });

  it.each(['not a link', 'https://example.com/bad%name.pt'])(
    'returns nothing for %s',
    (url) => {
      expect(fileNameFromUrl(url)).toBe('');
    }
  );
});
