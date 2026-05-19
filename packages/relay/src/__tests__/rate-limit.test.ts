import { describe, it, expect, beforeEach, afterAll } from "vitest";
import request from "supertest";
import express from "express";
import { relayRateLimiter, redisClient } from "../middleware/rate-limit.js";

const createApp = () => {
  const app = express();
  app.set("trust proxy", true);
  app.use(relayRateLimiter);
  app.post("/", (_req, res) => res.json({ ok: true }));
  app.get("/health", (_req, res) => res.json({ status: "ok" }));
  return app;
};

const app = createApp();

describe("relay rate limiting", () => {
  beforeEach(async () => {
    const keys = await redisClient.keys("rl:relay:*");
    if (keys.length) await redisClient.del(keys);
  });

  afterAll(async () => {
    await redisClient.quit();
  });

  it("allows requests under the limit", async () => {
    const res = await request(app).post("/").send(Buffer.alloc(10));
    expect(res.status).not.toBe(429);
  });

  it("excludes /health from rate limiting", async () => {
    for (let i = 0; i < 20; i++) {
      const res = await request(app).get("/health");
      expect(res.status).toBe(200);
      expect(res.body.status).toBe("ok");
    }
  });

  it("returns 429 when rate limit is exceeded", async () => {
    const responses = await Promise.all(
      Array.from({ length: 20 }, () =>
        request(app).post("/").send(Buffer.alloc(10))
      )
    );

    const okCount = responses.filter((r) => r.status !== 429).length;
    const limitedCount = responses.filter((r) => r.status === 429).length;

    expect(okCount).toBeLessThanOrEqual(15);
    expect(limitedCount).toBeGreaterThanOrEqual(1);
  });

  it("isolates rate limits per IP (e2e)", async () => {
    // User 1: 20 RPS (should hit limit)
    const user1Requests = Array.from({ length: 20 }, () =>
      request(app)
        .post("/")
        .set("X-Forwarded-For", "1.2.3.4")
        .send(Buffer.alloc(10))
    );

    // User 2: 5 RPS (should stay under limit)
    const user2Requests = Array.from({ length: 5 }, () =>
      request(app)
        .post("/")
        .set("X-Forwarded-For", "5.6.7.8")
        .send(Buffer.alloc(10))
    );

    const [user1Responses, user2Responses] = await Promise.all([
      Promise.all(user1Requests),
      Promise.all(user2Requests),
    ]);

    const user1OkCount = user1Responses.filter((r) => r.status !== 429).length;
    const user1LimitedCount = user1Responses.filter(
      (r) => r.status === 429
    ).length;

    expect(user1OkCount).toBeLessThanOrEqual(15);
    expect(user1LimitedCount).toBeGreaterThanOrEqual(1);

    // User 2 should have all requests succeed
    const user2OkCount = user2Responses.filter((r) => r.status !== 429).length;
    expect(user2OkCount).toBe(5);
  });
});
