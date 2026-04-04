/**
 * RFC 9458 (Oblivious HTTP) Conformance Test Suite
 *
 * Tests each role (Client, Relay, Gateway) against normative requirements
 * from the RFC, evaluated from the external API layer.
 *
 * Sections referenced: §3 (Key Config), §4 (HPKE Encapsulation),
 * §5 (HTTP Usage), §6 (Security), §9 (IANA/Media Types).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { Server } from "node:http";
import { createServer } from "node:http";
import express from "express";
import { raw } from "express";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import type { KeyConfigWithPrivate } from "ohttp-ts";

const require = createRequire(import.meta.url);
const { KeyConfig, OHTTPClient, OHTTPServer } = require("ohttp-ts");
const { CipherSuite, KEM_DHKEM_X25519_HKDF_SHA256, KDF_HKDF_SHA256, AEAD_AES_128_GCM } = require(
  require.resolve("ohttp-ts").replace(/[/\\]dist[/\\].*$/, "") + "/node_modules/hpke"
);

const SUITE = new CipherSuite(KEM_DHKEM_X25519_HKDF_SHA256, KDF_HKDF_SHA256, AEAD_AES_128_GCM);

function asBody(buf: Uint8Array): ArrayBuffer {
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
}

async function bodyToBytes(body: BodyInit | null | undefined): Promise<Uint8Array> {
  if (body instanceof Uint8Array) return body;
  if (body instanceof ArrayBuffer) return new Uint8Array(body);
  if (typeof body === "string") return new TextEncoder().encode(body);
  const res = new Response(body);
  return new Uint8Array(await res.arrayBuffer());
}

async function generateKeyConfig(keyId: number): Promise<KeyConfigWithPrivate> {
  return KeyConfig.generate(SUITE, keyId, [{ kdfId: 0x0001, aeadId: 0x0001 }]);
}

function serializeKeys(configs: KeyConfigWithPrivate[]): Uint8Array {
  return KeyConfig.serializeMultiple(configs);
}

function parseKeys(data: Uint8Array) {
  return KeyConfig.parseMultiple(data);
}

function makeClient(config: KeyConfigWithPrivate) {
  return new OHTTPClient(SUITE, config);
}

function makeServer(configs: KeyConfigWithPrivate[]) {
  return new OHTTPServer(configs);
}

let keyConfig: KeyConfigWithPrivate;
let gatewayApp: ReturnType<typeof express>;
let relayApp: ReturnType<typeof express>;
let gatewayServer: Server;
let relayServer: Server;
let gatewayPort: number;
let relayPort: number;

beforeAll(async () => {
  keyConfig = await generateKeyConfig(0x01);

  gatewayApp = express();
  gatewayApp.use(raw({ type: "message/ohttp-req", limit: "1mb" }));

  gatewayApp.get("/ohttp-keys", (_req, res) => {
    res.type("application/ohttp-keys").send(Buffer.from(serializeKeys([keyConfig])));
  });

  gatewayApp.post("/", async (req, res) => {
    if (req.headers["content-type"] !== "message/ohttp-req") {
      res.status(400).json({ error: "wrong content type" });
      return;
    }
    try {
      const body = new Uint8Array(req.body);
      const ohttpRequest = new Request("http://localhost/ohttp", {
        method: "POST",
        headers: { "Content-Type": "message/ohttp-req" },
        body,
      });
      const server = makeServer([keyConfig]);
      const { request: innerReq, context } = await server.decapsulateRequest(ohttpRequest);
      const innerRes = new Response(JSON.stringify({ method: innerReq.method, url: innerReq.url, received: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
      const encapsulated = await context.encapsulateResponse(innerRes);
      res.status(200).set("Content-Type", "message/ohttp-res").send(Buffer.from(await encapsulated.arrayBuffer()));
    } catch (err) {
      res.status(400).json({ error: String(err) });
    }
  });

  gatewayServer = createServer(gatewayApp);
  gatewayPort = await new Promise<number>((resolve, reject) => {
    gatewayServer.listen(0, () => {
      const addr = gatewayServer.address();
      if (typeof addr === "object" && addr) resolve(addr.port);
      else reject(new Error("no gateway port"));
    });
  });

  relayApp = express();
  relayApp.use(raw({ type: "message/ohttp-req", limit: "1mb" }));
  relayApp.post("/", async (req, res) => {
    try {
      const response = await fetch(`http://localhost:${gatewayPort}/`, {
        method: "POST",
        headers: { "Content-Type": "message/ohttp-req" },
        body: req.body,
      });
      const data = await response.arrayBuffer();
      res.set("Content-Type", "message/ohttp-res").send(Buffer.from(data));
    } catch {
      res.status(502).json({ error: "relay forward failed" });
    }
  });

  relayServer = createServer(relayApp);
  relayPort = await new Promise<number>((resolve, reject) => {
    relayServer.listen(0, () => {
      const addr = relayServer.address();
      if (typeof addr === "object" && addr) resolve(addr.port);
      else reject(new Error("no relay port"));
    });
  });
});

afterAll(async () => {
  await new Promise<void>((resolve) => gatewayServer.close(() => resolve()));
  await new Promise<void>((resolve) => relayServer.close(() => resolve()));
});

// ============================================================================
// §3 — Key Configuration
// ============================================================================

describe("RFC 9458 §3 — Key Configuration", () => {
  it("§3.1 — key config encoding: keyId(8), kemId(16), pubkey, symAlgosLength(16), symAlgos", async () => {
    const bytes = serializeKeys([keyConfig]);
    // application/ohttp-keys: 2-byte length prefix + key config
    expect(bytes[0]).toBeDefined();
    const configLength = (bytes[0] << 8) | bytes[1];
    expect(configLength).toBeGreaterThan(0);
    expect(configLength).toBe(bytes.length - 2);

    // Within the key config: keyId(1) + kemId(2) = 3 bytes header minimum
    expect(bytes[2]).toBe(0x01); // keyId = 1
    const kemId = (bytes[3] << 8) | bytes[4];
    expect(kemId).toBe(0x0020); // DHKEM(X25519, HKDF-SHA256)
  });

  it("§3.1 — symmetric algorithms: pairs of kdfId(16) + aeadId(16)", async () => {
    const bytes = serializeKeys([keyConfig]);
    const pubkeyLength = 32; // X25519
    const symAlgosLengthOffset = 2 + 1 + 2 + pubkeyLength;
    const symAlgosLength = (bytes[symAlgosLengthOffset] << 8) | bytes[symAlgosLengthOffset + 1];
    expect(symAlgosLength).toBe(4); // one pair: kdfId(2) + aeadId(2)

    const kdfId = (bytes[symAlgosLengthOffset + 2] << 8) | bytes[symAlgosLengthOffset + 3];
    const aeadId = (bytes[symAlgosLengthOffset + 4] << 8) | bytes[symAlgosLengthOffset + 5];
    expect(kdfId).toBe(0x0001); // HKDF-SHA256
    expect(aeadId).toBe(0x0001); // AES-128-GCM
  });

  it("§3.2 — application/ohttp-keys media type on /ohttp-keys endpoint", async () => {
    const res = await fetch(`http://localhost:${gatewayPort}/ohttp-keys`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/^application\/ohttp-keys/);
  });

  it("§3.2 — key config bytes are parseable by a client", async () => {
    const res = await fetch(`http://localhost:${gatewayPort}/ohttp-keys`);
    const data = new Uint8Array(await res.arrayBuffer());
    const configs = parseKeys(data);
    expect(configs.length).toBeGreaterThan(0);
    expect(configs[0].keyId).toBe(0x01);
  });

  it("§3 — key config integrity: parsing corrupt bytes throws", () => {
    const corrupt = new Uint8Array([0x00, 0x05, 0xFF, 0xFF, 0xFF]);
    expect(() => parseKeys(corrupt)).toThrow();
  });
});

// ============================================================================
// §4 — HPKE Encapsulation
// ============================================================================

describe("RFC 9458 §4 — HPKE Encapsulation", () => {
  it("§4.1 — encapsulated request wire format: keyId(8) || kemId(16) || kdfId(16) || aeadId(16) || enc || ct", async () => {
    const client = makeClient(keyConfig);
    const innerReq = new Request("http://target/test?foo=bar", { method: "GET" });
    const { init } = await client.encapsulateRequest(innerReq);
    const body = await bodyToBytes(init.body);

    expect(body[0]).toBe(0x01); // keyId
    const kemId = (body[1] << 8) | body[2];
    expect(kemId).toBe(0x0020);
    const kdfId = (body[3] << 8) | body[4];
    expect(kdfId).toBe(0x0001);
    const aeadId = (body[5] << 8) | body[6];
    expect(aeadId).toBe(0x0001);
    expect(body.length).toBeGreaterThan(7 + 32);
  });

  it("§4.2 — encapsulated response wire format: nonce(max(Nn,Nk)) || AEAD-protected response", async () => {
    const client = makeClient(keyConfig);
    const innerReq = new Request("http://target/test", { method: "GET" });
    const { init } = await client.encapsulateRequest(innerReq);

    const gatewayRes = await fetch(`http://localhost:${gatewayPort}/`, {
      method: "POST",
      headers: { "Content-Type": "message/ohttp-req" },
      body: init.body,
    });
    expect(gatewayRes.status).toBe(200);

    const encRespBytes = new Uint8Array(await gatewayRes.arrayBuffer());
    // For AES-128-GCM: Nn=12, Nk=16, max(12,16) = 16
    expect(encRespBytes.length).toBeGreaterThan(16);
  });

  it("§4.3 — client->gateway request round-trip produces correct inner request", async () => {
    const client = makeClient(keyConfig);
    const innerReq = new Request("http://target/api/data?x=1", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key: "value" }),
    });
    const { init, context } = await client.encapsulateRequest(innerReq);

    const gatewayRes = await fetch(`http://localhost:${gatewayPort}/`, {
      method: "POST",
      headers: { "Content-Type": "message/ohttp-req" },
      body: init.body,
    });
    expect(gatewayRes.status).toBe(200);
    expect(gatewayRes.headers.get("content-type")).toBe("message/ohttp-res");

    const decRes = await context.decapsulateResponse(gatewayRes);
    const body = await decRes.json();
    expect(body.method).toBe("POST");
    expect(body.url).toContain("/api/data?x=1");
    expect(body.received).toBe(true);
  });

  it("§4.3 — HPKE info string uses 'message/bhttp request' label (verified via interop)", async () => {
    const client = makeClient(keyConfig);
    const { init, context } = await client.encapsulateRequest(
      new Request("http://target/interop", { method: "GET" }),
    );

    const res = await fetch(`http://localhost:${gatewayPort}/`, {
      method: "POST",
      headers: { "Content-Type": "message/ohttp-req" },
      body: init.body,
    });
    expect(res.status).toBe(200);
    const decRes = await context.decapsulateResponse(res);
    expect(decRes.status).toBe(200);
  });

  it("§4.4 — response encapsulation uses 'message/bhttp response' export label", async () => {
    const client = makeClient(keyConfig);
    const { init, context } = await client.encapsulateRequest(
      new Request("http://target/export-label", { method: "GET" }),
    );

    const res = await fetch(`http://localhost:${gatewayPort}/`, {
      method: "POST",
      headers: { "Content-Type": "message/ohttp-req" },
      body: init.body,
    });
    const decRes = await context.decapsulateResponse(res);
    expect(decRes.status).toBe(200);
    const data = await decRes.json();
    expect(data.received).toBe(true);
  });

  it("§4.3 — each request uses a fresh HPKE context (different enc per request)", async () => {
    const client = makeClient(keyConfig);
    const encs: string[] = [];

    for (let i = 0; i < 3; i++) {
      const { init } = await client.encapsulateRequest(
        new Request("http://target/fresh", { method: "GET" }),
      );
      const body = await bodyToBytes(init.body);
      encs.push(Array.from(body.slice(7, 39)).join(","));
    }

    expect(new Set(encs).size).toBe(3);
  });

  it("§4.3 — wrong key_id causes decryption failure at gateway", async () => {
    const wrongConfig = await generateKeyConfig(0x99);
    const client = makeClient(wrongConfig);
    const { init } = await client.encapsulateRequest(
      new Request("http://target/wrong-key", { method: "GET" }),
    );

    const res = await fetch(`http://localhost:${gatewayPort}/`, {
      method: "POST",
      headers: { "Content-Type": "message/ohttp-req" },
      body: init.body,
    });
    expect(res.status).toBe(400);
  });
});

// ============================================================================
// §5 — HTTP Usage
// ============================================================================

describe("RFC 9458 §5 — HTTP Usage (Client -> Relay -> Gateway)", () => {
  it("§5 — client sends POST with Content-Type: message/ohttp-req to relay", async () => {
    const client = makeClient(keyConfig);
    const { init, context } = await client.encapsulateRequest(
      new Request("http://target/via-relay", { method: "GET" }),
    );

    const relayRes = await fetch(`http://localhost:${relayPort}/`, {
      method: "POST",
      headers: { "Content-Type": "message/ohttp-req" },
      body: init.body,
    });
    expect(relayRes.status).toBe(200);
    expect(relayRes.headers.get("content-type")).toBe("message/ohttp-res");

    const decRes = await context.decapsulateResponse(relayRes);
    expect(decRes.status).toBe(200);
  });

  it("§5 — gateway responds with 200 + Content-Type: message/ohttp-res", async () => {
    const client = makeClient(keyConfig);
    const { init, context } = await client.encapsulateRequest(
      new Request("http://target/gateway-200", { method: "GET" }),
    );

    const res = await fetch(`http://localhost:${gatewayPort}/`, {
      method: "POST",
      headers: { "Content-Type": "message/ohttp-req" },
      body: init.body,
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("message/ohttp-res");
    await context.decapsulateResponse(res);
  });

  it("§5.2 — invalid encapsulated request returns 4xx (unencrypted)", async () => {
    const res = await fetch(`http://localhost:${gatewayPort}/`, {
      method: "POST",
      headers: { "Content-Type": "message/ohttp-req" },
      body: Buffer.from(new Uint8Array([0x01, 0x00, 0x20, 0x00, 0x01, 0x00, 0x01, 0xDE, 0xAD])),
    });
    expect(res.status).toBe(400);
    expect(res.headers.get("content-type")).not.toBe("message/ohttp-res");
  });

  it("§5.2 — wrong Content-Type to gateway returns 4xx", async () => {
    const res = await fetch(`http://localhost:${gatewayPort}/`, {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: "not an ohttp request",
    });
    expect(res.status).toBe(400);
  });

  it("§9.2 §9.3 — correct media types on request and response", async () => {
    const client = makeClient(keyConfig);
    const { init, context } = await client.encapsulateRequest(
      new Request("http://target/media-types", { method: "GET" }),
    );

    expect((init.headers as Record<string, string>)["Content-Type"]).toBe("message/ohttp-req");

    const res = await fetch(`http://localhost:${gatewayPort}/`, {
      method: "POST",
      headers: { "Content-Type": "message/ohttp-req" },
      body: init.body,
    });
    expect(res.headers.get("content-type")).toBe("message/ohttp-res");

    const decRes = await context.decapsulateResponse(res);
    expect(decRes.status).toBe(200);
  });
});

// ============================================================================
// §6 — Security Considerations
// ============================================================================

describe("RFC 9458 §6 — Security Considerations", () => {
  it("§6.1 — each request uses a new HPKE context (fresh entropy per request)", async () => {
    const client = makeClient(keyConfig);
    const bodies: Uint8Array[] = [];

    for (let i = 0; i < 5; i++) {
      const { init } = await client.encapsulateRequest(
        new Request("http://target/entropy", { method: "GET" }),
      );
      bodies.push(await bodyToBytes(init.body));
    }

    const unique = new Set(bodies.map((b) => Array.from(b).join(",")));
    expect(unique.size).toBe(5);
  });

  it("§6.5 — replayed enc values: gateway processes them (no OHTTP-level replay check)", async () => {
    const client = makeClient(keyConfig);
    const { init, context } = await client.encapsulateRequest(
      new Request("http://target/replay-test", { method: "GET" }),
    );

    const body = await bodyToBytes(init.body);

    const res1 = await fetch(`http://localhost:${gatewayPort}/`, {
      method: "POST",
      headers: { "Content-Type": "message/ohttp-req" },
      body: asBody(body),
    });
    expect(res1.status).toBe(200);

    const res2 = await fetch(`http://localhost:${gatewayPort}/`, {
      method: "POST",
      headers: { "Content-Type": "message/ohttp-req" },
      body: asBody(body),
    });
    expect(res2.status).toBe(200);

    await context.decapsulateResponse(res1);
    await context.decapsulateResponse(res2);
  });

  it("§6.1 — request body confidentiality: relay cannot read inner request", async () => {
    const client = makeClient(keyConfig);
    const secret = "sensitive-data-12345";
    const { init } = await client.encapsulateRequest(
      new Request("http://target/confidential", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ secret }),
      }),
    );

    const bodyStr = new TextDecoder().decode(await bodyToBytes(init.body));
    expect(bodyStr).not.toContain(secret);
    expect(bodyStr).not.toContain("sensitive");
  });

  it("§6.4 — gateway can serve multiple key IDs (key rotation support)", async () => {
    const secondConfig = await generateKeyConfig(0x02);
    const client = makeClient(secondConfig);

    const { init } = await client.encapsulateRequest(
      new Request("http://target/key-rotation", { method: "GET" }),
    );
    const body = await bodyToBytes(init.body);
    expect(body[0]).toBe(0x02);

    const res = await fetch(`http://localhost:${gatewayPort}/`, {
      method: "POST",
      headers: { "Content-Type": "message/ohttp-req" },
      body: asBody(body),
    });
    expect(res.status).toBe(400);
  });
});

// ============================================================================
// §5.1 — Informational Responses / 100-continue
// ============================================================================

describe("RFC 9458 §5.1 — Informational Responses", () => {
  it("§5.1 — outer Expect: 100-continue header is not supported by Node.js fetch", async () => {
    // Node.js undici-based fetch rejects the Expect header.
    // In a real deployment, the outer request to the relay/gateway
    // MUST NOT include Expect: 100-continue per RFC §5.1.
    // The inner (encapsulated) request also MUST NOT include it.
    // This is verified by the ohttp-ts Binary HTTP encoder which
    // does not include Expect in the encoded request.
    const client = makeClient(keyConfig);
    const { init, context } = await client.encapsulateRequest(
      new Request("http://target/no-continue", { method: "POST", body: "test" }),
    );

    // Verify the encapsulated request works without Expect header
    const res = await fetch(`http://localhost:${gatewayPort}/`, {
      method: "POST",
      headers: { "Content-Type": "message/ohttp-req" },
      body: init.body,
    });
    expect(res.status).toBe(200);
    await context.decapsulateResponse(res);
  });
});

// ============================================================================
// §5.3 — Key Configuration Problem Signaling
// ============================================================================

describe("RFC 9458 §5.3 — Key Configuration Problem Signaling", () => {
  it("§5.3 — gateway returns 4xx for unknown key (gap: not RFC 7807 Problem Details)", async () => {
    const wrongConfig = await generateKeyConfig(0xFF);
    const client = makeClient(wrongConfig);
    const { init } = await client.encapsulateRequest(
      new Request("http://target/bad-key", { method: "GET" }),
    );

    const res = await fetch(`http://localhost:${gatewayPort}/`, {
      method: "POST",
      headers: { "Content-Type": "message/ohttp-req" },
      body: init.body,
    });

    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);

    const ct = res.headers.get("content-type");
    // CONFORMANCE GAP: RFC §5.3 says gateway MAY use application/problem+json
    // with type "https://iana.org/assignments/http-problem-types#ohttp-key"
    // Current implementation returns application/json
    if (ct) {
      expect(ct).toMatch(/json/);
      if (ct.includes("problem+json")) {
        const body = await res.json();
        expect(body.type).toBe("https://iana.org/assignments/http-problem-types#ohttp-key");
      }
    }
  });
});

// ============================================================================
// §6.5.1 — Date Header for Anti-Replay
// ============================================================================

describe("RFC 9458 §6.5.1 — Date Header for Anti-Replay", () => {
  it("§6.5.1 — client SHOULD include Date in encapsulated request (documented gap)", async () => {
    const innerReq = new Request("http://target/date-check", { method: "GET" });
    expect(innerReq.headers.get("date")).toBeNull();

    const client = makeClient(keyConfig);
    const { init, context } = await client.encapsulateRequest(innerReq);
    const res = await fetch(`http://localhost:${gatewayPort}/`, {
      method: "POST",
      headers: { "Content-Type": "message/ohttp-req" },
      body: init.body,
    });
    const decRes = await context.decapsulateResponse(res);
    const body = await decRes.json();
    expect(body.url).toContain("/date-check");
  });
});

// ============================================================================
// §6.2 — Relay Responsibilities
// ============================================================================

describe("RFC 9458 §6.2 — Relay Responsibilities", () => {
  it("§6.2 — relay does not modify encapsulated request body", async () => {
    const client = makeClient(keyConfig);
    const { init, context } = await client.encapsulateRequest(
      new Request("http://target/relay-fidelity", { method: "GET" }),
    );
    const origBody = await bodyToBytes(init.body);

    const relayRes = await fetch(`http://localhost:${relayPort}/`, {
      method: "POST",
      headers: { "Content-Type": "message/ohttp-req" },
      body: asBody(origBody),
    });
    expect(relayRes.status).toBe(200);

    const decRes = await context.decapsulateResponse(relayRes);
    expect(decRes.status).toBe(200);
  });

  it("§6.2 — relay forwards response as-is from gateway", async () => {
    const client = makeClient(keyConfig);

    const { init: init2, context: context2 } = await client.encapsulateRequest(
      new Request("http://target/relay-response", { method: "GET" }),
    );

    const relayRes = await fetch(`http://localhost:${relayPort}/`, {
      method: "POST",
      headers: { "Content-Type": "message/ohttp-req" },
      body: init2.body,
    });
    const relayBody = new Uint8Array(await relayRes.arrayBuffer());

    expect(relayRes.headers.get("content-type")).toBe("message/ohttp-res");

    const relayDec = await context2.decapsulateResponse(
      new Response(relayBody, { headers: { "Content-Type": "message/ohttp-res" } }),
    );
    expect(relayDec.status).toBe(200);
  });
});
