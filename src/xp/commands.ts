import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  MessageFlags,
  ModalBuilder,
  PermissionFlagsBits,
  TextInputBuilder,
  TextInputStyle,
  type ChatInputCommandInteraction,
  type ButtonInteraction,
  type GuildMember,
  type ModalSubmitInteraction,
} from 'discord.js';
import { db } from '../database/client.js';
import { auditNotification } from '../services/audit.js';
import { levelConfig, levelConfigSchema, saveLevelConfig } from './config.js';
import { applyXP, recalibrateLevels, xpStats, xpStandings } from './service.js';
import {
  setLevelRole,
  removeLevelRole,
  syncGuildLevelRoles,
  syncUserLevelRoles,
} from './roles.js';
import { UserError } from '../utils/errors.js';
import { periodRange } from '../leaderboard/calculations.js';
import type { LevelConfig } from '../database/models.js';
const pendingLevelConfig = new Map<
  string,
  { value: LevelConfig; expiresAt: number }
>();
type StaffCheck = (
  i: ChatInputCommandInteraction,
  permission?: bigint,
) => Promise<GuildMember>;
const card = (title: string, text: string) =>
  new EmbedBuilder()
    .setColor(0xc49a55)
    .setTitle(title)
    .setDescription(text.slice(0, 4000))
    .setFooter({ text: 'Craftland India • Community Level System' });
