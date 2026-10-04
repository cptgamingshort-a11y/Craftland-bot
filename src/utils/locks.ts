import { createHash, randomUUID } from 'node:crypto';
import { firestore } from '../database/firebase.js';
import { UserError } from './errors.js';
export const levelConfigLock = (guildId: string) => `levels:config:${guildId}`;
export const memberXPLock = (guildId: string, userId: string) =>
  `levels:member:${guildId}:${userId}`;
export async function transactionLock(
  _tx: unknown,
  _key: string,
  _shared = false,
) {
  return;
}
export async function withDatabaseLocks<T>(
  locks: { key: string; shared?: boolean }[],
  work: (assertHeld: () => void) => Promise<T>,
  tryOnly = false,
): Promise<T> {
  const owner = randomUUID();
  const guildId = process.env.DISCORD_GUILD_ID;
  if (!guildId)
    throw new UserError('DISCORD_GUILD_ID is required for a server lock.');
  const refs = locks.map(({ key }) =>
    firestore()
      .collection('guilds')
      .doc(guildId)
      .collection('_locks')
      .doc(createHash('sha256').update(key).digest('hex')),
  );
  let lost = false;
  for (let attempt = 0; attempt < 30; attempt++) {
    try {
      const acquired = await firestore().runTransaction(async (tx) => {
        const snaps = [];
        for (const ref of refs) snaps.push(await tx.get(ref));
        if (
          snaps.some(
            (s) =>
              s.exists &&
              s.get('owner') !== owner &&
              s.get('leaseUntil')?.toDate?.() > new Date(),
          )
        )
          return false;
        const leaseUntil = new Date(Date.now() + 10 * 60_000);
        for (const ref of refs) tx.set(ref, { owner, leaseUntil });
        return true;
      });
      if (acquired) break;
      if (tryOnly)
        throw new UserError(
          'This operation is already running for this server/member. Retry shortly.',
        );
      if (attempt === 29)
        throw new UserError(
          'Timed out waiting for another server operation to finish.',
        );
      await new Promise((resolve) =>
        setTimeout(resolve, Math.min(250 + attempt * 100, 2000)),
      );
    } catch (error) {
      if (error instanceof UserError) throw error;
      if (attempt === 29)
        throw new UserError('Could not acquire a Firestore operation lock.');
    }
  }
  const heartbeat = setInterval(() => {
    void firestore()
      .runTransaction(async (tx) => {
        const snaps = [];
        for (const ref of refs) snaps.push(await tx.get(ref));
        if (snaps.some((s) => s.get('owner') !== owner)) {
          lost = true;
          return;
        }
        for (const ref of refs)
          tx.set(ref, {
            owner,
            leaseUntil: new Date(Date.now() + 10 * 60_000),
          });
      })
      .catch(() => {
        lost = true;
      });
  }, 3 * 60_000);
  try {
    return await work(() => {
      if (lost)
        throw new UserError('Firestore operation lock was lost; retry.');
    });
  } finally {
    clearInterval(heartbeat);
    await firestore()
      .runTransaction(async (tx) => {
        const snaps = [];
        for (const ref of refs) snaps.push(await tx.get(ref));
        for (let i = 0; i < refs.length; i++)
          if (snaps[i]?.get('owner') === owner) tx.delete(refs[i]!);
      })
      .catch(() => {});
  }
}
