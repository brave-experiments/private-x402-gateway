import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

async function runE2E() {
  const {
    voprfKeyGen,
    generateOHTTPKeyPair,
    uint8ArrayToBase64,
    createVOPRFClient,
    batchBlind,
    batchFinalize,
    uint8ArrayToBase64Url,
    base64UrlToUint8Array,
    generateNonce,
    createTokenChallenge,
    hashTokenChallenge,
    buildTokenInput,
    createToken,
    encodeTokenForHeader,
    TOKEN_COUNT,
    evaluatedElementsToEvaluation,
  } = await import("@ppg/shared");

  const keyDir = join(tmpdir(), `ppg-e2e-${Date.now()}`);
  await mkdir(keyDir, { recursive: true });

  const voprfKeys = await voprfKeyGen();
  await writeFile(
    join(keyDir, "voprf.json"),
    JSON.stringify({
      privateKey: uint8ArrayToBase64(voprfKeys.privateKey),
      publicKey: uint8ArrayToBase64(voprfKeys.publicKey),
    }, null, 2),
  );

  const ohttpKeys = await generateOHTTPKeyPair();
  await writeFile(
    join(keyDir, "ohttp.json"),
    JSON.stringify({
      keyId: uint8ArrayToBase64(ohttpKeys.keyId),
      publicKey: uint8ArrayToBase64(ohttpKeys.publicKey),
      privateKey: uint8ArrayToBase64(ohttpKeys.privateKey),
    }, null, 2),
  );

  console.log("=== PPG E2E Test ===\n");

  const { createApp: createFacilitatorApp } = await import("@ppg/facilitator");
  const { createApp: createGatewayApp } = await import("@ppg/gateway");

  process.env.SHARED_KEYS_DIR = keyDir;

  const facilitatorResult = await createFacilitatorApp();
  const facilitatorApp = facilitatorResult.app;
  const facilitatorPort = await new Promise<number>((resolve, reject) => {
    const server = facilitatorApp.listen(0, () => {
      const addr = server.address();
      if (typeof addr === "object" && addr) resolve(addr.port);
      else reject(new Error("Failed to get facilitator port"));
    });
  });
  console.log(`[+] Facilitator listening on port ${facilitatorPort}`);

  const gatewayResult = await createGatewayApp();
  const gatewayApp = gatewayResult.app;
  const gatewayPort = await new Promise<number>((resolve, reject) => {
    const server = gatewayApp.listen(0, () => {
      const addr = server.address();
      if (typeof addr === "object" && addr) resolve(addr.port);
      else reject(new Error("Failed to get gateway port"));
    });
  });
  console.log(`[+] Gateway listening on port ${gatewayPort}`);

  const facilitatorUrl = `http://localhost:${facilitatorPort}`;
  const gatewayUrl = `http://localhost:${gatewayPort}`;
  const weatherUrl = `${gatewayUrl}/api/weather`;

  const tests: { name: string; fn: () => Promise<void> }[] = [];

  tests.push({
    name: "1. GET /token-key returns 32-byte public key",
    fn: async () => {
      const res = await fetch(`${facilitatorUrl}/token-key`);
      if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}`);
      const buf = await res.arrayBuffer();
      if (buf.byteLength !== 32) throw new Error(`Expected 32 bytes, got ${buf.byteLength}`);
      console.log("   PASS");
    },
  });

  tests.push({
    name: "2. GET /api/weather returns 402 with challenge",
    fn: async () => {
      const res = await fetch(weatherUrl);
      if (res.status !== 402) throw new Error(`Expected 402, got ${res.status}`);
      const wwwAuth = res.headers.get("www-authenticate");
      if (!wwwAuth?.includes("PrivateToken")) throw new Error("Missing PrivateToken");
      if (!wwwAuth.includes("challenge=")) throw new Error("Missing challenge");
      if (!wwwAuth.includes("token-key=")) throw new Error("Missing token-key");
      if (!res.headers.get("x-payment-required")) throw new Error("Missing X-Payment-Required");
      console.log("   PASS");
    },
  });

  tests.push({
    name: "3. POST /issue with 1000 blinded elements succeeds",
    fn: async () => {
      const keyRes = await fetch(`${facilitatorUrl}/token-key`);
      const publicKey = new Uint8Array(await keyRes.arrayBuffer());

      const client = createVOPRFClient(publicKey);
      const challenge = createTokenChallenge("gateway");
      const challengeDigest = hashTokenChallenge(challenge);

      const tokenInputs = Array.from({ length: TOKEN_COUNT }, () => {
        const nonce = generateNonce();
        return buildTokenInput(nonce, challengeDigest, publicKey);
      });

      const { evalReq } = await batchBlind(client, tokenInputs);
      const blindedElements = evalReq.blinded.map((e) => uint8ArrayToBase64Url(e.serialize()));

      const res = await fetch(`${facilitatorUrl}/issue`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ paymentPayload: { x402Version: 2 }, blindedElements }),
      });
      if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}: ${await res.text()}`);

      const body = await res.json();
      if (!body.evaluatedElements || body.evaluatedElements.length !== TOKEN_COUNT) {
        throw new Error(`Expected ${TOKEN_COUNT} evaluated elements, got ${body.evaluatedElements?.length}`);
      }
      if (!body.proof) throw new Error("Missing proof");
      if (!body.settlement?.success) throw new Error("Settlement failed");
      console.log("   PASS");
    },
  });

  tests.push({
    name: "4. POST /issue rejects wrong element count",
    fn: async () => {
      const res = await fetch(`${facilitatorUrl}/issue`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          paymentPayload: {},
          blindedElements: Array.from({ length: 10 }, () => uint8ArrayToBase64Url(new Uint8Array(32))),
        }),
      });
      if (res.status !== 400) throw new Error(`Expected 400, got ${res.status}`);
      console.log("   PASS");
    },
  });

  tests.push({
    name: "5. Full flow: 402 -> buy tokens -> access -> replay rejected",
    fn: async () => {
      const keyRes = await fetch(`${facilitatorUrl}/token-key`);
      const publicKey = new Uint8Array(await keyRes.arrayBuffer());

      const unauthRes = await fetch(weatherUrl);
      if (unauthRes.status !== 402) throw new Error("Expected 402");

      const wwwAuth = unauthRes.headers.get("www-authenticate")!;
      const tokenKeyB64 = wwwAuth.match(/token-key="([^"]+)"/)![1];
      const issuerPubKey = base64UrlToUint8Array(tokenKeyB64);

      if (issuerPubKey.length !== 32) {
        throw new Error(`Expected 32-byte issuer public key, got ${issuerPubKey.length}`);
      }

      const client = createVOPRFClient(issuerPubKey);
      const challenge = createTokenChallenge("gateway");
      const challengeDigest = hashTokenChallenge(challenge);
      const keyId = issuerPubKey;

      const nonces: Uint8Array[] = [];
      const tokenInputs: Uint8Array[] = [];
      for (let i = 0; i < TOKEN_COUNT; i++) {
        const nonce = generateNonce();
        nonces.push(nonce);
        tokenInputs.push(buildTokenInput(nonce, challengeDigest, keyId));
      }

      const { finData, evalReq } = await batchBlind(client, tokenInputs);
      const blindedElements = evalReq.blinded.map((e) => uint8ArrayToBase64Url(e.serialize()));

      const issueRes = await fetch(`${facilitatorUrl}/issue`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ paymentPayload: { x402Version: 2 }, blindedElements }),
      });
      if (issueRes.status !== 200) throw new Error(`Issue failed: ${issueRes.status}`);

      const issueBody = await issueRes.json();
      const evaluatedElements = issueBody.evaluatedElements.map((b64: string) => base64UrlToUint8Array(b64));
      const proof = base64UrlToUint8Array(issueBody.proof);
      const evaluation = evaluatedElementsToEvaluation(evaluatedElements, proof);

      const outputs = await batchFinalize(client, finData, evaluation);
      if (outputs.length !== TOKEN_COUNT) throw new Error(`Expected ${TOKEN_COUNT} outputs`);

      const tokens = nonces.map((nonce, i) => createToken(nonce, challengeDigest, keyId, outputs[i]));

      const tokenHeader = `PrivateToken token="${encodeTokenForHeader(tokens[0])}"`;
      const accessRes = await fetch(weatherUrl, { headers: { Authorization: tokenHeader } });

      if (accessRes.status !== 200) {
        const errorBody = await accessRes.text();
        throw new Error(`Token verification failed: ${accessRes.status} - ${errorBody}`);
      }

      const weatherData = await accessRes.json();
      if (weatherData.temperature !== 72) throw new Error("Wrong temperature in response");

      const replayRes = await fetch(weatherUrl, { headers: { Authorization: tokenHeader } });
      if (replayRes.status !== 401) throw new Error(`Expected 401 on replay, got ${replayRes.status}`);

      const secondHeader = `PrivateToken token="${encodeTokenForHeader(tokens[1])}"`;
      const secondRes = await fetch(weatherUrl, { headers: { Authorization: secondHeader } });
      if (secondRes.status !== 200) throw new Error(`Expected 200 with different token, got ${secondRes.status}`);

      console.log("   PASS");
    },
  });

  let passed = 0;
  let failed = 0;

  for (const test of tests) {
    process.stdout.write(`[*] ${test.name}...`);
    try {
      await test.fn();
      passed++;
    } catch (err) {
      console.log(`   FAIL: ${err}`);
      failed++;
    }
  }

  console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
  process.exit(failed > 0 ? 1 : 0);
}

runE2E().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
