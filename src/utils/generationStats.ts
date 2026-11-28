export type DayCounts = Map<string, number>;

export interface HeatmapDay {
  key: string;
  date: Date;
  count: number;
  level: number;
}

export interface RankedCount {
  name: string;
  count: number;
  bytes?: number;
}

export interface TimeOfDayBucket {
  key: string;
  name: string;
  detail: string;
  count: number;
}

export const ACTIVITY_THRESHOLDS = [1, 11, 31, 71] as const;

export function activityLevel(count: number) {
  return ACTIVITY_THRESHOLDS.filter((threshold) => count >= threshold).length;
}

export function startOfDay(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

export function addDays(date: Date, days: number) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
}

export function dayKey(date: Date) {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

export function parseDayKey(key: string) {
  const [year, month, day] = key.split('-').map(Number);
  return new Date(year, month - 1, day);
}

export function countByDay(timestamps: number[]): DayCounts {
  const counts: DayCounts = new Map();
  for (const timestamp of timestamps) {
    const key = dayKey(new Date(timestamp));
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

export function heatmapWeeks(
  counts: DayCounts,
  today: Date,
  weekCount = 53
): (HeatmapDay | null)[][] {
  const end = startOfDay(today);
  const start = addDays(end, -(weekCount - 1) * 7 - end.getDay());
  return Array.from({ length: weekCount }, (_, week) =>
    Array.from({ length: 7 }, (_day, weekday) => {
      const date = addDays(start, week * 7 + weekday);
      if (date > end) return null;
      const key = dayKey(date);
      const count = counts.get(key) ?? 0;
      return { key, date, count, level: activityLevel(count) };
    })
  );
}

export function streaks(counts: DayCounts, today: Date) {
  let current = 0;
  let cursor = startOfDay(today);
  if (!counts.has(dayKey(cursor))) cursor = addDays(cursor, -1);
  while (counts.has(dayKey(cursor))) {
    current++;
    cursor = addDays(cursor, -1);
  }

  let longest = 0;
  let run = 0;
  let previousKey = '';
  for (const key of [...counts.keys()].sort()) {
    const followsPrevious =
      previousKey !== '' &&
      dayKey(addDays(parseDayKey(previousKey), 1)) === key;
    run = followsPrevious ? run + 1 : 1;
    longest = Math.max(longest, run);
    previousKey = key;
  }
  return { current, longest };
}

export function dailySeries(counts: DayCounts, today: Date, days: number) {
  const end = startOfDay(today);
  return Array.from({ length: days }, (_, index) => {
    const date = addDays(end, index - days + 1);
    return { date, count: counts.get(dayKey(date)) ?? 0 };
  });
}

export function hourlyCounts(timestamps: number[]) {
  const hours = Array.from({ length: 24 }, () => 0);
  for (const timestamp of timestamps) hours[new Date(timestamp).getHours()]++;
  return hours;
}

export function weekdayCounts(timestamps: number[]) {
  const days = Array.from({ length: 7 }, () => 0);
  for (const timestamp of timestamps) days[new Date(timestamp).getDay()]++;
  return days;
}

export function timeOfDayBuckets(hourly: number[]): TimeOfDayBucket[] {
  const sumSlice = (start: number, end: number) =>
    hourly.slice(start, end).reduce((sum, count) => sum + count, 0);
  return [
    {
      key: 'morning',
      name: 'Morning',
      detail: '6 AM – 12 PM',
      count: sumSlice(6, 12)
    },
    {
      key: 'afternoon',
      name: 'Afternoon',
      detail: '12 PM – 6 PM',
      count: sumSlice(12, 18)
    },
    {
      key: 'evening',
      name: 'Evening',
      detail: '6 PM – 12 AM',
      count: sumSlice(18, 24)
    },
    {
      key: 'night',
      name: 'Late night',
      detail: '12 AM – 6 AM',
      count: sumSlice(0, 6)
    }
  ];
}

export function modelDisplayName(model: string) {
  return (
    model
      .split(/[\\/]/u)
      .at(-1)
      ?.replace(/\.[^.]+$/u, '') ?? model
  );
}

function foldRankedTail(ranked: RankedCount[], limit: number): RankedCount[] {
  if (ranked.length <= limit + 1) return ranked;
  const tail = ranked.slice(limit);
  const otherCount = tail.reduce((sum, item) => sum + item.count, 0);
  const hasBytes = tail.some((item) => item.bytes !== undefined);
  const otherBytes = tail.reduce((sum, item) => sum + (item.bytes ?? 0), 0);
  return [
    ...ranked.slice(0, limit),
    hasBytes
      ? { name: 'Other', count: otherCount, bytes: otherBytes }
      : { name: 'Other', count: otherCount }
  ];
}

export function topModels(models: string[], limit: number): RankedCount[] {
  const counts = new Map<string, number>();
  for (const model of models) {
    if (!model) continue;
    const name = modelDisplayName(model);
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  const ranked = [...counts]
    .map(([name, count]) => ({ name, count }))
    .sort((left, right) => right.count - left.count);
  return foldRankedTail(ranked, limit);
}

export function modelStorageBreakdown(
  items: { model: string; fileSize: number }[],
  limit: number
): RankedCount[] {
  const buckets = new Map<string, { count: number; bytes: number }>();
  for (const item of items) {
    const name = item.model ? modelDisplayName(item.model) : 'Unknown model';
    const current = buckets.get(name) ?? { count: 0, bytes: 0 };
    current.count += 1;
    current.bytes += item.fileSize;
    buckets.set(name, current);
  }
  const ranked = [...buckets]
    .map(([name, { count, bytes }]) => ({ name, count, bytes }))
    .sort(
      (left, right) => right.count - left.count || right.bytes - left.bytes
    );
  return foldRankedTail(ranked, limit);
}

export function subfolderBreakdown(
  items: { subfolder: string; fileSize: number }[],
  limit: number
): RankedCount[] {
  const buckets = new Map<string, { count: number; bytes: number }>();
  for (const item of items) {
    const name = item.subfolder.trim() || 'Root output';
    const current = buckets.get(name) ?? { count: 0, bytes: 0 };
    current.count += 1;
    current.bytes += item.fileSize;
    buckets.set(name, current);
  }
  const ranked = [...buckets]
    .map(([name, { count, bytes }]) => ({ name, count, bytes }))
    .sort(
      (left, right) => right.count - left.count || right.bytes - left.bytes
    );
  return foldRankedTail(ranked, limit);
}

export function extensionBreakdown(
  items: { extension: string; fileSize: number }[]
): RankedCount[] {
  const buckets = new Map<string, { count: number; bytes: number }>();
  for (const item of items) {
    const name = (item.extension.trim() || 'unknown').toUpperCase();
    const current = buckets.get(name) ?? { count: 0, bytes: 0 };
    current.count += 1;
    current.bytes += item.fileSize;
    buckets.set(name, current);
  }
  return [...buckets]
    .map(([name, { count, bytes }]) => ({ name, count, bytes }))
    .sort(
      (left, right) => right.count - left.count || right.bytes - left.bytes
    );
}

export function normalizePromptTag(raw: string) {
  return raw
    .replaceAll(/^[({[\s]+|[)}\]\s]+$/gu, '')
    .replace(/:[+-]?\d+(?:\.\d+)?$/u, '')
    .replaceAll(/\\([()[\]{}])/gu, '$1')
    .replaceAll(/\s+/gu, ' ')
    .trim()
    .toLowerCase();
}

export function topPromptTags(prompts: string[], limit: number): RankedCount[] {
  const counts = new Map<string, number>();
  for (const prompt of prompts) {
    if (!prompt) continue;
    const seenInImage = new Set<string>();
    for (const token of prompt.split(/[,\n]/u)) {
      const tag = normalizePromptTag(token);
      if (tag.length < 2 || tag.length > 48 || /^\d+$/u.test(tag)) continue;
      seenInImage.add(tag);
    }
    for (const tag of seenInImage) {
      counts.set(tag, (counts.get(tag) ?? 0) + 1);
    }
  }
  return [...counts]
    .map(([name, count]) => ({ name, count }))
    .sort(
      (left, right) =>
        right.count - left.count || left.name.localeCompare(right.name)
    )
    .slice(0, limit);
}

export function niceCeiling(value: number) {
  if (value <= 0) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  const step = [1, 2, 5].find((factor) => factor * magnitude >= value) ?? 10;
  return step * magnitude;
}
