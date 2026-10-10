import { describe, expect, it, onTestFinished } from 'vitest';
import { effectScope, nextTick, ref } from 'vue';
import { usePromptChips } from './usePromptChips';

function setup(initial: string) {
  const scope = effectScope();
  onTestFinished(() => scope.stop());
  const prompt = ref(initial);
  const editor = scope.run(() => usePromptChips(prompt));
  if (!editor) throw new Error('usePromptChips did not run');
  return { prompt, editor };
}

const chipTexts = (editor: ReturnType<typeof usePromptChips>) =>
  editor.chips.value.map((chip) => chip.text);

describe('usePromptChips', () => {
  it('keeps a disabled chip but drops it from the prompt until re-enabled', async () => {
    const { prompt, editor } = setup('(portrait:1.2), sky');

    editor.toggle(0);
    await nextTick();
    expect(prompt.value).toBe('sky');
    expect(editor.chips.value[0]?.disabled).toBe(true);

    editor.toggle(0);
    expect(prompt.value).toBe('(portrait:1.2), sky');
  });

  it('adds the typed tag and clears the input', () => {
    const { prompt, editor } = setup('sky');

    editor.newTag.value = 'clouds';
    editor.add();

    expect(chipTexts(editor)).toEqual(['sky', 'clouds']);
    expect(editor.newTag.value).toBe('');
    expect(prompt.value).toBe('sky, clouds');
  });

  it('writes reordered and removed chips back to the prompt', () => {
    const { prompt, editor } = setup('(portrait:1.2), sky, clouds');

    editor.chips.value.reverse();
    editor.sync();
    expect(prompt.value).toBe('clouds, sky, (portrait:1.2)');

    editor.remove(1);
    expect(prompt.value).toBe('clouds, (portrait:1.2)');
  });

  it('re-parses chips when the prompt changes externally', async () => {
    const { prompt, editor } = setup('sky');

    prompt.value = 'external';
    await nextTick();

    expect(chipTexts(editor)).toEqual(['external']);
  });
});
