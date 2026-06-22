import React from "react";
import SpaceSwitcher from "../components/SpaceSwitcher";
import Inbox from "../components/Inbox";
import RoomList from "../components/RoomList";
import RoomView from "./RoomView";
import WelcomeScreen from "../components/WelcomeScreen";
import KeyUnlockDialog from "../components/KeyUnlockDialog";
import E2EESetupDialog from "../components/E2EESetupDialog";
import VerificationDialog from "../components/VerificationDialog";
import { useTimelineStore } from "../store/timelineStore";
import { useAccountsStore } from "../store/accountsStore";
import { useRoomsStore } from "../store/roomsStore";
import { useTraySync } from "../hooks/useTraySync";
import { loadE2EEKey } from "../accounts/credentialStore";
import { accountManager } from "../accounts/AccountManager";
import type { VerificationRequest } from "matrix-js-sdk/lib/crypto-api/verification";
import { Key } from "lucide-react";
import "./AppLayout.css";

import { ErrorBoundary } from "react-error-boundary";

const ErrorFallback = ({ error }: { error: any }) => (
  <div style={{ padding: 20, color: "red", flex: 1 }}>
    <h2>Something went wrong in RoomView:</h2>
    <pre style={{ whiteSpace: "pre-wrap", background: "#f8d7da", padding: 10, borderRadius: 4 }}>
      {error.message}
      {"\n"}
      {error.stack}
    </pre>
  </div>
);

type ActiveDialog = "none" | "setup" | "key" | "verify-outgoing";

