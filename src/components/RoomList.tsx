import React, { useState, useMemo, useCallback, memo } from "react";
import { Search, Hash, MessageSquare } from "lucide-react";
import { useAccountsStore } from "../store/accountsStore";
import { useRoomsStore } from "../store/roomsStore";
import { useTimelineStore } from "../store/timelineStore";

import Avatar from "./Avatar";
import AccountSwitcher from "./AccountSwitcher";
import RoomContextMenu from "./RoomContextMenu";
import RoomInfoModal from "./RoomInfoModal";
import type { RoomSummary } from "../types/matrix";

import "./RoomList.css";

// ─── Helpers (module-scope, stable references) ───────────────────────────────

function formatTime(ts?: number): string {
  if (!ts) return "";
  const d = new Date(ts);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) {
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }
  return d.toLocaleDateString([], { month: "short", day: "numeric" });
}

// ─── RoomItem — defined at module scope so React never remounts it ────────────

interface RoomItemProps {
  room: RoomSummary;
  activeRoomId: string | null;
  isLocallyUnread: boolean;
  homeserver?: string;
  onClickRoom: (room: RoomSummary) => void;
  onContextMenuRoom: (room: RoomSummary, x: number, y: number) => void;
}

const RoomItem = memo(function RoomItem({
  room,
  activeRoomId,
  isLocallyUnread,
  homeserver,
  onClickRoom,
  onContextMenuRoom,
}: RoomItemProps) {
  const isActive = room.roomId === activeRoomId;
  const hasUnread = room.unreadCount > 0 || isLocallyUnread;
  const hasMention = room.notificationCount > 0;

  const handleContextMenu = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      onContextMenuRoom(room, e.clientX, e.clientY);
    },
    [room, onContextMenuRoom]
  );

  return (
    <button
      className={`room-item ${isActive ? "room-item--active" : ""} ${hasUnread ? "room-item--unread" : ""}`}
      onClick={() => onClickRoom(room)}
      onContextMenu={handleContextMenu}
      title={room.topic ?? room.name}
    >
      <Avatar
        name={room.name}
        avatarUrl={room.avatarUrl}
        homeserver={homeserver}
        size={32}
        className="room-item-avatar"
      />
      <div className="room-item-content">
        <div className="room-item-top">
          <span className="room-item-name truncate">
            {room.isDirect ? (
              <MessageSquare size={10} style={{ marginRight: 3, verticalAlign: "middle", opacity: 0.6 }} />
            ) : (
              <Hash size={10} style={{ marginRight: 3, verticalAlign: "middle", opacity: 0.6 }} />
            )}
            {room.name}
          </span>
          <div className="room-item-meta">
            <span className="room-item-time">{formatTime(room.lastMessageTs)}</span>
            {hasMention ? (
              <span className="room-item-dot room-item-dot--mention" />
            ) : hasUnread ? (
              <span className="room-item-dot" />
            ) : null}
          </div>
        </div>
        <div className="room-item-bottom">
          <span className="room-item-preview truncate">
            {room.lastMessage ?? <em>No messages yet</em>}
          </span>
        </div>
      </div>
    </button>
  );
});

// ─── RoomList ─────────────────────────────────────────────────────────────────

