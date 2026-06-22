import React, { useState, useRef, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Plus, Settings, ChevronUp } from "lucide-react";
import { useAccountsStore } from "../store/accountsStore";
import { useRoomsStore } from "../store/roomsStore";
import Avatar from "./Avatar";
import "./AccountSwitcher.css";

const AccountSwitcher: React.FC = () => {
  const accounts = useAccountsStore((s) => s.accounts);
  const activeAccountId = useAccountsStore((s) => s.activeAccountId);
  const syncStates = useAccountsStore((s) => s.syncStates);
  const setActiveAccount = useAccountsStore((s) => s.setActiveAccount);
  const roomsByAccount = useRoomsStore((s) => s.roomsByAccount);
  const navigate = useNavigate();

  const [popoverOpen, setPopoverOpen] = useState(false);
  const barRef = useRef<HTMLDivElement>(null);

  const activeAccount = accounts.find((a) => a.id === activeAccountId);
  const otherAccounts = accounts.filter((a) => a.id !== activeAccountId);

  const getTotalUnread = (accountId: string) => {
    const rooms = roomsByAccount[accountId] ?? [];
    return rooms.reduce((sum, r) => sum + r.unreadCount, 0);
  };

  const hasMention = (accountId: string) => {
    const rooms = roomsByAccount[accountId] ?? [];
    return rooms.some((r) => r.notificationCount > 0);
  };

  const getSyncState = (accountId: string) => syncStates[accountId] ?? "STOPPED";

  // Close popover on outside click
  useEffect(() => {
    if (!popoverOpen) return;
    const handler = (e: MouseEvent) => {
      if (barRef.current && !barRef.current.contains(e.target as Node)) {
        setPopoverOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [popoverOpen]);

  if (!activeAccount) return null;

  const syncState = getSyncState(activeAccount.id);
  const syncDotClass =
    syncState === "SYNCING" || syncState === "PREPARED"
      ? "account-sync-dot--online"
      : syncState === "ERROR"
      ? "account-sync-dot--error"
      : "account-sync-dot--away";

  const displayName = activeAccount.displayName ?? activeAccount.userId;
  const userId = activeAccount.userId;

  return (
    <div className="account-bar" ref={barRef}>
      {/* Account popover (renders above the bar) */}
      {popoverOpen && otherAccounts.length > 0 && (
        <div className="account-popover">
          <div className="account-popover-label">Switch Account</div>
          {otherAccounts.map((account) => {
            const unread = getTotalUnread(account.id);
            const mention = hasMention(account.id);
            return (
              <button
                key={account.id}
                className="account-popover-item"
                onClick={() => {
                  setActiveAccount(account.id);
                  setPopoverOpen(false);
                }}
              >
                <div className="account-popover-avatar-wrap">
                  <Avatar
                    name={account.displayName ?? account.userId}
                    avatarUrl={account.avatarUrl}
                    accountId={account.id}
                    size={32}
                  />
                  {unread > 0 && (
                    <span
                      className={`account-popover-dot ${mention ? "account-popover-dot--mention" : ""}`}
                    />
                  )}
                </div>
                <div className="account-popover-info">
                  <span className="account-popover-name">
                    {account.displayName ?? account.userId}
                  </span>
                  <span className="account-popover-id">{account.userId}</span>
                </div>
              </button>
            );
          })}
        </div>
      )}

      {/* Active account identity section */}
      <button
        className={`account-bar-identity ${popoverOpen ? "account-bar-identity--open" : ""}`}
        onClick={() => accounts.length > 1 && setPopoverOpen((v) => !v)}
        title={`${displayName} (${userId})`}
        aria-label="Switch account"
        aria-expanded={popoverOpen}
      >
        <div className="account-bar-avatar-wrap">
          <Avatar
            name={displayName}
            avatarUrl={activeAccount.avatarUrl}
            homeserver={activeAccount.homeserver}
            size={32}
          />
          <span className={`account-bar-sync-dot ${syncDotClass}`} />
        </div>
        <div className="account-bar-text">
          <span className="account-bar-display-name">{displayName}</span>
          <span className="account-bar-user-id">{userId}</span>
        </div>
        {accounts.length > 1 && (
          <ChevronUp
            size={14}
            className={`account-bar-chevron ${popoverOpen ? "account-bar-chevron--up" : ""}`}
          />
        )}
      </button>

      {/* Action buttons */}
      <div className="account-bar-actions">
        <button
          className="account-action-btn"
          onClick={() => navigate("/login")}
          title="Add account"
          aria-label="Add account"
        >
          <Plus size={16} />
        </button>
        <button
          className="account-action-btn"
          onClick={() => navigate("/app/settings")}
          title="Settings"
          aria-label="Settings"
        >
          <Settings size={15} />
        </button>
      </div>
    </div>
  );
};

export default AccountSwitcher;
