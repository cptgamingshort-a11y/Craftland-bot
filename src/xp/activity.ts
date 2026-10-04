import type { Client } from 'discord.js';
import { applyXP } from './service.js';
import { syncUserLevelRoles } from './roles.js';
import { levelConfig } from './config.js';

export const gameXPAmount = (messageXP: number) => messageXP * 2;

export async function awardActivityXP(
  client: Client,
  guildId: string,
  discordId: string,
  sourceKey: string,
  reason: string,
  amount = 5,
) {
  const result = await applyXP({
    guildId,
    discordId,
    actorId: discordId,
    sourceKey: `activity:${sourceKey}`,
    source: 'activity',
    amount,
    reason,
  });
  if (result.changed)
    await syncUserLevelRoles(client, guildId, discordId);
  return result;
}

export async function awardGameXP(
  client: Client,
  guildId: string,
  discordId: string,
  sourceKey: string,
  reason: string,
) {
  const config = await levelConfig(guildId);
  return awardActivityXP(client, guildId, discordId, sourceKey, reason, gameXPAmount(config.xpPerMessage));
}
