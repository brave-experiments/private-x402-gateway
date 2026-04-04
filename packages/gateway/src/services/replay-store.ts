export class ReplayStore {
  private used = new Set<string>();

  isUsed(nonce: Uint8Array): boolean {
    const hex = Array.from(nonce)
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
    return this.used.has(hex);
  }

  markUsed(nonce: Uint8Array): void {
    const hex = Array.from(nonce)
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
    this.used.add(hex);
  }

  clear(): void {
    this.used.clear();
  }
}
