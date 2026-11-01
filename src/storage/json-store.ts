import fs from "node:fs/promises";
import path from "node:path";
import { config } from "../config.js";

const locks = new Map<string, Promise<void>>();

async function ensureDataDir(): Promise<void> {
  await fs.mkdir(config.DATA_DIR, { recursive: true });
}

export async function readJson<T>(name: string, fallback: T): Promise<T> {
  await ensureDataDir();
  const file = path.join(config.DATA_DIR, `${name}.json`);
  try {
    const raw = await fs.readFile(file, "utf8");
    return JSON.parse(raw) as T;
  } catch (error: any) {
    if (error?.code === "ENOENT") return structuredClone(fallback);
    throw error;
  }
}

export async function writeJson<T>(name: string, value: T): Promise<void> {
  await ensureDataDir();
  const file = path.join(config.DATA_DIR, `${name}.json`);
  const tmp = `${file}.tmp`;
  const previous = locks.get(name) ?? Promise.resolve();
  const next = previous.then(async () => {
    await fs.writeFile(tmp, `${JSON.stringify(value, null, 2)}\n`, "utf8");
    await fs.rename(tmp, file);
  });
  locks.set(name, next.catch(() => undefined));
  await next;
}

export async function updateJson<T>(name: string, fallback: T, mutator: (value: T) => void | Promise<void>): Promise<T> {
  const previous = locks.get(name) ?? Promise.resolve();
  let result!: T;
  const next = previous.then(async () => {
    const current = await readJson(name, fallback);
    await mutator(current);
    const file = path.join(config.DATA_DIR, `${name}.json`);
    const tmp = `${file}.tmp`;
    await fs.writeFile(tmp, `${JSON.stringify(current, null, 2)}\n`, "utf8");
    await fs.rename(tmp, file);
    result = current;
  });
  locks.set(name, next.catch(() => undefined));
  await next;
  return result;
}
