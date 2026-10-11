import { registerPlugin } from "@capacitor/core";

interface SPlayerAccountKeyPlugin {
  saveKey(options: { accountId: string; key: string }): Promise<void>;
  getKey(options: { accountId: string }): Promise<{ key: string | null }>;
  deleteKey(options: { accountId: string }): Promise<void>;
}

export const sPlayerAccountKeyPlugin = registerPlugin<SPlayerAccountKeyPlugin>("SPlayerAccountKey");
