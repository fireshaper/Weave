import React from "react";
import { X, Crown, UserCheck } from "lucide-react";
import { useAccountsStore } from "../store/accountsStore";
import { accountManager } from "../accounts/AccountManager";
import Avatar from "./Avatar";
import "./MemberList.css";

interface MemberListProps {
  roomId: string;
  onClose: () => void;
  onContextMenuUser?: (userId: string, displayName: string, avatarUrl: string | undefined, x: number, y: number) => void;
}

interface MemberInfo {
  userId: string;
  displayName: string;
  avatarUrl?: string;
  powerLevel: number;
  membership: string;
}

const MemberList: React.FC<MemberListProps> = ({ roomId, onClose, onContextMenuUser }) => {
  const activeAccountId = useAccountsStore((s) => s.activeAccountId);
  const accounts = useAccountsStore((s) => s.accounts);

  const client = activeAccountId ? accountManager.getClient(activeAccountId) : undefined;
  const room = client?.getRoom(roomId);
  const activeAccount = accounts.find((a) => a.id === activeAccountId);

  const members: MemberInfo[] = React.useMemo(() => {
    if (!room) return [];
    return room
      .getMembers()
      .filter((m) => m.membership === "join")
      .map((m) => ({
        userId: m.userId,
        displayName: m.name ?? m.userId,
        avatarUrl: m.getMxcAvatarUrl() ?? undefined,
        powerLevel: m.powerLevel ?? 0,
        membership: m.membership ?? "join",
      }))
      .sort((a, b) => {
        if (b.powerLevel !== a.powerLevel) return b.powerLevel - a.powerLevel;
        return a.displayName.localeCompare(b.displayName);
      });
  }, [room]);

  const admins = members.filter((m) => m.powerLevel >= 100);
  const mods   = members.filter((m) => m.powerLevel >= 50 && m.powerLevel < 100);
  const users  = members.filter((m) => m.powerLevel < 50);

  const renderGroup = (title: string, list: MemberInfo[], icon?: React.ReactNode) => {
    if (list.length === 0) return null;
    return (
      <div className="member-group">
        <div className="member-group-header">
          {icon}
          <span>{title}</span>
          <span className="member-group-count">{list.length}</span>
        </div>
        {list.map((member) => (
          <div
            key={member.userId}
            className="member-row"
            title={member.userId}
            onContextMenu={onContextMenuUser ? (e) => {
              e.preventDefault();
              e.stopPropagation();
              onContextMenuUser(member.userId, member.displayName, member.avatarUrl, e.clientX, e.clientY);
            } : undefined}
            style={onContextMenuUser ? { cursor: "context-menu" } : undefined}
          >
            <Avatar
              name={member.displayName}
              avatarUrl={member.avatarUrl}
              homeserver={activeAccount?.homeserver}
              size={28}
            />
            <span className="member-name truncate">{member.displayName}</span>
            {member.powerLevel >= 100 && <Crown size={11} className="member-badge member-badge--admin" />}
            {member.powerLevel >= 50 && member.powerLevel < 100 && (
              <UserCheck size={11} className="member-badge member-badge--mod" />
            )}
          </div>
        ))}
      </div>
    );
  };

  return (
    <aside className="member-list">
      <div className="member-list-header">
        <span>Members — {members.length}</span>
        <button className="member-list-close" onClick={onClose} aria-label="Close member list">
          <X size={15} />
        </button>
      </div>
      <div className="member-list-body">
        {members.length === 0 && (
          <p className="member-list-empty">No members loaded yet</p>
        )}
        {renderGroup("Admins", admins, <Crown size={12} />)}
        {renderGroup("Moderators", mods, <UserCheck size={12} />)}
        {renderGroup("Members", users)}
      </div>
    </aside>
  );
};

export default MemberList;
