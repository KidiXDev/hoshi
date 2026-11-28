function promptParts(text: string): string[] {
  return text
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
}

function comparablePart(part: string): string {
  return part.toLowerCase().split(/\s+/u).filter(Boolean).join(' ');
}

export function formatPrompt(text: string): string {
  return promptParts(text).join(', ');
}

export function removeNegativeOverlap(
  positive: string,
  negative: string
): string {
  const positiveParts = new Set(
    promptParts(positive).map((part) => comparablePart(part))
  );
  return promptParts(negative)
    .filter((part) => !positiveParts.has(comparablePart(part)))
    .join(', ');
}
