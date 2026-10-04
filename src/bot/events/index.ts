import {
  Events,
  MessageFlags,
  PermissionFlagsBits,
  type Client,
  type Interaction,
} from 'discord.js';
import { env } from '../../config/env.js';
import { queueMemberCountSync } from '../../services/memberCount.js';
import {
  handleCommand,
  requireStaff,
  reviewButton,
  reviewDecisionModal,
  reviewModal,
  welcomeMessage,
} from '../commands/handler.js';
import { setupInteraction } from '../commands/setup.js';
import { settings } from '../../services/configuration.js';
import {
  memberUser,
  restoreMemberRoles,
  saveMemberRoles,
} from '../../services/members.js';
import { db } from '../../database/client.js';
import { logError, UserError } from '../../utils/errors.js';
import { RateLimiter } from '../../utils/rateLimit.js';
import { SpamDetector } from '../../moderation/detection.js';
import { scamPromotionReason } from '../../moderation/scam.js';
import { imageScamReason } from '../../moderation/imageScan.js';
import { warn, timeout } from '../../moderation/service.js';
import { audit, auditNotification } from '../../services/audit.js';
import { assignBotRole } from '../../services/botJoin.js';
import { applyXP } from '../../xp/service.js';
import { syncUserLevelRoles } from '../../xp/roles.js';
import { awardActivityXP } from '../../xp/activity.js';
import { handleTempVoiceInteraction, onVoiceChannelChanged } from '../../services/tempVoice.js';
import {
  levelConfigModal,
  openLevelConfigModal,
} from '../../xp/commands.js';
import { communityAIReply, communityReplyKind } from '../../ai/community.js';
import {
  handleGamePrefix,
  handleMinesButton,
  handleHighLowButton,
  handleBlackjackButton,
  parseGameCommand,
} from '../../game/prefix.js';
const limit = new RateLimiter(12, 60000);
const aiLimit = new RateLimiter(3, 60000);
const spam = new SpamDetector();
const modLimit = new RateLimiter(1, 60000);
const voiceSessions = new Map<string, number>();
export async function interactionHandler(i: Interaction) {
  if (!i.isRepliable()) return;
  const isMinesButton = i.isButton() && i.customId.startsWith('game:mines:');
  const isHighLowButton = i.isButton() && i.customId.startsWith('game:highlow:');
  const isBlackjackButton = i.isButton() && i.customId.startsWith('game:blackjack:');
  const isGameButton = isMinesButton || isHighLowButton || isBlackjackButton;
  const isTempVoiceControl =
    (i.isButton() || i.isUserSelectMenu() || i.isStringSelectMenu() || i.isModalSubmit()) &&
    i.customId.startsWith('tv:');
  try {
    // Acknowledge Mines clicks before checking rate limits or touching Firestore.
    // This keeps the message component safely inside Discord's interaction deadline.
    if (isGameButton) {
      if (!i.inGuild() || i.guildId !== env.DISCORD_GUILD_ID)
        throw new UserError('This bot is configured for Craftland India only.');
      if (i.customId.split(':')[3] !== i.user.id)
        throw new UserError(isMinesButton
          ? 'This mines board belongs to another member.'
          : 'This game belongs to another member.');
      await i.deferUpdate();
      if (isMinesButton) await handleMinesButton(i);
      else if (isHighLowButton) await handleHighLowButton(i);
      else await handleBlackjackButton(i);
      return;
    }
    if (isTempVoiceControl) {
      if (!i.inGuild() || i.guildId !== env.DISCORD_GUILD_ID)
        throw new UserError('This bot is configured for Craftland India only.');
      if (!limit.allow(`${i.guildId}:${i.user.id}`))
        throw new UserError('Too many actions. Please wait a minute.');
      await handleTempVoiceInteraction(i);
      return;
    }
    if (!i.inGuild() || i.guildId !== env.DISCORD_GUILD_ID)
      throw new UserError('This bot is configured for Craftland India only.');
    // Automatic setup already defers immediately before doing Firestore or Discord
    // work. Do not make this path wait on the general settings read first: Discord
    // expires unacknowledged interactions after a few seconds.
    if (
      i.isChatInputCommand() &&
      i.commandName === 'setup' &&
      !i.options.getBoolean('configure')
    ) {
      if (!limit.allow(`${i.guildId}:${i.user.id}`))
        throw new UserError('Too many actions. Please wait a minute.');
      await handleCommand(i);
      return;
    }
    // Acknowledge XP and level commands before the shared settings/database read.
    // Firestore can take longer than Discord's three-second interaction deadline.
    const levelCommand =
      i.isChatInputCommand() &&
      (['level', 'xp', 'level-role', 'level-config'].includes(i.commandName) ||
        (i.commandName === 'leaderboard' &&
          i.options.getSubcommand(false) === 'xp'));
    if (levelCommand) {
      if (!limit.allow(`${i.guildId}:${i.user.id}`))
        throw new UserError('Too many actions. Please wait a minute.');
      await i.deferReply({ flags: MessageFlags.Ephemeral });
      await handleCommand(i);
      return;
    }
    if (i.isButton() && i.customId.startsWith('level:config-open:')) {
      await openLevelConfigModal(i);
      return;
    }
    if (i.isModalSubmit() && i.customId.startsWith('level:config:')) {
      await levelConfigModal(i);
      return;
    }
    // Game commands perform multiple Firestore reads/writes; acknowledge them
    // inside handleGameCommand before doing any database work.
    if (i.isChatInputCommand() && i.commandName === 'game') {
      if (!limit.allow(`${i.guildId}:${i.user.id}`))
        throw new UserError('Too many actions. Please wait a minute.');
      await handleCommand(i);
      return;
    }
    await settings(i.guildId);
    if (!limit.allow(`${i.guildId}:${i.user.id}`))
      throw new UserError('Too many actions. Please wait a minute.');
    if (i.isChatInputCommand()) {
      if (i.commandName === 'ai' && !aiLimit.allow(`${i.guildId}:${i.user.id}`))
        throw new UserError('AI limit reached. Wait a minute.');
      await handleCommand(i);
    } else if (
      (i.isButton() ||
        i.isChannelSelectMenu() ||
        i.isRoleSelectMenu() ||
        i.isModalSubmit()) &&
      i.customId.startsWith('setup:')
    )
      await setupInteraction(i);
    else if (i.isModalSubmit() && i.customId === 'review:submit')
      await reviewModal(i);
    else if (i.isModalSubmit() && i.customId.startsWith('review:decision:'))
      await reviewDecisionModal(i);
    else if (i.isButton() && /^review:(approve|reject):/.test(i.customId)) {
      await requireStaff(i, undefined, true);
      await reviewButton(i);
    } else throw new UserError('Unknown or expired interaction.');
  } catch (e) {
    logError(
      isGameButton ? 'game-button-interaction' : 'interaction',
      e,
    );
    const content =
      e instanceof UserError
        ? e.message
        : 'The action could not be completed. Staff can check the service logs and retry.';
    try {
      if (isGameButton && i.deferred)
        await i.followUp({
          content,
          flags: MessageFlags.Ephemeral,
          allowedMentions: { parse: [] },
        });
      else if (i.deferred || i.replied)
        await i.editReply({ content, embeds: [], components: [] });
      else await i.reply({ content, flags: MessageFlags.Ephemeral });
    } catch (replyError) {
      logError('interaction-reply', replyError);
    }
  }
}
export function registerEvents(client: Client) {
  client.on(Events.InteractionCreate, (i) => void interactionHandler(i));
  client.on(Events.GuildMemberAdd, (m) => {
    if (m.guild.id !== env.DISCORD_GUILD_ID) return;
    queueMemberCountSync(client);
    void (async () => {
      if (m.user.bot) {
        await assignBotRole(client, m);
        return;
      }
      try {
        const result = await restoreMemberRoles(m);
        if (result.restored.length || result.skipped.length)
          console.info(
            JSON.stringify({
              scope: 'member-role-restore',
              memberId: m.id,
              restoredRoleIds: result.restored,
              skippedRoleIds: result.skipped,
              time: new Date().toISOString(),
            }),
          );
      } catch (error) {
        logError('member-role-restore', error);
      }
      await settings(m.guild.id);
      await memberUser(m);
      await welcomeMessage(client, m);
    })().catch((e) => logError('member-add', e));
  });
  client.on(Events.GuildMemberRemove, (m) => {
    if (m.guild.id !== env.DISCORD_GUILD_ID) return;
    queueMemberCountSync(client);
    if (!m.user.bot)
      void saveMemberRoles(m)
        .then((roleIds) =>
          console.info(
            JSON.stringify({
              scope: 'member-role-save',
              memberId: m.id,
              roleIds,
              time: new Date().toISOString(),
            }),
          ),
        )
        .catch((error) => logError('member-role-save', error));
  });
  client.on(Events.VoiceStateUpdate, (before, after) => {
    if (after.guild.id !== env.DISCORD_GUILD_ID || after.member?.user.bot) return;
    void onVoiceChannelChanged(client, before, after).catch((error) =>
      logError('temporary-voice', error),
    );
    const key = `${after.guild.id}:${after.id}`;
    if (!before.channelId && after.channelId) {
      voiceSessions.set(key, Date.now());
      return;
    }
    if (before.channelId && !after.channelId) {
      const started = voiceSessions.get(key);
      voiceSessions.delete(key);
      if (
        started &&
        before.channelId !== before.guild.afkChannelId &&
        Date.now() - started >= 5 * 60_000
      )
        void awardActivityXP(
          client,
          before.guild.id,
          before.id,
          `voice:${before.id}:${started}`,
          'Completed five-minute voice participation',
        ).catch((error) => logError('voice-xp', error));
    }
  });
  client.on(Events.MessageCreate, (m) => {
    if (
      !m.guild ||
      m.guild.id !== env.DISCORD_GUILD_ID ||
      m.author.bot ||
      Boolean(m.webhookId) ||
      !m.member
    )
      return;
    void (async () => {
      const fastGameCommand = parseGameCommand(m.content);
      if (
        fastGameCommand &&
        m.attachments.size === 0 &&
        m.embeds.length === 0 &&
        !scamPromotionReason(m.content)
      ) {
        void recordMemberActivity(m).catch((error) =>
          logError('message-last-active', error),
        );
        try {
          await handleGamePrefix(m, fastGameCommand);
        } catch (error) {
          const content =
            error instanceof UserError
              ? error.message
              : 'The game action could not be completed. Please try again.';
          if (!(error instanceof UserError)) logError('game-prefix', error);
          await m
            .reply({ content, allowedMentions: { parse: [] }, failIfNotExists: false })
            .catch((editError) => logError('game-prefix-reply', editError));
        }
        return;
      }

      let c: Awaited<ReturnType<typeof settings>>;
      try {
        c = await settings(m.guild!.id);
      } catch (error) {
        // If Firestore is temporarily unavailable, keep direct bot conversations
        // usable without relying on channel configuration or moderation state.
        const mentionedBot = Boolean(
          client.user && m.mentions.users.has(client.user.id),
        );
        let repliedToBot = false;
        if (m.reference?.messageId && !mentionedBot) {
          const referenced = await m.fetchReference().catch(() => null);
          if (referenced && referenced.author.id !== client.user?.id) return;
          repliedToBot = referenced?.author.id === client.user?.id;
        }
        if (!mentionedBot && !repliedToBot) {
          logError('message-settings-degraded', error);
          return;
        }
        if (!m.content.trim() || scamPromotionReason(m.content)) return;
        if (await respondToMentionedPerson(m, client)) return;
        const typing = setInterval(() => {
          void m.channel
            .sendTyping()
            .catch((sendError) => logError('typing-indicator', sendError));
        }, 8000);
        try {
          void m.channel
            .sendTyping()
            .catch((sendError) => logError('typing-indicator', sendError));
          const reply = await communityAIReply(
            'chat',
            m.content,
            m.author.id,
            m.guild!.id,
            m.channelId,
          );
          if (reply)
            await m.reply({
              content: reply,
              allowedMentions: { parse: [] },
              failIfNotExists: false,
            });
        } finally {
          clearInterval(typing);
        }
        return;
      }
      const privileged =
        m.member!.permissions.has(
          [
            PermissionFlagsBits.Administrator,
            PermissionFlagsBits.ManageMessages,
          ],
          false,
        ) || c.roles.staff.some((r) => m.member!.roles.cache.has(r));
      const textScamReason = privileged
        ? null
        : scamPromotionReason(
            [
              m.content,
              ...m.embeds.flatMap((embed) =>
                [embed.title, embed.description, embed.url].filter(Boolean),
              ),
              ...m.attachments.map((attachment) => attachment.name),
            ].join(' '),
          );
      const publicChannel =
        'permissionsFor' in m.channel &&
        (m.channel
          .permissionsFor(m.guild!.roles.everyone)
          ?.has(PermissionFlagsBits.ViewChannel) ??
          false);
      const scamReason = textScamReason || (privileged || !publicChannel
        ? null
        : await imageScamReason(m.guild!.id, m.content, m.attachments.values()));
      if (scamReason) {
        if (!m.deletable) return;
        await m.delete();
        await audit(
          client,
          m.guild!.id,
          client.user!.id,
          'SCAM_MESSAGE_DELETED',
          m.author.id,
          { messageId: m.id, reason: scamReason },
        );
        return;
      }
      if (await respondToMentionedPerson(m, client)) return;
      const gameCommand = parseGameCommand(m.content);
      if (gameCommand) {
        void recordMemberActivity(m).catch((error) =>
          logError('message-last-active', error),
        );
        try {
          await handleGamePrefix(m, gameCommand);
        } catch (error) {
          if (error instanceof UserError)
            await m.reply({
              content: error.message,
              allowedMentions: { parse: [] },
            });
          else logError('game-prefix', error);
        }
        return;
      }

      const reason = privileged
        ? null
        : spam.inspect(
            `${m.guildId}:${m.author.id}`,
            m.content,
            m.mentions.users.size +
              m.mentions.roles.size +
              (m.mentions.everyone ? 1 : 0),
            c.moderation,
          );
      void recordMessageActivity(client, m, reason).catch((error) =>
        logError('message-activity', error),
      );

      if (reason) {
        if (!privileged && modLimit.allow(`${m.guildId}:${m.author.id}`)) {
          await warn(client, m.member!, undefined, reason);
          if (m.deletable) {
            await audit(
              client,
              m.guild!.id,
              client.user!.id,
              'SPAM_DELETE_REQUESTED',
              m.author.id,
              { messageId: m.id, reason },
            );
            await m.delete();
            await audit(
              client,
              m.guild!.id,
              client.user!.id,
              'SPAM_MESSAGE_DELETED',
              m.author.id,
              { messageId: m.id, reason },
            );
          }
          if (c.moderation.timeoutMinutes > 0)
            await timeout(
              client,
              m.member!,
              undefined,
              c.moderation.timeoutMinutes,
              reason,
            );
        }
        return;
      }

      const mentionedBot = Boolean(
        client.user && m.mentions.users.has(client.user.id),
      );
      let repliedToBot = false;
      if (m.reference?.messageId && !mentionedBot) {
        const referenced = await m.fetchReference().catch(() => null);
        if (referenced && referenced.author.id !== client.user!.id) return;
        repliedToBot = referenced?.author.id === client.user!.id;
      }
      const kind = communityReplyKind(
        m.channelId,
        {
          generalChat: c.channels.generalChat,
          doubtSolving: c.channels.doubtSolving,
          games: c.channels.games,
        },
        m.content,
        mentionedBot || repliedToBot,
      );
      if (!kind || !m.content.trim()) return;
      const typing = setInterval(() => {
        void m.channel
          .sendTyping()
          .catch((error) => logError('typing-indicator', error));
      }, 8000);
      let reply: string | null;
      try {
        void m.channel
          .sendTyping()
          .catch((error) => logError('typing-indicator', error));
        reply = await communityAIReply(
          kind,
          m.content,
          m.author.id,
          m.guild!.id,
          m.channelId,
        );
      } finally {
        clearInterval(typing);
      }
      if (reply) {
        const sent = await m.reply({
          content: reply,
          allowedMentions: { parse: [] },
          failIfNotExists: false,
        });
        await auditNotification(
          client,
          m.guild!.id,
          'AI_COMMUNITY_REPLY',
          m.author.id,
          undefined,
          {
            kind,
            channelId: m.channelId,
            sourceMessageId: m.id,
            replyMessageId: sent.id,
          },
        );
      }
    })().catch((e) => logError('message-handler', e));
  });
  client.on(Events.Error, (e) => logError('discord-client', e));
  client.on(Events.Warn, (w) =>
    console.warn(
      JSON.stringify({ scope: 'discord-warning', message: w.slice(0, 500) }),
    ),
  );
}

