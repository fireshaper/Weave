import React, { useMemo, useState } from "react";
import { AtSign, Hash, MessageSquare, CheckCheck, Inbox as InboxIcon } from "lucide-react";
import { useAccountsStore } from "../store/accountsStore";
import { useRoomsStore } from "../store/roomsStore";
import { useTimelineStore } from "../store/timelineStore";
import { useInboxStore } from "../store/inboxStore";
import Avatar from "./Avatar";
import type { InboxMention, RoomSummary } from "../types/matrix";
import "./Inbox.css";

type Tab = "mentions" | "unreads";

function formatRelative(ts: number): string {
  const diff = Date.now() - ts;
  const min = Math.floor(diff / 60000);
  if (min < 1) return "now";
  if (min < 60) return `${min}m`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h`;
  const d = new Date(ts);
  return d.toLocaleDateString([], { month: "short", day: "numeric" });
}

const Inbox: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const activeAccountId = useAccountsStore((s) => s.activeAccountId);
  const mentionsByAccount = useInboxStore((s) => s.mentionsByAccount);
  const markAllRead = useInboxStore((s) => s.markAllRead);
  const roomsByAccount = useRoomsStore((s) => s.roomsByAccount);
  const setActiveSpaceId = useRoomsStore((s) => s.setActiveSpaceId);
  const setActiveRoom = useTimelineStore((s) => s.setActiveRoom);
  const requestJump = useTimelineStore((s) => s.requestJump);

  const [tab, setTab] = useState<Tab>("mentions");

  const mentions = useMemo<InboxMention[]>(
    () => (activeAccountId ? mentionsByAccount[activeAccountId] ?? [] : []),
    [mentionsByAccount, activeAccountId],
  );

  const unreadRooms = useMemo<RoomSummary[]>(() => {
    if (!activeAccountId) return [];
    return (roomsByAccount[activeAccountId] ?? [])
      .filter((r) => r.roomType !== "m.space" && r.membership !== "invite" && r.unreadCount > 0)
      .sort((a, b) => (b.lastMessageTs ?? 0) - (a.lastMessageTs ?? 0));
  }, [roomsByAccount, activeAccountId]);

  const unreadMentionCount = mentions.filter((m) => !m.read).length;

  // Open a room and dismiss the panel. Reset to Home so the room is visible
  // regardless of the current space filter.
  const openRoom = (roomId: string) => {
    setActiveSpaceId("home");
    setActiveRoom(roomId);
    onClose();
  };

  // Open a room and scroll straight to the message that pinged you.
  const openMention = (m: InboxMention) => {
    setActiveSpaceId("home");
    requestJump(m.roomId, m.id);
    onClose();
  };

  return (
    <>
      <div className="inbox-backdrop" onClick={onClose} />
      <div className="inbox-panel" role="dialog" aria-label="Inbox">
        <header className="inbox-header">
          <div className="inbox-title">
            <InboxIcon size={16} />
            <span>Inbox</span>
          </div>
          {tab === "mentions" && unreadMentionCount > 0 && activeAccountId && (
            <button
              className="inbox-markread"
              onClick={() => markAllRead(activeAccountId)}
              title="Mark all mentions read"
            >
              <CheckCheck size={14} />
              <span>Mark read</span>
            </button>
          )}
        </header>

        <div className="inbox-tabs">
          <button
            className={`inbox-tab ${tab === "mentions" ? "inbox-tab--active" : ""}`}
            onClick={() => setTab("mentions")}
          >
            Mentions
            {unreadMentionCount > 0 && <span className="inbox-tab-badge">{unreadMentionCount}</span>}
          </button>
          <button
            className={`inbox-tab ${tab === "unreads" ? "inbox-tab--active" : ""}`}
            onClick={() => setTab("unreads")}
          >
            Unreads
            {unreadRooms.length > 0 && <span className="inbox-tab-badge">{unreadRooms.length}</span>}
          </button>
        </div>

        <div className="inbox-list">
          {tab === "mentions" &&
            (mentions.length === 0 ? (
              <div className="inbox-empty">
                <AtSign size={28} />
                <p>No mentions yet</p>
                <span>When someone pings you, it shows up here.</span>
              </div>
            ) : (
              mentions.map((m) => (
                <button
                  key={m.id}
                  className={`inbox-item ${m.read ? "inbox-item--read" : ""}`}
                  onClick={() => openMention(m)}
                >
                  <Avatar
                    name={m.senderName}
                    avatarUrl={m.senderAvatarUrl}
                    accountId={m.accountId}
                    size={36}
                    className="inbox-item-avatar"
                  />
                  <div className="inbox-item-body">
                    <div className="inbox-item-top">
                      <span className="inbox-item-sender truncate">{m.senderName}</span>
                      <span className="inbox-item-time">{formatRelative(m.ts)}</span>
                    </div>
                    <div className="inbox-item-room truncate">
                      <Hash size={11} /> {m.roomName}
                    </div>
                    <div className="inbox-item-text truncate">{m.body}</div>
                  </div>
                  {!m.read && <span className="inbox-item-dot" />}
                </button>
              ))
            ))}

          {tab === "unreads" &&
            (unreadRooms.length === 0 ? (
              <div className="inbox-empty">
                <CheckCheck size={28} />
                <p>All caught up</p>
                <span>You have no unread rooms.</span>
              </div>
            ) : (
              unreadRooms.map((r) => (
                <button key={r.roomId} className="inbox-item" onClick={() => openRoom(r.roomId)}>
                  <Avatar
                    name={r.name}
                    avatarUrl={r.avatarUrl}
                    accountId={r.accountId}
                    size={36}
                    className="inbox-item-avatar"
                  />
                  <div className="inbox-item-body">
                    <div className="inbox-item-top">
                      <span className="inbox-item-sender truncate">
                        {r.isDirect ? <MessageSquare size={11} /> : <Hash size={11} />} {r.name}
                      </span>
                      <span className="inbox-item-time">{formatRelative(r.lastMessageTs ?? 0)}</span>
                    </div>
                    <div className="inbox-item-text truncate">{r.lastMessage ?? "New activity"}</div>
                  </div>
                  <span
                    className={`inbox-count-badge ${
                      r.notificationCount > 0 ? "inbox-count-badge--mention" : ""
                    }`}
                  >
                    {r.unreadCount}
                  </span>
                </button>
              ))
            ))}
        </div>
      </div>
    </>
  );
};

export default Inbox;
