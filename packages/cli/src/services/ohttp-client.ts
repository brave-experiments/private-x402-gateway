import {
  OHTTPKeyConfig,
  parseOHTTPKeyConfigBytes,
  createOHTTPClient,
} from "@ppg/shared";
import type { OHTTPKeyConfigType } from "@ppg/shared";

export class OHTTPClient {
  private relayUrl: string;
  private configs: Map<string, { keyConfig: OHTTPKeyConfigType; client: ReturnType<typeof createOHTTPClient> }> = new Map();

  constructor(relayUrl?: string) {
    this.relayUrl = relayUrl || "";
  }

  async fetchKeys(serverUrl: string): Promise<OHTTPKeyConfigType> {
    const cached = this.configs.get(serverUrl);
    if (cached) return cached.keyConfig;

    const res = await fetch(`${serverUrl}/ohttp-keys`);
    if (!res.ok) throw new Error(`Failed to fetch OHTTP keys: ${res.status}`);

    const data = new Uint8Array(await res.arrayBuffer());
    const configs = parseOHTTPKeyConfigBytes(data);
    if (configs.length === 0) throw new Error("No OHTTP key configs found");

    const keyConfig = configs[0];
    const client = createOHTTPClient(keyConfig);
    this.configs.set(serverUrl, { keyConfig, client });
    return keyConfig;
  }

  async request(
    targetUrl: string,
    options: RequestInit = {},
    ohttpTargetUrl?: string,
  ): Promise<Response> {
    if (!this.relayUrl) {
      return fetch(targetUrl, options);
    }

    const serverUrl = ohttpTargetUrl || new URL(targetUrl).origin;
    if (!this.configs.has(serverUrl)) {
      await this.fetchKeys(serverUrl);
    }
    const { client } = this.configs.get(serverUrl)!;

    const url = new URL(targetUrl);
    const innerUrl = `${url.origin}${url.pathname}${url.search}`;

    const headers: Record<string, string> = {};
    if (options.headers) {
      const h = options.headers as Record<string, string>;
      for (const [key, value] of Object.entries(h)) {
        if (key.toLowerCase() === "host") continue;
        headers[key] = value;
      }
    }

    const innerRequest = new Request(innerUrl, {
      method: options.method || "GET",
      headers,
      body: options.body,
    });

    const { init, context } = await client.encapsulateRequest(innerRequest);

    const relayUrl = new URL(this.relayUrl);
    relayUrl.searchParams.set("target", serverUrl);

    const relayRes = await fetch(relayUrl.toString(), {
      method: "POST",
      headers: { "Content-Type": "message/ohttp-req" },
      body: init.body,
    });

    if (relayRes.status !== 200) {
      throw new Error(`OHTTP relay error: ${relayRes.status}`);
    }

    return context.decapsulateResponse(relayRes);
  }
}
