export interface FormattedSpan {
  text: string;
  className: string;
}

export type LogLevel = 'info' | 'warn' | 'error' | 'system' | 'stdout';

export function getLogLevel(stream: string, message: string): LogLevel {
  if (stream === 'system') return 'system';

  const lower = message.toLowerCase();

  if (
    lower.includes('[error]') ||
    lower.includes('error:') ||
    lower.includes('traceback (most recent call last):') ||
    lower.includes('exception:') ||
    lower.includes('runtimeerror:') ||
    lower.includes('syntaxerror:') ||
    lower.includes('valueerror:') ||
    lower.includes('fatal:') ||
    lower.includes('critical:')
  ) {
    return 'error';
  }

  if (
    lower.includes('[warning]') ||
    lower.includes('warning:') ||
    lower.includes('userwarning:')
  ) {
    return 'warn';
  }

  if (stream === 'stdout') return 'stdout';
  return 'info';
}

const ANSI_COLOR_MAP: Record<string, string> = {
  '30': 'text-zinc-500',
  '31': 'text-rose-400',
  '32': 'text-emerald-400',
  '33': 'text-amber-400',
  '34': 'text-sky-400',
  '35': 'text-purple-400',
  '36': 'text-cyan-400',
  '37': 'text-zinc-200',
  '90': 'text-zinc-400',
  '91': 'text-rose-300',
  '92': 'text-emerald-300',
  '93': 'text-amber-300',
  '94': 'text-sky-300',
  '95': 'text-purple-300',
  '96': 'text-cyan-300',
  '97': 'text-white',
  '1': 'font-bold'
};

export function parseAnsiToSpans(raw: string): FormattedSpan[] {
  // eslint-disable-next-line no-control-regex
  const ansiRegex = /(?:\u001B)?\[([0-9;]+)m/gu;
  const spans: FormattedSpan[] = [];
  let lastIndex = 0;
  let currentClass = '';
  let match: RegExpExecArray | null;

  while ((match = ansiRegex.exec(raw)) !== null) {
    const textBefore = raw.slice(lastIndex, match.index);
    if (textBefore) {
      spans.push({ text: textBefore, className: currentClass });
    }

    const codes = match[1].split(';');
    for (const code of codes) {
      if (code === '0' || code === '') {
        currentClass = '';
      } else if (ANSI_COLOR_MAP[code]) {
        currentClass = `${currentClass} ${ANSI_COLOR_MAP[code]}`.trim();
      }
    }
    lastIndex = ansiRegex.lastIndex;
  }

  const remaining = raw.slice(lastIndex);
  if (remaining) {
    spans.push({ text: remaining, className: currentClass });
  }

  return spans.length > 0 ? spans : [{ text: raw, className: '' }];
}
