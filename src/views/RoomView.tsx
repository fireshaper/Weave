import React, { useEffect, useRef, useState, useCallback } from "react";
import { Hash, Users, Info, Send, Paperclip, Smile, Loader2, ChevronDown, X } from "lucide-react";
import { MsgType, EventTimeline, RoomEvent } from "matrix-js-sdk";
import { useTimelineStore } from "../store/timelineStore";
import { useAccountsStore } from "../store/accountsStore";
import { useRoomsStore } from "../store/roomsStore";
import { accountManager } from "../accounts/AccountManager";
import MessageBubble from "../components/MessageBubble";
import type { ReadReceiptUser } from "../components/MessageBubble";
import EmojiPicker from "../components/EmojiPicker";
import DateSeparator from "../components/DateSeparator";
import TypingIndicator from "../components/TypingIndicator";
import MemberList from "../components/MemberList";
import UserContextMenu from "../components/UserContextMenu";
import type { UserTarget } from "../components/UserContextMenu";
import RoomInfoModal from "../components/RoomInfoModal";
import UserProfileModal from "../components/UserProfileModal";
import { getUserColor } from "../utils/userColor";
import { buildMessageFromEvent } from "../utils/buildMessage";
import "./RoomView.css";

interface RoomViewProps {
  roomId: string;
}

function isSameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate();
}

