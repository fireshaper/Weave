import React, { useEffect, useMemo, useState } from "react";
import {
  CheckCheck,
  BellOff,
  Bell,
  Copy,
  LogOut,
  Star,
  StarOff,
  Hash,
  MessageSquare,
} from "lucide-react";
import ContextMenu, { type ContextMenuItem } from "./ContextMenu";
import { accountManager } from "../accounts/AccountManager";
import { useAccountsStore } from "../store/accountsStore";
import { useRoomsStore } from "../store/roomsStore";
import { useTimelineStore } from "../store/timelineStore";
import type { RoomSummary } from "../types/matrix";
import { PushRuleKind } from "matrix-js-sdk";

interface RoomContextMenuProps {
  room: RoomSummary;
  x: number;
  y: number;
  onClose: () => void;
  /** Called when the user selects "Room Info" — the parent mounts the modal so it outlives this component */
  onShowRoomInfo?: (room: RoomSummary) => void;
}

const RoomContextMenu: React.FC<RoomContextMenuProps> = ({ room, x, y, onClose, onShowRoomInfo }) => {
  const activeAccountId = useAccountsStore((s) => s.activeAccountId);

  const client = activeAccountId ? accountManager.getClient(activeAccountId) : undefined;
  const matrixRoom = client?.getRoom(room.roomId);
  const myUserId = client?.getUserId() ?? "";

  // getPushRules() can be async in some SDK versions — resolve via useEffect
  const [isMuted, setIsMuted] = useState(false);
  useEffect(() => {
    if (!client || !room.roomId) return;
    const check = async () => {
      try {
        const rulesResult = client.getPushRules();
        const pushRules = rulesResult instanceof Promise ? await rulesResult : rulesResult;
        const overrides: any[] = (pushRules?.global as any)?.[PushRuleKind.Override] ?? [];
        const muted = overrides.some(
          (r: any) =>
            r.rule_id === room.roomId &&
            r.enabled &&
            r.actions?.includes("dont_notify")
        );
        setIsMuted(muted);
      } catch {
        setIsMuted(false);
      }
    };
    check();
  }, [client, room.roomId]);

  const isFavorited = useMemo(() => {
    if (!matrixRoom) return false;
    try {
      return "m.favourite" in (matrixRoom.tags ?? {});
    } catch {
      return false;
    }
  }, [matrixRoom]);

  const isOwnedByMe = useMemo(() => {
    if (!matrixRoom || !myUserId) return false;
    try {
      const createEvent = matrixRoom.currentState?.getStateEvents("m.room.create", "");
      return createEvent?.getSender() === myUserId;
    } catch {
      return false;
    }
  }, [matrixRoom, myUserId]);

  // ── Actions ────────────────────────────────────────────────────────────────

  const handleMarkAsRead = async () => {
    if (!client || !matrixRoom) return;
    try {
      const lastEvent = matrixRoom.getLiveTimeline()?.getEvents()?.slice(-1)[0];
      if (lastEvent) {
        await client.sendReadReceipt(lastEvent);
      }
      // Optimistically clear the badge in the store
      const summary = accountManager.buildRoomSummary(matrixRoom, room.accountId);
      useRoomsStore.getState().updateRoom(room.accountId, {
        ...summary,
        unreadCount: 0,
        notificationCount: 0,
      });
    } catch (e) {
      console.warn("[RoomContextMenu] Could not mark as read:", e);
    }
  };

  const handleToggleMute = async () => {
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
      console.warn("[RoomContextMenu] Could not toggle mute:", e);
    }
  };

  const handleToggleFavorite = async () => {
    if (!client || !matrixRoom) return;
    try {
      if (isFavorited) {
        await client.deleteRoomTag(room.roomId, "m.favourite");
      } else {
        await client.setRoomTag(room.roomId, "m.favourite", { order: 0.5 });
      }
    } catch (e) {
      console.warn("[RoomContextMenu] Could not toggle favorite:", e);
    }
  };

  const handleCopyRoomId = () => {
    navigator.clipboard.writeText(room.roomId).catch(() => {
      // Fallback for environments that block the clipboard API
      const ta = document.createElement("textarea");
      ta.value = room.roomId;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
    });
  };

  const handleCopyRoomLink = () => {
    const encoded = encodeURIComponent(room.roomId);
    const link = `https://matrix.to/#/${encoded}`;
    navigator.clipboard.writeText(link).catch(() => {});
  };

  const handleLeaveRoom = async () => {
    if (!client) return;
    const confirmed = window.confirm(
      `Are you sure you want to leave "${room.name}"?`
    );
    if (!confirmed) return;
    try {
      await client.leave(room.roomId);
      const tl = useTimelineStore.getState();
      if (tl.activeRoomId === room.roomId) {
        tl.setActiveRoom(null);
      }
    } catch (e) {
      console.warn("[RoomContextMenu] Could not leave room:", e);
    }
  };

  // ── Menu items ─────────────────────────────────────────────────────────────

  const items: ContextMenuItem[] = [
    {
      id: "room-info",
      label: room.isDirect ? "View Profile" : "Room Info",
      icon: room.isDirect ? <MessageSquare size={14} /> : <Hash size={14} />,
      onClick: () => {
        onShowRoomInfo?.(room);
      },
    },
    {
      id: "mark-read",
      label: "Mark as Read",
      icon: <CheckCheck size={14} />,
      onClick: handleMarkAsRead,
      disabled: room.unreadCount === 0 && room.notificationCount === 0,
    },
    {
      id: "favorite",
      label: isFavorited ? "Remove from Favourites" : "Add to Favourites",
      icon: isFavorited ? <StarOff size={14} /> : <Star size={14} />,
      onClick: handleToggleFavorite,
      divider: true,
    },
    {
      id: "mute",
      label: isMuted ? "Unmute Room" : "Mute Room",
      icon: isMuted ? <Bell size={14} /> : <BellOff size={14} />,
      onClick: handleToggleMute,
    },
    {
      id: "copy-room-id",
      label: "Copy Room ID",
      icon: <Copy size={14} />,
      onClick: handleCopyRoomId,
      divider: true,
    },
    {
      id: "copy-room-link",
      label: "Copy matrix.to Link",
      icon: <Copy size={14} />,
      onClick: handleCopyRoomLink,
    },
    {
      id: "leave",
      label: isOwnedByMe ? "Leave Room (creator)" : "Leave Room",
      icon: <LogOut size={14} />,
      onClick: handleLeaveRoom,
      danger: true,
      divider: true,
    },
  ];

  return (
    <>
      <ContextMenu x={x} y={y} items={items} onClose={onClose} />
    </>
  );
};

export default RoomContextMenu;
