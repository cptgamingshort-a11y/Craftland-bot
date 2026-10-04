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
  type ModalSubmitInteraction,
  type ButtonInteraction,
  type GuildMember,
  type Client,
} from 'discord.js';
import { db } from '../../database/client.js';
import { settings, saveSettings } from '../../services/configuration.js';
import { ensureUser, memberStats, memberUser } from '../../services/members.js';
import { audit, auditNotification, notify } from '../../services/audit.js';
import { changePoints } from '../../services/points.js';
import { decideReview, submitReview } from '../../services/reviews.js';
import { assertRole, staffAllowed } from '../../roles/guards.js';
import {
  assignRole,
  eligibilityFacts,
  scanRoles,
} from '../../roles/service.js';
import { warn, timeout } from '../../moderation/service.js';
import { standings } from '../../leaderboard/service.js';
import { periodRange } from '../../leaderboard/calculations.js';
import { UserError } from '../../utils/errors.js';
import { startSetup, validateSettings } from './setup.js';
import { sendWelcome } from '../../services/welcome.js';
import { handleLevelCommand } from '../../xp/commands.js';
import { aiAnswer } from '../../ai/grounded.js';
import { communityAIFacts, memberAIFacts } from '../../ai/facts.js';
import { gemini } from '../../ai/gemini.js';
import { xpStats } from '../../xp/service.js';
import { awardActivityXP } from '../../xp/activity.js';
import { handleGameCommand } from '../../game/commands.js';
import {
  COMMUNITY_RULES_TITLE,
  communityRulesEmbed,
} from '../../services/communityRules.js';
type Interaction =
  ChatInputCommandInteraction | ModalSubmitInteraction | ButtonInteraction;
export async function requireStaff(
  i: Interaction,
  permission?: bigint,
  reviewer = false,
) {
  const actor = await i.guild!.members.fetch(i.user.id);
  const c = await settings(i.guildId!);
  if (
    !staffAllowed(
      actor.permissions.has(PermissionFlagsBits.Administrator),
      [...actor.roles.cache.keys()],
      [
        ...c.roles.staff,
        ...(reviewer
          ? [c.roles.reviewer, c.roles.seniorReviewer].filter(Boolean)
          : []),
      ],
    )
  )
    throw new UserError('Configured staff permission required.');
  if (permission && !actor.permissions.has(permission))
    throw new UserError('Your Discord permissions do not allow this action.');
  return actor;
}
async function admin(i: Interaction) {
  if (!i.memberPermissions?.has(PermissionFlagsBits.Administrator))
    throw new UserError('Administrator required.');
}
const embed = (title: string, body: string) =>
  new EmbedBuilder()
    .setColor(0xf0a52b)
    .setTitle(title.slice(0, 256))
    .setDescription(body.slice(0, 4000) || 'No records yet.')
    .setFooter({ text: 'Craftland India • Verified community records' })
    .setTimestamp();
async function response(i: Interaction, title: string, body: string) {
  await i.editReply({
    embeds: [embed(title, body)],
    allowedMentions: { parse: [] },
    components: [],
  });
}
async function target(i: ChatInputCommandInteraction): Promise<GuildMember> {
  const u = i.options.getUser('user') ?? i.user;
  const m = await i.guild!.members.fetch(u.id).catch(() => null);
  if (!m) throw new UserError('Member not found.');
  await memberUser(m);
  return m;
}
const reqText = (facts: Awaited<ReturnType<typeof eligibilityFacts>>) =>
  facts.roles
    .map(
      (r) =>
        `**${r.name}: ${r.eligible ? 'Eligible' : 'Not eligible'}**\n${r.checks.map((c) => `${c.met ? '✅' : '❌'} ${c.name}: ${c.actual < 0 ? 'unrated' : c.actual}/${c.required}`).join('\n')}`,
    )
    .join('\n\n') || 'No role requirements configured.';
