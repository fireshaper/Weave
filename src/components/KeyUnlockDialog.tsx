import React, { useState } from "react";
import { Key, X, Loader2, AlertTriangle } from "lucide-react";
import { useAccountsStore } from "../store/accountsStore";
import { accountManager } from "../accounts/AccountManager";
import { saveE2EEKey } from "../accounts/credentialStore";
import "./KeyUnlockDialog.css";

interface KeyUnlockDialogProps {
  accountId: string;
  onClose: () => void;
}

const KeyUnlockDialog: React.FC<KeyUnlockDialogProps> = ({ accountId, onClose }) => {
  const account = useAccountsStore((s) => s.accounts.find((a) => a.id === accountId));
  const setUnlocked = useAccountsStore((s) => s.setE2EEUnlocked);
  const [inputKey, setInputKey] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warn, setWarn] = useState<string | null>(null);

  if (!account) return null;

  const handleUnlock = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmedKey = inputKey.trim();
    if (!trimmedKey) return;

    setLoading(true);
    setError(null);
    setWarn(null);

    try {
      const client = accountManager.getClient(accountId);
      if (!client) throw new Error("Client not found");

      const crypto = client.getCrypto();
      if (!crypto) throw new Error("Crypto backend is not running. Please restart the app.");

      // ── Phase 1: bootstrapSecretStorage ───────────────────────────────────────
      // This verifies the key and loads cross-signing + backup keys from SSSS.
      // A "bad MAC" on m.megolm_backup.v1 means the backup secret in SSSS is
      // stale/corrupt but the SSSS key itself was accepted. We continue in that case.
      accountManager.setPendingKey(accountId, trimmedKey);
      let bootstrapBadMac = false;
      let fatalError: any = null;

      try {
        await crypto.bootstrapSecretStorage({ setupNewKeyBackup: false, setupNewSecretStorage: false });
        console.log("[KeyUnlockDialog] bootstrapSecretStorage OK");
      } catch (bsErr: any) {
        const msg: string = typeof bsErr === "string" ? bsErr : (bsErr?.message ?? "");
        console.error("[KeyUnlockDialog] bootstrapSecretStorage threw:", msg);
        if (msg.toLowerCase().includes("bad mac") || msg.toLowerCase().includes("bad_mac")) {
          bootstrapBadMac = true;
          // Don't rethrow — treat as degraded. The SSSS key verification MAC
          // would have failed BEFORE this if the key were wrong; reaching this
          // error with "bad MAC" on a specific secret means the key is valid.
        } else {
          fatalError = bsErr;
        }
      } finally {
        accountManager.clearPendingKey(accountId);
      }

      if (fatalError) throw fatalError;

      // ── Phase 1b: Import cross-signing keys from SSSS → OlmMachine ──────────
      // bootstrapSecretStorage only exports keys FROM OlmMachine → SSSS.
      // bootstrapCrossSigning does the reverse: it reads the private keys from
      // SSSS and imports them into the Rust OlmMachine, which is what makes
      // getCrossSigningStatus().privateKeysCachedLocally.masterKey go true.
      {
        const xsBefore = await crypto.getCrossSigningStatus().catch(() => null);
        if (!xsBefore?.privateKeysCachedLocally?.masterKey && xsBefore?.privateKeysInSecretStorage) {
          // Ensure OlmMachine has user's public cross-signing keys before importing
          // private keys — importCrossSigningKeys silently fails without them.
          await accountManager.ensureOwnKeysFetched(accountId);
          accountManager.setPendingKey(accountId, trimmedKey);
          try {
            await crypto.bootstrapCrossSigning({ setupNewCrossSigning: false });
            console.log("[KeyUnlockDialog] bootstrapCrossSigning OK");
          } catch (bcsErr: any) {
            console.warn("[KeyUnlockDialog] bootstrapCrossSigning failed:", bcsErr?.message ?? bcsErr);
          } finally {
            accountManager.clearPendingKey(accountId);
          }
        }
      }

      // ── Phase 1c: Check whether master key actually loaded; warn if not ─────
      const xsStatus = await crypto.getCrossSigningStatus().catch(() => null);
      const masterKeyLoaded = xsStatus?.privateKeysCachedLocally?.masterKey ?? false;
      if (!masterKeyLoaded) {
        if (xsStatus?.privateKeysInSecretStorage) {
          setWarn(
            "Security Key accepted and messages unlocked, but the cross-signing key data " +
            "on the server couldn't be decrypted (bad MAC) — likely encrypted with an older key. " +
            "To fix without resetting: open a working session (e.g. Element Web), go to " +
            "Settings → Security → Restore cross-signing, then re-enter your Security Key here."
          );
        } else {
          setWarn(
            "Security Key accepted and messages unlocked. " +
            "Cross-signing has not been set up on this account, so device verification is unavailable. " +
            "Set it up from another session (e.g. Element Web → Settings → Security) first."
          );
        }
      }

      // ── Phase 2: Load backup key from SSSS (try regardless of bootstrap result) ─
      // After a partial bootstrap the Rust engine might have the SSSS key loaded
      // even if it threw. Give each step its own try/catch so one failure doesn't
      // prevent the next from running.
      let backupKeyLoaded = false;
      if (crypto.loadSessionBackupPrivateKeyFromSecretStorage) {
        accountManager.setPendingKey(accountId, trimmedKey);
        try {
          await crypto.loadSessionBackupPrivateKeyFromSecretStorage();
          backupKeyLoaded = true;
          console.log("[KeyUnlockDialog] loadSessionBackupPrivateKeyFromSecretStorage OK");
        } catch (e: any) {
          console.warn("[KeyUnlockDialog] loadSessionBackupPrivateKeyFromSecretStorage failed:", e?.message ?? e);
        } finally {
          accountManager.clearPendingKey(accountId);
        }
      }

      // ── Phase 3: Restore key backup (imports megolm session keys from backup) ─
      if (crypto.restoreKeyBackup) {
        accountManager.setPendingKey(accountId, trimmedKey);
        crypto.restoreKeyBackup()
          .then((result) => {
            console.log("[KeyUnlockDialog] restoreKeyBackup OK", result);
            accountManager.retryDecryption(accountId);
            // Fire a second retry after a brief delay — some keys arrive
            // asynchronously from the backup download stream.
            setTimeout(() => accountManager.retryDecryption(accountId), 3000);
          })
          .catch((e: any) => console.warn("[KeyUnlockDialog] restoreKeyBackup failed:", e?.message ?? e))
          .finally(() => accountManager.clearPendingKey(accountId));
      }

      // Immediate retry for anything already in memory
      accountManager.retryDecryption(accountId);
      // Delayed retries to catch key shares arriving from other devices via sync
      setTimeout(() => accountManager.retryDecryption(accountId), 5000);
      setTimeout(() => accountManager.retryDecryption(accountId), 15000);

      // ── Phase 4: Mark unlocked, persist key ──────────────────────────────────
      setUnlocked(accountId, true);
      if (account.userId) {
        saveE2EEKey(account.userId, trimmedKey).catch((e) =>
          console.warn("[KeyUnlockDialog] Could not persist key to keychain:", e)
        );
      }

      // If a warn was already set (cross-signing issue), leave the dialog open so
      // the user can read it. Otherwise close immediately on success.
      // For a stale backup with no XS issue, show a brief warning then close.
      if (!masterKeyLoaded) {
        // Warning already set above — user must dismiss manually
      } else if (bootstrapBadMac && !backupKeyLoaded) {
        setWarn("Unlocked — key backup appears stale. Historical messages will decrypt as other devices share keys.");
        setTimeout(() => onClose(), 4000);
      } else {
        onClose();
      }
    } catch (err: any) {
      console.error("[KeyUnlockDialog] Unlock failed:", err);
      const msg = typeof err === "string" ? err : (err?.message ?? "");
      setError(msg || "Invalid Recovery Key or Passphrase. Please check the key and try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="key-unlock-overlay">
      <div className="key-unlock-modal">
        <button className="key-unlock-close" onClick={onClose}>
          <X size={18} />
        </button>
        <div className="key-unlock-header">
          <Key size={24} className="key-unlock-icon" />
          <h2>Unlock Encrypted Messages</h2>
        </div>
        <p className="key-unlock-desc">
          For <strong>{account.userId}</strong>
          <br />
          Enter your Security Key or Recovery Passphrase to decrypt your message history.
        </p>
        <form onSubmit={handleUnlock} className="key-unlock-form">
          <input
            type="password"
            autoComplete="new-password"
            placeholder="Security Key (e.g. Es...) or Passphrase"
            value={inputKey}
            onChange={(e) => setInputKey(e.target.value)}
            disabled={loading}
            autoFocus
          />
          {error && <div className="key-unlock-error">{error}</div>}
          {warn && (
            <div className="key-unlock-warning">
              <AlertTriangle size={14} />
              <span>{warn}</span>
            </div>
          )}
          <button type="submit" disabled={!inputKey.trim() || loading}>
            {loading ? <Loader2 size={16} className="spinner" /> : "Unlock"}
          </button>
        </form>
      </div>
    </div>
  );
};

export default KeyUnlockDialog;