async function respondToMentionedPerson(
  message: import('discord.js').Message,
  client: Client,
) {
  if (
    message.attachments.size > 0 ||
    message.embeds.length > 0 ||
    !/\b(?:isse|is se|in se|us se|unse|usko|unko)\b.{0,35}\b(?:baat|talk|chat)\b|\b(?:baat|talk|chat)\b.{0,35}\b(?:isse|is se|in se|us se|unse|usko|unko)\b/i.test(message.content)
  )
    return false;
  const target = [...message.mentions.users.values()].find(
    (user) => user.id !== client.user?.id && !user.bot,
  );
  if (!target) return false;

  let targetMessage: string | undefined;
  if ('messages' in message.channel) {
    const recent = await message.channel.messages
      .fetch({ limit: 20, before: message.id })
      .catch((error) => {
        logError('directed-chat-history', error);
        return null;
      });
    targetMessage = recent?.find(
      (candidate) =>
        candidate.author.id === target.id &&
        candidate.content.trim().length > 0 &&
        !scamPromotionReason(candidate.content),
    )?.content;
  }

  const targetName = message.guild?.members.cache.get(target.id)?.displayName ?? target.username;
  const reply = await communityAIReply(
    'chat',
    message.content,
    message.author.id,
    message.guild!.id,
    message.channelId,
    {
      memoryUserId: target.id,
      targetName,
      targetMessage,
    },
  );
  if (reply)
    await message.reply({
      content: reply,
      allowedMentions: { users: [target.id], parse: [] },
      failIfNotExists: false,
    });
  return true;
}

