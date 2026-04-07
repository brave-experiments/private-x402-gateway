import { benchmarkIssue } from "./issue.js";
import { benchmarkRequest } from "./request.js";

export async function benchmarkFull(options: {
  facilitator?: string;
  gateway?: string;
  relay?: string;
  noRelay?: boolean;
  iterations?: number;
}): Promise<void> {
  const start = performance.now();

  await benchmarkIssue(options);

  await benchmarkRequest({
    ...options,
    count: 1,
  });

  await benchmarkRequest({
    ...options,
    count: 1000,
  });

  const elapsed = ((performance.now() - start) / 1000).toFixed(1);
  console.log(`Full benchmark completed in ${elapsed}s`);
}
