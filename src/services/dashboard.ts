import express, { type Request } from 'express';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import {
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { PermissionFlagsBits, type Client } from 'discord.js';
import { env } from '../config/env.js';
import { db } from '../database/client.js';
import { databaseHealthCheck } from '../database/firebase.js';
import { settings, saveSettings } from './configuration.js';
import { settingsSchema } from '../config/settings.js';
import { validateSettings } from '../bot/commands/setup.js';
import { z } from 'zod';
import { logError, UserError } from '../utils/errors.js';
import { eligibilityFacts } from '../roles/service.js';
import { audit } from './audit.js';
const cookieName = 'craftland_session';
function cookie(req: Request, name: string) {
  return req.headers.cookie
    ?.split(';')
    .map((p) => p.trim())
    .find((p) => p.startsWith(`${name}=`))
    ?.slice(name.length + 1);
}
const hash = (value: string) =>
  createHash('sha256').update(value).digest('hex');
const sign = (value: string) =>
  createHmac('sha256', env.SESSION_SECRET).update(value).digest('hex');
function equal(a: string, b: string) {
  return (
    a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b))
  );
}
async function discord(path: string, token: string) {
  const res = await fetch(`https://discord.com/api/v10${path}`, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) throw new UserError('Discord authentication failed.');
  return res.json();
}
export function startDashboard(client: Client) {
  const app = express();
  app.disable('x-powered-by');
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'"],
          connectSrc: ["'self'"],
          imgSrc: ["'self'", 'data:'],
        },
      },
    }),
  );
  app.use(
    rateLimit({
      windowMs: 60000,
      limit: 60,
      standardHeaders: 'draft-8',
      legacyHeaders: false,
    }),
  );
  app.use(express.json({ limit: '48kb' }));
  const secure = env.NODE_ENV === 'production';
  const cookieOptions = {
    httpOnly: true,
    secure,
    sameSite: 'lax' as const,
    path: '/',
  };
  app.get('/health', async (_req, res) => {
    try {
      await databaseHealthCheck();
      res
        .status(client.isReady() ? 200 : 503)
        .json({ ready: client.isReady() });
    } catch {
      res.status(503).json({ ready: false });
    }
  });
  app.get('/auth/login', (_req, res) => {
    const state = `${randomBytes(24).toString('hex')}.${Date.now()}`;
    res.cookie('craftland_oauth', `${state}.${sign(state)}`, {
      ...cookieOptions,
      maxAge: 600000,
    });
    const url = new URL('https://discord.com/oauth2/authorize');
    url.search = new URLSearchParams({
      client_id: env.CLIENT_ID,
      redirect_uri: `${env.DASHBOARD_URL}/auth/callback`,
      response_type: 'code',
      scope: 'identify',
      state,
    }).toString();
    res.redirect(url.toString());
  });
  app.get('/auth/callback', async (req, res) => {
    try {
      const state = z.string().parse(req.query.state);
      const stored = cookie(req, 'craftland_oauth');
      const [nonce, time, signature] = stored?.split('.') ?? [];
      const expected = `${nonce}.${time}`;
      res.clearCookie('craftland_oauth', cookieOptions);
      if (
        !signature ||
        !equal(expected, state) ||
        !equal(signature, sign(expected)) ||
        Date.now() - Number(time) > 600000
      )
        throw new UserError('Invalid OAuth state.');
      const tokenResponse = await fetch(
        'https://discord.com/api/v10/oauth2/token',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            client_id: env.CLIENT_ID,
            client_secret: env.CLIENT_SECRET,
            grant_type: 'authorization_code',
            code: z.string().parse(req.query.code),
            redirect_uri: `${env.DASHBOARD_URL}/auth/callback`,
          }),
          signal: AbortSignal.timeout(10000),
        },
      );
      if (!tokenResponse.ok) throw new UserError('OAuth exchange failed.');
      const token = z
        .object({ access_token: z.string() })
        .parse(await tokenResponse.json());
      const user = z
        .object({ id: z.string() })
        .parse(await discord('/users/@me', token.access_token));
      const guild = await client.guilds.fetch(env.DISCORD_GUILD_ID);
      const member = await guild.members.fetch({ user: user.id, force: true });
      if (!member.permissions.has(PermissionFlagsBits.Administrator))
        throw new UserError(
          'Craftland India administrator permission required.',
        );
      const session = randomBytes(32).toString('hex');
      await db.dashboardSession.create({
        data: {
          hash: hash(session),
          discordId: user.id,
          expiresAt: new Date(Date.now() + 8 * 3600000),
        },
      });
      res.cookie(cookieName, session, {
        ...cookieOptions,
        maxAge: 8 * 3600000,
      });
      res.redirect('/');
    } catch (e) {
      logError('oauth', e);
      res
        .status(403)
        .send(
          'Authentication failed. Confirm your administrator role and OAuth redirect URL.',
        );
    }
  });
  app.use('/api', async (req, res, next) => {
    try {
      const session = cookie(req, cookieName);
      if (!session) throw new UserError('Login required.');
      const row = await db.dashboardSession.findUnique({
        where: { hash: hash(session) },
      });
      if (!row || row.expiresAt.getTime() < Date.now())
        throw new UserError('Session expired.');
      // Re-check permissions on every request; revoked staff access cannot reuse a session.
      const guild = await client.guilds.fetch(env.DISCORD_GUILD_ID);
      const m = await guild.members.fetch({ user: row.discordId, force: true });
      if (!m.permissions.has(PermissionFlagsBits.Administrator))
        throw new UserError('Administrator required.');
      if (
        req.method !== 'GET' &&
        (req.headers.origin !== new URL(env.DASHBOARD_URL).origin ||
          !equal(String(req.headers['x-csrf-token'] ?? ''), sign(session)))
      )
        throw new UserError('CSRF validation failed.');
      res.locals.actorId = row.discordId;
      res.locals.csrf = sign(session);
      next();
    } catch (e) {
      logError('dashboard-auth', e);
      res
        .status(403)
        .json({ error: 'Login with a Craftland India administrator account.' });
    }
  });
  app.get('/api/overview', async (_req, res) => {
    const guildId = env.DISCORD_GUILD_ID;
    await settings(guildId);
    const [
      members,
      active,
      points,
      reviews,
      reports,
      roles,
      boards,
      logs,
      config,
      summaries,
      memberCount,
      pendingReportCount,
    ] = await Promise.all([
      db.user.findMany({
        where: { guildId },
        orderBy: { lastActiveAt: 'desc' },
        take: 100,
      }),
      db.user.count({
        where: {
          guildId,
          lastActiveAt: { gte: new Date(Date.now() - 7 * 86400000) },
        },
      }),
      db.pointTransaction.aggregate({
        where: { guildId },
        _sum: { amount: true },
      }),
      db.review.findMany({
        where: { guildId },
        orderBy: { createdAt: 'desc' },
        take: 30,
      }),
      db.report.findMany({
        where: { guildId },
        orderBy: { createdAt: 'desc' },
        take: 30,
      }),
      db.roleConfiguration.findMany({
        where: { guildId },
        include: { requirement: true },
      }),
      db.leaderboard.findMany({
        where: { guildId },
        orderBy: { startsAt: 'desc' },
        take: 8,
      }),
      db.moderationAction.findMany({
        where: { guildId },
        orderBy: { createdAt: 'desc' },
        take: 30,
      }),
      db.botConfiguration.findUniqueOrThrow({ where: { guildId } }),
      db.auditLog.findMany({
        where: {
          guildId,
          action: {
            in: ['AI_RECOMMENDATION', 'AUTOMATIC_CONTRIBUTION_SUMMARY'],
          },
        },
        orderBy: { createdAt: 'desc' },
        take: 10,
      }),
      db.user.count({ where: { guildId } }),
      db.report.count({ where: { guildId, status: 'PENDING' } }),
    ]);
    res.json({
      csrf: res.locals.csrf,
      members,
      active,
      points: points._sum.amount ?? 0,
      reviews,
      reports,
      roles,
      boards,
      logs,
      config,
      summaries,
      memberCount,
      pendingReportCount,
    });
  });
  app.get('/api/member/:id', async (req, res) => {
    res.json(
      await eligibilityFacts(
        env.DISCORD_GUILD_ID,
        z
          .string()
          .regex(/^\d{17,20}$/)
          .parse(req.params.id),
      ),
    );
  });
  app.put('/api/config', async (req, res) => {
    const input = z
      .object({ version: z.number().int(), settings: settingsSchema })
      .parse(req.body);
    const guild = await client.guilds.fetch(env.DISCORD_GUILD_ID);
    await validateSettings(guild, input.settings);
    await saveSettings(
      guild.id,
      res.locals.actorId,
      input.settings,
      input.version,
    );
    await audit(
      client,
      guild.id,
      res.locals.actorId,
      'DASHBOARD_CONFIGURATION_CHANGED',
    );
    res.json({ ok: true });
  });
  app.put('/api/roles/:id', async (req, res) => {
    const roleId = z
      .string()
      .regex(/^\d{17,20}$/)
      .parse(req.params.id);
    const body = z
      .object({
        autoAssign: z.boolean(),
        autoRemove: z.boolean(),
        protected: z.boolean(),
        maintenanceDays: z.number().int().min(1).max(365).nullable(),
        minimumPoints: z.number().int().min(0).max(100000),
        minimumApprovedReviews: z.number().int().min(0).max(100000),
        minimumActiveDays: z.number().int().min(0).max(36500),
        minimumQuality: z.number().min(0).max(100).nullable(),
        maintenancePoints: z.number().int().min(0).max(100000).nullable(),
      })
      .parse(req.body);
    const guild = await client.guilds.fetch(env.DISCORD_GUILD_ID);
    const role = await guild.roles.fetch(roleId);
    const c = await settings(guild.id);
    const bot = await guild.members.fetchMe();
    if (
      !role ||
      role.managed ||
      role.id === guild.id ||
      role.position >= bot.roles.highest.position ||
      role.permissions.has(PermissionFlagsBits.Administrator)
    )
      throw new UserError('Unmanageable role.');
    const protectedRole =
      body.protected ||
      c.roles.staff.includes(roleId) ||
      role.permissions.has(
        [
          PermissionFlagsBits.ManageGuild,
          PermissionFlagsBits.ManageRoles,
          PermissionFlagsBits.ModerateMembers,
          PermissionFlagsBits.KickMembers,
          PermissionFlagsBits.BanMembers,
        ],
        false,
      );
    if (protectedRole && (body.autoAssign || body.autoRemove))
      throw new UserError('Staff roles cannot be automated.');
    await db.$transaction(async (tx) => {
      const r = await tx.roleConfiguration.upsert({
        where: { guildId_roleId: { guildId: guild.id, roleId } },
        create: {
          guildId: guild.id,
          roleId,
          name: role.name,
          autoAssign: body.autoAssign,
          autoRemove: body.autoRemove,
          protected: protectedRole,
          maintenanceDays: body.maintenanceDays,
        },
        update: {
          autoAssign: body.autoAssign,
          autoRemove: body.autoRemove,
          protected: protectedRole,
          maintenanceDays: body.maintenanceDays,
        },
      });
      const requirement = {
        minimumPoints: body.minimumPoints,
        minimumApprovedReviews: body.minimumApprovedReviews,
        minimumActiveDays: body.minimumActiveDays,
        minimumQuality: body.minimumQuality,
        maintenancePoints: body.maintenancePoints,
      };
      await tx.roleRequirement.upsert({
        where: { roleConfigurationId: r.id },
        create: { roleConfigurationId: r.id, ...requirement },
        update: requirement,
      });
      await tx.auditLog.create({
        data: {
          guildId: guild.id,
          actorId: res.locals.actorId,
          action: 'ROLE_CONFIGURATION_CHANGED',
          data: { roleId, ...body },
        },
      });
    });
    res.json({ ok: true });
  });
  app.post('/api/logout', async (req, res) => {
    const session = cookie(req, cookieName);
    if (session)
      await db.dashboardSession.deleteMany({ where: { hash: hash(session) } });
    res.clearCookie(cookieName, cookieOptions);
    res.json({ ok: true });
  });
  app.use(
    express.static(fileURLToPath(new URL('../../public/', import.meta.url))),
  );
  app.use(
    (
      error: unknown,
      _req: Request,
      res: express.Response,
      _next: express.NextFunction,
    ) => {
      logError('dashboard', error);
      res
        .status(
          error instanceof UserError || error instanceof z.ZodError ? 400 : 500,
        )
        .json({
          error:
            error instanceof UserError
              ? error.message
              : 'Request failed. Check values or retry.',
        });
    },
  );
  const server = app.listen(env.PORT, () =>
    console.log(`Dashboard listening on port ${env.PORT}`),
  );
  server.on('error', (error) => logError('dashboard-server', error));
  return () => server.close();
}
