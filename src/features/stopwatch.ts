import { readJson, updateJson } from "../storage/json-store.js";

export interface StopwatchLap {
  elapsedMs: number;
  recordedAt: number;
}

export interface StopwatchRecord {
  state: "running" | "paused" | "stopped";
  startedAt?: number;
  accumulatedMs: number;
  laps: StopwatchLap[];
  updatedAt: number;
}

interface StopwatchesFile {
  guilds: Record<string, Record<string, StopwatchRecord>>;
}

const DEFAULT_STOPWATCHES: StopwatchesFile = { guilds: {} };
const MAX_LAPS = 50;

function elapsedFor(record: StopwatchRecord, now = Date.now()): number {
  return record.accumulatedMs + (record.state === "running" && record.startedAt ? Math.max(0, now - record.startedAt) : 0);
}

export function formatStopwatch(ms: number): string {
  const safe = Math.max(0, Math.floor(ms));
  const hours = Math.floor(safe / 3_600_000);
  const minutes = Math.floor((safe % 3_600_000) / 60_000);
  const seconds = Math.floor((safe % 60_000) / 1_000);
  const millis = safe % 1_000;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}.${String(millis).padStart(3, "0")}`;
}

export function stopwatchElapsed(record: StopwatchRecord): number {
  return elapsedFor(record);
}

export async function getStopwatch(guildId: string, userId: string): Promise<StopwatchRecord | undefined> {
  const data = await readJson<StopwatchesFile>("stopwatches", DEFAULT_STOPWATCHES);
  return data.guilds[guildId]?.[userId];
}

export async function startStopwatch(guildId: string, userId: string): Promise<{ ok: true; record: StopwatchRecord } | { ok: false; reason: string }> {
  let result: { ok: true; record: StopwatchRecord } | { ok: false; reason: string } = { ok: false, reason: "Unable to start stopwatch." };
  await updateJson<StopwatchesFile>("stopwatches", DEFAULT_STOPWATCHES, data => {
    data.guilds[guildId] ??= {};
    const existing = data.guilds[guildId]![userId];
    if (existing?.state === "running") {
      result = { ok: false, reason: "Your stopwatch is already running." };
      return;
    }
    if (existing?.state === "paused") {
      result = { ok: false, reason: "Your stopwatch is paused. Use `/stopwatch resume` or `/stopwatch reset` first." };
      return;
    }
    const now = Date.now();
    const record: StopwatchRecord = {
      state: "running",
      startedAt: now,
      accumulatedMs: 0,
      laps: [],
      updatedAt: now,
    };
    data.guilds[guildId]![userId] = record;
    result = { ok: true, record };
  });
  return result;
}

export async function pauseStopwatch(guildId: string, userId: string): Promise<{ ok: true; record: StopwatchRecord } | { ok: false; reason: string }> {
  let result: { ok: true; record: StopwatchRecord } | { ok: false; reason: string } = { ok: false, reason: "No running stopwatch found." };
  await updateJson<StopwatchesFile>("stopwatches", DEFAULT_STOPWATCHES, data => {
    const record = data.guilds[guildId]?.[userId];
    if (!record || record.state !== "running" || !record.startedAt) return;
    const now = Date.now();
    record.accumulatedMs += Math.max(0, now - record.startedAt);
    record.startedAt = undefined;
    record.state = "paused";
    record.updatedAt = now;
    result = { ok: true, record: structuredClone(record) };
  });
  return result;
}

export async function resumeStopwatch(guildId: string, userId: string): Promise<{ ok: true; record: StopwatchRecord } | { ok: false; reason: string }> {
  let result: { ok: true; record: StopwatchRecord } | { ok: false; reason: string } = { ok: false, reason: "No paused stopwatch found." };
  await updateJson<StopwatchesFile>("stopwatches", DEFAULT_STOPWATCHES, data => {
    const record = data.guilds[guildId]?.[userId];
    if (!record || record.state !== "paused") return;
    const now = Date.now();
    record.state = "running";
    record.startedAt = now;
    record.updatedAt = now;
    result = { ok: true, record: structuredClone(record) };
  });
  return result;
}

export async function addStopwatchLap(guildId: string, userId: string): Promise<{ ok: true; record: StopwatchRecord; lap: StopwatchLap; lapNumber: number } | { ok: false; reason: string }> {
  let result: { ok: true; record: StopwatchRecord; lap: StopwatchLap; lapNumber: number } | { ok: false; reason: string } = { ok: false, reason: "No running stopwatch found." };
  await updateJson<StopwatchesFile>("stopwatches", DEFAULT_STOPWATCHES, data => {
    const record = data.guilds[guildId]?.[userId];
    if (!record || record.state !== "running") return;
    if (record.laps.length >= MAX_LAPS) {
      result = { ok: false, reason: `A stopwatch can store up to ${MAX_LAPS} laps.` };
      return;
    }
    const now = Date.now();
    const lap: StopwatchLap = { elapsedMs: elapsedFor(record, now), recordedAt: now };
    record.laps.push(lap);
    record.updatedAt = now;
    result = { ok: true, record: structuredClone(record), lap: structuredClone(lap), lapNumber: record.laps.length };
  });
  return result;
}

export async function stopStopwatch(guildId: string, userId: string): Promise<{ ok: true; record: StopwatchRecord } | { ok: false; reason: string }> {
  let result: { ok: true; record: StopwatchRecord } | { ok: false; reason: string } = { ok: false, reason: "No active stopwatch found." };
  await updateJson<StopwatchesFile>("stopwatches", DEFAULT_STOPWATCHES, data => {
    const record = data.guilds[guildId]?.[userId];
    if (!record || record.state === "stopped") return;
    const now = Date.now();
    if (record.state === "running" && record.startedAt) {
      record.accumulatedMs += Math.max(0, now - record.startedAt);
    }
    record.startedAt = undefined;
    record.state = "stopped";
    record.updatedAt = now;
    result = { ok: true, record: structuredClone(record) };
  });
  return result;
}

export async function resetStopwatch(guildId: string, userId: string): Promise<boolean> {
  let existed = false;
  await updateJson<StopwatchesFile>("stopwatches", DEFAULT_STOPWATCHES, data => {
    const guild = data.guilds[guildId];
    if (!guild?.[userId]) return;
    existed = true;
    delete guild[userId];
    if (!Object.keys(guild).length) delete data.guilds[guildId];
  });
  return existed;
}
