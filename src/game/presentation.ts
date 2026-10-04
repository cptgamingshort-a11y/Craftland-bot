import { activeTeam, companionCatalog, companionCounts, type GameActionResult } from './service.js';

type Collection = { pets?: unknown; petCounts?: unknown; team?: unknown };
const points: Record<string, number> = {
  Common: 1, Uncommon: 3, Rare: 8, Epic: 20, Legendary: 50,
};

export function zooText(account: Collection) {
  const counts = companionCounts(account);
  const ranks = [
    ['C', 'Common'], ['U', 'Uncommon'], ['R', 'Rare'],
    ['E', 'Epic'], ['L', 'Legendary'],
  ] as const;
  const grid = ranks.map(([letter, rank]) => {
    const animals = Object.entries(companionCatalog)
      .filter(([, data]) => data.rank === rank)
      .map(([name, data]) => `${data.icon} ${String(counts[name] ?? 0).padStart(2, '0')}`);
    return `**${letter}** │ ${animals.join('   ')}`;
  });
  const lines = Object.entries(companionCatalog).map(([name, data]) =>
    `${data.icon} **${name}** • ${data.rank} ×${counts[name] ?? 0}`,
  );
  const score = Object.entries(companionCatalog).reduce((total, [name, data]) =>
    total + (counts[name] ?? 0) * (points[data.rank] ?? 0), 0);
  const team = activeTeam(account);
  return `🌿 **Your zoo** 🌿\n${grid.join('\n')}\n\n**Zoo points:** ${score.toLocaleString()}\n**Team:** ${team.length ? team.map((name) => `${companionCatalog[name]?.icon ?? '🐾'} ${name}`).join(' • ') : 'No companions yet'}\n\n${lines.join('\n')}`;
}

export function animalText(account: Collection, animal: string) {
  const entry = Object.entries(companionCatalog).find(([name]) => name.toLowerCase() === animal.toLowerCase());
  if (!entry) return null;
  const [name, data] = entry;
  const count = companionCounts(account)[name] ?? 0;
  return `${data.icon} **${name}** • ${data.rank}\n${data.description}\n\nOwned: **${count}**\nSell: **${data.sell} Craft Coins**`;
}

export function battleText(result: GameActionResult) {
  const own = result.team?.length
    ? result.team.map((name) => `${companionCatalog[name]?.icon ?? '🐾'} ${name}`).join(' • ')
    : 'No companions';
  const rivals = result.enemyTeam?.map((name) => `${companionCatalog[name]?.icon ?? '🐾'} ${name}`).join(' • ') ?? 'Rival team';
  return `**Your team:** ${own}\n**Rival team:** ${rivals}\n\n${result.won ? '🏆 Victory!' : 'The rival won.'} • ${result.turns ?? '?'} turns\nReward: **${(result.reward ?? 0).toLocaleString()} Craft Coins**`;
}
