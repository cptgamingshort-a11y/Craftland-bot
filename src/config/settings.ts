import { z } from 'zod';
const id = z
  .string()
  .regex(/^\d{17,20}$/)
  .or(z.literal(''));
export const settingsSchema = z.object({
  channels: z.object({
    welcome: id.default(''),
    announcement: id.default(''),
    leaderboard: id.default(''),
    review: id.default(''),
    log: id.default(''),
    rules: id.default(''),
    reports: id.default(''),
    botCommands: id.default(''),
    games: id.default(''),
    generalChat: id.default(''),
    doubtSolving: id.default(''),
  }),
  roles: z.object({
    member: id.default(''),
    bot: id.default(''),
    creator: id.default(''),
    reviewer: id.default(''),
    seniorReviewer: id.default(''),
    eventTeam: id.default(''),
    moderator: id.default(''),
    staff: z.array(id).max(25).default([]),
  }),
  welcomeEnabled: z.boolean().default(false),
  autoMemberRole: z.boolean().default(false),
  points: z
    .record(
      z.string().regex(/^[a-z_]{1,40}$/),
      z.number().int().min(0).max(100000),
    )
    .default({
      approved_review: 10,
      quality_contribution: 20,
      event: 10,
      helpful_report: 5,
      task: 10,
      map_submission: 10,
      moderation_assistance: 5,
    }),
  moderation: z
    .object({
      enabled: z.boolean().default(false),
      floodCount: z.number().int().min(3).max(100).default(8),
      windowSeconds: z.number().int().min(2).max(120).default(10),
      duplicateCount: z.number().int().min(2).max(20).default(4),
      mentionLimit: z.number().int().min(2).max(100).default(8),
      badWords: z.array(z.string().min(1).max(60)).max(200).default([]),
      timeoutMinutes: z.number().int().min(0).max(60).default(0),
    })
    .default({
      enabled: false,
      floodCount: 8,
      windowSeconds: 10,
      duplicateCount: 4,
      mentionLimit: 8,
      badWords: [],
      timeoutMinutes: 0,
    }),
  schedule: z
    .object({
      timezone: z.literal('Asia/Kolkata').default('Asia/Kolkata'),
      weeklyDay: z.number().int().min(1).max(7).default(1),
      weeklyHour: z.number().int().min(0).max(23).default(9),
      weeklyMinute: z.number().int().min(0).max(59).default(0),
      scanMinutes: z.number().int().min(5).max(1440).default(60),
      reminderHours: z.number().int().min(1).max(168).default(24),
      summaryHour: z.number().int().min(0).max(23).default(20),
      dailyAnnouncementHour: z.number().int().min(0).max(23).default(11),
    })
    .default({
      timezone: 'Asia/Kolkata',
      weeklyDay: 1,
      weeklyHour: 9,
      weeklyMinute: 0,
      scanMinutes: 60,
      reminderHours: 24,
      summaryHour: 20,
      dailyAnnouncementHour: 11,
    }),
});
export type Settings = z.infer<typeof settingsSchema>;
export function defaults(): Settings {
  return settingsSchema.parse({
    channels: {
      welcome: process.env.WELCOME_CHANNEL_ID || '',
      announcement: process.env.ANNOUNCEMENT_CHANNEL_ID || '',
      leaderboard: process.env.LEADERBOARD_CHANNEL_ID || '',
      review: process.env.REVIEW_CHANNEL_ID || '',
      log: process.env.LOG_CHANNEL_ID || '',
      generalChat: process.env.GENERAL_CHAT_CHANNEL_ID || '',
      doubtSolving: process.env.DOUBT_SOLVING_CHANNEL_ID || '',
    },
    roles: {},
  });
}
