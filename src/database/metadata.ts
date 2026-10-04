export const metadata = {
  guild: {
    primary: 'id',
    defaults: {
      name: 'Craftland India',
      setupStatus: 'PENDING',
      createdAt: '$now',
      updatedAt: '$now',
    },
    unique: [],
  },
  user: {
    primary: 'id',
    defaults: {
      joinedAt: null,
      lastActiveAt: null,
      savedRoleIds: [],
    },
    unique: [
      ['guildId', 'discordId'],
      ['id', 'guildId'],
    ],
  },
  botConfiguration: {
    primary: 'guildId',
    defaults: {
      version: 0,
      updatedAt: '$now',
    },
    unique: [],
  },
  roleConfiguration: {
    primary: 'id',
    defaults: {
      protected: false,
      autoAssign: false,
      autoRemove: false,
      maintenanceDays: null,
    },
    unique: [['guildId', 'roleId']],
  },
  roleRequirement: {
    primary: 'id',
    defaults: {
      minimumQuality: null,
      maintenancePoints: null,
    },
    unique: [['roleConfigurationId']],
  },
  activity: {
    primary: 'id',
    defaults: {
      points: 0,
      status: 'PENDING',
      reviewerId: null,
      timestamp: '$now',
    },
    unique: [],
  },
  review: {
    primary: 'id',
    defaults: {
      status: 'PENDING',
      reviewerId: null,
      reason: null,
      quality: null,
      createdAt: '$now',
      decidedAt: null,
    },
    unique: [['guildId', 'userId', 'mapCode']],
  },
  pointTransaction: {
    primary: 'id',
    defaults: {
      createdAt: '$now',
    },
    unique: [['sourceKey']],
  },
  leaderboard: {
    primary: 'id',
    defaults: {
      messageId: null,
      announcementMessageId: null,
      xpEntries: [],
      statistics: {},
      createdAt: '$now',
    },
    unique: [['guildId', 'period', 'startsAt']],
  },
  levelConfig: {
    primary: 'guildId',
    defaults: {
      enabled: true,
      xpPerMessage: 10,
      cooldownSeconds: 60,
      dailyLimit: 300,
      duplicateWindowSeconds: 300,
      minimumMessageLength: 1,
      baseXP: 100,
      incrementXP: 50,
      maxLevel: 1000,
      levelUpChannelId: '',
      levelUpMessage:
        '{user} has reached **Level {level}**\n\nKeep creating, sharing and contributing to Craftland India!\n\n━━━━━━━━━━━━━━━━━━',
      ignoredChannelIds: [],
      timezone: 'Asia/Kolkata',
      version: 0,
      createdAt: '$now',
      updatedAt: '$now',
    },
    unique: [],
  },
  userXP: {
    primary: 'id',
    defaults: {
      xp: 0,
      level: 0,
      weeklyXP: 0,
      monthlyXP: 0,
      weekKey: '',
      monthKey: '',
      dailyKey: '',
      dailyMessageXP: 0,
      lastXPAt: null,
      lastSuspiciousAt: null,
      recentMessageHashes: [],
      roleSyncPending: false,
      configVersion: 0,
      createdAt: '$now',
      updatedAt: '$now',
    },
    unique: [['userId'], ['userId', 'guildId']],
  },
  xPTransaction: {
    primary: 'id',
    defaults: {
      metadata: {},
      createdAt: '$now',
    },
    unique: [['sourceKey']],
  },
  levelRole: {
    primary: 'id',
    defaults: {
      enabled: true,
      createdAt: '$now',
      updatedAt: '$now',
    },
    unique: [
      ['guildId', 'level'],
      ['guildId', 'roleId'],
    ],
  },
  gameAccount: {
    primary: 'id',
    defaults: {
      coins: 0,
      inventory: {},
      pets: [],
      petCounts: {},
      team: [],
      lastDailyAt: null,
      dailyStreak: 0,
      lastHuntAt: null,
      lastBattleAt: null,
      activeMines: null,
      activeBlackjack: null,
      createdAt: '$now',
      updatedAt: '$now',
    },
    unique: [['guildId', 'userId']],
  },
  gameTransaction: {
    primary: 'id',
    defaults: { metadata: {}, createdAt: '$now' },
    unique: [['guildId', 'sourceKey']],
  },
  levelRoleResource: {
    primary: 'id',
    defaults: {
      createdAt: '$now',
    },
    unique: [['guildId', 'roleId']],
  },
  levelChange: {
    primary: 'id',
    defaults: {
      processedAt: null,
      notifiedAt: null,
      attempts: 0,
      lastError: null,
      createdAt: '$now',
    },
    unique: [['transactionId']],
  },
  report: {
    primary: 'id',
    defaults: {
      status: 'PENDING',
      claimedBy: null,
      resolvedBy: null,
      resolution: null,
      createdAt: '$now',
      remindedAt: null,
    },
    unique: [],
  },
  warning: {
    primary: 'id',
    defaults: {
      createdAt: '$now',
    },
    unique: [],
  },
  moderationAction: {
    primary: 'id',
    defaults: {
      createdAt: '$now',
    },
    unique: [],
  },
  auditLog: {
    primary: 'id',
    defaults: {
      targetId: null,
      createdAt: '$now',
    },
    unique: [],
  },
  dashboardSession: {
    primary: 'hash',
    defaults: {},
    unique: [],
  },
  jobRun: {
    primary: 'key',
    defaults: {
      completed: false,
    },
    unique: [],
  },
} as const;
