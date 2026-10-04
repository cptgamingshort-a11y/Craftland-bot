export const MAX_XP = 2_000_000_000;
export type Formula = { baseXP: number; incrementXP: number; maxLevel: number };
export function threshold(level: number, formula: Formula) {
  if (!Number.isInteger(level) || level < 0)
    throw new Error('Level must be a non-negative integer.');
  return (
    level * formula.baseXP + (formula.incrementXP * level * (level - 1)) / 2
  );
}
export function calculateLevel(xp: number, formula: Formula) {
  let low = 0,
    high = formula.maxLevel;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (threshold(middle, formula) <= xp) low = middle;
    else high = middle - 1;
  }
  return low;
}
export function progress(xp: number, formula: Formula) {
  const level = calculateLevel(xp, formula);
  const floor = threshold(level, formula);
  const ceiling = threshold(level + 1, formula);
  const current = xp - floor;
  const required = ceiling - floor;
  const percent =
    level === formula.maxLevel
      ? 100
      : Math.min(100, Math.floor((current / required) * 100));
  const filled = Math.floor(percent / 10);
  return {
    level,
    current,
    required,
    totalXP: xp,
    nextLevelXP: ceiling,
    percent,
    bar: '█'.repeat(filled) + '░'.repeat(10 - filled),
    maxLevelReached: level === formula.maxLevel,
  };
}
