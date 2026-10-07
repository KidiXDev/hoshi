import { shallowRef, type ShallowRef } from 'vue';

export interface AnchoredTooltip {
  x: number;
  y: number;
  align: 'start' | 'center' | 'end';
  value: string;
  label: string;
}

const EDGE_MARGIN = 80;

export function useAnchoredTooltip(
  root: Readonly<ShallowRef<HTMLElement | null>>
) {
  const tooltip = shallowRef<AnchoredTooltip | null>(null);

  function show(anchor: Element, value: string, label: string) {
    const rootRect = root.value?.getBoundingClientRect();
    if (!rootRect) return;
    const rect = anchor.getBoundingClientRect();
    const x = rect.left + rect.width / 2 - rootRect.left;
    tooltip.value = {
      x,
      y: rect.top - rootRect.top,
      align:
        x < EDGE_MARGIN
          ? 'start'
          : x > rootRect.width - EDGE_MARGIN
            ? 'end'
            : 'center',
      value,
      label
    };
  }

  function hide() {
    tooltip.value = null;
  }

  return { tooltip, show, hide };
}
