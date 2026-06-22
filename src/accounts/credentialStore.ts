import { load, Store } from "@tauri-apps/plugin-store";
import { setPassword, getPassword, deletePassword } from "tauri-plugin-keyring-api";
import type { AccountConfig } from "../types/matrix";

const KEYRING_SERVICE = "weave-e2ee";
/** Keyring namespace for Matrix access tokens. Keyed by the account UUID
 *  (session-scoped) so it is removed on logout/expiry, unlike the E2EE key. */
const TOKEN_SERVICE = "weave-tokens";

/**
 * Persist the SSSS/recovery key for a Matrix user in the OS keychain.
 * We key by userId (e.g. "@user:matrix.org") — NOT the ephemeral account UUID —
 * so the key survives session expiry and re-login.
 */
export async function saveE2EEKey(userId: string, key: string): Promise<void> {
  await setPassword(KEYRING_SERVICE, userId, key);
}

/**
 * Retrieve the SSSS key for a Matrix user from the OS keychain.
 * Returns null if no key has been saved yet.
 */
export async function loadE2EEKey(userId: string): Promise<string | null> {
  try {
    return await getPassword(KEYRING_SERVICE, userId);
  } catch {
    return null;
  }
}

/**
 * Remove the saved SSSS key for a Matrix user (e.g. on explicit sign-out).
 * Should NOT be called on session expiry — the key belongs to the user, not the session.
 */
export async function deleteE2EEKey(userId: string): Promise<void> {
  try {
    await deletePassword(KEYRING_SERVICE, userId);
  } catch {
    // Key may not exist; ignore
  }
}


/**
 * Persist a Matrix access token in the OS keychain. The token grants full
 * account access, so it must never be written to the plaintext accounts.json
 * store. Keyed by the account UUID.
 */
async function saveAccessToken(id: string, token: string): Promise<void> {
  await setPassword(TOKEN_SERVICE, id, token);
}

async function loadAccessToken(id: string): Promise<string | null> {
  try {
    return await getPassword(TOKEN_SERVICE, id);
  } catch {
    return null;
  }
}

async function deleteAccessToken(id: string): Promise<void> {
  try {
    await deletePassword(TOKEN_SERVICE, id);
  } catch {
    // Token may not exist; ignore
  }
}

let _store: Store | null = null;

async function getStore(): Promise<Store> {
  if (!_store) {
    _store = await load("accounts.json", { autoSave: true, defaults: {} });
  }
  return _store;
}

/** Shape persisted to accounts.json — the access token is deliberately omitted
 *  and stored in the OS keychain instead. */
type StoredAccount = Omit<AccountConfig, "accessToken"> & { accessToken?: string };

export async function loadAccounts(): Promise<AccountConfig[]> {
  try {
    const store = await getStore();
    const stored = (await store.get<StoredAccount[]>("accounts")) ?? [];

    const result: AccountConfig[] = [];
    let needsMigration = false;

    for (const acc of stored) {
      let token = await loadAccessToken(acc.id);

      // Legacy migration: tokens used to be stored inline in accounts.json.
      // Move any such token into the keychain and strip it from disk.
      if (!token && acc.accessToken) {
        token = acc.accessToken;
        await saveAccessToken(acc.id, token);
        needsMigration = true;
      }

      if (!token) {
        console.warn(`[credentialStore] No access token for account ${acc.id}; skipping.`);
        continue;
      }

      const { accessToken: _inline, ...rest } = acc;
      void _inline;
      result.push({ ...rest, accessToken: token });
    }

    if (needsMigration) {
      // Re-persist the stripped (token-free) configs.
      await store.set("accounts", result.map(stripToken));
    }

    return result;
  } catch (err) {
    console.error("[credentialStore] Failed to load accounts:", err);
    return [];
  }
}

function stripToken(config: AccountConfig): StoredAccount {
  const { accessToken: _t, ...rest } = config;
  void _t;
  return rest;
}

export async function saveAccount(config: AccountConfig): Promise<void> {
  // Token → keychain; everything else → plaintext store.
  await saveAccessToken(config.id, config.accessToken);

  const store = await getStore();
  const existing = (await store.get<StoredAccount[]>("accounts")) ?? [];
  const stripped = stripToken(config);
  const idx = existing.findIndex((a) => a.id === config.id);
  if (idx >= 0) {
    existing[idx] = stripped;
  } else {
    existing.push(stripped);
  }
  await store.set("accounts", existing);
}

export async function deleteAccount(id: string): Promise<void> {
  await deleteAccessToken(id);
  const store = await getStore();
  const existing = (await store.get<StoredAccount[]>("accounts")) ?? [];
  const filtered = existing.filter((a) => a.id !== id);
  await store.set("accounts", filtered);
}

export async function clearAllAccounts(): Promise<void> {
  const store = await getStore();
  const existing = (await store.get<StoredAccount[]>("accounts")) ?? [];
  await Promise.all(existing.map((a) => deleteAccessToken(a.id)));
  await store.set("accounts", []);
}
