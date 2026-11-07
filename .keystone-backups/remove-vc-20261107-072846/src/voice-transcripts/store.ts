import fs from "node:fs";
import path from "node:path";

export const VC_RETENTION_MS = 8 * 60 * 60 * 1000;

export interface VoiceTranscriptEntry {
  at: string;
  userId: string;
  displayName: string;
  text: string;
}

export interface VoiceTranscriptParticipant {
  id: string;
  displayName: string;
}

export interface VoiceTranscriptSessionRecord {
  id: string;
  guildId: string;
  channelId: string;
  channelName: string;
  startedAt: string;
  endedAt: string | null;
  expiresAt: string | null;
  keptAt: string | null;
  startedBy: string | null;
  auto: boolean;
  reason: string | null;
  participants: VoiceTranscriptParticipant[];
  entries: VoiceTranscriptEntry[];
  logChannelId: string | null;
  logMessageId: string | null;
}

interface GuildVoiceSettings {
  logChannelId: string | null;
  autoChannelIds: string[];
}

interface VoiceSettingsFile {
  guilds: Record<string, GuildVoiceSettings>;
}

function dataRoot(): string {
  return process.env.DATA_DIR || path.join(process.cwd(), "data");
}

function rootDir(): string {
  return path.join(dataRoot(), "voice-transcripts");
}

function sessionsDir(): string {
  return path.join(rootDir(), "sessions");
}

function settingsPath(): string {
  return path.join(rootDir(), "settings.json");
}

function ensureDirs(): void {
  fs.mkdirSync(sessionsDir(), { recursive: true });
}

function readJson<T>(file: string, fallback: T): T {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as T;
  } catch {
    return fallback;
  }
}

function writeJsonAtomic(file: string, value: unknown): void {
  ensureDirs();
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2), "utf8");
  fs.renameSync(tmp, file);
}

function sessionPath(id: string): string {
  return path.join(sessionsDir(), `${id}.json`);
}

export function getGuildVoiceSettings(guildId: string): GuildVoiceSettings {
  const all = readJson<VoiceSettingsFile>(settingsPath(), { guilds: {} });
  return all.guilds[guildId] ?? { logChannelId: null, autoChannelIds: [] };
}

export function updateGuildVoiceSettings(
  guildId: string,
  updater: (current: GuildVoiceSettings) => GuildVoiceSettings,
): GuildVoiceSettings {
  const all = readJson<VoiceSettingsFile>(settingsPath(), { guilds: {} });
  const current = all.guilds[guildId] ?? { logChannelId: null, autoChannelIds: [] };
  const next = updater(current);
  all.guilds[guildId] = {
    logChannelId: next.logChannelId ?? null,
    autoChannelIds: [...new Set(next.autoChannelIds)],
  };
  writeJsonAtomic(settingsPath(), all);
  return all.guilds[guildId];
}

export function saveVoiceSession(record: VoiceTranscriptSessionRecord): void {
  writeJsonAtomic(sessionPath(record.id), record);
}

export function getVoiceSession(id: string): VoiceTranscriptSessionRecord | null {
  ensureDirs();
  const file = sessionPath(id);
  if (!fs.existsSync(file)) return null;
  return readJson<VoiceTranscriptSessionRecord | null>(file, null);
}

export function listVoiceSessions(guildId: string): VoiceTranscriptSessionRecord[] {
  ensureDirs();
  return fs.readdirSync(sessionsDir())
    .filter(name => name.endsWith(".json"))
    .map(name => readJson<VoiceTranscriptSessionRecord | null>(path.join(sessionsDir(), name), null))
    .filter((value): value is VoiceTranscriptSessionRecord => Boolean(value && value.guildId === guildId))
    .sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt));
}

export function deleteVoiceSession(id: string): boolean {
  ensureDirs();
  const file = sessionPath(id);
  if (!fs.existsSync(file)) return false;
  fs.unlinkSync(file);
  return true;
}

export function markInterruptedVoiceSessions(
  guildId: string,
  now = Date.now(),
): VoiceTranscriptSessionRecord[] {
  ensureDirs();
  const recovered: VoiceTranscriptSessionRecord[] = [];
  for (const name of fs.readdirSync(sessionsDir())) {
    if (!name.endsWith(".json")) continue;
    const file = path.join(sessionsDir(), name);
    const record = readJson<VoiceTranscriptSessionRecord | null>(file, null);
    if (!record || record.guildId !== guildId || record.endedAt) continue;
    record.endedAt = new Date(now).toISOString();
    record.expiresAt = new Date(now + VC_RETENTION_MS).toISOString();
    writeJsonAtomic(file, record);
    recovered.push(record);
  }
  return recovered;
}

export function cleanupExpiredVoiceSessions(now = Date.now()): string[] {
  ensureDirs();
  const deleted: string[] = [];
  for (const name of fs.readdirSync(sessionsDir())) {
    if (!name.endsWith(".json")) continue;
    const file = path.join(sessionsDir(), name);
    const record = readJson<VoiceTranscriptSessionRecord | null>(file, null);
    if (!record || record.keptAt || !record.expiresAt) continue;
    if (Date.parse(record.expiresAt) <= now) {
      fs.unlinkSync(file);
      deleted.push(record.id);
    }
  }
  return deleted;
}
