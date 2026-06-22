import React, { useMemo, useState, useCallback } from "react";
import ReactDOM from "react-dom";
import {
  X,
  Hash,
  Lock,
  Users,
  Link,
  Copy,
  CheckCheck,
  Star,
  StarOff,
  BellOff,
  Bell,
  LogOut,
  Shield,
  Globe,
  MessageSquare,
  Calendar,
} from "lucide-react";
import Avatar from "./Avatar";
import { accountManager } from "../accounts/AccountManager";
import { useAccountsStore } from "../store/accountsStore";
import { useTimelineStore } from "../store/timelineStore";
import type { RoomSummary } from "../types/matrix";
import { PushRuleKind } from "matrix-js-sdk";
import "./RoomInfoModal.css";

interface RoomInfoModalProps {
  room: RoomSummary;
  onClose: () => void;
}

type Tab = "overview" | "members";

const RoomInfoModal: React.FC<RoomInfoModalProps> = ({ room, onClose }) => {
  const activeAccountId = useAccountsStore((s) => s.activeAccountId);
  const activeAccount = useAccountsStore((s) => s.accounts.find((a) => a.id === s.activeAccountId));

  const client = activeAccountId ? accountManager.getClient(activeAccountId) : undefined;
  const matrixRoom = client?.getRoom(room.roomId);
  const myUserId = client?.getUserId() ?? "";

  const [tab, setTab] = useState<Tab>("overview");
  const [copied, setCopied] = useState<"id" | "link" | null>(null);
  const [isMuted, setIsMuted] = useState(false);
  const [isFavorited, setIsFavorited] = useState(false);

  // Load mute state on mount
  React.useEffect(() => {
    if (!client || !room.roomId) return;
    const check = async () => {
      try {
        const rulesResult = client.getPushRules();
        const pushRules = rulesResult instanceof Promise ? await rulesResult : rulesResult;
        const overrides: any[] = (pushRules?.global as any)?.[PushRuleKind.Override] ?? [];
        setIsMuted(overrides.some(
          (r: any) => r.rule_id === room.roomId && r.enabled && r.actions?.includes("dont_notify")
        ));
      } catch { setIsMuted(false); }
    };
    check();
    // Favourite
    try {
      setIsFavorited("m.favourite" in (matrixRoom?.tags ?? {}));
    } catch { setIsFavorited(false); }
  }, [client, room.roomId, matrixRoom]);

  // Room metadata from SDK
  const roomMeta = useMemo(() => {
    if (!matrixRoom) return null;

    const createEvent = matrixRoom.currentState?.getStateEvents("m.room.create", "");
    const encryptionEvent = matrixRoom.currentState?.getStateEvents("m.room.encryption", "");
    const aliases = matrixRoom.getAltAliases?.() ?? [];
    const canonicalAlias = matrixRoom.getCanonicalAlias?.() ?? null;

    return {
      isEncrypted: !!encryptionEvent,
      encryptionAlgorithm: encryptionEvent?.getContent()?.algorithm ?? null,
      createdAt: createEvent?.getTs() ?? null,
      creatorId: createEvent?.getSender() ?? null,
      aliases: [canonicalAlias, ...aliases].filter(Boolean) as string[],
      isPublic: matrixRoom.getJoinRule?.() === "public",
      myPowerLevel: matrixRoom.getMember(myUserId)?.powerLevel ?? 0,
    };
  }, [matrixRoom, myUserId]);

  // Member list for the members tab
  const members = useMemo(() => {
    if (!matrixRoom) return [];
    return matrixRoom
      .getMembers()
      .filter((m) => m.membership === "join")
      .map((m) => ({
        userId: m.userId,
        displayName: m.name ?? m.userId,
        avatarUrl: m.getMxcAvatarUrl?.() ?? undefined,
        powerLevel: m.powerLevel ?? 0,
      }))
      .sort((a, b) => {
        if (b.powerLevel !== a.powerLevel) return b.powerLevel - a.powerLevel;
        return a.displayName.localeCompare(b.displayName);
      });
  }, [matrixRoom]);

  // ── Actions ──────────────────────────────────────────────────────────────────

  const handleCopy = useCallback((type: "id" | "link") => {
    const text = type === "id"
      ? room.roomId
      : `https://matrix.to/#/${encodeURIComponent(room.roomId)}`;
    navigator.clipboard.writeText(text).catch(() => {});
    setCopied(type);
    setTimeout(() => setCopied(null), 1500);
  }, [room.roomId]);

  const handleToggleMute = useCallback(async () => {
    if (!client) return;
    try {
      if (isMuted) {
        await client.deletePushRule("global", PushRuleKind.Override, room.roomId);
        setIsMuted(false);
      } else {
        await client.addPushRule("global", PushRuleKind.Override, room.roomId, {
          actions: ["dont_notify"],
          conditions: [{ kind: "event_match", key: "room_id", pattern: room.roomId }],
        } as any);
        setIsMuted(true);
      }
    } catch (e) {
      console.warn("[RoomInfoModal] Could not toggle mute:", e);
    }
  }, [client, room.roomId, isMuted]);

  const handleToggleFavorite = useCallback(async () => {
    if (!client) return;
    try {
      if (isFavorited) {
        await client.deleteRoomTag(room.roomId, "m.favourite");
        setIsFavorited(false);
      } else {
        await client.setRoomTag(room.roomId, "m.favourite", { order: 0.5 });
        setIsFavorited(true);
      }
    } catch (e) {
      console.warn("[RoomInfoModal] Could not toggle favourite:", e);
    }
  }, [client, room.roomId, isFavorited]);

  const handleLeave = useCallback(async () => {
    if (!client) return;
    const confirmed = window.confirm(`Leave "${room.name}"?`);
    if (!confirmed) return;
    try {
      await client.leave(room.roomId);
      const tl = useTimelineStore.getState();
      if (tl.activeRoomId === room.roomId) tl.setActiveRoom(null);
      onClose();
    } catch (e) {
      console.warn("[RoomInfoModal] Could not leave room:", e);
    }
  }, [client, room.roomId, room.name, onClose]);

  const formatDate = (ts: number | null) => {
    if (!ts) return "Unknown";
    return new Date(ts).toLocaleDateString([], { year: "numeric", month: "long", day: "numeric" });
  };

  return ReactDOM.createPortal(
    <div className="rim-overlay" onClick={onClose}>
      <div
        className="rim-modal fade-in"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={`Room info: ${room.name}`}
      >
        {/* ── Header ── */}
        <div className="rim-header">
          <div className="rim-header-avatar">
            <Avatar
              name={room.name}
              avatarUrl={room.avatarUrl}
              homeserver={activeAccount?.homeserver}
              size={44}
            />
            {roomMeta?.isEncrypted && (
              <span className="rim-enc-badge" title="End-to-end encrypted">
                <Lock size={9} />
              </span>
            )}
          </div>

          <div className="rim-header-info">
            <h2 className="rim-room-name">{room.name}</h2>
            <div className="rim-room-chips">
              {room.isDirect ? (
                <span className="rim-chip"><MessageSquare size={10} /> Direct Message</span>
              ) : (
                <span className="rim-chip">
                  {roomMeta?.isPublic ? <Globe size={10} /> : <Lock size={10} />}
                  {roomMeta?.isPublic ? "Public" : "Private"}
                </span>
              )}
              {roomMeta?.isEncrypted && (
                <span className="rim-chip rim-chip--encrypted"><Shield size={10} /> Encrypted</span>
              )}
            </div>
          </div>

          <button className="rim-close" onClick={onClose} aria-label="Close">
            <X size={14} />
          </button>
        </div>

        {/* ── Topic ── */}
        {room.topic && (
          <p className="rim-topic">{room.topic}</p>
        )}

        {/* ── Quick stats ── */}
        <div className="rim-stats">
          <div className="rim-stat">
            <Users size={14} className="rim-stat-icon" />
            <span className="rim-stat-value">{room.memberCount}</span>
            <span className="rim-stat-label">Members</span>
          </div>
          {roomMeta?.createdAt && (
            <div className="rim-stat">
              <Calendar size={14} className="rim-stat-icon" />
              <span className="rim-stat-value">{formatDate(roomMeta.createdAt)}</span>
              <span className="rim-stat-label">Created</span>
            </div>
          )}
        </div>

        {/* ── Quick actions ── */}
        <div className="rim-actions">
          <button className={`rim-action-btn ${isFavorited ? "rim-action-btn--active" : ""}`} onClick={handleToggleFavorite}>
            {isFavorited ? <StarOff size={14} /> : <Star size={14} />}
            {isFavorited ? "Unfavourite" : "Favourite"}
          </button>
          <button className={`rim-action-btn ${isMuted ? "rim-action-btn--active" : ""}`} onClick={handleToggleMute}>
            {isMuted ? <Bell size={14} /> : <BellOff size={14} />}
            {isMuted ? "Unmute" : "Mute"}
          </button>
          <button className="rim-action-btn rim-action-btn--danger" onClick={handleLeave}>
            <LogOut size={14} />
            Leave
          </button>
        </div>

        {/* ── Tabs ── */}
        <div className="rim-tabs" role="tablist">
          <button
            className={`rim-tab ${tab === "overview" ? "rim-tab--active" : ""}`}
            onClick={() => setTab("overview")}
            role="tab"
            aria-selected={tab === "overview"}
          >
            <Hash size={12} />
            Overview
          </button>
          <button
            className={`rim-tab ${tab === "members" ? "rim-tab--active" : ""}`}
            onClick={() => setTab("members")}
            role="tab"
            aria-selected={tab === "members"}
          >
            <Users size={12} />
            Members
            <span className="rim-tab-count">{room.memberCount}</span>
          </button>
        </div>

        {/* ── Tab body ── */}
        <div className="rim-body">

          {/* Overview tab */}
          {tab === "overview" && (
            <div className="rim-overview">

              {/* Room ID */}
              <div className="rim-field">
                <label className="rim-field-label">Room ID</label>
                <div className="rim-field-value-row">
                  <span className="rim-field-value rim-field-value--mono">{room.roomId}</span>
                  <button
                    className={`rim-copy-btn ${copied === "id" ? "rim-copy-btn--done" : ""}`}
                    onClick={() => handleCopy("id")}
                    title="Copy room ID"
                  >
                    {copied === "id" ? <CheckCheck size={12} /> : <Copy size={12} />}
                  </button>
                </div>
              </div>

              {/* Aliases */}
              {(roomMeta?.aliases ?? []).length > 0 && (
                <div className="rim-field">
                  <label className="rim-field-label">Aliases</label>
                  <div className="rim-aliases">
                    {roomMeta!.aliases.map((alias) => (
                      <div key={alias} className="rim-alias-row">
                        <Link size={11} className="rim-alias-icon" />
                        <span className="rim-field-value--mono">{alias}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Share link */}
              <div className="rim-field">
                <label className="rim-field-label">Share Link</label>
                <div className="rim-field-value-row">
                  <span className="rim-field-value" style={{ fontSize: 11, wordBreak: "break-all" }}>
                    {`matrix.to/#/${encodeURIComponent(room.roomId)}`}
                  </span>
                  <button
                    className={`rim-copy-btn ${copied === "link" ? "rim-copy-btn--done" : ""}`}
                    onClick={() => handleCopy("link")}
                    title="Copy link"
                  >
                    {copied === "link" ? <CheckCheck size={12} /> : <Copy size={12} />}
                  </button>
                </div>
              </div>

              {/* Encryption */}
              {roomMeta?.isEncrypted && (
                <div className="rim-field">
                  <label className="rim-field-label">Encryption</label>
                  <div className="rim-enc-info">
                    <Shield size={13} className="rim-enc-icon" />
                    <span>{roomMeta.encryptionAlgorithm ?? "Enabled"}</span>
                  </div>
                </div>
              )}

              {/* Creator */}
              {roomMeta?.creatorId && (
                <div className="rim-field">
                  <label className="rim-field-label">Created by</label>
                  <span className="rim-field-value rim-field-value--mono" style={{ fontSize: 12 }}>
                    {roomMeta.creatorId}
                  </span>
                </div>
              )}
            </div>
          )}

          {/* Members tab */}
          {tab === "members" && (
            <div className="rim-members">
              {members.map((m) => (
                <div key={m.userId} className="rim-member-row" title={m.userId}>
                  <Avatar
                    name={m.displayName}
                    avatarUrl={m.avatarUrl}
                    homeserver={activeAccount?.homeserver}
                    size={28}
                  />
                  <div className="rim-member-info">
                    <span className="rim-member-name truncate">{m.displayName}</span>
                    <span className="rim-member-id truncate">{m.userId}</span>
                  </div>
                  {m.powerLevel >= 100 && (
                    <span className="rim-member-role rim-member-role--admin" title="Admin">
                      <Shield size={10} /> Admin
                    </span>
                  )}
                  {m.powerLevel >= 50 && m.powerLevel < 100 && (
                    <span className="rim-member-role rim-member-role--mod" title="Moderator">
                      <Shield size={10} /> Mod
                    </span>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
};

export default RoomInfoModal;