const RoomView: React.FC<RoomViewProps> = ({ roomId }) => {
  const messages = useTimelineStore((s) => s.messages[roomId]) ?? [];
  const typingUsers = useTimelineStore((s) => s.typingByRoom[roomId]) ?? [];
  const prependMessages = useTimelineStore((s) => s.prependMessages);
  const jumpTarget = useTimelineStore((s) => s.jumpTarget);
  const clearJump = useTimelineStore((s) => s.clearJump);
  const requestJump = useTimelineStore((s) => s.requestJump);
  const activeAccountId = useAccountsStore((s) => s.activeAccountId);
  const roomsByAccount = useRoomsStore((s) => s.roomsByAccount);

  // Fast eventId → message lookup for resolving reply targets
  const messageIndex = React.useMemo(
    () => new Map(messages.map((m) => [m.eventId, m])),
    [messages]
  );

  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [showComposerEmoji, setShowComposerEmoji] = useState(false);
  const [showMembers, setShowMembers] = useState(false);
  const [showRoomInfo, setShowRoomInfo] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [canLoadMore, setCanLoadMore] = useState(true);
  const [atBottom, setAtBottom] = useState(true);
  const [unseenCount, setUnseenCount] = useState(0);
  const [replyTo, setReplyTo] = useState<import("../types/matrix").MatrixMessage | null>(null);

  // User context-menu state
  const [userContextMenu, setUserContextMenu] = useState<{
    user: UserTarget;
    x: number;
    y: number;
  } | null>(null);

  // User profile modal — lives here so it outlives the context menu
  const [profileTarget, setProfileTarget] = useState<UserTarget | null>(null);

  const handleShowProfile = useCallback((user: UserTarget) => {
    setProfileTarget(user);
  }, []);

  // Clicking a reply quote jumps back to the message it replied to.
  const handleJumpToEvent = useCallback(
    (eventId: string) => {
      requestJump(roomId, eventId);
    },
    [requestJump, roomId]
  );

  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const timelineRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const prevScrollHeight = useRef<number>(0);
  // Tracks which roomId we've already done the initial scroll-to-bottom for,
  // so we can always scroll on first render after a room switch even when
  // messages.length happens to be identical between rooms.
  const scrolledForRoom = useRef<string | null>(null);

  const handleContextMenuUser = useCallback(
    (userId: string, displayName: string, avatarUrl: string | undefined, x: number, y: number) => {
      setUserContextMenu({ user: { userId, displayName, avatarUrl, roomId }, x, y });
    },
    [roomId]
  );

  const handleMention = useCallback(
    (mention: string) => {
      // Insert "@DisplayName" at cursor or append to current input
      const ta = textareaRef.current;
      if (ta) {
        const start = ta.selectionStart ?? input.length;
        const end   = ta.selectionEnd   ?? input.length;
        const prefix = input.slice(0, start);
        const suffix = input.slice(end);
        const spaceBefore = prefix.length > 0 && !prefix.endsWith(" ") ? " " : "";
        const newValue = `${prefix}${spaceBefore}@${mention} ${suffix}`;
        setInput(newValue);
        // Re-focus and move caret after the mention
        requestAnimationFrame(() => {
          ta.focus();
          const pos = (prefix + spaceBefore + `@${mention} `).length;
          ta.setSelectionRange(pos, pos);
        });
      } else {
        setInput((v) => `${v}@${mention} `);
      }
    },
    [input]
  );

  const insertEmoji = useCallback(
    (emoji: string) => {
      const ta = textareaRef.current;
      if (ta) {
        const start = ta.selectionStart ?? input.length;
        const end = ta.selectionEnd ?? input.length;
        const newValue = input.slice(0, start) + emoji + input.slice(end);
        setInput(newValue);
        requestAnimationFrame(() => {
          ta.focus();
          const pos = start + emoji.length;
          ta.setSelectionRange(pos, pos);
        });
      } else {
        setInput((v) => v + emoji);
      }
    },
    [input]
  );

  // Receipt tick — bump this to force re-computation of the receipt map
  const [receiptTick, setReceiptTick] = useState(0);

  // Find room info from store
  const room = Object.values(roomsByAccount).flat().find((r) => r.roomId === roomId);

  // Subscribe to receipt events so the receipt map stays live
  useEffect(() => {
    if (!activeAccountId) return;
    const client = accountManager.getClient(activeAccountId);
    if (!client) return;
    const onReceipt = () => setReceiptTick((t) => t + 1);
    client.on(RoomEvent.Receipt, onReceipt);
    return () => { client.off(RoomEvent.Receipt, onReceipt); };
  }, [activeAccountId, roomId]);

  // Build a map: eventId → list of users whose read pointer is at this event.
  // We exclude the local user and only look at users other than ourselves.
  const readReceiptMap = React.useMemo((): Map<string, ReadReceiptUser[]> => {
    const map = new Map<string, ReadReceiptUser[]>();
    if (!activeAccountId) return map;
    const client = accountManager.getClient(activeAccountId);
    if (!client) return map;
    const matrixRoomObj = client.getRoom(roomId);
    if (!matrixRoomObj) return map;
    const myUserId = client.getUserId() ?? "";

    // getUsersReadUpTo returns all user IDs whose m.read receipt points at this event.
    // Private receipts (m.read.private) are excluded automatically by this API.
    for (const msg of messages) {
      const sdkEvent = matrixRoomObj.findEventById(msg.eventId);
      if (!sdkEvent) continue;
      const userIds = matrixRoomObj.getUsersReadUpTo(sdkEvent);
      const users: ReadReceiptUser[] = userIds
        .filter((uid) => uid !== myUserId)
        .map((uid) => {
          const member = matrixRoomObj.getMember(uid);
          return {
            userId: uid,
            displayName: member?.name ?? uid,
            avatarUrl: member?.getMxcAvatarUrl() ?? undefined,
          };
        });
      if (users.length > 0) map.set(msg.eventId, users);
    }
    return map;
  // receiptTick is intentionally included so the map recalculates on every receipt event
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages, activeAccountId, roomId, receiptTick]);

  // Reset scroll state whenever the room changes so we always land at the bottom
  const isNearBottom = useRef(true);
  const prevMessageCount = useRef(0);
  useEffect(() => {
    isNearBottom.current = true;
    setAtBottom(true);
    setUnseenCount(0);
    prevMessageCount.current = 0;
    setCanLoadMore(true);
    setLoadingMore(false);
    scrolledForRoom.current = null; // auto-scroll effect will scroll once messages are rendered
  }, [roomId]);

  // Auto-scroll to bottom when new messages arrive, or count them as unseen.
  // roomId is a dep so this fires even when message count happens to be identical
  // between the old and new room, ensuring we always reach the bottom after a switch.
  useEffect(() => {
    const newCount = messages.length;
    const delta = newCount - prevMessageCount.current;
    prevMessageCount.current = newCount;

    if (scrolledForRoom.current !== roomId) {
      // First render after a room switch — scroll to bottom once messages exist.
      // If the store is empty we wait for the hydration effect to populate it.
      if (newCount > 0) {
        scrolledForRoom.current = roomId;
        bottomRef.current?.scrollIntoView({ behavior: "instant" });
        setUnseenCount(0);
      }
      return;
    }

    if (isNearBottom.current) {
      bottomRef.current?.scrollIntoView({ behavior: "smooth" });
      setUnseenCount(0);
    } else if (delta > 0 && !loadingMore) {
      // New messages arrived while scrolled up — count them
      setUnseenCount((c) => c + delta);
    }
  }, [messages.length, roomId]);

  // Hydrate initial messages if store is empty
  useEffect(() => {
    if (messages.length === 0 && activeAccountId && roomId) {
      const client = accountManager.getClient(activeAccountId);
      if (client) {
        const matrixRoom = client.getRoom(roomId);
        if (matrixRoom) {
          const allEvents = matrixRoom.getLiveTimeline()?.getEvents() ?? [];
          const msgs = allEvents
            .filter((e) => {
              if (e.getType() !== "m.room.message" && e.getType() !== "m.room.encrypted") return false;
              // Skip edit events — they are applied to the original message, not shown standalone
              const relatesTo = e.getWireContent()["m.relates_to"] as any;
              if (relatesTo?.rel_type === "m.replace") return false;
              return true;
            })
            .map((e) => buildMessageFromEvent(e, matrixRoom, client));
          if (msgs.length > 0) {
            prependMessages(roomId, msgs);
          }
        }
      }
    }
  }, [roomId, activeAccountId]);

  // Restore scroll position after prepending older messages
  useEffect(() => {
    if (!loadingMore && timelineRef.current && prevScrollHeight.current > 0) {
      const newScrollHeight = timelineRef.current.scrollHeight;
      timelineRef.current.scrollTop = newScrollHeight - prevScrollHeight.current;
      prevScrollHeight.current = 0;
    }
  }, [loadingMore, messages.length]);

  // Send a read receipt for the latest message — but only while the window is
  // focused. Messages that arrive while the app is backgrounded, minimized, or
  // hidden to the tray must not be silently marked read; otherwise the user
  // loses unread tracking for messages they never actually saw.
  const markRoomRead = useCallback(() => {
    if (!activeAccountId || !roomId || messages.length === 0) return;
    if (!document.hasFocus()) return;
    const client = accountManager.getClient(activeAccountId);
    if (!client) return;
    const matrixRoom = client.getRoom(roomId);
    if (!matrixRoom) return;

    const latestEventId = messages[messages.length - 1].eventId;
    const event = matrixRoom.getLiveTimeline()?.getEvents()?.find((e) => e.getId() === latestEventId);
    if (event) {
      client.sendReadReceipt(event).catch((err) => {
        console.warn("Failed to send read receipt", err);
      });
    }
  }, [messages, activeAccountId, roomId]);

  // Mark read when new messages arrive in the open room (no-op if unfocused).
  useEffect(() => {
    markRoomRead();
  }, [markRoomRead]);

  // Mark read when the window regains focus, so receipts catch up to the latest
  // message once the user returns from another app or the tray.
  useEffect(() => {
    window.addEventListener("focus", markRoomRead);
    return () => window.removeEventListener("focus", markRoomRead);
  }, [markRoomRead]);

  // Auto-resize textarea
  useEffect(() => {
    const ta = textareaRef.current;
    if (ta) {
      ta.style.height = "auto";
      ta.style.height = `${Math.min(ta.scrollHeight, 140)}px`;
    }
  }, [input]);

  // Focus the composer whenever a reply is set
  useEffect(() => {
    if (replyTo) {
      textareaRef.current?.focus();
    }
  }, [replyTo]);

  const loadOlderMessages = useCallback(async () => {
    if (loadingMore || !canLoadMore) return;
    const client = activeAccountId ? accountManager.getClient(activeAccountId) : undefined;
    if (!client) return;
    const matrixRoom = client.getRoom(roomId);
    if (!matrixRoom) return;

    setLoadingMore(true);
    if (timelineRef.current) {
      prevScrollHeight.current = timelineRef.current.scrollHeight;
    }

    try {
      const result = await client.scrollback(matrixRoom, 30);
      if (result === matrixRoom) {
        // Get the events that were prepended
        const allEvents = matrixRoom.getLiveTimeline()?.getEvents() ?? [];
        const msgs = allEvents
          .filter((e) => {
            if (e.getType() !== "m.room.message" && e.getType() !== "m.room.encrypted") return false;
            const relatesTo = e.getWireContent()["m.relates_to"] as any;
            if (relatesTo?.rel_type === "m.replace") return false;
            return true;
          })
          .map((e) => buildMessageFromEvent(e, matrixRoom, client));
        prependMessages(roomId, msgs);
      }
      // If no more events, disable pagination
      const tl = matrixRoom.getLiveTimeline();
      if (!tl || !tl.getPaginationToken(EventTimeline.BACKWARDS)) {
        setCanLoadMore(false);
      }
    } catch {
      // non-fatal
    } finally {
      setLoadingMore(false);
    }
  }, [loadingMore, canLoadMore, activeAccountId, roomId, prependMessages]);

  // Track scroll position to detect near-bottom and trigger load-more
  const handleScroll = useCallback(async () => {
    const el = timelineRef.current;
    if (!el) return;

    // Near bottom?
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 100;
    isNearBottom.current = nearBottom;
    if (nearBottom !== atBottom) {
      setAtBottom(nearBottom);
      if (nearBottom) setUnseenCount(0);
    }

    // Near top → load older messages
    if (el.scrollTop < 80 && !loadingMore && canLoadMore) {
      loadOlderMessages();
    }
  }, [loadingMore, canLoadMore, atBottom, loadOlderMessages]);

  const scrollToBottom = useCallback(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    setUnseenCount(0);
    setAtBottom(true);
    isNearBottom.current = true;
  }, []);

  // Scroll to a rendered message and flash it. Returns false if not in the DOM.
  const flashEvent = useCallback((eventId: string): boolean => {
    const el = timelineRef.current?.querySelector<HTMLElement>(
      `[data-event-id="${eventId}"]`
    );
    if (!el) return false;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    el.classList.remove("msg-bubble--flash");
    // Force reflow so the animation restarts if the class is re-added quickly.
    void el.offsetWidth;
    el.classList.add("msg-bubble--flash");
    window.setTimeout(() => el.classList.remove("msg-bubble--flash"), 1600);
    return true;
  }, []);

  // Drive a jump to `targetId`, paginating backwards until the event is loaded.
  const performJump = useCallback(
    async (targetId: string) => {
      // Take manual control of scrolling: suppress the auto-scroll-to-bottom and
      // initial-scroll behaviour so they don't fight the jump.
      scrolledForRoom.current = roomId;
      isNearBottom.current = false;
      setAtBottom(false);

      // Already rendered? Flash immediately.
      if (flashEvent(targetId)) return;

      const client = activeAccountId ? accountManager.getClient(activeAccountId) : undefined;
      const matrixRoom = client?.getRoom(roomId);
      if (!client || !matrixRoom) return;

      const isDisplayable = (e: import("matrix-js-sdk").MatrixEvent) => {
        if (e.getType() !== "m.room.message" && e.getType() !== "m.room.encrypted") return false;
        const relatesTo = e.getWireContent()["m.relates_to"] as any;
        return relatesTo?.rel_type !== "m.replace";
      };

      // Load older pages until the target is in our store or history runs out.
      for (let i = 0; i < 20; i++) {
        const present = useTimelineStore.getState().messages[roomId]?.some(
          (m) => m.eventId === targetId
        );
        if (present) {
          // Wait a frame for the row to render, then scroll to it.
          await new Promise((r) => requestAnimationFrame(() => r(null)));
          if (flashEvent(targetId)) return;
        }

        const tl = matrixRoom.getLiveTimeline();
        if (!tl?.getPaginationToken(EventTimeline.BACKWARDS)) break; // no more history

        await client.scrollback(matrixRoom, 50);
        const allEvents = matrixRoom.getLiveTimeline()?.getEvents() ?? [];
        const msgs = allEvents.filter(isDisplayable).map((e) => buildMessageFromEvent(e, matrixRoom, client));
        prependMessages(roomId, msgs);
      }

      // Final attempt after the last page renders.
      await new Promise((r) => requestAnimationFrame(() => r(null)));
      flashEvent(targetId);
    },
    [activeAccountId, roomId, flashEvent, prependMessages]
  );

  // React to jump requests targeting this room.
  useEffect(() => {
    if (!jumpTarget || jumpTarget.roomId !== roomId) return;
    let cancelled = false;
    const targetId = jumpTarget.eventId;
    (async () => {
      await performJump(targetId);
      if (!cancelled) clearJump();
    })();
    return () => { cancelled = true; };
  }, [jumpTarget, roomId, performJump, clearJump]);

  const sendMessage = useCallback(async () => {
    const body = input.trim();
    if (!body || !activeAccountId || sending) return;
    const client = accountManager.getClient(activeAccountId);
    if (!client) return;
    setSending(true);
    const currentReply = replyTo;
    setInput("");
    setReplyTo(null);
    try {
      const content: Record<string, unknown> = { msgtype: MsgType.Text, body };
      if (currentReply) {
        content["m.relates_to"] = {
          "m.in_reply_to": { event_id: currentReply.eventId },
        };
      }
      await client.sendMessage(roomId, content as any);
    } catch (err) {
      console.error("[RoomView] send failed:", err);
      setInput(body);
      setReplyTo(currentReply);
    } finally {
      setSending(false);
    }
  }, [input, activeAccountId, roomId, sending, replyTo]);

  const handleReact = useCallback(async (message: import("../types/matrix").MatrixMessage, emoji: string) => {
    if (!activeAccountId) return;
    const client = accountManager.getClient(activeAccountId);
    if (!client) return;

    // If we already reacted with this emoji, redact (toggle off)
    const existingEventId = message.myReactions?.[emoji];
    if (existingEventId) {
      try {
        await client.redactEvent(message.roomId, existingEventId);
      } catch (err) {
        console.error("[RoomView] redact reaction failed:", err);
      }
      return;
    }

    // Send new reaction
    try {
      await client.sendEvent(message.roomId, "m.reaction" as any, {
        "m.relates_to": {
          rel_type: "m.annotation",
          event_id: message.eventId,
          key: emoji,
        },
      });
    } catch (err) {
      console.error("[RoomView] send reaction failed:", err);
    }
  }, [activeAccountId]);

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !activeAccountId || sending) return;

    const client = accountManager.getClient(activeAccountId);
    if (!client) return;

    setSending(true);
    try {
      const response = await client.uploadContent(file, { name: file.name });
      const url = response.content_uri; // mxc://...
      const msgtype = file.type.startsWith("image/")
        ? MsgType.Image
        : file.type.startsWith("video/")
          ? MsgType.Video
          : file.type.startsWith("audio/")
            ? MsgType.Audio
            : MsgType.File;

      await client.sendMessage(roomId, {
        msgtype,
        body: file.name,
        url,
        info: {
          size: file.size,
          mimetype: file.type,
        },
      } as any);
    } catch (err) {
      console.error("[RoomView] file upload failed:", err);
    } finally {
      setSending(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const client = activeAccountId ? accountManager.getClient(activeAccountId) : undefined;
  const matrixRoom = client?.getRoom(roomId);
  const typingDisplayNames = typingUsers.map((uid) => {
    const member = matrixRoom?.getMember(uid);
    return member?.name ?? uid;
  });
  const activeAccount = useAccountsStore.getState().accounts.find(
    (a) => a.id === activeAccountId
  );

  return (
    <div className={`room-view-wrapper ${showMembers ? "room-view-wrapper--with-members" : ""}`}>
      <div className="room-view">
        {/* Header */}
        <header className="room-view-header">
          <div className="room-view-header-left">
            <Hash size={18} className="room-view-icon" />
            <div>
              <span className="room-view-name">{room?.name ?? roomId}</span>
              {room?.topic && <span className="room-view-topic">{room.topic}</span>}
            </div>
          </div>
          <div className="room-view-header-right">
            <button
              className={`room-view-header-btn ${showMembers ? "room-view-header-btn--active" : ""}`}
              title={showMembers ? "Hide members" : "Show members"}
              onClick={() => setShowMembers((v) => !v)}
            >
              <Users size={16} />
            </button>
            <button
              className={`room-view-header-btn ${showRoomInfo ? "room-view-header-btn--active" : ""}`}
              title="Room Info"
              onClick={() => setShowRoomInfo((v) => !v)}
            >
              <Info size={16} />
            </button>
          </div>
        </header>

        {room?.membership === "invite" ? (
          <div className="room-view-invite">
            <div className="room-view-invite-card">
              <div className="room-view-invite-icon">
                <Users size={48} />
              </div>
              <h2>You've been invited</h2>
              <p>Would you like to join <strong>{room?.name ?? roomId}</strong>?</p>
              <div className="room-view-invite-actions">
                <button 
                  className="btn-decline" 
                  onClick={() => activeAccountId && accountManager.declineInvite(activeAccountId, roomId)}
                >
                  Decline
                </button>
                <button 
                  className="btn-accept" 
                  onClick={() => activeAccountId && accountManager.acceptInvite(activeAccountId, roomId)}
                >
                  Accept
                </button>
              </div>
            </div>
          </div>
        ) : (
          <>
            {/* Timeline */}
            <div className="room-view-timeline" ref={timelineRef} onScroll={handleScroll}>
          {loadingMore && (
            <div className="room-view-load-more">
              <Loader2 size={16} className="room-view-spinner" />
              <span>Loading older messages…</span>
            </div>
          )}
          {!loadingMore && canLoadMore && messages.length > 0 && (
            <div className="room-view-load-more">
              <button onClick={loadOlderMessages} className="room-view-load-more-btn">
                Load older messages
              </button>
            </div>
          )}
          {!canLoadMore && messages.length > 0 && (
            <div className="room-view-beginning">
              Beginning of <strong>{room?.name ?? roomId}</strong>
            </div>
          )}
          {messages.length === 0 && (
            <div className="room-view-empty">
              <Hash size={40} style={{ opacity: 0.2, marginBottom: 12 }} />
              <p>This is the beginning of <strong>{room?.name ?? roomId}</strong></p>
            </div>
          )}
          {messages.map((msg, i) => {
            const prev = messages[i - 1];
            const isGrouped =
              prev &&
              prev.sender === msg.sender &&
              msg.ts - prev.ts < 5 * 60 * 1000;
            const showDate = !prev || !isSameDay(new Date(prev.ts), new Date(msg.ts));

            // Resolve the replied-to message for inline quote display.
            // Check local index first; fall back to the SDK room event store for
            // older messages that haven't been loaded into the timeline yet.
            let replyMessage: { sender: string; senderDisplayName?: string; body: string; isEncrypted?: boolean } | undefined;
            if (msg.replyToEventId) {
              const local = messageIndex.get(msg.replyToEventId);
              if (local) {
                replyMessage = {
                  sender: local.sender,
                  senderDisplayName: local.senderDisplayName,
                  body: local.body,
                  isEncrypted: local.isEncrypted && !local.body,
                };
              } else if (matrixRoom) {
                const sdkEvent = matrixRoom.findEventById(msg.replyToEventId);
                if (sdkEvent && !sdkEvent.isDecryptionFailure?.()) {
                  const content = sdkEvent.getContent();
                  const sender = sdkEvent.getSender() ?? "";
                  const member = matrixRoom.getMember(sender);
                  replyMessage = {
                    sender,
                    senderDisplayName: member?.name ?? sender,
                    body: content.body ?? "",
                    isEncrypted: sdkEvent.isEncrypted() && !content.body,
                  };
                } else if (sdkEvent?.isDecryptionFailure?.()) {
                  replyMessage = {
                    sender: sdkEvent.getSender() ?? "",
                    senderDisplayName: matrixRoom.getMember(sdkEvent.getSender() ?? "")?.name,
                    body: "",
                    isEncrypted: true,
                  };
                }
              }
            }

            return (
              <React.Fragment key={msg.eventId}>
                {showDate && <DateSeparator timestamp={msg.ts} />}
                <MessageBubble
                  message={msg}
                  isGrouped={!!isGrouped && !showDate}
                  homeserver={activeAccount?.homeserver}
                  onReply={setReplyTo}
                  onReact={handleReact}
                  myUserId={activeAccount?.userId}
                  replyMessage={replyMessage}
                  readReceipts={readReceiptMap.get(msg.eventId)}
                  onContextMenuUser={handleContextMenuUser}
                  onJumpToEvent={handleJumpToEvent}
                />
              </React.Fragment>
            );
          })}
          <div ref={bottomRef} />
        </div>

        {/* Jump-to-bottom floating pill */}
        {!atBottom && (
          <button
            className={`jump-to-bottom ${unseenCount > 0 ? "jump-to-bottom--unread" : ""}`}
            onClick={scrollToBottom}
            aria-label="Jump to latest messages"
          >
            {unseenCount > 0 && (
              <span className="jump-to-bottom-count">{unseenCount > 99 ? "99+" : unseenCount}</span>
            )}
            <ChevronDown size={16} />
          </button>
        )}

        {/* Typing — always rendered so its 28px never causes timeline layout shift */}
        <TypingIndicator names={typingDisplayNames} />

        {/* Input */}
        <div className="room-view-input-area">
          <input
            type="file"
            ref={fileInputRef}
            style={{ display: "none" }}
            onChange={handleFileUpload}
          />
          {replyTo && (
            <div className="reply-preview">
              <span className="reply-preview-label">Replying to</span>
              <span className="reply-preview-sender"
                style={{ color: getUserColor(replyTo.sender) }}
              >
                {replyTo.senderDisplayName ?? replyTo.sender}
              </span>
              <span className="reply-preview-body">
                {replyTo.body?.slice(0, 80)}{(replyTo.body?.length ?? 0) > 80 ? "…" : ""}
              </span>
              <button
                className="reply-preview-close"
                title="Cancel reply"
                onClick={() => setReplyTo(null)}
              >
                <X size={13} />
              </button>
            </div>
          )}
          <div className="room-view-composer">
            <button 
              className="room-input-btn" 
              title="Attach file" 
              disabled={sending}
              onClick={() => fileInputRef.current?.click()}
            >
              <Paperclip size={17} />
            </button>
            <textarea
              ref={textareaRef}
              className="room-input"
              placeholder={`Message ${room?.name ?? "#room"}…`}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              rows={1}
              aria-label="Message input"
            />
            <div style={{ position: "relative" }}>
              <button
                className={`room-input-btn ${showComposerEmoji ? "room-input-btn--active" : ""}`}
                title="Emoji"
                disabled={sending}
                onClick={() => setShowComposerEmoji((v) => !v)}
              >
                <Smile size={17} />
              </button>
              {showComposerEmoji && (
                <EmojiPicker
                  onSelect={insertEmoji}
                  onClose={() => setShowComposerEmoji(false)}
                />
              )}
            </div>
            <button
              className={`room-send-btn ${input.trim() ? "room-send-btn--active" : ""}`}
              onClick={sendMessage}
              disabled={!input.trim() || sending}
              aria-label="Send message"
            >
              <Send size={15} />
            </button>
          </div>
        </div>
          </>
        )}
      </div>

      {/* Member list panel */}
      {showMembers && (
        <MemberList roomId={roomId} onClose={() => setShowMembers(false)} onContextMenuUser={handleContextMenuUser} />
      )}

      {userContextMenu && (
        <UserContextMenu
          user={userContextMenu.user}
          x={userContextMenu.x}
          y={userContextMenu.y}
          onClose={() => setUserContextMenu(null)}
          onMention={handleMention}
          onShowProfile={handleShowProfile}
        />
      )}

      {showRoomInfo && room && (
        <RoomInfoModal room={room} onClose={() => setShowRoomInfo(false)} />
      )}

      {profileTarget && (
        <UserProfileModal
          user={profileTarget}
          onClose={() => setProfileTarget(null)}
          onMention={handleMention}
        />
      )}
    </div>
  );
};

export default RoomView;
