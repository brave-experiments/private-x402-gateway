import { getCount, clearTokens } from "../services/token-store.js";

export async function clearTokensAction(): Promise<number> {
  const count = await getCount();
  await clearTokens();
  return count;
}
