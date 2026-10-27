import { safeStorage } from "electron";
import { existsSync, readFileSync, writeFileSync, renameSync } from "node:fs";
import { join } from "node:path";
export class SecretVault {
  available = false;
  private values: Record<string, string> = {};
  private ciphertext: Record<string, string> = {};
  private file: string;
  constructor(root: string) {
    this.file = join(root, "credentials.json");
  }
  async initialize() {
    this.available = await safeStorage.isAsyncEncryptionAvailable();
    if (!existsSync(this.file) || !this.available) return;
    try {
      this.ciphertext = JSON.parse(readFileSync(this.file, "utf8"));
    } catch {
      return;
    }
    for (const [key, value] of Object.entries(this.ciphertext))
      try {
        this.values[key] = (
          await safeStorage.decryptStringAsync(Buffer.from(value, "base64"))
        ).result;
      } catch {
        /* A rotated/unavailable OS key must not expose plaintext or block the app. */
      }
  }
  get(key: string) {
    return this.values[key];
  }
  async set(key: string, value: string) {
    this.values[key] = value;
    if (!this.available) return;
    this.ciphertext[key] = (
      await safeStorage.encryptStringAsync(value)
    ).toString("base64");
    const temporary = this.file + ".tmp";
    writeFileSync(temporary, JSON.stringify(this.ciphertext), "utf8");
    renameSync(temporary, this.file);
  }
}
