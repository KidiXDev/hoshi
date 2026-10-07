import { test } from 'bun:test';
import assert from 'node:assert/strict';
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

const at = (day, hour = 12) => new Date(2026, 9, day, hour).getTime();

test('activity levels follow the 0 / 1-10 / 11-30 / 31-70 / 71+ tiers', () => {
  assert.deepEqual(
    [0, 1, 10, 11, 30, 31, 50, 70, 71, 1000].map((count) =>
      activityLevel(count)
    ),
    [0, 1, 1, 2, 2, 3, 3, 3, 4, 4]
  );
});

test('heatmap ends on today and starts on a Sunday', () => {
  const today = new Date(2026, 9, 7);
  const weeks = heatmapWeeks(countByDay([at(7), at(7), at(1)]), today);
  assert.equal(weeks.length, 53);
  assert.equal(weeks[0][0]?.date.getDay(), 0);
  const lastWeek = weeks.at(-1);
  assert.equal(lastWeek[today.getDay()]?.key, '2026-10-07');
  assert.equal(lastWeek[today.getDay()]?.count, 2);
  assert.ok(lastWeek.slice(today.getDay() + 1).every((day) => day === null));
});

test('streaks count back from today, or yesterday when today is idle', () => {
  const counts = countByDay([at(1), at(2), at(3), at(5), at(6)]);
  assert.deepEqual(streaks(counts, new Date(2026, 9, 6)), {
    current: 2,
    longest: 3
  });
  assert.equal(streaks(counts, new Date(2026, 9, 7)).current, 2);
  assert.equal(streaks(counts, new Date(2026, 9, 8)).current, 0);
});

test('daily series and hourly counts bucket by local time', () => {
  const counts = countByDay([at(6), at(7), at(7)]);
  assert.deepEqual(
    dailySeries(counts, new Date(2026, 9, 7), 3).map((day) => day.count),
    [0, 1, 2]
  );
  const hours = hourlyCounts([at(7, 0), at(7, 23), at(7, 23)]);
  assert.equal(hours[0], 1);
  assert.equal(hours[23], 2);
});

test('top models strip folders and fold the tail into Other', () => {
  const models = [
    'anima/a.safetensors',
    'anima\\a.safetensors',
    'b.ckpt',
    'c.safetensors',
    'd.safetensors',
    ''
  ];
  assert.deepEqual(topModels(models, 2), [
    { name: 'a', count: 2 },
    { name: 'b', count: 1 },
    { name: 'Other', count: 2 }
  ]);
  assert.equal(topModels(models, 3).length, 4);
});

test('nice ceiling rounds axis maxima to 1/2/5 steps', () => {
  assert.deepEqual(
    [0, 1, 7, 12, 50, 51, 180, 999].map((value) => niceCeiling(value)),
    [1, 1, 10, 20, 50, 100, 200, 1000]
  );
});
