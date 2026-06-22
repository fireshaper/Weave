import React, { useEffect, useState, useCallback } from "react";
import { ShieldCheck, ShieldX, X, Loader2, CheckCircle, XCircle, Smartphone } from "lucide-react";
import {
  VerificationRequestEvent,
  VerificationPhase,
  VerifierEvent,
} from "matrix-js-sdk/lib/crypto-api/verification";
import type {
  VerificationRequest,
  Verifier,
  ShowSasCallbacks,
  EmojiMapping,
} from "matrix-js-sdk/lib/crypto-api/verification";
import "./VerificationDialog.css";

interface VerificationDialogProps {
  request: VerificationRequest;
  onClose: () => void;
  /** Called once when verification reaches the Done phase. Use to retry decryption. */
  onVerified?: () => void;
  /** Optional: returns a fresh live wrapper from the OlmMachine each call.
   *  Used to work around the Rust WASM snapshot issue where the request object
   *  returned by requestOwnUserVerification() doesn't reflect state updates. */
  getLiveRequest?: () => VerificationRequest | null;
}

type DialogPhase =
  | "incoming"   // Requested, not initiated by us
  | "waiting"    // Requested, initiated by us — waiting for other side to accept
  | "ready"      // Ready — waiting to start SAS
  | "starting"   // Transitional: startVerification in flight
  | "sas"        // ShowSas — showing emoji
  | "confirming" // sas.confirm() in flight
  | "done"       // Done
  | "cancelled"; // Cancelled

const METHOD_SAS = "m.sas.v1";

