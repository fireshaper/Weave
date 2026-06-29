import React, { useCallback } from "react";
import {
  User,
  MessageSquarePlus,
  AtSign,
  Copy,
} from "lucide-react";
import ContextMenu, { type ContextMenuItem } from "./ContextMenu";
import { accountManager } from "../accounts/AccountManager";
import { useAccountsStore } from "../store/accountsStore";
import { useTimelineStore } from "../store/timelineStore";

export interface UserTarget {
  userId: string;
  displayName: string;
  avatarUrl?: string;
  /** The room context this right-click came from (for power level + shared rooms) */
  roomId?: string;
}

interface UserContextMenuProps {
  user: UserTarget;
  x: number;
  y: number;
  onClose: () => void;
  /** Called when "Mention" is selected — passes the display name and userId */
  onMention?: (mention: string, userId?: string) => void;
  /** Called when "View Profile" is selected — parent mounts the modal so it outlives this component */
  onShowProfile?: (user: UserTarget) => void;
}

const UserContextMenu: React.FC<UserContextMenuProps> = ({
  user,
  x,
  y,
  onClose,
  onMention,
  onShowProfile,
}) => {
  const activeAccountId = useAccountsStore((s) => s.activeAccountId);
  const setActiveRoom = useTimelineStore((s) => s.setActiveRoom);

  const client = activeAccountId ? accountManager.getClient(activeAccountId) : undefined;
  const myUserId = client?.getUserId() ?? "";
  const isSelf = user.userId === myUserId;

  const handleViewProfile = useCallback(() => {
    onShowProfile?.(user);
  }, [onShowProfile, user]);

  const handleOpenDm = useCallback(async () => {
    if (!client || !activeAccountId) return;
    onClose();
    try {
      const dmMap = client.getAccountData("m.direct" as any)?.getContent() ?? {};
      const existingRooms: string[] = (dmMap as any)[user.userId] ?? [];
      if (existingRooms.length > 0) {
        setActiveRoom(existingRooms[existingRooms.length - 1]);
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
      await accountManager.addDirectMessage(activeAccountId, user.userId, result.room_id);
      setActiveRoom(result.room_id);
    } catch (e) {
      console.warn("[UserContextMenu] Could not open DM:", e);
    }
  }, [client, activeAccountId, user.userId, setActiveRoom, onClose]);

  const handleMention = useCallback(() => {
    onMention?.(user.displayName, user.userId);
    onClose();
  }, [user.displayName, user.userId, onMention, onClose]);

  const handleCopyUserId = useCallback(() => {
    navigator.clipboard.writeText(user.userId).catch(() => {});
    onClose();
  }, [user.userId, onClose]);

  const handleCopyDisplayName = useCallback(() => {
    navigator.clipboard.writeText(user.displayName).catch(() => {});
    onClose();
  }, [user.displayName, onClose]);

  const items: ContextMenuItem[] = [
    {
      id: "view-profile",
      label: isSelf ? "View My Profile" : "View Profile",
      icon: <User size={14} />,
      onClick: handleViewProfile,
    },
    ...(!isSelf
      ? [
          {
            id: "open-dm",
            label: "Message",
            icon: <MessageSquarePlus size={14} />,
            onClick: handleOpenDm,
          },
          ...(onMention
            ? [
                {
                  id: "mention",
                  label: "Mention",
                  icon: <AtSign size={14} />,
                  onClick: handleMention,
                  divider: true,
                } as ContextMenuItem,
              ]
            : []),
        ]
      : []),
    {
      id: "copy-display-name",
      label: "Copy Display Name",
      icon: <Copy size={14} />,
      onClick: handleCopyDisplayName,
      divider: !isSelf && !onMention,
    },
    {
      id: "copy-user-id",
      label: "Copy User ID",
      icon: <Copy size={14} />,
      onClick: handleCopyUserId,
    },
  ];

  return <ContextMenu x={x} y={y} items={items} onClose={onClose} />;
};

export default UserContextMenu;