export async function handleLevelCommand(
  i: ChatInputCommandInteraction,
  staff: StaffCheck,
) {
  const gid = i.guildId!;
  if (i.commandName === 'level-config') {
    if (!i.memberPermissions?.has(PermissionFlagsBits.Administrator))
      throw new UserError('Administrator required.');
    if (!i.deferred && !i.replied)
      await i.deferReply({ flags: MessageFlags.Ephemeral });
    const config = await levelConfig(gid);
    pendingLevelConfig.set(`${gid}:${i.user.id}`, {
      value: config as unknown as LevelConfig,
      expiresAt: Date.now() + 10 * 60_000,
    });
    await i.editReply({
      content: 'XP settings are ready. Open the editor to change them.',
      components: [
        new ActionRowBuilder<ButtonBuilder>().addComponents(
          new ButtonBuilder()
            .setCustomId(`level:config-open:${config.version}`)
            .setLabel('Edit XP settings')
            .setStyle(ButtonStyle.Primary),
        ),
      ],
    });
    return;
  }
  if (!i.deferred && !i.replied)
    await i.deferReply({ flags: MessageFlags.Ephemeral });
  const sub = i.options.getSubcommand(false);
  if (i.commandName === 'leaderboard') {
    const { start, end } = periodRange('weekly');
    const weekly = sub === 'weekly';
    const rows = await xpStandings(
      gid,
      weekly ? start : undefined,
      weekly ? end : undefined,
    );
    const me = await xpStats(gid, i.user.id);
    let rank = me.rank;
    if (weekly) {
      const totals = await db.xPTransaction.groupBy({
        by: ['userId'],
        where: { guildId: gid, createdAt: { gte: start, lt: end } },
        _sum: { amount: true },
      });
      rank =
        totals.filter((t) => (t._sum.amount ?? 0) > me.weeklyXP).length + 1;
    }
    await i.editReply({
      embeds: [
        card(
          weekly
            ? '🏆 Weekly XP leaderboard'
            : '🏆 Craftland India XP leaderboard',
          rows
            .slice(0, 10)
            .map(
              (r, n) =>
                `${['🥇', '🥈', '🥉'][n] ?? `${n + 1}.`} <@${r.discordId}> — **Level ${r.level}** • ${r.xp.toLocaleString()} ${weekly ? 'XP gained' : 'total XP'}`,
            )
            .join('\n') +
            `\n\nYour rank: **#${rank}** • ${weekly ? me.weeklyXP : me.totalXP} XP`,
        ),
      ],
      allowedMentions: { parse: [] },
    });
    return;
  }
  if (i.commandName === 'level-role') {
    if (!i.memberPermissions?.has(PermissionFlagsBits.Administrator))
      throw new UserError('Administrator required.');
    const actor = await i.guild!.members.fetch(i.user.id);
    if (!actor.permissions.has(PermissionFlagsBits.ManageRoles))
      throw new UserError('Manage Roles required.');
    if (sub === 'set') {
      const role = await i.guild!.roles.fetch(
        i.options.getRole('role', true).id,
      );
      if (!role) throw new UserError('Role missing.');
      await setLevelRole(gid, i.options.getInteger('level', true), role, actor);
    }
    if (sub === 'remove')
      await removeLevelRole(
        gid,
        i.options.getInteger('level', true),
        i.user.id,
      );
    if (sub === 'sync-user') {
      const u = i.options.getUser('user', true);
      const result = await syncUserLevelRoles(i.client, gid, u.id, true);
      await i.editReply({
        embeds: [card('Level role sync', JSON.stringify(result))],
      });
      return;
    }
    if (sub === 'sync' || sub === 'set' || sub === 'remove') {
      const result = await syncGuildLevelRoles(i.client, gid, sub === 'sync');
      await auditNotification(
        i.client,
        gid,
        'LEVEL_ROLES_SYNCHRONIZED',
        i.user.id,
        undefined,
        { checked: result.checked, changed: result.changed, failed: result.failed },
      );
      await i.editReply({
        embeds: [
          card(
            'Level roles updated',
            `Checked: ${result.checked}\nChanged: ${result.changed}\nBlocked/retry: ${result.failed}\nOnly registered level roles were considered.`,
          ),
        ],
      });
      return;
    }
    const roles = await db.levelRole.findMany({
      where: { guildId: gid, enabled: true },
      orderBy: { level: 'asc' },
    });
    await i.editReply({
      embeds: [
        card(
          'Level role mappings',
          roles
            .map(
              (r) => `**Level ${r.level}** → <@&${r.roleId}> (${r.roleName})`,
            )
            .join('\n') || 'No level-role mappings configured.',
        ),
      ],
      allowedMentions: { parse: [] },
    });
    return;
  }
  const member = await i.guild!.members.fetch(
    (i.options.getUser('user') ?? i.user).id,
  );
  const level = i.commandName === 'level' ? i.options.getInteger('set') : null;
  if (i.commandName === 'xp') await staff(i);
  if (level !== null || (i.commandName === 'xp' && sub !== 'stats')) {
    await staff(i);
    const amount = i.options.getInteger('amount') ?? 0;
    await applyXP({
      guildId: gid,
      discordId: member.id,
      actorId: i.user.id,
      sourceKey: `xp-admin:${i.id}`,
      source:
        level !== null ? 'level_set' : sub === 'reset' ? 'reset' : 'manual',
      ...(level !== null
        ? { level }
        : { amount: sub === 'remove' ? -amount : amount }),
      reason: i.options.getString('reason') ?? 'Authorized level change',
    });
    await syncUserLevelRoles(i.client, gid, member.id);
    await auditNotification(
      i.client,
      gid,
      'XP_ADMIN_CHANGE',
      i.user.id,
      member.id,
      {
        operation: level !== null ? 'set_level' : sub,
        level,
        amount: level === null ? (sub === 'remove' ? -amount : amount) : null,
        reason: i.options.getString('reason') ?? 'Authorized level change',
      },
    );
  }
  const s = await xpStats(gid, member.id);
  await i.editReply({
    embeds: [
      card(
        `Level profile • ${member.user.username}`,
        `<@${member.id}>\n\n**Level ${s.level}**\n${s.bar} **${s.percent}%**\n\nCurrent progress: **${s.current.toLocaleString()} / ${s.required.toLocaleString()} XP**\nTotal XP: **${s.totalXP.toLocaleString()}**\n${s.maxLevelReached ? 'Maximum configured level reached' : `Next level at: **${s.nextLevelXP.toLocaleString()} total XP**`}\nServer rank: **#${s.rank}**\nWeekly XP: **${s.weeklyXP}** • Monthly XP: **${s.monthlyXP}**`,
      ).setThumbnail(member.displayAvatarURL({ size: 256 })),
    ],
    allowedMentions: { parse: [] },
  });
}
export async function openLevelConfigModal(i: ButtonInteraction) {
  if (!i.memberPermissions?.has(PermissionFlagsBits.Administrator))
    throw new UserError('Administrator required.');
  const key = `${i.guildId}:${i.user.id}`;
  const pending = pendingLevelConfig.get(key);
  if (
    !pending ||
    pending.expiresAt < Date.now() ||
    pending.value.version !== Number(i.customId.split(':')[2])
  ) {
    pendingLevelConfig.delete(key);
    await i.reply({
      content: 'XP settings expired. Run /level-config again.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  pendingLevelConfig.delete(key);
  const data = levelConfigSchema.parse(pending.value);
  const modal = new ModalBuilder()
    .setCustomId(`level:config:${pending.value.version}`)
    .setTitle('Craftland India XP configuration')
    .addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId('config')
          .setLabel('Editable XP configuration JSON')
          .setStyle(TextInputStyle.Paragraph)
          .setValue(JSON.stringify(data, null, 2))
          .setMaxLength(4000)
          .setRequired(true),
      ),
    );
  await i.showModal(modal);
}
export async function levelConfigModal(i: ModalSubmitInteraction) {
  await i.deferReply({ flags: MessageFlags.Ephemeral });
  if (!i.memberPermissions?.has(PermissionFlagsBits.Administrator))
    throw new UserError('Administrator required.');
  let data: unknown;
  try {
    data = JSON.parse(i.fields.getTextInputValue('config'));
  } catch {
    throw new UserError('Configuration must be valid JSON.');
  }
  const config = levelConfigSchema.parse(data);
  if (config.levelUpChannelId) {
    const ch = await i.guild!.channels.fetch(config.levelUpChannelId);
    if (
      !ch?.isSendable() ||
      !ch
        .permissionsFor(await i.guild!.members.fetchMe())
        ?.has([
          PermissionFlagsBits.ViewChannel,
          PermissionFlagsBits.SendMessages,
          PermissionFlagsBits.EmbedLinks,
        ])
    )
      throw new UserError(
        'Choose a text channel where the bot can send embeds.',
      );
  }
  await saveLevelConfig(
    i.guildId!,
    i.user.id,
    config,
    Number(i.customId.split(':')[2]),
  );
  await recalibrateLevels(i.guildId!, i.user.id);
  const synced = await syncGuildLevelRoles(i.client, i.guildId!);
  await auditNotification(
    i.client,
    i.guildId!,
    'LEVEL_CONFIGURATION_CHANGED',
    i.user.id,
    undefined,
    { config, synchronizedRoles: synced },
  );
  await i.editReply({
    embeds: [
      card(
        'XP configuration saved',
        `Formula changes recalculated. Role changes: ${synced.changed}; queued retries: ${synced.failed}. Weekly scheduling uses the existing /setup configure:true schedule.`,
      ),
    ],
  });
}
