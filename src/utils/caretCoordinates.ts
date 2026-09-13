// Caret position relative to the element's padding box, via an off-screen
// mirror div. Shared by every field that anchors a dropdown at the caret.
const caretPropertiesToCopy = [
  'direction',
  'boxSizing',
  'width',
  'overflowX',
  'overflowY',
  'borderTopWidth',
  'borderRightWidth',
  'borderBottomWidth',
  'borderLeftWidth',
  'borderStyle',
  'paddingTop',
  'paddingRight',
  'paddingBottom',
  'paddingLeft',
  'fontStyle',
  'fontVariant',
  'fontWeight',
  'fontStretch',
  'fontSize',
  'fontSizeAdjust',
  'lineHeight',
  'fontFamily',
  'textAlign',
  'textTransform',
  'textIndent',
  'textDecoration',
  'letterSpacing',
  'wordSpacing',
  'tabSize'
] as const;
let mirrorDiv: HTMLDivElement | null = null;
export function getCaretCoordinates(
  element: HTMLTextAreaElement | HTMLInputElement,
  position: number
): { top: number; left: number; height: number } {
  if (typeof document === 'undefined') {
    return { top: 0, left: 0, height: 20 };
  }

  if (!mirrorDiv) {
    mirrorDiv = document.createElement('div');
    mirrorDiv.id = 'prompt-textarea-caret-position-mirror';
    document.body.append(mirrorDiv);
  }

  const style = mirrorDiv.style;
  const computedStyle = window.getComputedStyle(element);

  // single-line inputs never wrap
  style.whiteSpace = element instanceof HTMLInputElement ? 'pre' : 'pre-wrap';
  style.wordWrap = 'break-word';
  style.overflowWrap = 'break-word';
  style.position = 'absolute';
  style.top = '-9999px';
  style.left = '-9999px';
  style.visibility = 'hidden';

  for (const prop of caretPropertiesToCopy) {
    style[prop] = computedStyle[prop];
  }

  style.width = `${element.clientWidth}px`;
  mirrorDiv.textContent = element.value.slice(0, position);

  const span = document.createElement('span');
  span.textContent = element.value.slice(position) || '.';
  mirrorDiv.append(span);

  const parsedLineHeight = Math.trunc(
    Number(computedStyle.lineHeight.replace('px', ''))
  );
  const coordinates = {
    top: span.offsetTop - element.scrollTop,
    left: span.offsetLeft - element.scrollLeft,
    height:
      span.offsetHeight ||
      (Number.isNaN(parsedLineHeight) ? 18 : parsedLineHeight)
  };

  return coordinates;
}
