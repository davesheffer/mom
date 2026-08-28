import { Redis } from "@upstash/redis";

const SEEN_KEY = "yad2:seen_ids";
const FAILURE_ALERT_KEY = "yad2:last_failure_alert";
const FAILURE_ALERT_COOLDOWN_SECONDS = 60 * 60 * 12; // 12h, so a broken scraper doesn't spam WhatsApp hourly

function getRedis(): Redis {
  return Redis.fromEnv();
}

export async function filterNewIds(ids: string[]): Promise<string[]> {
  if (ids.length === 0) return [];
  const redis = getRedis();
  const pipeline = redis.pipeline();
  for (const id of ids) pipeline.sismember(SEEN_KEY, id);
  const results = (await pipeline.exec()) as number[];
  return ids.filter((_, i) => results[i] === 0);
}

export async function markSeen(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const redis = getRedis();
  await redis.sadd(SEEN_KEY, ...(ids as [string, ...string[]]));
}

export async function shouldSendFailureAlert(): Promise<boolean> {
  const redis = getRedis();
  const existing = await redis.get(FAILURE_ALERT_KEY);
  if (existing) return false;
  await redis.set(FAILURE_ALERT_KEY, Date.now(), { ex: FAILURE_ALERT_COOLDOWN_SECONDS });
  return true;
}
