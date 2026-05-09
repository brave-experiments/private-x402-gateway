import { rateLimit } from "express-rate-limit";
import { RedisStore } from "rate-limit-redis";
import { createClient } from "redis";

const REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";
export const redisClient = createClient({ url: REDIS_URL });

if (!redisClient.isOpen) {
  await redisClient.connect();
}

const store = new RedisStore({
  sendCommand: async (...args: string[]) => redisClient.sendCommand(args),
  prefix: "rl:relay:",
});

const RATE_LIMIT_WINDOW_MS = parseInt(process.env.RATE_LIMIT_WINDOW_MS || "1000", 10);
const RATE_LIMIT_MAX = parseInt(process.env.RATE_LIMIT_MAX || "15", 10);

export const relayRateLimiter = rateLimit({
  windowMs: RATE_LIMIT_WINDOW_MS,
  max: RATE_LIMIT_MAX,
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => req.path === "/health",
  store,
  message: { error: "Too many requests, please try again later." },
  validate: { trustProxy: false },
});
