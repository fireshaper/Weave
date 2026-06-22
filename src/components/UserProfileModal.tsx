import React, { useMemo, useState, useCallback } from "react";
import ReactDOM from "react-dom";
import {
  X,
  MessageSquarePlus,
  AtSign,
  Copy,
  Crown,
  Shield,
  User,
  Hash,
  CheckCheck,
  ExternalLink,
} from "lucide-react";
import Avatar from "./Avatar";
import { accountManager } from "../accounts/AccountManager";
import { useAccountsStore } from "../store/accountsStore";
import { useTimelineStore } from "../store/timelineStore";
import { getUserColor } from "../utils/userColor";
import "./UserProfileModal.css";

export interface UserProfileTarget {
  userId: string;
  displayName: string;
  avatarUrl?: string;
  roomId?: string; // the room the right-click came from (for power-level + shared context)
}

interface UserProfileModalProps {
  user: UserProfileTarget;
  onClose: () => void;
  onMention?: (mention: string) => void;
}

type Tab = "profile" | "rooms";

const UserProfileModal: React.FC<UserProfileModalProps> = ({ user, onClose, onMention }) => {
  const activeAccountId = useAccountsStore((s) => s.activeAccountId);
  const activeAccount = useAccountsStore((s) => s.accounts.find((a) => a.id === s.activeAccountId));
  const setActiveRoom = useTimelineStore((s) => s.setActiveRoom);

  const client = activeAccountId ? accountManager.getClient(activeAccountId) : undefined;
  const myUserId = client?.getUserId() ?? "";
  const isSelf = user.userId === myUserId;

  const [tab, setTab] = useState<Tab>("profile");
  const [copied, setCopied] = useState<"id" | "name" | null>(null);

  // Power level in the originating room
  const powerLevel = useMemo(() => {
    if (!client || !user.roomId) return 0;
    return client.getRoom(user.roomId)?.getMember(user.userId)?.powerLevel ?? 0;
  }, [client, user.userId, user.roomId]);

  const isAdmin = powerLevel >= 100;
  const isMod = powerLevel >= 50 && powerLevel < 100;
  const roleLabel = isAdmin ? "Admin" : isMod ? "Moderator" : null;
  const RoleIcon = isAdmin ? Crown : Shield;

  // Shared rooms: rooms where both the local user and the target user are members
  const sharedRooms = useMemo(() => {
    if (!client || isSelf) return [];
    return client
      .getRooms()
      .filter((r) => {
        if (r.getMyMembership() !== "join") return false;
        const member = r.getMember(user.userId);
        return member?.membership === "join";
      })
      .map((r) => ({
        roomId: r.roomId,
        name: r.name ?? r.roomId,
        avatarUrl: r.getMxcAvatarUrl?.() ?? undefined,
        isDirect: (() => {
          const dmMap = client.getAccountData("m.direct" as any)?.getContent() ?? {};
          return Object.values(dmMap as Record<string, string[]>)
            .flat()
            .includes(r.roomId);
        })(),
        memberCount: r.getJoinedMemberCount?.() ?? 0,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [client, user.userId, isSelf]);

  const handleOpenDm = useCallback(async () => {
    if (!client || !activeAccountId) return;
    try {
      const dmMap = client.getAccountData("m.direct" as any)?.getContent() ?? {};
      const existingRooms: string[] = (dmMap as any)[user.userId] ?? [];
      if (existingRooms.length > 0) {
        setActiveRoom(existingRooms[existingRooms.length - 1]);
        onClose();
        return;
      }
      const result = await client.createRoom({
        is_direct: true,
        invite: [user.userId],
        preset: "trusted_private_chat" as any,
        initial_state: [
          { type: "m.room.encryption", state_key: "", content: { algorithm: "m.megolm" } },
        ],
      });
      setActiveRoom(result.room_id);
      onClose();
    } catch (e) {
      console.warn("[UserProfileModal] Could not open DM:", e);
    }
  }, [client, activeAccountId, user.userId, setActiveRoom, onClose]);

  const handleMention = useCallback(() => {
    onMention?.(user.displayName);
    onClose();
  }, [onMention, user.displayName, onClose]);

  const handleCopy = useCallback((type: "id" | "name") => {
    const text = type === "id" ? user.userId : user.displayName;
    navigator.clipboard.writeText(text).catch(() => {});
    setCopied(type);
    setTimeout(() => setCopied(null), 1500);
  }, [user.userId, user.displayName]);

  const handleNavigateRoom = useCallback((roomId: string) => {
    setActiveRoom(roomId);
    onClose();
  }, [setActiveRoom, onClose]);

  return ReactDOM.createPortal(
    <div className="upm-overlay" onClick={onClose}>
      <div
        className="upm-modal fade-in"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={`Profile: ${user.displayName}`}
      >
        {/* ── Banner ── */}
        <div
          className="upm-banner"
          style={{
            background: `linear-gradient(135deg, ${getUserColor(user.userId)}40 0%, ${getUserColor(user.userId)}10 60%, transparent 100%)`,
          }}
        />

        <button className="upm-close" onClick={onClose} aria-label="Close">
          <X size={14} />
        </button>

        {/* ── Avatar row ── */}
        <div className="upm-avatar-row">
          <div className="upm-avatar-wrap">
            <Avatar
              name={user.displayName}
              avatarUrl={user.avatarUrl}
              homeserver={activeAccount?.homeserver}
              size={80}
              className="upm-avatar"
            />
          </div>

          {/* Role + quick-actions pushed to the right */}
          <div className="upm-avatar-actions">
            {roleLabel && (
              <span className="upm-role-chip">
                <RoleIcon size={10} />
                {roleLabel}
              </span>
            )}
            {!isSelf && (
              <button className="upm-action-btn upm-action-btn--primary" onClick={handleOpenDm} title="Send message">
                <MessageSquarePlus size={14} />
                Message
              </button>
            )}
            {!isSelf && onMention && (
              <button className="upm-action-btn" onClick={handleMention} title="Mention in chat">
                <AtSign size={14} />
                Mention
              </button>
            )}
          </div>
        </div>

        {/* ── Identity ── */}
        <div className="upm-identity">
          <h2 className="upm-name" style={{ color: getUserColor(user.userId) }}>
            {user.displayName}
          </h2>
          <div className="upm-mxid-row">
            <span className="upm-mxid">{user.userId}</span>
            <button
              className={`upm-copy-btn ${copied === "id" ? "upm-copy-btn--done" : ""}`}
              onClick={() => handleCopy("id")}
              title="Copy Matrix ID"
            >
              {copied === "id" ? <CheckCheck size={12} /> : <Copy size={12} />}
            </button>
          </div>
        </div>

        {/* ── Tabs ── */}
        {!isSelf && sharedRooms.length > 0 && (
          <div className="upm-tabs" role="tablist">
            <button
              className={`upm-tab ${tab === "profile" ? "upm-tab--active" : ""}`}
              onClick={() => setTab("profile")}
              role="tab"
              aria-selected={tab === "profile"}
            >
              <User size={13} />
              Profile
            </button>
            <button
              className={`upm-tab ${tab === "rooms" ? "upm-tab--active" : ""}`}
              onClick={() => setTab("rooms")}
              role="tab"
              aria-selected={tab === "rooms"}
            >
              <Hash size={13} />
              Shared Rooms
              <span className="upm-tab-count">{sharedRooms.length}</span>
            </button>
          </div>
        )}

        {/* ── Tab content ── */}
        <div className="upm-body">
          {tab === "profile" && (
            <div className="upm-profile-tab">
              {/* Stats row */}
              <div className="upm-stats">
                <div className="upm-stat">
                  <span className="upm-stat-value">{sharedRooms.length}</span>
                  <span className="upm-stat-label">Shared Rooms</span>
                </div>
                {powerLevel > 0 && (
                  <div className="upm-stat">
                    <span className="upm-stat-value">{powerLevel}</span>
                    <span className="upm-stat-label">Power Level</span>
                  </div>
                )}
              </div>

              {/* Copy row */}
              <div className="upm-field-section">
                <div className="upm-field-row">
                  <label className="upm-field-label">Display Name</label>
                  <div className="upm-field-value-row">
                    <span className="upm-field-value">{user.displayName}</span>
                    <button
                      className={`upm-copy-btn ${copied === "name" ? "upm-copy-btn--done" : ""}`}
                      onClick={() => handleCopy("name")}
                      title="Copy display name"
                    >
                      {copied === "name" ? <CheckCheck size={12} /> : <Copy size={12} />}
                    </button>
                  </div>
                </div>
                <div className="upm-field-row">
                  <label className="upm-field-label">Matrix ID</label>
                  <div className="upm-field-value-row">
                    <span className="upm-field-value upm-field-value--mono">{user.userId}</span>
                    <button
                      className={`upm-copy-btn ${copied === "id" ? "upm-copy-btn--done" : ""}`}
                      onClick={() => handleCopy("id")}
                      title="Copy Matrix ID"
                    >
                      {copied === "id" ? <CheckCheck size={12} /> : <Copy size={12} />}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {tab === "rooms" && (
            <div className="upm-rooms-tab">
              {sharedRooms.map((r) => (
                <button
                  key={r.roomId}
                  className="upm-room-row"
                  onClick={() => handleNavigateRoom(r.roomId)}
                  title={r.roomId}
                >
                  <Avatar
                    name={r.name}
                    avatarUrl={r.avatarUrl}
                    homeserver={activeAccount?.homeserver}
                    size={28}
                    className="upm-room-avatar"
                  />
                  <div className="upm-room-info">
                    <span className="upm-room-name truncate">{r.name}</span>
                    <span className="upm-room-meta">
                      {r.isDirect ? "Direct message" : `${r.memberCount} members`}
                    </span>
                  </div>
                  <ExternalLink size={12} className="upm-room-open" />
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
};

export default UserProfileModal;
