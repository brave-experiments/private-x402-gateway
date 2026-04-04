import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { airdropViaFaucet, airdropViaRpc } from "../commands/fund-account.js";
import type { FaucetResult } from "../commands/fund-account.js";

const originalFetch = globalThis.fetch;

describe("airdropViaFaucet", () => {
  beforeEach(() => {
    globalThis.fetch = vi.fn();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("returns success on 200 response", async () => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(new Response("", { status: 200 }));

    const result = await airdropViaFaucet("TestPubkey111111111111111111111111111111", 2);

    expect(result.success).toBe(true);
    expect(result.method).toBe("faucet.solana.com");
    expect(result.amount).toBe(2);
  });

  it("returns error with body on non-200 response", async () => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(
      new Response("GitHub authentication is required", { status: 403 }),
    );

    const result = await airdropViaFaucet("TestPubkey111111111111111111111111111111", 1);

    expect(result.success).toBe(false);
    expect(result.method).toBe("faucet.solana.com");
    expect(result.error).toContain("GitHub authentication");
  });

  it("returns error on network failure", async () => {
    vi.mocked(globalThis.fetch).mockRejectedValueOnce(new TypeError("fetch failed"));

    const result = await airdropViaFaucet("TestPubkey111111111111111111111111111111", 2);

    expect(result.success).toBe(false);
    expect(result.error).toContain("fetch failed");
  });

  it("sends correct request body", async () => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(new Response("", { status: 200 }));

    await airdropViaFaucet("TestPubkey111111111111111111111111111111", 5);

    const call = vi.mocked(globalThis.fetch).mock.calls[0];
    expect(call[0]).toBe("https://faucet.solana.com/api/request");
    const body = JSON.parse(call[1]!.body as string);
    expect(body.walletAddress).toBe("TestPubkey111111111111111111111111111111");
    expect(body.amount).toBe(5);
    expect(body.network).toBe("devnet");
  });
});

describe("airdropViaRpc", () => {
  beforeEach(() => {
    globalThis.fetch = vi.fn();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("returns success with signature on valid response", async () => {
    const mockSig = "5UfDuX7W3KbpB1QZ6J7dA5sFqV3Y8qR4mN2oP9xL6kHjE";
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ jsonrpc: "2.0", result: mockSig, id: 1 }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    const result = await airdropViaRpc("TestPubkey111111111111111111111111111111", 2, "https://api.devnet.solana.com");

    expect(result.success).toBe(true);
    expect(result.signature).toBe(mockSig);
    expect(result.amount).toBe(2);
  });

  it("returns error when RPC returns jsonrpc error", async () => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          jsonrpc: "2.0",
          error: { code: 429, message: "Airdrop limit reached" },
          id: 1,
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    const result = await airdropViaRpc("TestPubkey111111111111111111111111111111", 2, "https://api.devnet.solana.com");

    expect(result.success).toBe(false);
    expect(result.error).toBe("Airdrop limit reached");
  });

  it("returns error when RPC returns null result", async () => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ jsonrpc: "2.0", result: null, id: 1 }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    const result = await airdropViaRpc("TestPubkey111111111111111111111111111111", 1, "https://rpc.example.com");

    expect(result.success).toBe(false);
    expect(result.error).toBe("No signature returned");
  });

  it("returns error on network failure", async () => {
    vi.mocked(globalThis.fetch).mockRejectedValueOnce(new Error("Connection refused"));

    const result = await airdropViaRpc("TestPubkey111111111111111111111111111111", 2, "https://bad.example.com");

    expect(result.success).toBe(false);
    expect(result.error).toContain("Connection refused");
  });

  it("sends correct JSON-RPC params with lamports", async () => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ jsonrpc: "2.0", result: "sig123", id: 1 }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    await airdropViaRpc("TestPubkey111111111111111111111111111111", 3, "https://api.devnet.solana.com");

    const call = vi.mocked(globalThis.fetch).mock.calls[0];
    const body = JSON.parse(call[1]!.body as string);
    expect(body.jsonrpc).toBe("2.0");
    expect(body.method).toBe("requestAirdrop");
    expect(body.params[0]).toBe("TestPubkey111111111111111111111111111111");
    expect(body.params[1]).toBe(3_000_000_000); // 3 SOL in lamports
  });

  it("includes RPC URL in error method name", async () => {
    vi.mocked(globalThis.fetch).mockRejectedValueOnce(new Error("timeout"));

    const result = await airdropViaRpc("TestPubkey111111111111111111111111111111", 2, "https://custom.rpc.com");

    expect(result.method).toContain("custom.rpc.com");
  });
});
