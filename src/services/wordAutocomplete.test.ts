import { encode } from '@msgpack/msgpack';
import { invoke } from '@tauri-apps/api/core';
import { gzipSync } from 'node:zlib';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { suggestWords, WordAutocomplete } from './wordAutocomplete';

vi.mock(import('@tauri-apps/api/core'), async (importOriginal) => ({
  ...(await importOriginal()),
  invoke: vi.fn()
}));

function cbPack(...items: unknown[]): ArrayBuffer {
  const bytes = gzipSync(encode(items));
  return bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength
  );
}

const HEADER = { format: 'cB', version: 1 };

describe('WordAutocomplete.reload', () => {
  beforeEach(() => {
    vi.mocked(invoke).mockReset();
  });

  it('flattens buckets in frequency order and drops non-words', async () => {
    vi.mocked(invoke).mockResolvedValue(
      cbPack(HEADER, ['the'], [], ['beach', 'beauty', '1990s'], ['beautiful'])
    );

    await expect(WordAutocomplete.reload()).resolves.toEqual([
      'the',
      'beach',
      'beauty',
      'beautiful'
    ]);
    expect(invoke).toHaveBeenCalledWith('load_word_frequency_data');
  });

  it('rejects a file without the cBpack header', async () => {
    vi.mocked(invoke).mockResolvedValue(cbPack({ format: 'x' }, ['the']));

    await expect(WordAutocomplete.reload()).rejects.toThrow(
      'Not a wordfreq cBpack word list'
    );
  });

  it('rejects when the word list is missing', async () => {
    vi.mocked(invoke).mockRejectedValue('No word list found');

    await expect(WordAutocomplete.reload()).rejects.toBe('No word list found');
  });

  it('reads the file again after a failed load', async () => {
    vi.mocked(invoke)
      .mockRejectedValueOnce('No word list found')
      .mockResolvedValueOnce(cbPack(HEADER, ['beach']));

    await expect(WordAutocomplete.reload()).rejects.toBe('No word list found');
    await expect(WordAutocomplete.reload()).resolves.toEqual(['beach']);
  });
});

describe('suggestWords', () => {
  const words = ['the', 'beach', 'beauty', 'bear', 'beautiful'];

  it('returns prefix matches in frequency order up to the limit', () => {
    expect(suggestWords(words, 'bea', 2).map((item) => item.label)).toEqual([
      'beach',
      'beauty'
    ]);
  });

  it('includes an exact match at its frequency rank', () => {
    expect(
      suggestWords(['birth', 'birthday', 'bird'], 'birth', 5).map(
        (item) => item.label
      )
    ).toEqual(['birth', 'birthday']);
  });

  it('keeps a leading capital', () => {
    expect(suggestWords(words, 'Bea', 1)[0]).toMatchObject({
      label: 'Beach',
      insert_text: 'Beach',
      kind: 'word'
    });
  });
});
