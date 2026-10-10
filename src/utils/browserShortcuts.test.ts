import { describe, expect, it } from 'vitest';
import { isNativeBrowserShortcut } from './browserShortcuts';

type Modifiers = Partial<
  Pick<KeyboardEvent, 'ctrlKey' | 'metaKey' | 'shiftKey' | 'altKey'>
>;

const keyEvent = (key: string, modifiers: Modifiers = {}) => ({
  key,
  ctrlKey: false,
  metaKey: false,
  shiftKey: false,
  altKey: false,
  ...modifiers
});

describe('isNativeBrowserShortcut', () => {
  it.each([
    ['F5', {}],
    ['F12', {}],
    ['R', { ctrlKey: true, shiftKey: true }],
    ['r', { metaKey: true }],
    ['ArrowLeft', { altKey: true }]
  ])('blocks %s %o', (key, modifiers: Modifiers) => {
    expect(isNativeBrowserShortcut(keyEvent(key, modifiers))).toBe(true);
  });

  it.each(['a', 'c', 'x', 'v', 'z', 'y', 'Enter'])(
    'keeps Ctrl+%s for text editing',
    (key) => {
      expect(isNativeBrowserShortcut(keyEvent(key, { ctrlKey: true }))).toBe(
        false
      );
    }
  );

  it('ignores unmodified keys', () => {
    expect(isNativeBrowserShortcut(keyEvent('r'))).toBe(false);
    expect(isNativeBrowserShortcut(keyEvent('ArrowLeft'))).toBe(false);
  });
});