async function recordMessageActivity(
  client: Client,
  message: import('discord.js').Message,
  spamReason: string | null,
) {
  let userId: string | undefined;
  try {
    const user = await memberUser(message.member!);
    userId = user.id;
  } catch (error) {
    logError('message-last-active', error);
  }

  const activityWrite = userId
    ? db.user.update({
        where: { id: userId },
        data: { lastActiveAt: new Date() },
      })
    : Promise.resolve();
  const xpWrite = applyXP({
    guildId: message.guild!.id,
    discordId: message.author.id,
    actorId: message.author.id,
    sourceKey: `message:${message.id}`,
    source: 'message',
    reason: 'Message activity',
    message: {
      content: message.content,
      channelId: message.channelId,
      spamReason,
      bot: message.author.bot,
      system: message.system,
      webhook: Boolean(message.webhookId),
    },
  });
  const [activity, xp] = await Promise.allSettled([activityWrite, xpWrite]);
  if (activity.status === 'rejected')
    logError('message-last-active', activity.reason);
  if (xp.status === 'rejected') {
    logError('message-xp', xp.reason);
    return;
  }
  if (xp.value.changed)
    await syncUserLevelRoles(client, message.guild!.id, message.author.id);
}

async function recordMemberActivity(message: import('discord.js').Message) {
  const user = await memberUser(message.member!);
  await db.user.update({
    where: { id: user.id },
    data: { lastActiveAt: new Date() },
  });
}
