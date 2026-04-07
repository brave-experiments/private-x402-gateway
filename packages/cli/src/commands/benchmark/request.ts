import { encodeTokenForHeader } from "@ppg/shared";
import { OHTTPClient } from "../../services/ohttp-client.js";
import { consumeToken, getTokens } from "../../services/token-store.js";
import { Timer } from "./timer.js";
import { formatStats, formatRequestStats } from "./format.js";

const DEFAULT_GATEWAY = "http://localhost:3001";

export async function benchmarkRequest(options: {
  gateway?: string;
  relay?: string;
  noRelay?: boolean;
  count?: number;
}): Promise<void> {
  const count = options.count ?? 1;
  const gateway = options.gateway ?? DEFAULT_GATEWAY;
  const relay = options.noRelay ? "" : (options.relay || "http://localhost:3000");
  const url = `${gateway}/api/weather`;
  const httpClient = new OHTTPClient(relay);

  const available = await getTokens();
  if (available.length < count) {
    throw new Error(`Not enough tokens. Have ${available.length}, need ${count}. Run 'ppg buy-tokens' first.`);
  }

  const timings: number[] = [];

  for (let i = 0; i < count; i++) {
    const token = await consumeToken();
    if (!token) throw new Error(`Ran out of tokens at request ${i + 1}/${count}`);

    const t = new Timer();
    t.start("request");
    const resp = await httpClient.request(url, {
      headers: {
        Authorization: `PrivateToken token="${encodeTokenForHeader(token)}"`,
      },
    });
    t.end("request");

    if (resp.status !== 200) {
      throw new Error(`Request ${i + 1} failed with status ${resp.status}: ${await resp.text()}`);
    }

    timings.push(t.total());
  }

  const stats = formatStats(timings);
  const title = count === 1
    ? "Single Request"
    : `${count} Sequential Requests`;
  console.log(formatRequestStats(stats, title));
}
