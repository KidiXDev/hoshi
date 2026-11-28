// @vitest-environment happy-dom
import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import DonutChart from './DonutChart.vue';

describe('DonutChart', () => {
  it('renders slices and legend percentages in donut mode', () => {
    const wrapper = mount(DonutChart, {
      props: {
        items: [
          { key: 'anima', label: 'Anima XL', value: 30 },
          { key: 'pony', label: 'Pony v6', value: 10 }
        ],
        centerLabel: 'Models'
      }
    });

    expect(wrapper.findAll('path')).toHaveLength(2);
    expect(wrapper.text()).toContain('40');
    expect(wrapper.text()).toContain('Models');
    expect(wrapper.text()).toContain('75%');
    expect(wrapper.text()).toContain('25%');
  });

  it('supports pie variant without center hole label', () => {
    const wrapper = mount(DonutChart, {
      props: {
        items: [{ key: 'png', label: 'PNG', value: 12 }],
        variant: 'pie',
        centerLabel: 'Formats'
      }
    });

    expect(wrapper.findAll('path')).toHaveLength(1);
    expect(wrapper.text()).toContain('100%');
    expect(wrapper.text()).not.toContain('Formats');
  });
});
