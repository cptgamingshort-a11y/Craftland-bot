import { db } from '../database/client.js';
import { defaults, settingsSchema, type Settings } from '../config/settings.js';
import { UserError } from '../utils/errors.js';
import { logError } from '../utils/errors.js';
const SETTINGS_CACHE_MS = 60_000;
const settingsCache = new Map<
  string,
  { value: Settings; expiresAt: number }
>();
const settingsLoads = new Map<string, Promise<Settings>>();
const settingsEpoch = new Map<string, number>();

function refreshSettings(guildId: string) {
  const loading = settingsLoads.get(guildId);
  if (loading) return loading;
  const epoch = settingsEpoch.get(guildId) ?? 0;
  const next = (async () => {
    try {
      await db.guild.upsert({
        where: { id: guildId },
        create: { id: guildId },
        update: {},
      });
      const c = await db.botConfiguration.upsert({
        where: { guildId },
        create: { guildId, settings: defaults() },
        update: {},
      });
      const value = settingsSchema.parse(c.settings);
      if ((settingsEpoch.get(guildId) ?? 0) === epoch)
        settingsCache.set(guildId, { value, expiresAt: Date.now() + SETTINGS_CACHE_MS });
      return value;
    } finally {
      settingsLoads.delete(guildId);
    }
  })();
  settingsLoads.set(guildId, next);
  return next;
}

export async function settings(guildId: string): Promise<Settings> {
  const cached = settingsCache.get(guildId);
  if (cached) {
    if (cached.expiresAt <= Date.now() && !settingsLoads.has(guildId))
      void refreshSettings(guildId).catch((error) => logError('settings-refresh', error));
    return settingsSchema.parse(cached.value);
  }
  return settingsSchema.parse(await refreshSettings(guildId));
}
export async function saveSettings(
  guildId: string,
  actorId: string,
  input: unknown,
  expectedVersion?: number,
  extra?: (tx: typeof db) => Promise<void>,
) {
  const value = settingsSchema.parse(input);
  await db.$transaction(async (tx) => {
    const result = await tx.botConfiguration.updateMany({
      where: {
        guildId,
        ...(expectedVersion === undefined ? {} : { version: expectedVersion }),
      },
      data: { settings: value, version: { increment: 1 } },
    });
    if (result.count !== 1)
      throw new UserError(
        'Configuration changed. Restart setup or reload the dashboard.',
      );
    if (extra) await extra(tx);
    await tx.auditLog.create({
      data: { guildId, actorId, action: 'CONFIGURATION_CHANGED', data: value },
    });
  });
  settingsEpoch.set(guildId, (settingsEpoch.get(guildId) ?? 0) + 1);
  settingsCache.set(guildId, { value, expiresAt: Date.now() + SETTINGS_CACHE_MS });
  return value;
}
