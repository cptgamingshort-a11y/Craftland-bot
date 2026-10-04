import { EmbedBuilder, type Client } from 'discord.js';
import { DateTime } from 'luxon';
import { z } from 'zod';
import { gemini } from '../ai/gemini.js';
import { db } from '../database/client.js';
import { settings } from './configuration.js';
import { logError } from '../utils/errors.js';
import { audit } from './audit.js';

const promptSchema = z.object({ message: z.string().min(12).max(240) });
const fallbackPrompts = [
  'Share one small detail that makes a Craftland map enjoyable, and tell us why it works.',
  'What building skill would you like to practice next? Share an idea others can try too.',
  'Show a creation you are proud of and ask the community for one focused suggestion.',
  'If you could build one new map for the community, what would its main idea be?',
  'Share a useful Craftland tip that helped you improve a map or solve a building problem.',
];

function fallbackPrompt(date: string) {
  const day = DateTime.fromISO(date).day;
  return fallbackPrompts[day % fallbackPrompts.length]!;
}

export async function createDailyPrompt(
  guildId: string,
  actorId: string,
  date: string,
  stats: {
    approvedReviews: number;
    completedTasks: number;
    xpEarned: number;
    levelUps: number;
  },
) {
  const result = await gemini.generate(
    JSON.stringify({
      task: 'Write one friendly, specific daily discussion prompt for Craftland India creators. Invite members to share, learn, or help with a Craftland map. Do not add any numbers, statistics, member names, announcements of events, or facts not in DATA. Return only the requested JSON.',
      DATA: { date, previousDayCommunityActivity: stats },
    }),
    { type: 'daily_announcement', actorId, guildId },
    z.toJSONSchema(promptSchema),
  );
  if (!result.success) return fallbackPrompt(date);
  try {
    const message = promptSchema.parse(JSON.parse(result.text)).message;
    if (/\d|<@|https?:\/\/|@everyone|@here/i.test(message))
      return fallbackPrompt(date);
    return message.replace(/\s+/g, ' ').trim();
  } catch {
    return fallbackPrompt(date);
  }
}

export async function draftDailyAnnouncement(
  guildId: string,
  actorId: string,
  today = DateTime.now().setZone('Asia/Kolkata'),
) {
  const c = await settings(guildId);
  if (!c.channels.announcement) return null;

  const yesterday = today.minus({ days: 1 });
  const start = yesterday.startOf('day').toJSDate();
  const end = today.startOf('day').toJSDate();
  const [reviews, activities, xpTransactions, levelChanges] = await Promise.all(
    [
      db.review.findMany({ where: { decidedAt: { gte: start, lt: end } } }),
      db.activity.findMany({ where: { timestamp: { gte: start, lt: end } } }),
      db.xPTransaction.findMany({
        where: { createdAt: { gte: start, lt: end } },
      }),
      db.levelChange.findMany({
        where: {
          guildId,
          createdAt: { gte: start, lt: end },
        },
        select: { oldLevel: true, newLevel: true },
      }),
    ],
  );
  const stats = {
    approvedReviews: reviews.filter((review) => review.status === 'APPROVED')
      .length,
    completedTasks: activities.filter(
      (activity) => activity.type === 'task' && activity.status === 'APPROVED',
    ).length,
    xpEarned: xpTransactions.reduce(
      (total, transaction) =>
        total + (transaction.amount > 0 ? transaction.amount : 0),
      0,
    ),
    levelUps: levelChanges.filter((change) => change.newLevel > change.oldLevel)
      .length,
  };
  const prompt = await createDailyPrompt(
    guildId,
    actorId,
    today.toISODate()!,
    stats,
  );
  return {
    channelId: c.channels.announcement,
    date: today.toISODate()!,
    stats,
    embed: new EmbedBuilder()
      .setColor(0xc49a55)
      .setTitle('☀️ Craftland India • Daily Community Prompt')
      .setDescription(prompt)
      .addFields({
        name: 'Yesterday in the community',
        value: `🗺️ ${stats.approvedReviews} approved reviews  ·  ✅ ${stats.completedTasks} tasks\n✨ ${stats.xpEarned} XP earned  ·  🆙 ${stats.levelUps} level-ups`,
      })
      .setFooter({ text: 'Create. Share. Learn. Grow. • Asia/Kolkata' })
      .setTimestamp(today.toJSDate()),
  };
}

export async function publishDailyAnnouncement(
  client: Client,
  guildId: string,
  today = DateTime.now().setZone('Asia/Kolkata'),
) {
  const draft = await draftDailyAnnouncement(guildId, client.user!.id, today);
  if (!draft) return;
  const channel = await client.channels.fetch(draft.channelId);
  if (
    !channel ||
    !('guildId' in channel) ||
    channel.guildId !== guildId ||
    !channel.isSendable()
  )
    throw new Error('Configured announcement channel is unavailable.');

  const posted = await channel.send({
    embeds: [draft.embed],
    allowedMentions: { parse: [] },
  });
  try {
    await audit(client, guildId, client.user!.id, 'DAILY_AI_ANNOUNCEMENT_PUBLISHED', undefined, {
      date: draft.date,
      channelId: draft.channelId,
      messageId: posted.id,
      stats: draft.stats,
    });
  } catch (error) {
    logError('daily-announcement-audit', error);
  }
}
