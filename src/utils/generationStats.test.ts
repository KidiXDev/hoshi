import { describe, expect, it } from 'vitest';
import {
  activityLevel,
  countByDay,
  dailySeries,
  heatmapWeeks,
  hourlyCounts,
  niceCeiling,
  streaks,
  topModels
} from './generationStats';

const at = (day: number, hour = 12) => new Date(2026, 9, day, hour).getTime();

describe('activityLevel', () => {
  it('follows the 0 / 1-10 / 11-30 / 31-70 / 71+ tiers', () => {
    expect(
      [0, 1, 10, 11, 30, 31, 50, 70, 71, 1000].map((count) =>
        activityLevel(count)
      )
    ).toEqual([0, 1, 1, 2, 2, 3, 3, 3, 4, 4]);
  });
});

describe('heatmapWeeks', () => {
  it('starts on a Sunday and ends on today', () => {
    const today = new Date(2026, 9, 7);
    const weeks = heatmapWeeks(countByDay([at(7), at(7), at(1)]), today);
    const lastWeek = weeks.at(-1) ?? [];

    expect(weeks).toHaveLength(53);
    expect(weeks[0]?.[0]?.date.getDay()).toBe(0);
    expect(lastWeek[today.getDay()]).toMatchObject({
      key: '2026-10-07',
      count: 2
    });
    expect(
      lastWeek.slice(today.getDay() + 1).every((day) => day === null)
    ).toBe(true);
  });
});

describe('streaks', () => {
  const counts = countByDay([at(1), at(2), at(3), at(5), at(6)]);

  it('counts the current and longest run ending today', () => {
    expect(streaks(counts, new Date(2026, 9, 6))).toEqual({
      current: 2,
      longest: 3
    });
  });

  it('keeps the current run alive through an idle today, not two idle days', () => {
    expect(streaks(counts, new Date(2026, 9, 7)).current).toBe(2);
    expect(streaks(counts, new Date(2026, 9, 8)).current).toBe(0);
  });
});

describe('dailySeries and hourlyCounts', () => {
  it('bucket timestamps by local day and hour', () => {
    const counts = countByDay([at(6), at(7), at(7)]);
    expect(
      dailySeries(counts, new Date(2026, 9, 7), 3).map((day) => day.count)
    ).toEqual([0, 1, 2]);

    const hours = hourlyCounts([at(7, 0), at(7, 23), at(7, 23)]);
    expect(hours[0]).toBe(1);
    expect(hours[23]).toBe(2);
  });
});

describe('topModels', () => {
  const models = [
    'anima/a.safetensors',
    'anima\\a.safetensors',
    'b.ckpt',
    'c.safetensors',
    'd.safetensors',
    ''
  ];

  it('strips folders and extensions and folds the tail into Other', () => {
    expect(topModels(models, 2)).toEqual([
      { name: 'a', count: 2 },
      { name: 'b', count: 1 },
      { name: 'Other', count: 2 }
    ]);
    expect(topModels(models, 3)).toHaveLength(4);
  });
});

describe('niceCeiling', () => {
  it('rounds axis maxima up to 1/2/5 steps', () => {
    expect(
      [0, 1, 7, 12, 50, 51, 180, 999].map((value) => niceCeiling(value))
    ).toEqual([1, 1, 10, 20, 50, 100, 200, 1000]);
  });
});