const RoomList: React.FC = () => {
  const activeAccountId = useAccountsStore((s) => s.activeAccountId);
  const activeAccount = useAccountsStore((s) =>
    s.accounts.find((a) => a.id === s.activeAccountId)
  );
  const roomsByAccount = useRoomsStore((s) => s.roomsByAccount);
  const activeSpaceId = useRoomsStore((s) => s.activeSpaceId);
  const activeRoomId = useTimelineStore((s) => s.activeRoomId);
  const setActiveRoom = useTimelineStore((s) => s.setActiveRoom);
  const localUnreadsByRoom = useTimelineStore((s) => s.localUnreadsByRoom);

  const [search, setSearch] = useState("");
  const [channelsCollapsed, setChannelsCollapsed] = useState(false);
  const [dmsCollapsed, setDmsCollapsed] = useState(false);
  const [invitesCollapsed, setInvitesCollapsed] = useState(false);

  // Context-menu state
  const [contextMenu, setContextMenu] = useState<{
    room: RoomSummary;
    x: number;
    y: number;
  } | null>(null);

  const handleContextMenuRoom = useCallback(
    (room: RoomSummary, x: number, y: number) => {
      setContextMenu({ room, x, y });
    },
    []
  );

  const closeContextMenu = useCallback(() => setContextMenu(null), []);

  // Room-info modal — lives here so it outlives the context menu component
  const [roomInfoTarget, setRoomInfoTarget] = useState<RoomSummary | null>(null);

  const handleShowRoomInfo = useCallback((room: RoomSummary) => {
    setRoomInfoTarget(room);
  }, []);

  // All non-space rooms for the active account
  const allRooms = useMemo<RoomSummary[]>(() => {
    if (!activeAccountId) return [];
    return (roomsByAccount[activeAccountId] ?? []).filter(
      (r) => r.roomType !== "m.space"
    );
  }, [roomsByAccount, activeAccountId]);

  // Filter the room list based on the active space selection
  const scopedRooms = useMemo<RoomSummary[]>(() => {
    if (activeSpaceId === "home") return allRooms;
    if (activeSpaceId === "personal") return allRooms.filter((r) => r.isDirect);
    return allRooms.filter((r) => r.spaceIds.includes(activeSpaceId));
  }, [allRooms, activeSpaceId]);

  // Apply search
  const filtered = useMemo<RoomSummary[]>(() => {
    if (!search.trim()) return scopedRooms;
    const q = search.toLowerCase();
    return scopedRooms.filter((r) => r.name.toLowerCase().includes(q));
  }, [scopedRooms, search]);

  // Split into invites, channels and DMs
  const invites = useMemo(() => filtered.filter((r) => r.membership === "invite"), [filtered]);
  const activeRooms = useMemo(() => filtered.filter((r) => r.membership !== "invite"), [filtered]);
  const channels = useMemo(() => activeRooms.filter((r) => !r.isDirect), [activeRooms]);
  const dms = useMemo(() => activeRooms.filter((r) => r.isDirect), [activeRooms]);

  // Section label
  const sectionLabel = useMemo(() => {
    if (activeSpaceId === "home") return "Home";
    if (activeSpaceId === "personal") return "Personal";
    if (!activeAccountId) return "Rooms";
    return (roomsByAccount[activeAccountId] ?? []).find((r) => r.roomId === activeSpaceId)?.name ?? "Space";
  }, [activeSpaceId, activeAccountId, roomsByAccount]);

  // Stable click handler — won't recreate every render
  const handleRoomClick = useCallback(async (room: RoomSummary) => {
    setActiveRoom(room.roomId);
  }, [setActiveRoom]);

  const showChannels = activeSpaceId !== "personal";

  return (
    <aside className="room-list" aria-label="Room list">
      {/* Header */}
      <div className="room-list-header">
        <div className="room-list-title">
          <span>{sectionLabel}</span>
        </div>
        <div className="room-list-search">
          <Search size={13} className="room-list-search-icon" />
          <input
            type="text"
            placeholder="Search rooms…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label="Search rooms"
          />
        </div>
      </div>

      {/* Room sections */}
      <div className="room-list-items">
        {filtered.length === 0 && (
          <div className="room-list-empty">
            {search ? "No rooms match your search" : "No rooms yet — sync in progress…"}
          </div>
        )}

        {/* Invites section */}
        {invites.length > 0 && (
          <div className="room-section">
            <button
              className="room-section-header"
              onClick={() => setInvitesCollapsed((c) => !c)}
              aria-expanded={!invitesCollapsed}
            >
              <span className="room-section-chevron">{invitesCollapsed ? "▶" : "▼"}</span>
              <span>Invites</span>
              <span className="room-section-count">{invites.length}</span>
            </button>
            {!invitesCollapsed && invites.map((room) => (
              <RoomItem
                key={room.roomId}
                room={room}
                activeRoomId={activeRoomId}
                isLocallyUnread={localUnreadsByRoom[room.roomId] ?? false}
                homeserver={activeAccount?.homeserver}
                onClickRoom={handleRoomClick}
                onContextMenuRoom={handleContextMenuRoom}
              />
            ))}
          </div>
        )}

        {/* Channels section */}
        {showChannels && channels.length > 0 && (
          <div className="room-section">
            <button
              className="room-section-header"
              onClick={() => setChannelsCollapsed((c) => !c)}
              aria-expanded={!channelsCollapsed}
            >
              <span className="room-section-chevron">{channelsCollapsed ? "▶" : "▼"}</span>
              <span>Channels</span>
              <span className="room-section-count">{channels.length}</span>
            </button>
            {!channelsCollapsed && channels.map((room) => (
              <RoomItem
                key={room.roomId}
                room={room}
                activeRoomId={activeRoomId}
                isLocallyUnread={localUnreadsByRoom[room.roomId] ?? false}
                homeserver={activeAccount?.homeserver}
                onClickRoom={handleRoomClick}
                onContextMenuRoom={handleContextMenuRoom}
              />
            ))}
          </div>
        )}

        {/* Direct Messages section */}
        {dms.length > 0 && (
          <div className="room-section">
            <button
              className="room-section-header"
              onClick={() => setDmsCollapsed((c) => !c)}
              aria-expanded={!dmsCollapsed}
            >
              <span className="room-section-chevron">{dmsCollapsed ? "▶" : "▼"}</span>
              <span>Direct Messages</span>
              <span className="room-section-count">{dms.length}</span>
            </button>
            {!dmsCollapsed && dms.map((room) => (
              <RoomItem
                key={room.roomId}
                room={room}
                activeRoomId={activeRoomId}
                isLocallyUnread={localUnreadsByRoom[room.roomId] ?? false}
                homeserver={activeAccount?.homeserver}
                onClickRoom={handleRoomClick}
                onContextMenuRoom={handleContextMenuRoom}
              />
            ))}
          </div>
        )}
      </div>

      <AccountSwitcher />

      {contextMenu && (
        <RoomContextMenu
          room={contextMenu.room}
          x={contextMenu.x}
          y={contextMenu.y}
          onClose={closeContextMenu}
          onShowRoomInfo={handleShowRoomInfo}
        />
      )}

      {roomInfoTarget && (
        <RoomInfoModal
          room={roomInfoTarget}
          onClose={() => setRoomInfoTarget(null)}
        />
      )}
    </aside>
  );
};

export default RoomList;
