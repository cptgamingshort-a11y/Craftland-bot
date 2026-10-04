// Persistent Firestore document contracts. Relations are resolved by the repository.
export type JsonValue =
  string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };
export interface Guild {
  id: string;
  name: string;
  setupStatus: string;
  createdAt: Date;
  updatedAt: Date;
}
export interface User {
  id: string;
  discordId: string;
  guildId: string;
  username: string;
  joinedAt: Date | null;
  lastActiveAt: Date | null;
  savedRoleIds: string[];
}
export interface BotConfiguration {
  guildId: string;
  settings: JsonValue;
  version: number;
  updatedAt: Date;
}
export interface RoleConfiguration {
  id: string;
  guildId: string;
  roleId: string;
  name: string;
  protected: boolean;
  autoAssign: boolean;
  autoRemove: boolean;
  maintenanceDays: number | null;
}
export interface RoleRequirement {
  id: string;
  roleConfigurationId: string;
  minimumPoints: number;
  minimumApprovedReviews: number;
  minimumActiveDays: number;
  minimumQuality: number | null;
  maintenancePoints: number | null;
}
export interface Activity {
  id: string;
  guildId: string;
  userId: string;
  type: string;
  description: string;
  points: number;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  reviewerId: string | null;
  metadata: JsonValue;
  timestamp: Date;
}
export interface Review {
  id: string;
  guildId: string;
  userId: string;
  mapName: string;
  creator: string;
  mapCode: string;
  content: string;
  result: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  reviewerId: string | null;
  reason: string | null;
  quality: number | null;
  createdAt: Date;
  decidedAt: Date | null;
}
export interface PointTransaction {
  id: string;
  guildId: string;
  userId: string;
  amount: number;
  reason: string;
  actorId: string;
  sourceKey: string;
  createdAt: Date;
}
export interface Leaderboard {
  id: string;
  guildId: string;
  period: string;
  startsAt: Date;
  endsAt: Date;
  entries: JsonValue;
  summary: string;
  messageId: string | null;
  announcementMessageId: string | null;
  xpEntries: JsonValue;
  statistics: JsonValue;
  createdAt: Date;
}
export interface LevelConfig {
  guildId: string;
  enabled: boolean;
  xpPerMessage: number;
  cooldownSeconds: number;
  dailyLimit: number;
  duplicateWindowSeconds: number;
  minimumMessageLength: number;
  baseXP: number;
  incrementXP: number;
  maxLevel: number;
  levelUpChannelId: string;
  levelUpMessage: string;
  ignoredChannelIds: JsonValue;
  timezone: string;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}
export interface UserXP {
  id: string;
  guildId: string;
  userId: string;
  xp: number;
  level: number;
  weeklyXP: number;
  monthlyXP: number;
  weekKey: string;
  monthKey: string;
  dailyKey: string;
  dailyMessageXP: number;
  lastXPAt: Date | null;
  lastSuspiciousAt: Date | null;
  recentMessageHashes: JsonValue;
  roleSyncPending: boolean;
  configVersion: number;
  createdAt: Date;
  updatedAt: Date;
}
export interface XPTransaction {
  id: string;
  guildId: string;
  userId: string;
  amount: number;
  xpBefore: number;
  xpAfter: number;
  levelBefore: number;
  levelAfter: number;
  source: string;
  actorId: string;
  reason: string;
  sourceKey: string;
  metadata: JsonValue;
  createdAt: Date;
}
export interface LevelRole {
  id: string;
  guildId: string;
  level: number;
  roleId: string;
  roleName: string;
  enabled: boolean;
  createdAt: Date;
  updatedAt: Date;
}
export interface GameAccount {
  id: string;
  guildId: string;
  userId: string;
  coins: number;
  inventory: JsonValue;
  pets: JsonValue;
  petCounts: JsonValue;
  team: JsonValue;
  lastDailyAt: Date | null;
  dailyStreak: number;
  lastHuntAt: Date | null;
  lastBattleAt: Date | null;
  activeMines: JsonValue | null;
  activeBlackjack: JsonValue | null;
  createdAt: Date;
  updatedAt: Date;
}
export interface GameTransaction {
  id: string;
  guildId: string;
  userId: string;
  type: string;
  amount: number;
  reason: string;
  sourceKey: string;
  metadata: JsonValue;
  createdAt: Date;
}
export interface LevelRoleResource {
  id: string;
  guildId: string;
  roleId: string;
  roleName: string;
  createdAt: Date;
}
export interface LevelChange {
  id: string;
  guildId: string;
  userId: string;
  transactionId: string;
  oldLevel: number;
  newLevel: number;
  processedAt: Date | null;
  notifiedAt: Date | null;
  attempts: number;
  lastError: string | null;
  createdAt: Date;
}
export interface Report {
  id: string;
  guildId: string;
  authorId: string;
  type: string;
  target: string;
  description: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  claimedBy: string | null;
  resolvedBy: string | null;
  resolution: string | null;
  createdAt: Date;
  remindedAt: Date | null;
}
export interface Warning {
  id: string;
  guildId: string;
  userId: string;
  actorId: string;
  reason: string;
  createdAt: Date;
}
export interface ModerationAction {
  id: string;
  guildId: string;
  targetId: string;
  actorId: string;
  type: string;
  reason: string;
  metadata: JsonValue;
  createdAt: Date;
}
export interface AuditLog {
  id: string;
  guildId: string;
  actorId: string;
  action: string;
  targetId: string | null;
  data: JsonValue;
  createdAt: Date;
}
export interface DashboardSession {
  hash: string;
  discordId: string;
  expiresAt: Date;
}
export interface JobRun {
  key: string;
  completed: boolean;
  leaseUntil: Date;
}
export interface Documents {
  guild: Guild;
  user: User;
  botConfiguration: BotConfiguration;
  roleConfiguration: RoleConfiguration;
  roleRequirement: RoleRequirement;
  activity: Activity;
  review: Review;
  pointTransaction: PointTransaction;
  leaderboard: Leaderboard;
  levelConfig: LevelConfig;
  userXP: UserXP;
  xPTransaction: XPTransaction;
  levelRole: LevelRole;
  gameAccount: GameAccount;
  gameTransaction: GameTransaction;
  levelRoleResource: LevelRoleResource;
  levelChange: LevelChange;
  report: Report;
  warning: Warning;
  moderationAction: ModerationAction;
  auditLog: AuditLog;
  dashboardSession: DashboardSession;
  jobRun: JobRun;
}
