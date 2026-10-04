/* eslint-disable @typescript-eslint/no-explicit-any */
/** Guild-scoped Firestore repository preserving the service API. */
import { randomUUID } from 'node:crypto';
import { createHash } from 'node:crypto';
import { closeFirebase, firestore } from './firebase.js';
import { Timestamp } from 'firebase-admin/firestore';
import { metadata } from './metadata.js';
import type { Documents } from './models.js';
import { env } from '../config/env.js';

type Model = keyof Documents;
type Row = Record<string, any>;
type Query = Record<string, any>;
type Delegate = {
  findMany(args?: Query): Promise<Row[]>;
  findFirst(args?: Query): Promise<Row | null>;
  findFirstOrThrow(args?: Query): Promise<Row>;
  findUnique(args: Query): Promise<Row | null>;
  findUniqueOrThrow(args: Query): Promise<Row>;
  create(args: Query): Promise<Row>;
  createMany(args: Query): Promise<{ count: number }>;
  upsert(args: Query): Promise<Row>;
  update(args: Query): Promise<Row>;
  updateMany(args: Query): Promise<{ count: number }>;
  delete(args: Query): Promise<Row>;
  deleteMany(args?: Query): Promise<{ count: number }>;
  count(args?: Query): Promise<number>;
  aggregate(args?: Query): Promise<Row>;
  groupBy(args: Query): Promise<Row[]>;
};
type RepositoryClient = Record<Model, Delegate> & {
  $transaction<T>(work: (tx: RepositoryClient) => Promise<T>): Promise<T>;
  $connect(): Promise<void>;
  $disconnect(): Promise<void>;
};
const aliases: Record<string, string> = { xPTransaction: 'xpTransactions' };
const collectionName = (model: string) =>
  aliases[model] ?? `${model[0]!.toLowerCase()}${model.slice(1)}s`;
