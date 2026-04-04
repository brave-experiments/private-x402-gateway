import express from "express";

const TARGET_URL = process.env.TARGET_URL || "http://localhost:3001";
const PORT = parseInt(process.env.PORT || "3000");

function resolveTarget(rawTarget: string): string {
  try {
    const url = new URL(rawTarget);
    const port = parseInt(url.port) || 80;
    const portMap: Record<number, string> = {
      3001: process.env.TARGET_GATEWAY || "http://gateway:3001",
      3002: process.env.TARGET_FACILITATOR || "http://facilitator:3002",
    };
    const mapped = portMap[port];
    if (mapped) {
      const mappedUrl = new URL(mapped);
      return `${mappedUrl.origin}${url.pathname}${url.search}`;
    }
    return rawTarget;
  } catch {
    return rawTarget;
  }
}

const app = express();
app.use(express.raw({ type: "message/ohttp-req", limit: "1mb" }));

app.post("/", async (req, res) => {
  const rawTarget = (req.query.target as string) || TARGET_URL;
  const target = resolveTarget(rawTarget);
  try {
    const response = await fetch(target, {
      method: "POST",
      headers: {
        "Content-Type": "message/ohttp-req",
      },
      body: req.body,
    });
    const data = await response.arrayBuffer();
    res.setHeader("Content-Type", "message/ohttp-res");
    res.send(Buffer.from(data));
  } catch (err) {
    res.status(502).json({ error: "Failed to forward request" });
  }
});

app.get("/health", (_req, res) => {
  res.json({ status: "ok", target: TARGET_URL });
});

export default app;

if (import.meta.url === `file://${process.argv[1]}`) {
  app.listen(PORT, () => {
    console.log(`OHTTP Relay listening on port ${PORT}, forwarding to ${TARGET_URL}`);
  });
}
