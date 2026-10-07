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
}

// ponytail: fixed thresholds tuned for image generation volume; switch to per-user percentiles if heavy users saturate the top level
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

export function modelDisplayName(model: string) {
  return (
    model
      .split(/[\\/]/u)
      .at(-1)
      ?.replace(/\.[^.]+$/u, '') ?? model
  );
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
  if (ranked.length <= limit + 1) return ranked;
  const otherCount = ranked
    .slice(limit)
    .reduce((sum, item) => sum + item.count, 0);
  return [...ranked.slice(0, limit), { name: 'Other', count: otherCount }];
}

export function niceCeiling(value: number) {
  if (value <= 0) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  const step = [1, 2, 5].find((factor) => factor * magnitude >= value) ?? 10;
  return step * magnitude;
}
