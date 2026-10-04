import { DateTime } from 'luxon';
import { type Client } from 'discord.js';
import { db } from '../database/client.js';
import { settings } from './configuration.js';
import { scanRoles } from '../roles/service.js';
import { publishWeekly } from '../leaderboard/service.js';
import { aiAnswer } from '../ai/service.js';
import { notify, audit } from './audit.js';
import { logError } from '../utils/errors.js';
import { env } from '../config/env.js';
import { syncGuildLevelRoles } from '../xp/roles.js';
import { publishDailyAnnouncement } from './dailyAnnouncement.js';
// Firestore-backed job lease prevents ordinary overlap across bot instances.
async function runJob(key: string, work: () => Promise<void>) {
  const now = new Date();
  const lease = new Date(Date.now() + 30 * 60000);
  const acquired = await db.$transaction(async (tx) => {
    const prior = await tx.jobRun.findUnique({ where: { key } });
    if (
      prior?.completed ||
      (prior?.leaseUntil && new Date(prior.leaseUntil) > now)
    )
      return false;
    await tx.jobRun.upsert({
      where: { key },
      create: { key, completed: false, leaseUntil: lease },
      update: { leaseUntil: lease },
    });
    return true;
  });
  if (!acquired) return;
  try {
    await work();
    await db.jobRun.update({ where: { key }, data: { completed: true } });
  } catch (e) {
    await db.jobRun.update({ where: { key }, data: { leaseUntil: now } });
    throw e;
  }
}
async function job(key: string, work: () => Promise<void>) {
  try {
    await runJob(key, work);
  } catch (e) {
    logError(`job:${key}`, e);
  }
}
export function startScheduler(client: Client) {
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const guildId = env.DISCORD_GUILD_ID;
      const c = await settings(guildId);
      const now = DateTime.now().setZone(c.schedule.timezone);
      const date = now.toISODate();
      if (
        (c.channels.leaderboard || c.channels.announcement) &&
        (now.weekday > c.schedule.weeklyDay ||
          (now.weekday === c.schedule.weeklyDay &&
            (now.hour > c.schedule.weeklyHour ||
              (now.hour === c.schedule.weeklyHour &&
                now.minute >= c.schedule.weeklyMinute))))
      )
        await job(`weekly:${guildId}:${now.startOf('week').toISODate()}`, () =>
          publishWeekly(client, guildId),
        );
      if (
        c.channels.announcement &&
        now.hour >= c.schedule.dailyAnnouncementHour
      )
        await job(`daily-announcement:${guildId}:${date}`, () =>
          publishDailyAnnouncement(client, guildId, now),
        );
      const slot = Math.floor(
        now.toMillis() / (c.schedule.scanMinutes * 60000),
      );
      await job(`roles:${guildId}:${slot}`, () => scanRoles(client, guildId));
      await job(`level-roles:${guildId}:${slot}`, async () => {
        await syncGuildLevelRoles(client, guildId);
      });
      if (now.hour >= c.schedule.summaryHour)
        await job(`summary:${guildId}:${date}`, async () => {
          const types = await db.activity.groupBy({
            by: ['type', 'status'],
            where: {
              guildId,
              timestamp: { gte: now.startOf('day').toJSDate() },
            },
            _count: true,
          });
          const summary = await aiAnswer(
            'Summarize today’s contributions for staff.',
            types,
            {
              type: 'daily_contribution_summary',
              actorId: client.user!.id,
              guildId,
            },
          );
          await audit(
            client,
            guildId,
            client.user!.id,
            'AUTOMATIC_CONTRIBUTION_SUMMARY',
            undefined,
            { date, summary },
          );
          await notify(
            client,
            guildId,
            c.channels.log,
            'Daily contribution summary',
            summary,
          );
        });
      await job(
        `reminders:${guildId}:${Math.floor(now.toMillis() / 3600000)}`,
        async () => {
          const threshold = now
            .minus({ hours: c.schedule.reminderHours })
            .toJSDate();
          const reports = await db.report.findMany({
            where: {
              guildId,
              status: 'PENDING',
              createdAt: { lt: threshold },
              OR: [{ remindedAt: null }, { remindedAt: { lt: threshold } }],
            },
            take: 30,
          });
          if (reports.length) {
            await notify(
              client,
              guildId,
              c.channels.log,
              'Pending report reminders',
              reports
                .map(
                  (r) =>
                    `${r.id} • ${r.type} • Claimed: ${r.claimedBy ?? 'Nobody'}`,
                )
                .join('\n'),
            );
            await db.report.updateMany({
              where: { id: { in: reports.map((r) => r.id) } },
              data: { remindedAt: new Date() },
            });
          }
        },
      );
      await job(`maintenance:${guildId}:${date}`, async () => {
        await db.dashboardSession.deleteMany({
          where: { expiresAt: { lt: new Date() } },
        });
        await db.jobRun.deleteMany({
          where: {
            completed: true,
            leaseUntil: { lt: now.minus({ days: 60 }).toJSDate() },
          },
        });
      });
    } catch (e) {
      logError('scheduler', e);
    } finally {
      running = false;
    }
  };
  const timer = setInterval(() => void tick(), 60000);
  void tick();
  return () => clearInterval(timer);
}
