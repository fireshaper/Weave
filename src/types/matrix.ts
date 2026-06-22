export interface AccountConfig {
  id: string;           // stable UUID, set by us
  userId: string;       // @user:homeserver.tld
  homeserver: string;   // https://homeserver.tld
  accessToken: string;
  deviceId: string;
  displayName?: string;
  avatarUrl?: string;
}

export interface RoomSummary {
  roomId: string;
  accountId: string;
  name: string;
  avatarUrl?: string;
  topic?: string;
  lastMessage?: string;
  lastMessageTs?: number;
  lastMessageSender?: string;
  unreadCount: number;
  notificationCount: number;
  isDirect: boolean;
  memberCount: number;
  /** "m.space" if this room is a Matrix space, otherwise undefined */
  roomType?: string;
  /** IDs of parent spaces this room belongs to */
  spaceIds: string[];
  /** The user's membership state in this room */
  membership?: string;
}

/** A single message that pinged the user (highlight push action), surfaced in the inbox. */
export interface InboxMention {
  /** The mentioning event's ID — also the dedupe key. */
  id: string;
  accountId: string;
  roomId: string;
  roomName: string;
  roomAvatarUrl?: string;
  sender: string;
  senderName: string;
  senderAvatarUrl?: string;
  body: string;
  ts: number;
  /** True once the room has been read (highlight count cleared). */
  read: boolean;
}

export interface MatrixMessage {
  eventId: string;
  roomId: string;
  sender: string;
  senderDisplayName?: string;
  senderAvatarUrl?: string;
  body: string;
  formattedBody?: string;
  msgtype: string;
  ts: number;
  isEncrypted: boolean;
  isRedacted: boolean;
  isEdited?: boolean;
  replyToEventId?: string;
  reactions: Record<string, number>; // emoji -> total count
  myReactions: Record<string, string>; // emoji -> redaction eventId (events I sent)
  url?: string; // for images/files (unencrypted)
  /** Present for encrypted attachments (E2EE rooms). Contains key, iv, hashes, and the mxc URL. */
  encryptedFile?: {
    url: string; // mxc:// URL of the encrypted blob
    key: {
      kty: string;
      key_ops: string[];
      alg: string;
      k: string; // base64url-encoded AES-CTR key
      ext: boolean;
    };
    iv: string;     // base64-encoded IV (16 bytes, last 8 must be 0)
    hashes: Record<string, string>; // e.g. { sha256: "..." }
    v: string;      // must be "v2"
  };
  filename?: string;
  info?: {
    mimetype?: string;
    size?: number;
    w?: number;
    h?: number;
    duration?: number; // for audio/video, in ms
  };
}

export interface TypingState {
  roomId: string;
  typingUserIds: string[];
}

export type SyncState = "INITIAL_SYNC" | "SYNCING" | "PREPARED" | "STOPPED" | "ERROR" | "RECONNECTING";
