export type LogKind = "general" | "moderation" | "tickets" | "joinLeave" | "messages" | "members" | "channels" | "roles" | "voice" | "server" | "reactions" | "invites";

export interface LevelTier {
  level: number;
  roleId: string;
  name: string;
}

export interface RoleMapping {
  triggerRoleId: string;
  targetRoleId: string;
  removeWithTrigger: boolean;
}

export interface GuildSettings {
  logs: Partial<Record<LogKind, string>>;
  tickets: {
    categoryId?: string;
    staffRoleIds: string[];
    nextNumber?: number;
  };
  leveling: {
    enabled: boolean;
    cooldownSeconds: number;
    xpMin: number;
    xpMax: number;
    tiers: LevelTier[];
    announcementChannelId?: string;
  };
  media: Record<string, { unlockLevel: number }>;
  selfRoles: string[];
  roleMappings: RoleMapping[];
  automod: {
    enabled: boolean;
    blockedTerms: string[];
    spamWindowSeconds: number;
    spamMessageCount: number;
  };
}

export interface SettingsFile {
  guilds: Record<string, GuildSettings>;
}

export const DEFAULT_GUILD_SETTINGS: GuildSettings = {
  logs: {},
  tickets: { staffRoleIds: [] },
  leveling: {
    enabled: false,
    cooldownSeconds: 60,
    xpMin: 8,
    xpMax: 15,
    tiers: [],
  },
  media: {},
  selfRoles: [],
  roleMappings: [],
  automod: { enabled: false, blockedTerms: [], spamWindowSeconds: 8, spamMessageCount: 6 },
};

export const DEFAULT_SETTINGS: SettingsFile = { guilds: {} };

export interface LevelRecord {
  xp: number;
  level: number;
  lastXpAt?: number; // legacy field retained for compatibility
  messageXpWindow?: Array<{ at: number; amount: number }>;
  recentMessages?: Array<{ signature: string; at: number }>;
  lastReactionXpAt?: number;
  reactionDay?: string;
  reactionAwardsToday?: number; // legacy field retained for compatibility
  reactedMessages?: Record<string, number>;
  weekKey?: string;
  weeklyXp?: number;
}
export interface LevelsFile { guilds: Record<string, Record<string, LevelRecord>>; }
export const DEFAULT_LEVELS: LevelsFile = { guilds: {} };

export interface StickyRecord {
  channelId: string;
  messageId?: string;
  content?: string;
  title?: string;
  color?: string;
}
export interface StickiesFile { guilds: Record<string, Record<string, StickyRecord>>; }
export const DEFAULT_STICKIES: StickiesFile = { guilds: {} };

export interface ModNote {
  id: string;
  userId: string;
  moderatorId: string;
  text: string;
  createdAt: number;
  kind: "note" | "warning";
}
export interface ModNotesFile { guilds: Record<string, ModNote[]>; }
export const DEFAULT_MODNOTES: ModNotesFile = { guilds: {} };

export interface ReminderRecord {
  id: string;
  userId: string;
  channelId: string;
  text: string;
  dueAt: number;
}
export interface RemindersFile { reminders: ReminderRecord[]; }
export const DEFAULT_REMINDERS: RemindersFile = { reminders: [] };
