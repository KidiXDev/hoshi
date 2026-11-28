/** @vitest-environment happy-dom */
import { enableAutoUnmount, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { nextTick } from 'vue';
import PositivePromptSection from './PositivePromptSection.vue';

enableAutoUnmount(afterEach);

const STORAGE_KEY = 'generation-data-prompt-view';

function mountSection(prompt?: string) {
  return mount(PositivePromptSection, {
    props: { prompt, emptyMessage: 'No prompt.' }
  });
}

describe('PositivePromptSection', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('shows the prompt as unparsed text by default', () => {
    const wrapper = mountSection('1girl, solo');

    expect(wrapper.find('p').text()).toBe('1girl, solo');
    expect(wrapper.findAll('span')).toHaveLength(0);
  });

  it('splits the prompt into tags in standard mode', async () => {
    const wrapper = mountSection('1girl, solo');

    const standardToggle = wrapper
      .findAll('button')
      .find((button) => button.text() === 'Standard');
    await standardToggle?.trigger('click');
    await nextTick();

    expect(wrapper.findAll('span').map((tag) => tag.text())).toEqual([
      '1girl',
      'solo'
    ]);
  });

  it('keeps the current mode when its toggle is clicked again', async () => {
    const wrapper = mountSection('1girl, solo');

    const rawToggle = wrapper
      .findAll('button')
      .find((button) => button.text() === 'Raw');
    await rawToggle?.trigger('click');
    await nextTick();

    expect(wrapper.find('p').text()).toBe('1girl, solo');
  });

  it('restores the stored mode', () => {
    localStorage.setItem(STORAGE_KEY, 'standard');

    const wrapper = mountSection('1girl, solo');

    expect(wrapper.findAll('span')).toHaveLength(2);
  });

  it('shows the empty message when the prompt has no tags', () => {
    const wrapper = mountSection(' , ');

    expect(wrapper.text()).toContain('No prompt.');
  });
});