export async function welcomeMessage(
  client: Client,
  m: GuildMember,
  test = false,
) {
  const c = await settings(m.guild.id);
  if (!test && !c.welcomeEnabled) return;
  await sendWelcome(client, m, c.channels.welcome);
  if (!test && c.autoMemberRole && c.roles.member) {
    const role = await m.guild.roles.fetch(c.roles.member);
    const bot = await m.guild.members.fetchMe();
    if (!role) throw new UserError('Member role is missing.');
    assertRole(bot, m, role);
    if (
      role.permissions.has(
        [
          PermissionFlagsBits.ManageGuild,
          PermissionFlagsBits.ManageRoles,
          PermissionFlagsBits.ModerateMembers,
          PermissionFlagsBits.BanMembers,
          PermissionFlagsBits.KickMembers,
        ],
        false,
      ) ||
      c.roles.staff.includes(role.id)
    )
      throw new UserError('Member auto-role cannot grant staff privileges.');
    await audit(client, m.guild.id, bot.id, 'WELCOME_ROLE_REQUESTED', m.id, {
      roleId: role.id,
    });
    await m.roles.add(role, 'Welcome Member role');
    await audit(client, m.guild.id, bot.id, 'ROLE_ASSIGNED', m.id, {
      roleId: role.id,
      source: 'welcome',
    });
  }
}
export async function handleCommand(i: ChatInputCommandInteraction) {
  const name = i.commandName;
  const sub = i.options.getSubcommand(false);
  const guildId = i.guildId!;
  const client = i.client;
  if (name === 'setup') return startSetup(i);
  if (name === 'game') return handleGameCommand(i);
  if (
    ['level', 'xp', 'level-role', 'level-config'].includes(name) ||
    (name === 'leaderboard' && sub === 'xp')
  )
    return handleLevelCommand(i, requireStaff);
  if (name === 'review' && sub === 'submit') {
    const m = new ModalBuilder()
      .setCustomId('review:submit')
      .setTitle('Craftland India map review');
    for (const [id, label] of [
      ['map', 'Map name'],
      ['creator', 'Creator'],
      ['code', 'Map code'],
      ['review', 'Your review'],
      ['result', 'Result'],
    ])
      m.addComponents(
        new ActionRowBuilder<TextInputBuilder>().addComponents(
          new TextInputBuilder()
            .setCustomId(id!)
            .setLabel(label!)
            .setStyle(
              id === 'review' ? TextInputStyle.Paragraph : TextInputStyle.Short,
            )
            .setRequired(true)
            .setMaxLength(id === 'review' ? 2000 : 200),
        ),
      );
    await i.showModal(m);
    return;
  }
  await i.deferReply({ flags: MessageFlags.Ephemeral });
  const c = await settings(guildId);
  if (name === 'welcome') {
    await admin(i);
    if (sub === 'setup') {
      c.channels.welcome = i.options.getChannel('channel', true).id;
      const r = i.options.getRole('member_role');
      if (r) c.roles.member = r.id;
      c.welcomeEnabled = true;
      c.autoMemberRole = Boolean(r);
      await validateSettings(i.guild!, c);
      await saveSettings(guildId, i.user.id, c);
    } else if (sub === 'disable') {
      c.welcomeEnabled = false;
      await saveSettings(guildId, i.user.id, c);
    } else await welcomeMessage(client, await target(i), true);
    return response(i, 'Welcome system', 'Settings applied / test sent.');
  }
  if (name === 'rules') {
    await admin(i);
    if (!c.channels.rules)
      throw new UserError('Configure the rules channel first.');
    const channel = await client.channels.fetch(c.channels.rules);
    if (
      !channel ||
      !('guildId' in channel) ||
      channel.guildId !== guildId ||
      !channel.isSendable()
    )
      throw new UserError('The configured rules channel is unavailable.');
    const payload = {
      content: '📌 **Please read the updated community rules before posting.**',
      embeds: [communityRulesEmbed(c)],
      allowedMentions: { parse: [] as const },
    };
    const previous = await channel.messages
      .fetch({ limit: 25 })
      .catch(() => null);
    const existing = previous?.find(
      (message) =>
        message.author.id === client.user!.id &&
        message.embeds.some((item) => item.title === COMMUNITY_RULES_TITLE),
    );
    const posted = existing
      ? await existing.edit(payload)
      : await channel.send(payload);
    await audit(
      client,
      guildId,
      i.user.id,
      'COMMUNITY_RULES_PUBLISHED',
      undefined,
      {
        channelId: channel.id,
        messageId: posted.id,
      },
    );
    return response(
      i,
      'Community rules updated',
      `The current rules are published in <#${channel.id}>. The bot will update its own rules post if you run this again.`,
    );
  }
  if (name === 'ai') {
    await requireStaff(i);
    if (sub === 'test') {
      const result = await gemini.generate('Reply with the single word OK.', {
        type: 'connection_test',
        actorId: i.user.id,
        guildId,
      });
      if (!result.success)
        return response(
          i,
          'Gemini AI unavailable',
          result.error ?? 'Configuration error.',
        );
      return response(
        i,
        '✅ Gemini AI is connected',
        `Model: ${result.model}\nStatus: Operational`,
      );
    }
    if (sub === 'analyze') {
      const m = await target(i);
      const facts = await memberAIFacts(m);
      return response(
        i,
        `Member Analysis • ${m.user.username}`,
        await aiAnswer(
          'Summarize this member and explain the deterministic role eligibility checks.',
          facts,
          { type: 'member_analysis', actorId: i.user.id, guildId },
        ),
      );
    }
    const facts = await communityAIFacts(
      guildId,
      sub === 'ask'
        ? i.options.getString('question', true)
        : 'weekly community summary',
    );
    const question =
      sub === 'ask'
        ? i.options.getString('question', true)
        : 'Summarize verified Craftland India community activity for this week.';
    return response(
      i,
      sub === 'summary'
        ? 'Craftland India • Weekly Summary'
        : 'Craftland India • AI Assistant',
      await aiAnswer(question, facts, {
        type: sub === 'ask' ? 'admin_question' : 'weekly_summary',
        actorId: i.user.id,
        guildId,
      }),
    );
  }
  if (name === 'role') {
    if (sub === 'eligibility') {
      const m = await target(i);
      return response(
        i,
        `Eligibility • ${m.user.username}`,
        reqText(await eligibilityFacts(guildId, m.id)),
      );
    }
    if (sub === 'info') {
      const r = await i.guild!.roles.fetch(i.options.getRole('role', true).id);
      if (!r) throw new UserError('Role missing.');
      return response(
        i,
        r.name,
        `ID: ${r.id}\nMembers cached: ${r.members.size}\nPosition: ${r.position}\nManaged: ${r.managed}\nAdministrator: ${r.permissions.has(PermissionFlagsBits.Administrator)}`,
      );
    }
    if (sub === 'view') {
      const r = await db.roleConfiguration.findUnique({
        where: {
          guildId_roleId: {
            guildId,
            roleId: i.options.getRole('role', true).id,
          },
        },
        include: { requirement: true },
      });
      return response(i, 'Requirements', JSON.stringify(r, null, 2));
    }
    if (sub === 'give' || sub === 'remove') {
      const actor = await requireStaff(i, PermissionFlagsBits.ManageRoles);
      const m = await target(i);
      const r = await i.guild!.roles.fetch(i.options.getRole('role', true).id);
      if (!r) throw new UserError('Role missing.');
      assertRole(await i.guild!.members.fetchMe(), m, r, actor);
      const reason = i.options.getString('reason', true);
      if (sub === 'give') await assignRole(client, m, r.id, actor);
      else {
        await audit(client, guildId, actor.id, 'ROLE_REMOVAL_REQUESTED', m.id, {
          roleId: r.id,
          reason,
        });
        await m.roles.remove(r, reason);
        await audit(client, guildId, actor.id, 'ROLE_REMOVED', m.id, {
          roleId: r.id,
          reason,
        });
      }
      return response(
        i,
        'Role updated',
        `${r.name} ${sub === 'give' ? 'assigned to' : 'removed from'} <@${m.id}>.`,
      );
    }
    await admin(i);
    if (sub === 'scan') {
      await scanRoles(client, guildId);
      return response(i, 'Role scan', 'Verified role scan completed.');
    }
    const roleId = i.options.getRole('role', true).id;
    const r = await i.guild!.roles.fetch(roleId);
    if (!r) throw new UserError('Role missing.');
    if (
      r.managed ||
      r.id === guildId ||
      r.permissions.has(PermissionFlagsBits.Administrator) ||
      r.position >= (await i.guild!.members.fetchMe()).roles.highest.position
    )
      throw new UserError('Protected or unmanageable role.');
    const privileged =
      r.permissions.has(
        [
          PermissionFlagsBits.ManageGuild,
          PermissionFlagsBits.ManageRoles,
          PermissionFlagsBits.ModerateMembers,
          PermissionFlagsBits.KickMembers,
          PermissionFlagsBits.BanMembers,
        ],
        false,
      ) || c.roles.staff.includes(roleId);
    const rc = await db.roleConfiguration.upsert({
      where: { guildId_roleId: { guildId, roleId } },
      create: { guildId, roleId, name: r.name, protected: privileged },
      update: { name: r.name },
    });
    if (sub === 'setup') {
      const protect =
        privileged || (i.options.getBoolean('protected') ?? false);
      const auto = i.options.getBoolean('automatic', true);
      const remove = i.options.getBoolean('auto_remove') ?? false;
      if (protect && (auto || remove))
        throw new UserError('Staff roles cannot be automated.');
      await db.roleConfiguration.update({
        where: { id: rc.id },
        data: {
          protected: protect,
          autoAssign: auto,
          autoRemove: remove,
          maintenanceDays: i.options.getInteger('maintenance_days'),
        },
      });
    } else if (sub === 'set') {
      const data = {
        minimumPoints: i.options.getInteger('points', true),
        minimumApprovedReviews: i.options.getInteger('reviews', true),
        minimumActiveDays: i.options.getInteger('active_days', true),
        minimumQuality: i.options.getNumber('quality'),
        maintenancePoints: i.options.getInteger('maintenance_points'),
      };
      await db.roleRequirement.upsert({
        where: { roleConfigurationId: rc.id },
        create: { roleConfigurationId: rc.id, ...data },
        update: data,
      });
    }
    await audit(
      client,
      guildId,
      i.user.id,
      'ROLE_CONFIGURATION_CHANGED',
      undefined,
      { roleId, sub },
    );
    return response(
      i,
      'Role configuration',
      'Saved. Automation uses these verified requirements.',
    );
  }
  if (name === 'review') {
    if (sub === 'approve' || sub === 'reject') {
      await requireStaff(i, undefined, true);
      const id = i.options.getString('id', true);
      await decideReview(
        guildId,
        id,
        i.user.id,
        sub === 'approve',
        i.options.getString('reason') ?? 'Approved',
        i.options.getNumber('quality') ?? undefined,
      );
      await auditNotification(
        client,
        guildId,
        `REVIEW_${sub.toUpperCase()}`,
        i.user.id,
        undefined,
        {
          reviewId: id,
          decision: sub,
          reason: i.options.getString('reason') ?? 'Approved',
          quality: i.options.getNumber('quality') ?? undefined,
        },
      );
      return response(i, 'Review decided', `Review ${id}: ${sub}.`);
    }
    const m = await target(i);
    const u = await memberUser(m);
    if (sub === 'stats') {
      const s = await memberStats(guildId, m.id);
      return response(
        i,
        'Review statistics',
        `Approved: ${s.approvedReviews}\nRejected: ${s.rejectedReviews}\nQuality: ${s.quality ?? 'Unrated'}`,
      );
    }
    const rows = await db.review.findMany({
      where: { guildId, userId: u.id },
      orderBy: { createdAt: 'desc' },
      take: 15,
    });
    return response(
      i,
      'Review history',
      rows
        .map(
          (r) =>
            `**${r.id}** • ${r.mapName} (${r.mapCode}) — ${r.status}\n${r.reason ?? ''}`,
        )
        .join('\n'),
    );
  }
  if (name === 'points') {
    if (sub === 'leaderboard') return showBoard(i, 'weekly');
    const m = await target(i);
    const u = await memberUser(m);
    if (sub === 'add' || sub === 'remove') {
      await requireStaff(i);
      const amount =
        i.options.getInteger('amount', true) * (sub === 'remove' ? -1 : 1);
      await changePoints(
        guildId,
        m.id,
        i.user.id,
        amount,
        i.options.getString('reason', true),
        `interaction:${i.id}`,
      );
      await auditNotification(
        client,
        guildId,
        'POINTS_CHANGED',
        i.user.id,
        m.id,
        {
          amount,
          reason: i.options.getString('reason', true),
        },
      );
      return response(
        i,
        'Points updated',
        `${amount > 0 ? '+' : ''}${amount} for <@${m.id}>.`,
      );
    }
    if (sub === 'history') {
      const rows = await db.pointTransaction.findMany({
        where: { guildId, userId: u.id },
        orderBy: { createdAt: 'desc' },
        take: 15,
      });
      return response(
        i,
        'Point history',
        rows
          .map(
            (r) =>
              `${r.amount > 0 ? '+' : ''}${r.amount} — ${r.reason} • ${r.createdAt.toISOString()}`,
          )
          .join('\n'),
      );
    }
    const s = await memberStats(guildId, m.id);
    return response(
      i,
      'Points',
      `<@${m.id}>\nTotal: **${s.points}**\nThis week: **${s.weeklyPoints}**`,
    );
  }
  if (name === 'leaderboard') {
    if (sub === 'history') {
      const rows = await db.leaderboard.findMany({
        where: { guildId },
        orderBy: { startsAt: 'desc' },
        take: 8,
      });
      return response(
        i,
        'Historical leaderboards',
        rows
          .map(
            (r) =>
              `**${r.startsAt.toISOString().slice(0, 10)}**\n${r.summary.slice(0, 350)}`,
          )
          .join('\n'),
      );
    }
    return showBoard(i, sub === 'monthly' ? 'monthly' : 'weekly');
  }
  if (name === 'member') {
    const m = await target(i);
    const f = await eligibilityFacts(guildId, m.id);
    const s = f.stats;
    const xp = await xpStats(guildId, m.id);
    const body = `<@${m.id}> • Joined: ${m.joinedAt?.toISOString().slice(0, 10) ?? 'Unknown'}\nRoles: ${m.roles.cache
      .filter((r) => r.id !== guildId)
      .map((r) => r.name)
      .join(', ')
      .slice(
        0,
        500,
      )}\n\nTotal points: **${s.points}** • Weekly: **${s.weeklyPoints}**\nLevel: **${xp.level}** • XP: **${xp.totalXP}** • Weekly XP: **${xp.weeklyXP}** • Rank: **#${xp.rank}**\nApproved reviews: ${s.approvedReviews} • Rejected: ${s.rejectedReviews}\nCompleted tasks: ${s.tasksCompleted} • Active contribution days: ${s.activeDays}\n\n${reqText(f)}\n\n**Recent contributions**\n${s.recentActivity.map((a) => `${a.type}: ${a.description.slice(0, 120)} (${a.points})`).join('\n')}`;
    return response(i, m.user.username, body);
  }
  if (name === 'warn' || name === 'timeout' || name === 'warnings') {
    const actor = await requireStaff(
      i,
      name === 'timeout' ? PermissionFlagsBits.ModerateMembers : undefined,
    );
    const m = await target(i);
    if (name === 'warnings') {
      const u = await memberUser(m);
      const rows = await db.warning.findMany({
        where: { guildId, userId: u.id },
        orderBy: { createdAt: 'desc' },
        take: 15,
      });
      return response(
        i,
        'Warnings',
        rows
          .map((r) => `${r.createdAt.toISOString()} — ${r.reason}`)
          .join('\n'),
      );
    }
    const reason = i.options.getString('reason', true);
    if (name === 'warn') await warn(client, m, actor, reason);
    else
      await timeout(
        client,
        m,
        actor,
        i.options.getInteger('minutes', true),
        reason,
      );
    return response(
      i,
      'Moderation complete',
      `${name} recorded for <@${m.id}>.`,
    );
  }
  if (name === 'clear') {
    await requireStaff(i, PermissionFlagsBits.ManageMessages);
    const channel = i.channel;
    const count = i.options.getInteger('count', true);
    if (!channel || !('bulkDelete' in channel))
      throw new UserError('Use a guild text channel.');
    if (
      !channel
        .permissionsFor(await i.guild!.members.fetchMe())
        ?.has(PermissionFlagsBits.ManageMessages)
    )
      throw new UserError('Bot requires Manage Messages here.');
    await audit(client, guildId, i.user.id, 'CLEAR_REQUESTED', undefined, {
      channelId: channel.id,
      count,
    });
    const deleted = await channel.bulkDelete(count, true);
    await audit(client, guildId, i.user.id, 'MESSAGES_CLEARED', undefined, {
      channelId: channel.id,
      count: deleted.size,
    });
    return response(
      i,
      'Messages cleared',
      `${deleted.size} recent messages removed.`,
    );
  }
  if (name === 'report' || name === 'reports') {
    if (name === 'report' && ['user', 'map', 'issue'].includes(sub!)) {
      const report = await db.report.create({
        data: {
          guildId,
          authorId: i.user.id,
          type: sub!,
          target:
            i.options.getUser('user')?.id ??
            i.options.getString('map_code') ??
            i.options.getString('target', true),
          description: i.options.getString('description', true),
        },
      });
      await audit(client, guildId, i.user.id, 'REPORT_CREATED', undefined, {
        reportId: report.id,
      });
      await notify(
        client,
        guildId,
        c.channels.reports,
        `New ${report.type} report`,
        `Report ID: ${report.id}\nReporter: <@${i.user.id}>\nTarget: ${report.target}\n\n${report.description}`,
      );
      return response(
        i,
        'Report received',
        `Report ID: ${report.id}. Staff will review it.`,
      );
    }
    await requireStaff(i);
    if (name === 'reports') {
      const rows = await db.report.findMany({
        where: { guildId, status: 'PENDING' },
        orderBy: { createdAt: 'asc' },
        take: 15,
      });
      return response(
        i,
        'Pending reports',
        rows
          .map(
            (r) =>
              `${r.id} • ${r.type} • ${r.target} • Claimed: ${r.claimedBy ?? 'Nobody'}`,
          )
          .join('\n'),
      );
    }
    const id = i.options.getString('id', true);
    const r = await db.report.findFirst({ where: { guildId, id } });
    if (!r) throw new UserError('Report not found.');
    if (sub === 'view')
      return response(
        i,
        `Report ${r.id}`,
        `${r.type} • ${r.status}\nTarget: ${r.target}\n${r.description}\nClaimed by: ${r.claimedBy ?? 'Nobody'}\nResolution: ${r.resolution ?? 'Pending'}`,
      );
    if (sub === 'claim') {
      const changed = await db.report.updateMany({
        where: {
          guildId,
          id,
          status: 'PENDING',
          OR: [{ claimedBy: null }, { claimedBy: i.user.id }],
        },
        data: { claimedBy: i.user.id },
      });
      if (!changed.count)
        throw new UserError('Report already claimed or closed.');
    } else {
      const approved = sub === 'resolve';
      const reason = i.options.getString('reason', true);
      await db.$transaction(async (tx) => {
        const changed = await tx.report.updateMany({
          where: {
            guildId,
            id,
            status: 'PENDING',
            OR: [{ claimedBy: null }, { claimedBy: i.user.id }],
          },
          data: {
            status: approved ? 'APPROVED' : 'REJECTED',
            resolvedBy: i.user.id,
            resolution: reason,
          },
        });
        if (!changed.count)
          throw new UserError(
            'Report closed or claimed by another staff member.',
          );
        if (approved && r.authorId !== i.user.id) {
          const u = await tx.user.upsert({
            where: { guildId_discordId: { guildId, discordId: r.authorId } },
            create: { guildId, discordId: r.authorId, username: r.authorId },
            update: {},
          });
          const points = c.points.helpful_report ?? 0;
          await tx.activity.create({
            data: {
              guildId,
              userId: u.id,
              type: 'helpful_report',
              description: reason,
              points,
              status: 'APPROVED',
              reviewerId: i.user.id,
              metadata: { reportId: id },
            },
          });
          if (points)
            await tx.pointTransaction.create({
              data: {
                guildId,
                userId: u.id,
                amount: points,
                actorId: i.user.id,
                reason: 'Helpful report',
                sourceKey: `report:${id}`,
              },
            });
        }
        await tx.auditLog.create({
          data: {
            guildId,
            actorId: i.user.id,
            action: 'REPORT_DECIDED',
            data: { reportId: id, approved, reason },
          },
        });
      });
    }
    await audit(
      client,
      guildId,
      i.user.id,
      `REPORT_${sub!.toUpperCase()}`,
      undefined,
      { reportId: id },
    );
    return response(i, 'Report updated', id);
  }
  if (name === 'activity') {
    if (sub === 'submit') {
      const type = i.options.getString('type', true);
      if (
        !Object.hasOwn(c.points, type) ||
        type === 'approved_review' ||
        type === 'helpful_report'
      )
        throw new UserError(
          `Allowed activity types: ${Object.keys(c.points)
            .filter((k) => !['approved_review', 'helpful_report'].includes(k))
            .join(', ')}`,
        );
      const u = await ensureUser(guildId, i.user.id, i.user.username);
      const a = await db.activity.create({
        data: {
          guildId,
          userId: u.id,
          type,
          description: i.options.getString('description', true),
          metadata: {},
        },
      });
      await audit(client, guildId, i.user.id, 'ACTIVITY_SUBMITTED', undefined, {
        activityId: a.id,
      });
      return response(
        i,
        'Contribution submitted',
        `ID: ${a.id}. Points require staff approval.`,
      );
    }
    if (sub === 'history') {
      const m = await target(i);
      const u = await memberUser(m);
      const rows = await db.activity.findMany({
        where: { guildId, userId: u.id },
        orderBy: { timestamp: 'desc' },
        take: 15,
      });
      return response(
        i,
        'Contribution history',
        rows
          .map(
            (a) =>
              `${a.id} • ${a.type} • ${a.status} • ${a.points}\n${a.description.slice(0, 150)}`,
          )
          .join('\n'),
      );
    }
    await requireStaff(i);
    const id = i.options.getString('id', true);
    const a = await db.activity.findFirst({
      where: { guildId, id },
      include: { user: true },
    });
    if (!a || a.type === 'map_review')
      throw new UserError('Use /review for reviews; contribution missing.');
    if (a.user.discordId === i.user.id)
      throw new UserError('You cannot approve your own contribution.');
    const approved = sub === 'approve';
    const points = approved ? (c.points[a.type] ?? 0) : 0;
    await db.$transaction(async (tx) => {
      const result = await tx.activity.updateMany({
        where: { guildId, id, status: 'PENDING' },
        data: {
          status: approved ? 'APPROVED' : 'REJECTED',
          points,
          reviewerId: i.user.id,
          timestamp: new Date(),
        },
      });
      if (!result.count) throw new UserError('Contribution already decided.');
      if (points)
        await tx.pointTransaction.create({
          data: {
            guildId,
            userId: a.userId,
            amount: points,
            actorId: i.user.id,
            reason: a.description,
            sourceKey: `activity:${id}`,
          },
        });
      await tx.auditLog.create({
        data: {
          guildId,
          actorId: i.user.id,
          action: 'ACTIVITY_DECIDED',
          targetId: a.user.discordId,
          data: {
            activityId: id,
            approved,
            points,
            reason: i.options.getString('reason') ?? '',
          },
        },
      });
    });
    await auditNotification(
      client,
      guildId,
      'ACTIVITY_DECIDED',
      i.user.id,
      a.user.discordId,
      {
        activityId: id,
        approved,
        points,
        reason: i.options.getString('reason') ?? '',
      },
    );
    return response(
      i,
      'Contribution decided',
      `${id} • ${sub} • ${points} points`,
    );
  }
  throw new UserError('Unknown command.');
}
async function showBoard(
  i: ChatInputCommandInteraction,
  period: 'weekly' | 'monthly',
) {
  const { start, end } = periodRange(period);
  const rows = await standings(i.guildId!, start, end);
  return response(
    i,
    `🏆 Craftland India • ${period}`,
    rows
      .slice(0, 15)
      .map((r, n) => `${n + 1}. <@${r.discordId}> — **${r.points} points**`)
      .join('\n'),
  );
}
export async function reviewModal(i: ModalSubmitInteraction) {
  await i.deferReply({ flags: MessageFlags.Ephemeral });
  const guildId = i.guildId!;
  const r = await submitReview(guildId, i.user.id, {
    mapName: i.fields.getTextInputValue('map'),
    creator: i.fields.getTextInputValue('creator'),
    mapCode: i.fields.getTextInputValue('code'),
    content: i.fields.getTextInputValue('review'),
    result: i.fields.getTextInputValue('result'),
  });
  const reviewAnalysis = await aiAnswer(
    'Summarize and categorize the submitted map review for staff consideration. Do not approve or reject it.',
    {
      map: r.mapName,
      creator: r.creator,
      mapCode: r.mapCode,
      review: r.content,
      submitterResult: r.result,
    },
    { type: 'map_review_analysis', actorId: i.user.id, guildId },
  );
  const c = await settings(guildId);
  const ch = await i.guild!.channels.fetch(c.channels.review).catch(() => null);
  if (ch?.isSendable())
    await ch.send({
      embeds: [
        embed(
          `Map review • ${r.mapName}`,
          `ID: ${r.id}\nReviewer: <@${i.user.id}>\nCreator: ${r.creator}\nCode: ${r.mapCode}\n${r.content}\nResult: ${r.result}\n\n**AI summary (advisory only):**\n${reviewAnalysis}`,
        ),
      ],
      components: [
        new ActionRowBuilder<ButtonBuilder>().addComponents(
          new ButtonBuilder()
            .setCustomId(`review:approve:${r.id}`)
            .setLabel('Approve')
            .setStyle(ButtonStyle.Success),
          new ButtonBuilder()
            .setCustomId(`review:reject:${r.id}`)
            .setLabel('Reject')
            .setStyle(ButtonStyle.Danger),
        ),
      ],
      allowedMentions: { parse: [] },
    });
  return response(
    i,
    'Review submitted',
    `ID: ${r.id}. Pending staff decision.`,
  );
}
export async function reviewButton(i: ButtonInteraction) {
  await requireStaff(i, undefined, true);
  const [, decision, id] = i.customId.split(':');
  const m = new ModalBuilder()
    .setCustomId(`review:decision:${decision}:${id}`)
    .setTitle(decision === 'approve' ? 'Approve review' : 'Reject review');
  m.addComponents(
    new ActionRowBuilder<TextInputBuilder>().addComponents(
      new TextInputBuilder()
        .setCustomId('reason')
        .setLabel('Decision reason')
        .setStyle(TextInputStyle.Paragraph)
        .setRequired(true)
        .setMaxLength(500),
    ),
  );
  if (decision === 'approve')
    m.addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId('quality')
          .setLabel('Quality 0–100 (optional)')
          .setStyle(TextInputStyle.Short)
          .setRequired(false)
          .setMaxLength(3),
      ),
    );
  await i.showModal(m);
}
export async function reviewDecisionModal(i: ModalSubmitInteraction) {
  await i.deferReply({ flags: MessageFlags.Ephemeral });
  await requireStaff(i, undefined, true);
  const [, , decision, id] = i.customId.split(':');
  let quality: number | undefined;
  if (decision === 'approve') {
    const raw = i.fields.getTextInputValue('quality');
    if (raw) {
      quality = Number(raw);
      if (!Number.isFinite(quality) || quality < 0 || quality > 100)
        throw new UserError('Quality must be 0–100.');
    }
  }
  const review = await decideReview(
    i.guildId!,
    id!,
    i.user.id,
    decision === 'approve',
    i.fields.getTextInputValue('reason'),
    quality,
  );
  if (decision === 'approve') {
    const author = await db.user.findUnique({ where: { id: review.userId } });
    if (author)
      await awardActivityXP(
        i.client,
        i.guildId!,
        author.discordId,
        `approved-review:${review.id}`,
        'Staff-approved Craftland map review',
        10,
      );
  }
  await auditNotification(i.client, i.guildId!, 'REVIEW_DECIDED', i.user.id, undefined, {
    reviewId: id,
    decision,
    quality,
    reason: i.fields.getTextInputValue('reason'),
  });
  return response(i, 'Review decided', `${id} • ${decision}`);
}
