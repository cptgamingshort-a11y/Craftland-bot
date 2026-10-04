import { DateTime } from 'luxon';
export function periodRange(
  period: 'weekly' | 'monthly',
  previous = false,
  now = DateTime.now(),
) {
  let start = now
    .setZone('Asia/Kolkata')
    .startOf(period === 'weekly' ? 'week' : 'month');
  if (previous)
    start = start.minus(period === 'weekly' ? { weeks: 1 } : { months: 1 });
  return {
    start: start.toJSDate(),
    end: start
      .plus(period === 'weekly' ? { weeks: 1 } : { months: 1 })
      .toJSDate(),
  };
}
export function rankEntries(rows: { discordId: string; amount: number }[]) {
  const totals = new Map<string, number>();
  for (const row of rows)
    totals.set(row.discordId, (totals.get(row.discordId) ?? 0) + row.amount);
  return [...totals]
    .map(([discordId, points]) => ({ discordId, points }))
    .filter((r) => r.points > 0)
    .sort(
      (a, b) => b.points - a.points || a.discordId.localeCompare(b.discordId),
    );
}
