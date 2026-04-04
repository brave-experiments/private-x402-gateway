import { getCount } from "../services/token-store.js";

export async function balanceAction(): Promise<number> {
  return getCount();
}
