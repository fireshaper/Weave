import React, { useMemo } from "react";
import { Home, User, Inbox as InboxIcon } from "lucide-react";
import { useAccountsStore } from "../store/accountsStore";
import { useRoomsStore } from "../store/roomsStore";
import { useTimelineStore } from "../store/timelineStore";
import { useInboxStore } from "../store/inboxStore";
import Avatar from "./Avatar";
import "./SpaceSwitcher.css";

interface SpaceSwitcherProps {
  onOpenInbox: () => void;
  inboxOpen: boolean;
}

const SpaceSwitcher: React.FC<SpaceSwitcherProps> = ({ onOpenInbox, inboxOpen }) => {
  const activeAccountId = useAccountsStore((s) => s.activeAccountId);
  const activeAccount = useAccountsStore((s) =>
    s.accounts.find((a) => a.id === s.activeAccountId)
  );
  const roomsByAccount = useRoomsStore((s) => s.roomsByAccount);
  const activeSpaceId = useRoomsStore((s) => s.activeSpaceId);
  const setActiveSpaceId = useRoomsStore((s) => s.setActiveSpaceId);
  const setActiveRoom = useTimelineStore((s) => s.setActiveRoom);

  // Derive spaces from the active account's room list
  const spaces = useMemo(() => {
    if (!activeAccountId) return [];
    const rooms = roomsByAccount[activeAccountId] ?? [];
    return rooms
      .filter((r) => r.roomType === "m.space")
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [roomsByAccount, activeAccountId]);

  // Unread helpers
  const allRooms = activeAccountId ? (roomsByAccount[activeAccountId] ?? []) : [];

  const homeUnread = allRooms.filter((r) => r.roomType !== "m.space").reduce((s, r) => s + r.unreadCount, 0);
  const homeMention = allRooms.filter((r) => r.roomType !== "m.space").some((r) => r.notificationCount > 0);

  const personalUnread = allRooms.filter((r) => r.isDirect).reduce((s, r) => s + r.unreadCount, 0);
  const personalMention = allRooms.filter((r) => r.isDirect).some((r) => r.notificationCount > 0);

  const spaceUnread = (spaceId: string) =>
    allRooms.filter((r) => r.spaceIds.includes(spaceId)).reduce((s, r) => s + r.unreadCount, 0);
  const spaceMention = (spaceId: string) =>
    allRooms.filter((r) => r.spaceIds.includes(spaceId)).some((r) => r.notificationCount > 0);

  // Unread mention count for the inbox badge
  const mentionsByAccount = useInboxStore((s) => s.mentionsByAccount);
  const inboxCount = useMemo(() => {
    if (!activeAccountId) return 0;
    return (mentionsByAccount[activeAccountId] ?? []).filter((m) => !m.read).length;
  }, [mentionsByAccount, activeAccountId]);

  const pill = (
    id: string,
    icon: React.ReactNode,
    label: string,
    unread: number,
    mention: boolean,
  ) => {
    const isActive = activeSpaceId === id;
    return (
      <button
        key={id}
        id={`space-pill-${id}`}
        className={`space-pill ${isActive ? "space-pill--active" : ""}`}
        onClick={() => {
          setActiveSpaceId(id);
          setActiveRoom(null);
        }}
        title={label}
        aria-label={label}
        aria-pressed={isActive}
      >
        <div className="space-pill-indicator" />
        <div className="space-pill-icon">{icon}</div>
        {unread > 0 && !isActive && (
          <span className={`space-pill-dot ${mention ? "space-pill-dot--mention" : ""}`} />
        )}
      </button>
    );
  };

  return (
    <aside className="space-switcher" aria-label="Space switcher">
      <div className="space-switcher-list">
        {/* Inbox — mentions & unreads across all rooms */}
        <button
          className={`space-pill ${inboxOpen ? "space-pill--active" : ""}`}
          onClick={onOpenInbox}
          title="Inbox"
          aria-label="Inbox"
          aria-pressed={inboxOpen}
        >
          <div className="space-pill-indicator" />
          <div className="space-pill-icon">
            <InboxIcon size={18} />
          </div>
          {inboxCount > 0 && (
            <span className="space-pill-badge">{inboxCount > 99 ? "99+" : inboxCount}</span>
          )}
        </button>

        <div className="space-divider" />

        {/* Home — all rooms + DMs */}
        {pill(
          "home",
          <Home size={18} />,
          "Home",
          homeUnread,
          homeMention,
        )}

        {/* Personal — DMs only */}
        {pill(
          "personal",
          <User size={18} />,
          "Personal",
          personalUnread,
          personalMention,
        )}

        {spaces.length > 0 && <div className="space-divider" />}

        {/* One pill per space */}
        {spaces.map((space) => {
          const unread = spaceUnread(space.roomId);
          const mention = spaceMention(space.roomId);
          const isActive = activeSpaceId === space.roomId;
          return (
            <button
              key={space.roomId}
              id={`space-pill-${space.roomId}`}
              className={`space-pill ${isActive ? "space-pill--active" : ""}`}
              onClick={() => {
                setActiveSpaceId(space.roomId);
                setActiveRoom(null);
              }}
              title={space.name}
              aria-label={space.name}
              aria-pressed={isActive}
            >
              <div className="space-pill-indicator" />
              <Avatar
                name={space.name}
                avatarUrl={space.avatarUrl}
                homeserver={activeAccount?.homeserver}
                size={36}
                className="space-pill-avatar"
              />
              {unread > 0 && !isActive && (
                <span className={`space-pill-dot ${mention ? "space-pill-dot--mention" : ""}`} />
              )}
            </button>
          );
        })}
      </div>
    </aside>
  );
};

export default SpaceSwitcher;
