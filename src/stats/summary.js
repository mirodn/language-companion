// Numbers for the stats page and the toolbar popup, computed from the word log.
// Days and weeks are in local time; weeks start on Monday.

export function startOfDay(time) {
  const date = new Date(time);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

export function startOfWeek(time) {
  const date = new Date(startOfDay(time));
  date.setDate(date.getDate() - ((date.getDay() + 6) % 7));
  return date.getTime();
}

// Calendar arithmetic through Date, so days with a DST change still line up.
function addDays(time, days) {
  const date = new Date(time);
  date.setDate(date.getDate() + days);
  return date.getTime();
}

function ranked(entries, key, limit) {
  const counts = new Map();
  for (const entry of entries) {
    const value = entry[key];
    if (value) counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return [...counts]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([value, count]) => ({ value, count }));
}

// Days in a row with at least one saved word, ending today (or yesterday, until today has one).
function streak(entries, now) {
  const days = new Set(entries.map((entry) => startOfDay(entry.at)));
  let day = startOfDay(now);
  if (!days.has(day)) day = addDays(day, -1);
  let count = 0;
  while (days.has(day)) {
    count += 1;
    day = addDays(day, -1);
  }
  return count;
}

// Queued words count as saved: they reach Anki as soon as it is open.
export function summarize(entries, now = Date.now(), { weeks = 12, sources = 10 } = {}) {
  const currentWeek = startOfWeek(now);
  const weekStarts = Array.from({ length: weeks }, (_, i) => addDays(currentWeek, -7 * (weeks - 1 - i)));
  const perWeek = new Map(weekStarts.map((start) => [start, 0]));
  for (const entry of entries) {
    const start = startOfWeek(entry.at);
    if (perWeek.has(start)) perWeek.set(start, perWeek.get(start) + 1);
  }

  return {
    total: entries.length,
    thisWeek: perWeek.get(currentWeek),
    streak: streak(entries, now),
    weeks: weekStarts.map((start) => ({ start, count: perWeek.get(start) })),
    languages: ranked(entries, "lang", Infinity),
    sources: ranked(entries, "host", sources),
    queued: entries.filter((entry) => entry.status === "queued"),
  };
}
