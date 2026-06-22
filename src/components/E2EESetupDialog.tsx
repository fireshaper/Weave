import React from "react";
import { ShieldCheck, Key, Smartphone, ChevronRight } from "lucide-react";
import "./E2EESetupDialog.css";

interface E2EESetupDialogProps {
  userId: string;
  onUseKey: () => void;
  onVerify: () => void;
  onSkip: () => void;
}

const E2EESetupDialog: React.FC<E2EESetupDialogProps> = ({
  userId,
  onUseKey,
  onVerify,
  onSkip,
}) => {
  return (
    <div className="e2ee-setup-overlay" role="dialog" aria-modal="true" aria-label="Set up encryption">
      <div className="e2ee-setup-modal">

        <div className="e2ee-setup-header">
          <div className="e2ee-setup-shield">
            <ShieldCheck size={26} />
          </div>
          <h2>Verify your identity</h2>
          <p>
            This is a new session for <strong>{userId}</strong>. Verify it to access
            your encrypted messages and confirm your identity to other users.
          </p>
        </div>

        <div className="e2ee-setup-body">
          <button className="e2ee-choice" onClick={onUseKey}>
            <div className="e2ee-choice-icon">
              <Key size={20} />
            </div>
            <div className="e2ee-choice-text">
              <p className="e2ee-choice-title">Use Security Key</p>
              <p className="e2ee-choice-desc">
                Enter your recovery key or passphrase to unlock encrypted messages
                and load your cross-signing keys.
              </p>
            </div>
            <ChevronRight size={16} className="e2ee-choice-arrow" />
          </button>

          <button className="e2ee-choice" onClick={onVerify}>
            <div className="e2ee-choice-icon">
              <Smartphone size={20} />
            </div>
            <div className="e2ee-choice-text">
              <p className="e2ee-choice-title">Verify with another session</p>
              <p className="e2ee-choice-desc">
                Compare emojis with an existing session on another device
                (e.g. Element on your phone or another computer).
              </p>
            </div>
            <ChevronRight size={16} className="e2ee-choice-arrow" />
          </button>
        </div>

        <div className="e2ee-setup-footer">
          <button className="e2ee-skip-btn" onClick={onSkip}>
            Skip for now — I'll verify later
          </button>
        </div>

      </div>
    </div>
  );
};

export default E2EESetupDialog;
