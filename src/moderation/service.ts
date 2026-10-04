import { type Client, type GuildMember, PermissionFlagsBits } from 'discord.js';
import { db } from '../database/client.js';
import { memberUser } from '../services/members.js';
import { assertModeration } from '../roles/guards.js';
import { audit } from '../services/audit.js';
import { UserError } from '../utils/errors.js';
export async function warn(
  client: Client,
  target: GuildMember,
  actor: GuildMember | undefined,
  reason: string,
) {
  const bot = await target.guild.members.fetchMe();
  assertModeration(bot, target, actor);
  const user = await memberUser(target);
  const actorId = actor?.id ?? bot.id;
  const warning = await db.$transaction(async (tx) => {
    const w = await tx.warning.create({
      data: { guildId: target.guild.id, userId: user.id, actorId, reason },
    });
    await tx.moderationAction.create({
      data: {
        guildId: target.guild.id,
        targetId: target.id,
        actorId,
        type: 'WARN',
        reason,
        metadata: { warningId: w.id },
      },
    });
    await tx.auditLog.create({
      data: {
        guildId: target.guild.id,
        actorId,
        action: 'WARNING',
        targetId: target.id,
        data: { reason },
      },
    });
    return w;
  });
  await audit(client, target.guild.id, actorId, 'WARNING_RECORDED', target.id, {
    warningId: warning.id,
  });
  await target
    .send({
      content: `Craftland India warning: ${reason}`,
      allowedMentions: { parse: [] },
    })
    .catch(() => {});
  return warning;
}
export async function timeout(
  client: Client,
  target: GuildMember,
  actor: GuildMember | undefined,
  minutes: number,
  reason: string,
) {
  const bot = await target.guild.members.fetchMe();
  assertModeration(bot, target, actor);
  if (
    !bot.permissions.has(PermissionFlagsBits.ModerateMembers) ||
    !target.moderatable
  )
    throw new UserError('Bot cannot timeout this member.');
  const actorId = actor?.id ?? bot.id;
  await audit(
    client,
    target.guild.id,
    actorId,
    'TIMEOUT_REQUESTED',
    target.id,
    { minutes, reason },
  );
  await target.timeout(minutes * 60000, reason);
  await db.moderationAction.create({
    data: {
      guildId: target.guild.id,
      actorId,
      targetId: target.id,
      type: 'TIMEOUT',
      reason,
      metadata: { minutes },
    },
  });
  await audit(client, target.guild.id, actorId, 'TIMEOUT', target.id, {
    minutes,
    reason,
  });
}