const AppLayout: React.FC = () => {
  const activeRoomId = useTimelineStore((s) => s.activeRoomId);
  const setActiveRoom = useTimelineStore((s) => s.setActiveRoom);
  const activeAccountId = useAccountsStore((s) => s.activeAccountId);
  const activeAccount = useAccountsStore((s) => s.accounts.find((a) => a.id === s.activeAccountId));
  const isE2EEUnlocked = useAccountsStore((s) => s.isE2EEUnlocked);
  const syncStates = useAccountsStore((s) => s.syncStates);
  const setActiveSpaceId = useRoomsStore((s) => s.setActiveSpaceId);

  const [activeDialog, setActiveDialog] = React.useState<ActiveDialog>("none");
  const [inboxOpen, setInboxOpen] = React.useState(false);
  // Outgoing verification request initiated from the setup dialog
  const [outgoingVerifRequest, setOutgoingVerifRequest] = React.useState<VerificationRequest | null>(null);
  // Incoming verification request from another device
  const [incomingVerifRequest, setIncomingVerifRequest] = React.useState<VerificationRequest | null>(null);

  // Track which accounts we've already attempted auto-unlock for this session.
  const attemptedAutoUnlock = React.useRef<Set<string>>(new Set());

  // Wire incoming verification requests → dialog
  React.useEffect(() => {
    accountManager.onVerificationRequest = (req, accountId) => {
      console.log(`[AppLayout] Incoming verification request from ${req.otherUserId} (account=${accountId})`);
      setIncomingVerifRequest(req);
      (async () => {
        try {
          const client = accountManager.getClient(accountId);
          const crypto = client?.getCrypto() as any;
          const olmMachine = crypto?.olmMachine ?? crypto?._olmMachine;
          const processor = crypto?.outgoingRequestProcessor;
          const userId = client?.getUserId();
          if (olmMachine && processor && userId) {
            const { UserId } = await import("@matrix-org/matrix-sdk-crypto-wasm");
            const keyReq = olmMachine.queryKeysForUsers([new UserId(userId)]);
            if (keyReq) await processor.makeOutgoingRequest(keyReq);
          }
        } catch (e) {
          console.warn("[AppLayout] Pre-verification key refresh failed (non-fatal):", e);
        }
      })();
    };
    return () => { accountManager.onVerificationRequest = null; };
  }, []);

  // Reset space selection when the active account changes
  React.useEffect(() => {
    setActiveSpaceId("home");
    setActiveRoom(null);
    setInboxOpen(false);
  }, [activeAccountId]);

  // Sync unread count to system tray tooltip
  useTraySync();

  // Auto-unlock E2EE once the Matrix client reaches PREPARED/SYNCING.
  React.useEffect(() => {
    if (!activeAccountId) return;
    if (isE2EEUnlocked[activeAccountId]) return;

    const syncState = syncStates[activeAccountId];
    const clientReady = syncState === "PREPARED" || syncState === "SYNCING";
    if (!clientReady) return;

    if (attemptedAutoUnlock.current.has(activeAccountId)) return;
    attemptedAutoUnlock.current.add(activeAccountId);

    const userId = activeAccount?.userId;
    if (!userId) return;

    (async () => {
      const rawKey = await loadE2EEKey(userId);
      const savedKey = rawKey?.trim() ?? null;
      if (!savedKey) {
        // No saved key — show the first-time setup prompt
        setActiveDialog("setup");
        return;
      }

      // Key found in keychain — silently unlock
      await performUnlock(activeAccountId, savedKey);
    })();
  }, [activeAccountId, syncStates]);

  // Shared unlock logic used by both auto-unlock and post-setup unlock
  const performUnlock = async (accountId: string, key: string) => {
    const client = accountManager.getClient(accountId);
    if (!client) return;
    const crypto = client.getCrypto();
    if (!crypto) return;

    console.log("[AppLayout] Unlocking E2EE...");

    // Phase 1 — bootstrap (exports OlmMachine keys → SSSS if needed)
    accountManager.setPendingKey(accountId, key);
    let bootstrapBadMac = false;
    try {
      await crypto.bootstrapSecretStorage({ setupNewKeyBackup: false, setupNewSecretStorage: false });
    } catch (e: any) {
      const msg: string = e?.message ?? "";
      if (msg.toLowerCase().includes("bad mac") || msg.toLowerCase().includes("bad_mac")) {
        console.warn("[AppLayout] bootstrapSecretStorage bad MAC — continuing.");
        bootstrapBadMac = true;
      } else {
        console.warn("[AppLayout] bootstrapSecretStorage failed:", e);
        accountManager.clearPendingKey(accountId);
        setActiveDialog("setup");
        return;
      }
    } finally {
      accountManager.clearPendingKey(accountId);
    }

    // Phase 1b — import cross-signing keys SSSS → OlmMachine
    {
      const xsStatus = await crypto.getCrossSigningStatus().catch(() => null);
      if (!xsStatus?.privateKeysCachedLocally?.masterKey && xsStatus?.privateKeysInSecretStorage) {
        await accountManager.ensureOwnKeysFetched(accountId);
        accountManager.setPendingKey(accountId, key);
        try {
          await crypto.bootstrapCrossSigning({ setupNewCrossSigning: false });
          console.log("[AppLayout] bootstrapCrossSigning OK");
        } catch (e: any) {
          console.warn("[AppLayout] bootstrapCrossSigning failed (non-fatal):", e?.message ?? e);
        } finally {
          accountManager.clearPendingKey(accountId);
        }
      }
    }

    // Phase 2 — load backup private key from SSSS
    if (crypto.loadSessionBackupPrivateKeyFromSecretStorage) {
      accountManager.setPendingKey(accountId, key);
      try {
        await crypto.loadSessionBackupPrivateKeyFromSecretStorage();
      } catch (e) {
        console.warn("[AppLayout] loadSessionBackupPrivateKeyFromSecretStorage failed:", e);
      } finally {
        accountManager.clearPendingKey(accountId);
      }
    }

    // Phase 3 — restore key backup (megolm session keys)
    if (crypto.restoreKeyBackup) {
      accountManager.setPendingKey(accountId, key);
      crypto.restoreKeyBackup()
        .then(() => {
          accountManager.retryDecryption(accountId);
          setTimeout(() => accountManager.retryDecryption(accountId), 3000);
        })
        .catch((e) => console.warn("[AppLayout] restoreKeyBackup failed:", e))
        .finally(() => accountManager.clearPendingKey(accountId));
    }

    accountManager.retryDecryption(accountId);
    setTimeout(() => accountManager.retryDecryption(accountId), 5000);
    setTimeout(() => accountManager.retryDecryption(accountId), 15000);

    useAccountsStore.getState().setE2EEUnlocked(accountId, true);
    console.log("[AppLayout] Unlock complete. bootstrapBadMac:", bootstrapBadMac);
  };

  // Initiate outgoing self-verification (from setup dialog "Verify" path)
  const handleStartVerification = async () => {
    if (!activeAccountId) return;
    const client = accountManager.getClient(activeAccountId);
    const crypto = client?.getCrypto();
    if (!crypto) return;

    // Try to load cross-signing keys first so SAS MAC includes them
    const savedKey = activeAccount?.userId ? await loadE2EEKey(activeAccount.userId) : null;
    if (savedKey) {
      const xsStatus = await crypto.getCrossSigningStatus().catch(() => null);
      if (!xsStatus?.privateKeysCachedLocally?.masterKey && xsStatus?.privateKeysInSecretStorage) {
        await accountManager.ensureOwnKeysFetched(activeAccountId);
        accountManager.setPendingKey(activeAccountId, savedKey.trim());
        try {
          await crypto.bootstrapCrossSigning({ setupNewCrossSigning: false });
        } catch {
          // non-fatal — proceed anyway
        } finally {
          accountManager.clearPendingKey(activeAccountId);
        }
      }
    }

    try {
      const req = await crypto.requestOwnUserVerification();
      setOutgoingVerifRequest(req);
      setActiveDialog("verify-outgoing");
    } catch (e: any) {
      console.error("[AppLayout] requestOwnUserVerification failed:", e);
    }
  };

  const handleVerified = (accountId: string) => {
    accountManager.retryDecryption(accountId);
    setTimeout(() => accountManager.retryDecryption(accountId), 5000);
  };

  const needsUnlock = activeAccountId && !isE2EEUnlocked[activeAccountId] && activeDialog === "none";

  return (
    <div className="app-layout">
      <SpaceSwitcher onOpenInbox={() => setInboxOpen((o) => !o)} inboxOpen={inboxOpen} />
      {inboxOpen && <Inbox onClose={() => setInboxOpen(false)} />}
      <RoomList />
      <main className="app-main" style={{ position: "relative" }}>
        {needsUnlock && (
          <div className="e2ee-banner" onClick={() => setActiveDialog("setup")}>
            <Key size={14} />
            <span>Messages are locked. Click to verify your identity.</span>
          </div>
        )}
        {activeRoomId ? (
          <ErrorBoundary FallbackComponent={ErrorFallback}>
            <RoomView roomId={activeRoomId} />
          </ErrorBoundary>
        ) : (
          <WelcomeScreen />
        )}
      </main>

      {/* First-time setup prompt */}
      {activeDialog === "setup" && activeAccount && (
        <E2EESetupDialog
          userId={activeAccount.userId}
          onUseKey={() => setActiveDialog("key")}
          onVerify={() => handleStartVerification()}
          onSkip={() => setActiveDialog("none")}
        />
      )}

      {/* Security key entry */}
      {activeDialog === "key" && activeAccountId && (
        <KeyUnlockDialog
          accountId={activeAccountId}
          onClose={() => setActiveDialog("none")}
        />
      )}

      {/* Outgoing verification (initiated from setup dialog) */}
      {activeDialog === "verify-outgoing" && outgoingVerifRequest && activeAccountId && (
        <VerificationDialog
          request={outgoingVerifRequest}
          onClose={() => { setActiveDialog("none"); setOutgoingVerifRequest(null); }}
          onVerified={() => handleVerified(activeAccountId)}
          getLiveRequest={() => {
            const client = accountManager.getClient(activeAccountId);
            const crypto = client?.getCrypto();
            const userId = activeAccount?.userId;
            if (!crypto || !userId) return null;
            const requests = crypto.getVerificationRequestsToDeviceInProgress(userId);
            return requests.find((r) => r.isSelfVerification && r.initiatedByMe) ?? null;
          }}
        />
      )}

      {/* Incoming verification from another device */}
      {incomingVerifRequest && (
        <VerificationDialog
          request={incomingVerifRequest}
          onClose={() => setIncomingVerifRequest(null)}
          onVerified={() => activeAccountId && handleVerified(activeAccountId)}
        />
      )}
    </div>
  );
};

export default AppLayout;
