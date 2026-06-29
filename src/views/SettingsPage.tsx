import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Trash2, Plus, Sun, Moon, Bell, BellOff, ChevronLeft, ShieldCheck, ShieldX, Loader2, Smartphone, Key } from "lucide-react";
import { useAccountsStore } from "../store/accountsStore";
import { useRoomsStore } from "../store/roomsStore";
import { useTimelineStore } from "../store/timelineStore";
import { useTheme } from "../contexts/ThemeContext";
import { accountManager } from "../accounts/AccountManager";
import { deleteAccount, loadE2EEKey } from "../accounts/credentialStore";
import Avatar from "../components/Avatar";
import VerificationDialog from "../components/VerificationDialog";
import KeyUnlockDialog from "../components/KeyUnlockDialog";
import type { VerificationRequest } from "matrix-js-sdk/lib/crypto-api/verification";
import "./SettingsPage.css";

type Tab = "accounts" | "appearance" | "notifications" | "security";

const SettingsPage: React.FC = () => {
  const navigate = useNavigate();
  const { theme, setTheme } = useTheme();
  const accounts = useAccountsStore((s) => s.accounts);
  const activeAccountId = useAccountsStore((s) => s.activeAccountId);
  const removeAccount = useAccountsStore((s) => s.removeAccount);
  const syncStates = useAccountsStore((s) => s.syncStates);
  const clearRooms = useRoomsStore((s) => s.clearRooms);
  const setActiveRoom = useTimelineStore((s) => s.setActiveRoom);

  const [tab, setTab] = useState<Tab>("accounts");
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);
  const [notifications, setNotifications] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(accounts.map((a) => [a.id, true]))
  );

  // ── Security tab state ────────────────────────────────────────────────────
  const [verificationRequest, setVerificationRequest] = useState<VerificationRequest | null>(null);
  const [verifyLoading, setVerifyLoading] = useState(false);
  const [verifyError, setVerifyError] = useState<string | null>(null);
  const [showKeyDialog, setShowKeyDialog] = useState(false);
  const [keyVerifyLoading, setKeyVerifyLoading] = useState(false);
  const [keyVerifyMsg, setKeyVerifyMsg] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  // Whether THIS device is cross-signed (signed by our own self-signing key).
  // This is what other clients check before sharing room keys.
  const [deviceCrossSigned, setDeviceCrossSigned] = useState<boolean | null>(null);
  const [crossSigningStatus, setCrossSigningStatus] = useState<{
    publicKeysOnDevice: boolean;
    privateKeysInSecretStorage: boolean;
    privateKeysCachedLocally: { masterKey: boolean; selfSigningKey: boolean; userSigningKey: boolean } | undefined;
  } | null>(null);

  const activeAccount = accounts.find((a) => a.id === activeAccountId);

  // Fetch cross-signing status whenever the security tab is opened
  useEffect(() => {
    if (tab !== "security" || !activeAccountId) return;
    const client = accountManager.getClient(activeAccountId);
    const crypto = client?.getCrypto();
    if (!crypto) return;
    crypto.getCrossSigningStatus().then((s) => {
      setCrossSigningStatus({
        publicKeysOnDevice: s.publicKeysOnDevice,
        privateKeysInSecretStorage: s.privateKeysInSecretStorage,
        privateKeysCachedLocally: s.privateKeysCachedLocally,
      });
    }).catch(() => {/* ignore */});
    const deviceId = activeAccount?.deviceId;
    const userId = activeAccount?.userId;
    if (userId && deviceId) {
      crypto.getDeviceVerificationStatus(userId, deviceId)
        .then((st) => setDeviceCrossSigned(st ? (st.signedByOwner ?? st.crossSigningVerified ?? false) : false))
        .catch(() => setDeviceCrossSigned(null));
    }
  }, [tab, activeAccountId]);

  const refreshCrossSigningStatus = async () => {
    if (!activeAccountId) return;
    const client = accountManager.getClient(activeAccountId);
    const crypto = client?.getCrypto();
    if (!crypto) return;
    const s = await crypto.getCrossSigningStatus().catch(() => null);
    if (s) setCrossSigningStatus({ publicKeysOnDevice: s.publicKeysOnDevice, privateKeysInSecretStorage: s.privateKeysInSecretStorage, privateKeysCachedLocally: s.privateKeysCachedLocally });
    const deviceId = activeAccount?.deviceId;
    const userId = activeAccount?.userId;
    if (userId && deviceId) {
      const st = await crypto.getDeviceVerificationStatus(userId, deviceId).catch(() => null);
      setDeviceCrossSigned(st ? (st.signedByOwner ?? st.crossSigningVerified ?? false) : false);
    }
  };

  const handleVerifyDevice = async () => {
    if (!activeAccountId) return;
    const client = accountManager.getClient(activeAccountId);
    const crypto = client?.getCrypto();
    if (!crypto) { setVerifyError("Crypto not ready."); return; }
    setVerifyLoading(true);
    setVerifyError(null);
    try {
      // Ensure cross-signing private keys are in the OlmMachine before starting
      // verification. bootstrapCrossSigning reads them from SSSS → OlmMachine,
      // which is the direction we need. Without this the SAS MAC omits the master
      // key and the other device gets m.key_mismatch even when emojis match.
      const savedKey = await loadE2EEKey(activeAccount?.userId ?? "");
      if (savedKey) {
        const xsBefore = await crypto.getCrossSigningStatus().catch(() => null);
        if (!xsBefore?.privateKeysCachedLocally?.masterKey && xsBefore?.privateKeysInSecretStorage) {
          accountManager.setPendingKey(activeAccountId, savedKey.trim());
          try {
            await crypto.bootstrapCrossSigning({ setupNewCrossSigning: false });
          } catch (bsErr: any) {
            const msg: string = bsErr?.message ?? "";
            if (!msg.toLowerCase().includes("bad mac") && !msg.toLowerCase().includes("bad_mac")) {
              throw bsErr;
            }
          } finally {
            accountManager.clearPendingKey(activeAccountId);
          }
        }
      }

      // Confirm the master private key is actually in the OlmMachine now.
      // If not, verification will produce m.key_mismatch — block early with a clear message.
      const xsStatus = await crypto.getCrossSigningStatus();
      setCrossSigningStatus({ publicKeysOnDevice: xsStatus.publicKeysOnDevice, privateKeysInSecretStorage: xsStatus.privateKeysInSecretStorage, privateKeysCachedLocally: xsStatus.privateKeysCachedLocally });
      if (!xsStatus.privateKeysCachedLocally?.masterKey) {
        if (!xsStatus.privateKeysInSecretStorage) {
          setVerifyError(
            "Cross-signing is not set up on this account. " +
            "Set it up from a verified session (e.g. Element Web → Settings → Security) first."
          );
        } else {
          setVerifyError(
            "Cross-signing keys could not be loaded — the stored secrets appear corrupt. " +
            "Reset cross-signing from a verified session (e.g. Element Web → Settings → Security → Reset cross-signing), then try again."
          );
        }
        return;
      }

      // Force a fresh /keys/query so the SAS MAC is computed against up-to-date keys.
      const userId = activeAccount?.userId;
      if (userId) {
        try {
          const rustCrypto = crypto as any;
          const olmMachine = rustCrypto.olmMachine ?? rustCrypto._olmMachine;
          const processor = rustCrypto.outgoingRequestProcessor;
          if (olmMachine && processor) {
            const { UserId } = await import("@matrix-org/matrix-sdk-crypto-wasm");
            const keyReq = olmMachine.queryKeysForUsers([new UserId(userId)]);
            if (keyReq) await processor.makeOutgoingRequest(keyReq);
          }
        } catch (e) {
          console.warn("[SettingsPage] Pre-verification key refresh failed (non-fatal):", e);
        }
      }

      const req = await crypto.requestOwnUserVerification();
      setVerificationRequest(req);
    } catch (e: any) {
      setVerifyError(e?.message ?? "Failed to start verification.");
    } finally {
      setVerifyLoading(false);
    }
  };

  // Non-interactive verification: cross-sign this device with our own
  // self-signing key (no second session / SAS dance required). Uses the locally
  // cached cross-signing keys if present, otherwise the saved Security Key.
  const handleVerifyWithKey = async () => {
    if (!activeAccountId) return;
    setKeyVerifyLoading(true);
    setKeyVerifyMsg(null);
    setVerifyError(null);
    try {
      const savedKey = await loadE2EEKey(activeAccount?.userId ?? "").catch(() => null);
      const result = await accountManager.selfVerifyWithSecurityKey(activeAccountId, savedKey);
      if (result.ok) {
        setKeyVerifyMsg({
          kind: "ok",
          text: result.crossSigned
            ? "This device is now cross-signed. Stuck messages will decrypt as keys arrive — give it up to a minute."
            : "Signed this device. If messages stay locked, re-enter your Security Key and try again.",
        });
        await refreshCrossSigningStatus();
      } else if (result.needsKey) {
        setKeyVerifyMsg({ kind: "error", text: result.error ?? "Enter your Security Key first." });
        setShowKeyDialog(true);
      } else {
        setKeyVerifyMsg({ kind: "error", text: result.error ?? "Verification failed." });
      }
    } catch (e: any) {
      setKeyVerifyMsg({ kind: "error", text: e?.message ?? "Verification failed." });
    } finally {
      setKeyVerifyLoading(false);
    }
  };

  // Pull megolm keys from the encrypted key backup and retry decryption — the
  // recovery path for your own older messages stuck on "Waiting for keys".
  const handleRestoreHistory = async () => {
    if (!activeAccountId) return;
    setKeyVerifyLoading(true);
    setKeyVerifyMsg(null);
    try {
      const savedKey = await loadE2EEKey(activeAccount?.userId ?? "").catch(() => null);
      const result = await accountManager.restoreKeyBackupAndRetry(activeAccountId, savedKey);
      if (result.ok) {
        setKeyVerifyMsg({
          kind: "ok",
          text:
            (result.imported ?? 0) > 0
              ? `Restored ${result.imported} key(s) from backup. Stuck messages should decrypt now.`
              : "Backup restore ran, but no new keys were found. Those messages may only be recoverable from the device that sent them (and only if it had key backup on).",
        });
      } else {
        setKeyVerifyMsg({ kind: "error", text: result.error ?? "Restore failed." });
      }
    } catch (e: any) {
      setKeyVerifyMsg({ kind: "error", text: e?.message ?? "Restore failed." });
    } finally {
      setKeyVerifyLoading(false);
    }
  };

  const handleRemoveAccount = async (accountId: string) => {
    if (confirmRemove !== accountId) {
      setConfirmRemove(accountId);
      return;
    }
    await deleteAccount(accountId);
    await accountManager.removeAccount(accountId);
    clearRooms(accountId);
    setActiveRoom(null);
    removeAccount(accountId);
    setConfirmRemove(null);
    if (accounts.length <= 1) navigate("/", { replace: true });
    else navigate("/app", { replace: true });
  };

  const toggleNotifications = (accountId: string) => {
    setNotifications((prev) => ({ ...prev, [accountId]: !prev[accountId] }));
  };

  return (
    <div className="settings-page">
      <div className="settings-sidebar">
        <button className="settings-back" onClick={() => navigate("/app")}>
          <ChevronLeft size={16} /> Back
        </button>
        <h2 className="settings-title">Settings</h2>
        <nav className="settings-nav">
          {(["accounts", "appearance", "notifications", "security"] as Tab[]).map((t) => (
            <button
              key={t}
              className={`settings-nav-item ${tab === t ? "settings-nav-item--active" : ""}`}
              onClick={() => setTab(t)}
            >
              {t.charAt(0).toUpperCase() + t.slice(1)}
            </button>
          ))}
        </nav>
      </div>

      <div className="settings-content">
        {/* ─── Accounts Tab ─── */}
        {tab === "accounts" && (
          <div className="settings-section fade-in">
            <h3>Accounts</h3>
            <p className="settings-desc">Manage your logged-in Matrix accounts.</p>

            <div className="settings-account-list">
              {accounts.map((account) => {
                const syncState = syncStates[account.id] ?? "STOPPED";
                const isRemoving = confirmRemove === account.id;

                return (
                  <div key={account.id} className={`settings-account-row ${isRemoving ? "settings-account-row--confirming" : ""}`}>
                    <Avatar
                      name={account.displayName ?? account.userId}
                      avatarUrl={account.avatarUrl}
                      accountId={account.id}
                      size={40}
                    />
                    <div className="settings-account-info">
                      <span className="settings-account-name">
                        {account.displayName ?? account.userId}
                      </span>
                      <span className="settings-account-sub">
                        {account.userId} · {account.homeserver.replace("https://", "")}
                      </span>
                      <span className={`settings-sync-pill settings-sync-pill--${
                        syncState === "SYNCING" || syncState === "PREPARED" ? "online"
                        : syncState === "ERROR" ? "error" : "offline"
                      }`}>
                        {syncState === "SYNCING" || syncState === "PREPARED" ? "Synced"
                          : syncState === "ERROR" ? "Error" : syncState}
                      </span>
                    </div>
                    <div className="settings-account-actions">
                      {isRemoving ? (
                        <>
                          <button className="settings-btn settings-btn--danger" onClick={() => handleRemoveAccount(account.id)}>
                            Confirm Remove
                          </button>
                          <button className="settings-btn" onClick={() => setConfirmRemove(null)}>
                            Cancel
                          </button>
                        </>
                      ) : (
                        <button
                          className="settings-icon-btn"
                          onClick={() => handleRemoveAccount(account.id)}
                          title="Remove account"
                          disabled={account.id === activeAccountId && accounts.length === 1}
                        >
                          <Trash2 size={15} />
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            <button className="settings-btn settings-btn--primary" onClick={() => navigate("/login")}>
              <Plus size={15} /> Add Account
            </button>
          </div>
        )}

        {/* ─── Appearance Tab ─── */}
        {tab === "appearance" && (
          <div className="settings-section fade-in">
            <h3>Appearance</h3>
            <p className="settings-desc">Choose your preferred color theme.</p>

            <div className="settings-theme-row">
              <button
                className={`settings-theme-card ${theme === "dark" ? "settings-theme-card--active" : ""}`}
                onClick={() => setTheme("dark")}
              >
                <div className="settings-theme-preview settings-theme-preview--dark">
                  <Moon size={24} />
                </div>
                <span>Dark</span>
                {theme === "dark" && <div className="settings-theme-check">✓</div>}
              </button>
              <button
                className={`settings-theme-card ${theme === "light" ? "settings-theme-card--active" : ""}`}
                onClick={() => setTheme("light")}
              >
                <div className="settings-theme-preview settings-theme-preview--light">
                  <Sun size={24} />
                </div>
                <span>Light</span>
                {theme === "light" && <div className="settings-theme-check">✓</div>}
              </button>
            </div>

            <div className="settings-subsection">
              <h4>Font Size</h4>
              <p className="settings-desc" style={{ marginBottom: 0 }}>Coming soon</p>
            </div>
          </div>
        )}

        {/* ─── Notifications Tab ─── */}
        {tab === "notifications" && (
          <div className="settings-section fade-in">
            <h3>Notifications</h3>
            <p className="settings-desc">Control desktop notifications per account.</p>

            <div className="settings-account-list">
              {accounts.map((account) => (
                <div key={account.id} className="settings-account-row">
                  <Avatar
                    name={account.displayName ?? account.userId}
                    avatarUrl={account.avatarUrl}
                    accountId={account.id}
                    size={36}
                  />
                  <div className="settings-account-info">
                    <span className="settings-account-name">
                      {account.displayName ?? account.userId}
                    </span>
                    <span className="settings-account-sub">{account.homeserver.replace("https://", "")}</span>
                  </div>
                  <button
                    className={`settings-toggle ${notifications[account.id] ? "settings-toggle--on" : ""}`}
                    onClick={() => toggleNotifications(account.id)}
                    aria-label={notifications[account.id] ? "Disable notifications" : "Enable notifications"}
                  >
                    {notifications[account.id] ? <Bell size={14} /> : <BellOff size={14} />}
                    <span>{notifications[account.id] ? "On" : "Off"}</span>
                  </button>
                </div>
              ))}
            </div>

            <div className="settings-subsection">
              <h4>Notification Sound</h4>
              <p className="settings-desc" style={{ marginBottom: 0 }}>Coming soon</p>
            </div>
          </div>
        )}
        {/* ─── Security Tab ─── */}
        {tab === "security" && (
          <div className="settings-section fade-in">
            <h3>Security</h3>
            <p className="settings-desc">Manage device verification and cross-signing.</p>

            {activeAccount && (
              <div className="settings-security-card">
                <div className="settings-security-row">
                  <Smartphone size={16} className="settings-security-icon" />
                  <div className="settings-security-info">
                    <span className="settings-security-label">This Device</span>
                    <code className="settings-security-value">{activeAccount.deviceId ?? "Unknown"}</code>
                  </div>
                  {crossSigningStatus !== null ? (
                    crossSigningStatus.privateKeysCachedLocally?.masterKey ? (
                      <span className="settings-security-badge settings-security-badge--ok">
                        <ShieldCheck size={12} /> Keys loaded
                      </span>
                    ) : crossSigningStatus.privateKeysInSecretStorage ? (
                      <span className="settings-security-badge settings-security-badge--warn">
                        <ShieldX size={12} /> Keys corrupt
                      </span>
                    ) : (
                      <span className="settings-security-badge settings-security-badge--warn">
                        <ShieldX size={12} /> Not set up
                      </span>
                    )
                  ) : null}
                </div>

                <div className="settings-security-row">
                  <div className="settings-security-info" style={{ paddingLeft: 0 }}>
                    <span className="settings-security-label">Verification</span>
                    <span className="settings-security-value">
                      {deviceCrossSigned === null
                        ? "Unknown"
                        : deviceCrossSigned
                          ? "Cross-signed (trusted by others)"
                          : "Not cross-signed — other clients will withhold keys"}
                    </span>
                  </div>
                  {deviceCrossSigned !== null && (
                    <span
                      className={`settings-security-badge ${deviceCrossSigned ? "settings-security-badge--ok" : "settings-security-badge--warn"}`}
                    >
                      {deviceCrossSigned ? <ShieldCheck size={12} /> : <ShieldX size={12} />}
                      {deviceCrossSigned ? "Verified" : "Unverified"}
                    </span>
                  )}
                </div>

                <div className="settings-security-row">
                  <div className="settings-security-info" style={{ paddingLeft: 0 }}>
                    <span className="settings-security-label">Signed in as</span>
                    <span className="settings-security-value">{activeAccount.userId}</span>
                  </div>
                </div>
              </div>
            )}

            <div className="settings-subsection">
              <h4>Security Key</h4>
              <p className="settings-desc">
                Re-enter your Security Key or Passphrase to load cross-signing keys. Required before
                verifying this device.
              </p>
              <button
                className="settings-btn settings-btn--primary"
                onClick={() => setShowKeyDialog(true)}
                style={{ marginTop: 8 }}
              >
                <Key size={14} /> Re-enter Security Key
              </button>
            </div>

            <div className="settings-subsection">
              <h4>Verify This Device</h4>
              <p className="settings-desc">
                Cross-sign this device so other people's clients trust it and share decryption keys.
                The fastest way is with your Security Key — no second device needed.
              </p>
              {keyVerifyMsg && (
                <p
                  style={{
                    color: keyVerifyMsg.kind === "ok" ? "var(--online)" : "var(--unread-badge)",
                    fontSize: 12,
                    margin: "4px 0",
                  }}
                >
                  {keyVerifyMsg.text}
                </p>
              )}
              <button
                className="settings-btn settings-btn--primary"
                onClick={handleVerifyWithKey}
                disabled={keyVerifyLoading}
                style={{ marginTop: 8 }}
              >
                {keyVerifyLoading
                  ? <><Loader2 size={14} className="spinner" /> Verifying…</>
                  : <><ShieldCheck size={14} /> Verify with Security Key</>}
              </button>

              <p className="settings-desc" style={{ marginTop: 16 }}>
                Or start an interactive verification from another session (e.g. Element Web or your phone).
              </p>
              {verifyError && (
                <p style={{ color: "var(--unread-badge)", fontSize: 12, margin: "4px 0" }}>{verifyError}</p>
              )}
              <button
                className="settings-btn"
                onClick={handleVerifyDevice}
                disabled={verifyLoading}
                style={{ marginTop: 8 }}
              >
                {verifyLoading
                  ? <><Loader2 size={14} className="spinner" /> Starting…</>
                  : <><Smartphone size={14} /> Verify from another session</>}
              </button>
            </div>

            <div className="settings-subsection">
              <h4>Restore Encrypted History</h4>
              <p className="settings-desc">
                Pull decryption keys from your encrypted key backup. Use this for your own older
                messages stuck on “Waiting for keys” after verifying this device.
              </p>
              <button
                className="settings-btn settings-btn--primary"
                onClick={handleRestoreHistory}
                disabled={keyVerifyLoading}
                style={{ marginTop: 8 }}
              >
                {keyVerifyLoading
                  ? <><Loader2 size={14} className="spinner" /> Restoring…</>
                  : <><Key size={14} /> Restore from Key Backup</>}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Verification dialog — initiated from this page */}
      {verificationRequest && (
        <VerificationDialog
          request={verificationRequest}
          onClose={() => setVerificationRequest(null)}
          onVerified={async () => {
            if (!activeAccountId) return;
            const client = accountManager.getClient(activeAccountId);
            const crypto = client?.getCrypto();
            if (!crypto) return;
            // Re-load key backup with the now-verified device, then retry all UTD events.
            // retryDecryption also fires m.room_key_request to other (now-trusted) devices.
            if (crypto.restoreKeyBackup) {
              const savedKey = await loadE2EEKey(activeAccount?.userId ?? "");
              if (savedKey) {
                accountManager.setPendingKey(activeAccountId, savedKey.trim());
                crypto.restoreKeyBackup()
                  .then(() => accountManager.retryDecryption(activeAccountId))
                  .catch(() => {})
                  .finally(() => accountManager.clearPendingKey(activeAccountId));
              }
            }
            accountManager.retryDecryption(activeAccountId);
            setTimeout(() => accountManager.retryDecryption(activeAccountId), 5000);
          }}
          getLiveRequest={() => {
            if (!activeAccountId) return null;
            const client = accountManager.getClient(activeAccountId);
            const crypto = client?.getCrypto();
            const userId = activeAccount?.userId;
            if (!crypto || !userId) return null;
            const requests = crypto.getVerificationRequestsToDeviceInProgress(userId);
            return requests.find((r) => r.isSelfVerification && r.initiatedByMe) ?? null;
          }}
        />
      )}
      {showKeyDialog && activeAccountId && (
        <KeyUnlockDialog
          accountId={activeAccountId}
          onClose={() => {
            setShowKeyDialog(false);
            refreshCrossSigningStatus();
          }}
        />
      )}
    </div>
  );
};

export default SettingsPage;