const assertId = (value: unknown, label: string) => {
  if (typeof value !== 'string' || !/^[\w-]{1,128}$/.test(value))
    throw new Error(`Invalid ${label}.`);
  return value;
};
function guildOf(model: string, args: Query, context?: string) {
  const where = args.where ?? {};
  const guildId =
    where.guildId ??
    (model === 'guild' ? where.id : undefined) ??
    where.guildId_discordId?.guildId ??
    where.guildId_userId?.guildId ??
    where.guildId_sourceKey?.guildId ??
    where.guildId_roleId?.guildId ??
    where.guildId_level?.guildId ??
    args.data?.guildId ??
    context ??
    env.DISCORD_GUILD_ID;
  if (model === 'guild') return assertId(guildId, 'guildId');
  return assertId(guildId, 'guildId');
}
function primary(model: Model, data: Row) {
  const field = (metadata as any)[model]?.primary ?? 'id';
  if (data[field]) return String(data[field]);
  const uniques: string[][] = (metadata as any)[model]?.unique ?? [];
  const unique = uniques.find(
    (fields) =>
      !fields.includes(field) &&
      fields.every((key) => data[key] !== undefined && data[key] !== null),
  );
  if (unique)
    return `u-${createHash('sha256')
      .update(JSON.stringify(unique.map((k) => data[k])))
      .digest('hex')
      .slice(0, 32)}`;
  return randomUUID();
}
function compare(actual: any, expected: any): boolean {
  if (
    expected &&
    typeof expected === 'object' &&
    !(expected instanceof Date) &&
    !Array.isArray(expected)
  ) {
    const entries = Object.entries(expected);
    const operators = new Set([
      'equals',
      'in',
      'notIn',
      'not',
      'gt',
      'gte',
      'lt',
      'lte',
      'contains',
    ]);
    if (!entries.some(([key]) => operators.has(key)))
      return entries.every(([key, value]) => compare(actual?.[key], value));
    return entries.every(([op, value]) => {
      if (op === 'equals') return compare(actual, value);
      if (op === 'in') return (value as any[]).includes(actual);
      if (op === 'notIn') return !(value as any[]).includes(actual);
      if (op === 'not') return !compare(actual, value);
      if (op === 'gt') return actual > (value as any);
      if (op === 'gte') return actual >= (value as any);
      if (op === 'lt') return actual < (value as any);
      if (op === 'lte') return actual <= (value as any);
      if (op === 'contains') return String(actual).includes(String(value));
      return false;
    });
  }
  return actual instanceof Date && expected instanceof Date
    ? actual.getTime() === expected.getTime()
    : actual === expected;
}
function matches(row: Row, where: Query = {}): boolean {
  return Object.entries(where).every(([key, value]) => {
    if (key === 'AND')
      return (Array.isArray(value) ? value : [value]).every((w) =>
        matches(row, w),
      );
    if (key === 'OR') return (value as Query[]).some((w) => matches(row, w));
    if (key === 'NOT') return !matches(row, value);
    if (
      key.includes('_') &&
      value &&
      typeof value === 'object' &&
      !(value instanceof Date)
    )
      return Object.entries(value).every(([field, expected]) =>
        compare(row[field], expected),
      );
    if (key === 'metadata' && value?.path) {
      const got = value.path.reduce(
        (v: any, part: string) => v?.[part],
        row.metadata,
      );
      return compare(got, value.equals);
    }
    if (
      value &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      !(value instanceof Date)
    ) {
      if ('guildId' in value && row[key] === undefined) return false;
      if (key === 'user' && value.discordId)
        return compare(row.user?.discordId, value.discordId);
    }
    return compare(row[key], value);
  });
}
function applyData(old: Row, data: Row) {
  const next = { ...old };
  for (const [key, value] of Object.entries(data)) {
    if (key === 'increment') continue;
    if (
      value &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      !(value instanceof Date)
    ) {
      if ('increment' in value) next[key] = (next[key] ?? 0) + value.increment;
      else if ('decrement' in value)
        next[key] = (next[key] ?? 0) - value.decrement;
      else if ('set' in value) next[key] = value.set;
      else next[key] = value;
    } else next[key] = value;
  }
  if ('updatedAt' in next) next.updatedAt = new Date();
  return next;
}
class Unit {
  private staged: Array<{
    ref: FirebaseFirestore.DocumentReference;
    data: Row;
    merge: boolean;
    create?: boolean;
  }> = [];
  constructor(private readonly tx?: FirebaseFirestore.Transaction) {}
  private ref(model: Model, guildId: string, id: string) {
    const root = firestore().collection('guilds').doc(guildId);
    return model === 'guild'
      ? root
      : root.collection(collectionName(model)).doc(id);
  }
  private async all(
    model: Model,
    guildId: string,
    where: Query = {},
  ): Promise<Row[]> {
    const root = firestore().collection('guilds').doc(guildId);
    let query: FirebaseFirestore.Query = root.collection(collectionName(model));
    for (const [field, condition] of Object.entries(where)) {
      if (
        field === 'guildId' ||
        ['AND', 'OR', 'NOT', 'metadata', 'user'].includes(field) ||
        field.includes('_') ||
        condition === undefined
      )
        continue;
      if (
        condition === null ||
        ['string', 'number', 'boolean'].includes(typeof condition) ||
        condition instanceof Date
      )
        query = query.where(field, '==', condition);
      else if (
        condition &&
        typeof condition === 'object' &&
        !Array.isArray(condition) &&
        !(condition instanceof Date)
      ) {
        const ops: Record<string, FirebaseFirestore.WhereFilterOp> = {
          equals: '==',
          gt: '>',
          gte: '>=',
          lt: '<',
          lte: '<=',
          in: 'in',
          notIn: 'not-in',
        };
        for (const [op, value] of Object.entries(condition))
          if (ops[op] && value !== undefined)
            query = query.where(field, ops[op], value);
      }
    }
    const snap =
      model === 'guild'
        ? await (this.tx ? this.tx.get(root) : root.get())
        : await (this.tx ? this.tx.get(query) : query.get());
    if (model === 'guild')
      return (snap as FirebaseFirestore.DocumentSnapshot).exists
        ? [
            {
              ...(snap as FirebaseFirestore.DocumentSnapshot).data(),
              id: guildId,
            },
          ]
        : [];
    const normalize = (value: any): any =>
      value instanceof Timestamp
        ? value.toDate()
        : Array.isArray(value)
          ? value.map(normalize)
          : value && typeof value === 'object'
            ? Object.fromEntries(
                Object.entries(value).map(([k, v]) => [k, normalize(v)]),
              )
            : value;
    const rows = (snap as FirebaseFirestore.QuerySnapshot).docs.map((d) => ({
      ...normalize(d.data()),
      id: d.id,
    }));
    if (model === 'userXP') {
      const users = await this.all('user', guildId);
      const byId = new Map(users.map((u) => [u.id, u]));
      for (const row of rows) row.user = byId.get(row.userId);
    }
    return rows.filter((r) => matches(r, where));
  }
  private async related(
    model: Model,
    row: Row,
    guildId: string,
    include: Query = {},
  ) {
    const out = { ...row };
    if ((include.user || include.requirement) && row.userId) {
      const users = await this.all('user', guildId);
      out.user = users.find((u) => u.id === row.userId);
    }
    if (include.requirement && model === 'roleConfiguration') {
      const reqs = await this.all('roleRequirement', guildId);
      out.requirement =
        reqs.find((r) => r.roleConfigurationId === row.id) ?? null;
    }
    if (include.user && model === 'userXP') {
      const users = await this.all('user', guildId);
      out.user = users.find((u) => u.id === row.userId);
    }
    return out;
  }
  delegate<K extends Model>(model: K, guildId: string): any {
    // Delegate callbacks below are closures over this Unit instance.
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const unit = this;
    const getAll = async (where: Query = {}) => unit.all(model, guildId, where);
    const findMany = async (args: Query = {}) => {
      let rows = await getAll(args.where);
      const order = args.orderBy
        ? Array.isArray(args.orderBy)
          ? args.orderBy
          : [args.orderBy]
        : [];
      rows.sort((a, b) => {
        for (const o of order) {
          const [key, dir] = Object.entries(o)[0]!;
          const av = a[key],
            bv = b[key];
          const cmp =
            av instanceof Date
              ? av.getTime() - new Date(bv).getTime()
              : av > bv
                ? 1
                : av < bv
                  ? -1
                  : 0;
          if (cmp) return dir === 'desc' ? -cmp : cmp;
        }
        return 0;
      });
      if (args.skip) rows = rows.slice(args.skip);
      if (args.take !== undefined) rows = rows.slice(0, args.take);
      return Promise.all(
        rows.map((r) => unit.related(model, r, guildId, args.include)),
      );
    };
    const findUnique = async (args: Query) => {
      const unique = model === 'gameAccount'
        ? args.where?.guildId_userId
        : model === 'gameTransaction'
          ? args.where?.guildId_sourceKey
          : undefined;
      if (unique) {
        const id = primary(model, unique);
        const ref = unit.ref(model, guildId, id);
        const snap = unit.tx ? await unit.tx.get(ref) : await ref.get();
        if (!snap.exists) return null;
        const normalize = (value: any): any =>
          value instanceof Timestamp
            ? value.toDate()
            : Array.isArray(value)
              ? value.map(normalize)
              : value && typeof value === 'object'
                ? Object.fromEntries(Object.entries(value).map(([key, child]) => [key, normalize(child)]))
                : value;
        return { ...normalize(snap.data()), id: snap.id };
      }
      return (await findMany({ where: args.where, take: 1, include: args.include }))[0] ?? null;
    };
    const put = async (data: Row, merge = false) => {
      const shaped = { ...((metadata as any)[model]?.defaults ?? {}), ...data };
      for (const [k, v] of Object.entries(shaped))
        if (v === '$now') shaped[k] = new Date();
      if (shaped.guildId !== undefined && shaped.guildId !== guildId)
        throw new Error('Cross-guild write rejected.');
      const id = primary(model, shaped);
      if (model !== 'guild') shaped.id ??= id;
      const ref = unit.ref(model, guildId, id);
      if (unit.tx)
        unit.staged.push({ ref, data: shaped, merge, create: !merge });
      else if (merge) await ref.set(shaped, { merge: true });
      else await ref.create(shaped);
      return { ...shaped };
    };
    return {
      findMany,
      findFirst: async (a: Query = {}) =>
        (await findMany({ ...a, take: 1 }))[0] ?? null,
      findFirstOrThrow: async (a: Query = {}) => {
        const r = await (async () => (await findMany({ ...a, take: 1 }))[0])();
        if (!r) throw new Error(`${String(model)} not found`);
        return r;
      },
      findUnique,
      findUniqueOrThrow: async (a: Query) => {
        const r = await findUnique(a);
        if (!r) throw new Error(`${String(model)} not found`);
        return r;
      },
      create: async (a: Query) => put(a.data),
      createMany: async (a: Query) => {
        let count = 0;
        for (const data of a.data) {
          try {
            await put(data);
            count++;
          } catch (e) {
            if (!a.skipDuplicates) throw e;
          }
        }
        return { count };
      },
      upsert: async (a: Query) => {
        const old = await findUnique({ where: a.where });
        return old
          ? Object.keys(a.update ?? {}).length === 0
            ? old
            : unit
                .delegate(model, guildId)
                .update({ where: a.where, data: a.update })
          : // Another bot instance may create the same deterministic document
            // after the read above. A merge-set makes the create branch safe to
            // retry without surfacing Firestore ALREADY_EXISTS to the caller.
            put(a.create, true);
      },
      update: async (a: Query) => {
        const old = await findUnique({ where: a.where });
        if (!old) throw new Error(`${String(model)} not found`);
        const next = applyData(old, a.data);
        if (next.guildId !== undefined && next.guildId !== guildId)
          throw new Error('Cross-guild write rejected.');
        const ref = unit.ref(model, guildId, primary(model, old));
        if (unit.tx) unit.staged.push({ ref, data: next, merge: false });
        else await ref.set(next);
        return next;
      },
      updateMany: async (a: Query) => {
        const rows = await getAll(a.where);
        for (const old of rows) {
          const next = applyData(old, a.data);
          if (next.guildId !== undefined && next.guildId !== guildId)
            throw new Error('Cross-guild write rejected.');
          const ref = unit.ref(model, guildId, primary(model, old));
          if (unit.tx) unit.staged.push({ ref, data: next, merge: false });
          else await ref.set(next);
        }
        return { count: rows.length };
      },
      delete: async (a: Query) => {
        const old = await findUnique({ where: a.where });
        if (!old) throw new Error(`${String(model)} not found`);
        await unit.ref(model, guildId, primary(model, old)).delete();
        return old;
      },
      deleteMany: async (a: Query = {}) => {
        const rows = await getAll(a.where);
        for (const old of rows)
          await unit.ref(model, guildId, primary(model, old)).delete();
        return { count: rows.length };
      },
      count: async (a: Query = {}) => (await getAll(a.where)).length,
      aggregate: async (a: Query = {}) => {
        const rows = await getAll(a.where),
          res: Row = { _count: rows.length };
        for (const k of a._sum ? Object.keys(a._sum) : [])
          res._sum = {
            ...res._sum,
            [k]: rows.reduce((n, r) => n + (r[k] ?? 0), 0),
          };
        for (const k of a._avg ? Object.keys(a._avg) : [])
          res._avg = {
            ...res._avg,
            [k]: rows.length
              ? rows.reduce((n, r) => n + (r[k] ?? 0), 0) /
                rows.filter((r) => r[k] != null).length
              : null,
          };
        return res;
      },
      groupBy: async (a: Query) => {
        const rows = await getAll(a.where),
          groups = new Map<string, Row>();
        for (const row of rows) {
          const key = (a.by as string[]).map((k) => String(row[k])).join('|');
          const x =
            groups.get(key) ??
            Object.fromEntries((a.by as string[]).map((k) => [k, row[k]]));
          x._count = (x._count ?? 0) + 1;
          for (const k of a._sum ? Object.keys(a._sum) : [])
            x._sum = { ...x._sum, [k]: (x._sum?.[k] ?? 0) + (row[k] ?? 0) };
          groups.set(key, x);
        }
        let out = [...groups.values()];
        if (a.orderBy) {
          const [key, dir] = Object.entries(a.orderBy[0] ?? a.orderBy)[0]!;
          out.sort((x, y) => {
            const field = key === '_sum' ? Object.keys(a._sum)[0]! : key;
            const diff =
              (x[key]?.[field] ?? x[field] ?? 0) -
              (y[key]?.[field] ?? y[field] ?? 0);
            return dir === 'desc' || dir ? -diff : diff;
          });
        }
        if (a.take) out = out.slice(0, a.take);
        return out;
      },
    };
  }
  async commit() {
    if (this.tx)
      for (const w of this.staged) {
        if (w.create) this.tx.create(w.ref, w.data);
        else this.tx.set(w.ref, w.data, { merge: w.merge });
      }
  }
}
function scopeFor(model: Model, args: Query, fallback?: string) {
  return guildOf(model, args, fallback);
}
const modelNames = Object.keys(metadata) as Model[];
function makeClient(unit = new Unit(), fallback?: string): RepositoryClient {
  const client: Record<string, any> = {};
  for (const model of modelNames)
    client[model] = new Proxy(
      {},
      {
        get(_target, method: string) {
          return (args: Query = {}) =>
            unit.delegate(model, scopeFor(model, args, fallback))[method]!(
              args,
            );
        },
      },
    );
  client.$transaction = async <T>(work: (tx: RepositoryClient) => Promise<T>) =>
    firestore().runTransaction(async (tx) => {
      const u = new Unit(tx);
      const result = await work(makeClient(u, fallback));
      await u.commit();
      return result;
    });
  client.$connect = async () => {
    await firestore().doc('_health/connectivity').get();
  };
  client.$disconnect = async () => closeFirebase();
  return client as RepositoryClient;
}
export const db = makeClient();
export async function getGuild(guildId: string) {
  return db.guild.findUnique({ where: { id: assertId(guildId, 'guildId') } });
}
export async function createGuild(guildId: string, guildName: string) {
  return db.guild.upsert({
    where: { id: assertId(guildId, 'guildId') },
    create: { id: guildId, name: guildName },
    update: { name: guildName },
  });
}
export async function getMember(guildId: string, userId: string) {
  return db.user.findUnique({
    where: {
      guildId_discordId: {
        guildId: assertId(guildId, 'guildId'),
        discordId: assertId(userId, 'userId'),
      },
    },
  });
}
export async function updateMember(guildId: string, userId: string, data: Row) {
  return db.user.upsert({
    where: { guildId_discordId: { guildId, discordId: userId } },
    create: { guildId, discordId: userId, ...data },
    update: data,
  });
}
export const addXP = async (guildId: string, userId: string, amount: number) =>
  db.userXP.update({
    where: { guildId_userId: { guildId, userId } },
    data: { xp: { increment: amount } },
  });
