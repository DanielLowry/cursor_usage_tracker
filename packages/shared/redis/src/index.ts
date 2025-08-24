import Redis from "ioredis";
import { loadConfig } from "@cursor-usage/env";

let redisSingleton: Redis | null = null;

export function getRedis(): Redis {
  if (redisSingleton) return redisSingleton;
  const cfg = loadConfig();
  const url = cfg.REDIS_URL ?? "redis://127.0.0.1:6379";
  redisSingleton = new Redis(url, {
    lazyConnect: false,
    maxRetriesPerRequest: null,
  });
  return redisSingleton;
}