const VerificationDialog: React.FC<VerificationDialogProps> = ({ request, onClose, onVerified, getLiveRequest }) => {
  const [phase, setPhase] = useState<DialogPhase>(() => derivePhase(request));
  const [verifier, setVerifier] = useState<Verifier | undefined>(request.verifier);
  const [sasCallbacks, setSasCallbacks] = useState<ShowSasCallbacks | null>(null);
  const [error, setError] = useState<string | null>(null);
  const verifiedFired = React.useRef(false);

  // Map the SDK VerificationPhase → our DialogPhase
  function derivePhase(req: VerificationRequest): DialogPhase {
    switch (req.phase) {
      case VerificationPhase.Unsent:
      case VerificationPhase.Requested:
        return req.initiatedByMe ? "waiting" : "incoming";
      case VerificationPhase.Ready:
        return "ready";
      case VerificationPhase.Started:
        return req.verifier?.getShowSasCallbacks() ? "sas" : "starting";
      case VerificationPhase.Done:
        return "done";
      case VerificationPhase.Cancelled:
        return "cancelled";
      default:
        return "incoming";
    }
  }

  // Track whether we have already fired verify() so we never double-call it.
  const verifyStarted = React.useRef(false);

  // Keep a stable ref so the polling interval always calls the latest getLiveRequest
  // without needing it in the dep array (avoids restarting the interval on every render).
  const getLiveRequestRef = React.useRef(getLiveRequest);
  useEffect(() => { getLiveRequestRef.current = getLiveRequest; });

  /**
   * Kick off the verify() handshake on a verifier.
   * verify() is idempotent per-session according to the SDK docs
   * ("start if not already started"), but we guard anyway to be safe.
   */
  const kickVerify = useCallback((v: Verifier) => {
    if (verifyStarted.current) return;
    verifyStarted.current = true;
    v.verify().catch((e: any) => {
      if (!v.hasBeenCancelled) {
        setError(e?.message ?? "Verification failed");
        setPhase("cancelled");
      }
    });
  }, []);

  // Listen for VerificationRequest.Change to keep phase in sync
  useEffect(() => {
    const syncState = () => {
      const derived = derivePhase(request);
      setPhase(derived);

      // The remote side sent m.key.verification.start — the SDK auto-created
      // request.verifier.  We must call verify() to respond with our accept.
      if (request.verifier) {
        setVerifier((prev) => {
          if (!prev) kickVerify(request.verifier!);
          return request.verifier;
        });

        // Also pull SAS callbacks if they're already available.
        const sas = request.verifier.getShowSasCallbacks();
        if (sas) {
          setSasCallbacks(sas);
          setPhase("sas");
        }
      }
    };

    request.on(VerificationRequestEvent.Change, syncState);
    // Immediately sync in case the phase changed before this effect ran.
    syncState();
    return () => { request.off(VerificationRequestEvent.Change, syncState); };
  }, [request, kickVerify]);

  // Polling fallback: requestOwnUserVerification() returns a snapshot VerificationRequest
  // from the Rust WASM OlmMachine. The Rust layer doesn't reliably call registerChangesCallback
  // on snapshot objects when the peer sends m.key.verification.ready. getLiveRequest() fetches
  // a fresh wrapper from getVerificationRequestsToDeviceInProgress() which holds a live OlmMachine
  // reference and always reflects current state.
  useEffect(() => {
    const id = setInterval(() => {
      const live = getLiveRequestRef.current?.() ?? request;
      const derived = derivePhase(live);
      setPhase((prev) => {
        if (prev === derived) return prev;
        console.log(`[VerificationDialog] poll: phase ${prev} → ${derived}`);
        return derived;
      });
      if (live.verifier) {
        setVerifier((prev) => {
          if (!prev) kickVerify(live.verifier!);
          return live.verifier ?? prev;
        });
        const sas = live.verifier.getShowSasCallbacks();
        if (sas) setSasCallbacks(sas);
      }
    }, 500);
    return () => clearInterval(id);
  }, [request, kickVerify]);

  // Also listen on the verifier once we have it
  useEffect(() => {
    if (!verifier) return;

    const onShowSas = (sas: ShowSasCallbacks) => {
      setSasCallbacks(sas);
      setPhase("sas");
    };
    const onCancel = () => setPhase("cancelled");

    verifier.on(VerifierEvent.ShowSas, onShowSas);
    verifier.on(VerifierEvent.Cancel, onCancel);
    return () => {
      verifier.off(VerifierEvent.ShowSas, onShowSas);
      verifier.off(VerifierEvent.Cancel, onCancel);
    };
  }, [verifier]);

  // Fire onVerified once when phase reaches done
  useEffect(() => {
    if (phase === "done" && onVerified && !verifiedFired.current) {
      verifiedFired.current = true;
      onVerified();
    }
  }, [phase, onVerified]);

  // ── Actions ────────────────────────────────────────────────────────────────

  const handleAccept = useCallback(async () => {
    try {
      await request.accept();
      // phase will update via Change event
    } catch (e: any) {
      setError(e?.message ?? "Failed to accept");
    }
  }, [request]);

  const handleStartSas = useCallback(async () => {
    setPhase("starting");
    try {
      const v = await request.startVerification(METHOD_SAS);
      setVerifier(v);
      kickVerify(v);
    } catch (e: any) {
      setError(e?.message ?? "Failed to start SAS");
      setPhase("cancelled");
    }
  }, [request, kickVerify]);


  const handleConfirmSas = useCallback(async () => {
    if (!sasCallbacks) return;
    setPhase("confirming");
    try {
      await sasCallbacks.confirm();
      // Phase will update to Done via Change event
    } catch (e: any) {
      setError(e?.message ?? "Failed to confirm");
      setPhase("cancelled");
    }
  }, [sasCallbacks]);

  const handleMismatch = useCallback(() => {
    sasCallbacks?.mismatch();
  }, [sasCallbacks]);

  const handleDecline = useCallback(async () => {
    try {
      await request.cancel();
    } catch {/* ignore */}
    onClose();
  }, [request, onClose]);

  // ── Derived display data ────────────────────────────────────────────────────

  const otherUser = request.otherUserId;
  const otherDevice = request.otherDeviceId;
  const isSelf = request.isSelfVerification;

  const subtitle = isSelf
    ? `Another session (${otherDevice ?? "unknown device"})`
    : otherUser;

  const emoji: EmojiMapping[] | undefined = sasCallbacks?.sas?.emoji;
  const decimals: [number, number, number] | undefined = sasCallbacks?.sas?.decimal;

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="vd-overlay" role="dialog" aria-modal="true" aria-label="Device Verification">
      <div className="vd-modal">

        {/* Header */}
        <div className="vd-header">
          <div className="vd-header-icon">
            {phase === "done" ? (
              <CheckCircle size={22} className="vd-icon-done" />
            ) : phase === "cancelled" ? (
              <XCircle size={22} className="vd-icon-cancel" />
            ) : (
              <ShieldCheck size={22} className="vd-icon-shield" />
            )}
          </div>
          <div className="vd-header-text">
            <h2 className="vd-title">
              {phase === "done" ? "Verified!" :
               phase === "cancelled" ? "Cancelled" :
               "Verify Device"}
            </h2>
            <p className="vd-subtitle">{subtitle}</p>
          </div>
          {(phase === "done" || phase === "cancelled") && (
            <button className="vd-close" onClick={onClose} aria-label="Close">
              <X size={16} />
            </button>
          )}
        </div>

        {/* Body */}
        <div className="vd-body">

          {/* ── Incoming request ── */}
          {phase === "incoming" && (
            <div className="vd-section vd-section--incoming fade-in">
              <Smartphone size={32} className="vd-device-icon" />
              <p className="vd-desc">
                <strong>{isSelf ? "One of your other sessions" : otherUser}</strong> wants to verify
                {isSelf ? " this device." : " with you."}
              </p>
              <p className="vd-hint">
                You'll compare a set of emojis on both devices to confirm the verification.
              </p>
              {error && <div className="vd-error">{error}</div>}
              <div className="vd-actions">
                <button className="vd-btn vd-btn--danger" onClick={handleDecline}>Decline</button>
                <button className="vd-btn vd-btn--primary" onClick={handleAccept}>Accept</button>
              </div>
            </div>
          )}

          {/* ── Waiting for other side ── */}
          {phase === "waiting" && (
            <div className="vd-section vd-section--waiting fade-in">
              <Loader2 size={32} className="vd-spinner" />
              <p className="vd-desc">Waiting for the other session to accept…</p>
              <p className="vd-hint">Open {isSelf ? "your other device" : otherUser + "'s device"} to accept.</p>
              <div className="vd-actions">
                <button className="vd-btn vd-btn--danger" onClick={handleDecline}>Cancel</button>
              </div>
            </div>
          )}

          {/* ── Ready — waiting for start or able to start ── */}
          {phase === "ready" && (
            <div className="vd-section fade-in">
              {request.initiatedByMe ? (
                // We initiated: we drive the start
                <>
                  <ShieldCheck size={32} className="vd-device-icon" />
                  <p className="vd-desc">
                    The other session has accepted. Start the emoji comparison to verify.
                  </p>
                  {error && <div className="vd-error">{error}</div>}
                  <div className="vd-actions">
                    <button className="vd-btn vd-btn--danger" onClick={handleDecline}>Cancel</button>
                    <button className="vd-btn vd-btn--primary" onClick={handleStartSas}>
                      Compare Emojis
                    </button>
                  </div>
                </>
              ) : (
                // They initiated: they'll send the start, we just wait
                <>
                  <Loader2 size={32} className="vd-spinner" />
                  <p className="vd-desc">Accepted! Waiting for the other device to start…</p>
                  <p className="vd-hint">The emojis will appear automatically.</p>
                  <div className="vd-actions">
                    <button className="vd-btn vd-btn--danger" onClick={handleDecline}>Cancel</button>
                  </div>
                </>
              )}
            </div>
          )}

          {/* ── Starting (transitional) ── */}
          {phase === "starting" && (
            <div className="vd-section vd-section--waiting fade-in">
              <Loader2 size={32} className="vd-spinner" />
              <p className="vd-desc">Starting emoji verification…</p>
            </div>
          )}

          {/* ── SAS Emoji display ── */}
          {phase === "sas" && (
            <div className="vd-section fade-in">
              <p className="vd-desc">
                Compare these emojis with the other device. If they match, tap <strong>They Match</strong>.
              </p>

              {emoji && emoji.length > 0 ? (
                <div className="vd-emoji-grid">
                  {emoji.map(([e, name], i) => (
                    <div className="vd-emoji-item" key={i}>
                      <span className="vd-emoji-char">{e}</span>
                      <span className="vd-emoji-name">{name}</span>
                    </div>
                  ))}
                </div>
              ) : decimals ? (
                <div className="vd-decimals">
                  {decimals.map((d, i) => (
                    <span className="vd-decimal-num" key={i}>{d}</span>
                  ))}
                </div>
              ) : (
                <div className="vd-section vd-section--waiting">
                  <Loader2 size={24} className="vd-spinner" />
                  <p className="vd-hint">Generating codes…</p>
                </div>
              )}

              {error && <div className="vd-error">{error}</div>}
              <div className="vd-actions">
                <button className="vd-btn vd-btn--danger" onClick={handleMismatch}>
                  <ShieldX size={14} /> They Don't Match
                </button>
                <button className="vd-btn vd-btn--primary" onClick={handleConfirmSas}>
                  <ShieldCheck size={14} /> They Match
                </button>
              </div>
            </div>
          )}

          {/* ── Confirming ── */}
          {phase === "confirming" && (
            <div className="vd-section vd-section--waiting fade-in">
              <Loader2 size={32} className="vd-spinner" />
              <p className="vd-desc">Confirming match…</p>
            </div>
          )}

          {/* ── Done ── */}
          {phase === "done" && (
            <div className="vd-section vd-section--done fade-in">
              <div className="vd-done-ring">
                <CheckCircle size={48} />
              </div>
              <p className="vd-desc">
                {isSelf
                  ? "Your device has been successfully verified."
                  : `${otherUser} has been verified.`}
              </p>
              <p className="vd-hint">Encrypted messages can now be shared securely between these devices.</p>
              <div className="vd-actions">
                <button className="vd-btn vd-btn--primary" onClick={onClose}>Done</button>
              </div>
            </div>
          )}

          {/* ── Cancelled ── */}
          {phase === "cancelled" && (
            <div className="vd-section vd-section--cancelled fade-in">
              <XCircle size={40} className="vd-cancel-icon" />
              <p className="vd-desc">Verification was cancelled.</p>
              {request.cancellationCode === "m.key_mismatch" ? (
                <p className="vd-hint">
                  Key mismatch — the stored device keys don't agree with the other session.
                  Make sure E2EE is fully unlocked (enter your Security Key in Settings → Security),
                  then try verifying again.
                </p>
              ) : request.cancellationCode ? (
                <p className="vd-hint">Reason: <code>{request.cancellationCode}</code></p>
              ) : null}
              {error && <div className="vd-error">{error}</div>}
              <div className="vd-actions">
                <button className="vd-btn vd-btn--primary" onClick={onClose}>Close</button>
              </div>
            </div>
          )}

        </div>
      </div>
    </div>
  );
};

export default VerificationDialog;