export const removeXP = async (
  guildId: string,
  userId: string,
  amount: number,
) => addXP(guildId, userId, -amount);
export const getXP = async (guildId: string, userId: string) =>
  db.userXP.findUnique({ where: { guildId_userId: { guildId, userId } } });
export const setLevelRole = async (
  guildId: string,
  level: number,
  roleId: string,
  roleName: string,
) =>
  db.levelRole.upsert({
    where: { guildId_level: { guildId, level } },
    create: { guildId, level, roleId, roleName },
    update: { roleId, roleName },
  });
export const getLevelRole = async (guildId: string, level: number) =>
  db.levelRole.findUnique({ where: { guildId_level: { guildId, level } } });
export const addContribution = async (
  guildId: string,
  userId: string,
  type: string,
  points: number,
  description: string,
) =>
  db.activity.create({
    data: {
      guildId,
      userId,
      type,
      points,
      description,
      status: 'APPROVED',
      metadata: {},
    },
  });
export const createMapReview = async (guildId: string, data: Query) =>
  db.review.create({ data: { guildId, ...data } });
export const updateMapReview = async (
  guildId: string,
  id: string,
  data: Query,
) => db.review.update({ where: { id, guildId }, data });
export const createReport = async (guildId: string, data: Query) =>
  db.report.create({ data: { guildId, ...data } });
export const createModerationLog = async (guildId: string, data: Query) =>
  db.moderationAction.create({ data: { guildId, ...data } });
export const createAuditLog = async (guildId: string, data: Query) =>
  db.auditLog.create({ data: { guildId, ...data } });
export const getWeeklyLeaderboard = async (guildId: string, week: string) =>
  db.leaderboard.findFirst({
    where: { guildId, period: 'weekly', startsAt: new Date(week) },
  });
