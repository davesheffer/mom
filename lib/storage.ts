import { promises as fs } from "fs";
import path from "path";
import { Redis } from "@upstash/redis";

const SEEN_KEY = "yad2:seen_ids";
const FAILURE_ALERT_KEY = "yad2:last_failure_alert";
const FAILURE_ALERT_COOLDOWN_MS = 1000 * 60 * 60 * 12; // 12h, so a broken scraper doesn't email hourly

// Bound the file-backed set so the committed state file can't grow forever.
const MAX_TRACKED_IDS = 5000;

export interface Storage {
  filterNewIds(ids: string[]): Promise<string[]>;
  markSeen(ids: string[]): Promise<void>;
  shouldSendFailureAlert(): Promise<boolean>;
}

/* ------------------------------------------------------------------ */
/* Upstash Redis backend (used on Vercel, where there's no writable disk) */
/* ------------------------------------------------------------------ */

function redisStorage(): Storage {
  const redis = Redis.fromEnv();

  return {
    async filterNewIds(ids) {
      if (ids.length === 0) return [];
      const pipeline = redis.pipeline();
      for (const id of ids) pipeline.sismember(SEEN_KEY, id);
      const results = (await pipeline.exec()) as number[];
      return ids.filter((_, i) => results[i] === 0);
    },

    async markSeen(ids) {
      if (ids.length === 0) return;
      await redis.sadd(SEEN_KEY, ...(ids as [string, ...string[]]));
    },

    async shouldSendFailureAlert() {
      const existing = await redis.get(FAILURE_ALERT_KEY);
      if (existing) return false;
      await redis.set(FAILURE_ALERT_KEY, Date.now(), {
        ex: Math.floor(FAILURE_ALERT_COOLDOWN_MS / 1000),
      });
      return true;
    },
  };
}

/* ------------------------------------------------------------------ */
/* JSON-file backend (used by the standalone GitHub Actions runner)      */
/* ------------------------------------------------------------------ */

interface StateFile {
  seenIds: string[];
  lastFailureAlertAt: number | null;
}

const EMPTY_STATE: StateFile = { seenIds: [], lastFailureAlertAt: null };

function stateFilePath(): string {
  return process.env.STATE_FILE || path.join(process.cwd(), ".state", "seen.json");
}

async function readState(): Promise<StateFile> {
  try {
    const raw = await fs.readFile(stateFilePath(), "utf8");
    const parsed = JSON.parse(raw) as Partial<StateFile>;
    return {
      seenIds: Array.isArray(parsed.seenIds) ? parsed.seenIds : [],
      lastFailureAlertAt:
        typeof parsed.lastFailureAlertAt === "number" ? parsed.lastFailureAlertAt : null,
    };
  } catch (err) {
    // A missing state file just means "first run" — anything else is a real problem.
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return { ...EMPTY_STATE };
    throw err;
  }
}

async function writeState(state: StateFile): Promise<void> {
  const file = stateFilePath();
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify(state, null, 2) + "\n", "utf8");
}

function fileStorage(): Storage {
  return {
    async filterNewIds(ids) {
      if (ids.length === 0) return [];
      const { seenIds } = await readState();
      const seen = new Set(seenIds);
      return ids.filter((id) => !seen.has(id));
    },

    async markSeen(ids) {
      if (ids.length === 0) return;
      const state = await readState();
      const merged = [...state.seenIds, ...ids];
      // Keep the most recent ids; older listings are long gone from Yad2 anyway.
      state.seenIds = Array.from(new Set(merged)).slice(-MAX_TRACKED_IDS);
      await writeState(state);
    },

    async shouldSendFailureAlert() {
      const state = await readState();
      const last = state.lastFailureAlertAt;
      if (last && Date.now() - last < FAILURE_ALERT_COOLDOWN_MS) return false;
      state.lastFailureAlertAt = Date.now();
      await writeState(state);
      return true;
    },
  };
}

/* ------------------------------------------------------------------ */

export function getStorage(): Storage {
  const hasUpstash =
    !!process.env.UPSTASH_REDIS_REST_URL && !!process.env.UPSTASH_REDIS_REST_TOKEN;

  if (hasUpstash) return redisStorage();

  // Vercel's filesystem is ephemeral and read-only outside /tmp, so a file-backed
  // set there would silently forget everything and re-alert on every run.
  if (process.env.VERCEL) {
    throw new Error(
      "Running on Vercel without Upstash Redis configured. Set UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN, otherwise already-seen listings can't be remembered between runs."
    );
  }

  return fileStorage();
}
