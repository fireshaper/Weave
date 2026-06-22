import { create } from "zustand";
import type { MatrixMessage } from "../types/matrix";

/** A request to scroll the timeline to a specific event. The nonce makes
 *  repeated jumps to the same event re-trigger the effect in RoomView. */
export interface JumpTarget {
  roomId: string;
  eventId: string;
  nonce: number;
}

interface TimelineState {
  messages: Record<string, MatrixMessage[]>;  // keyed by roomId
  activeRoomId: string | null;
  typingByRoom: Record<string, string[]>;     // roomId -> userId[]
  localUnreadsByRoom: Record<string, boolean>;
  /** Pending scroll-to-event request, consumed by RoomView. */
  jumpTarget: JumpTarget | null;
  setActiveRoom: (roomId: string | null) => void;
  /** Open `roomId` (if not already active) and scroll to `eventId`. */
  requestJump: (roomId: string, eventId: string) => void;
  /** Clear the pending jump once handled. */
  clearJump: () => void;
  appendMessage: (roomId: string, msg: MatrixMessage) => void;
  prependMessages: (roomId: string, msgs: MatrixMessage[]) => void;
  setMessages: (roomId: string, msgs: MatrixMessage[]) => void;
  setTyping: (roomId: string, userIds: string[]) => void;
  clearRoom: (roomId: string) => void;
  updateMessage: (roomId: string, msg: MatrixMessage) => void;
  /** Replace the entry with oldEventId with newMsg. Falls back to append if not found. */
  replaceMessage: (roomId: string, oldEventId: string, newMsg: MatrixMessage) => void;
}

export const useTimelineStore = create<TimelineState>((set) => ({
  messages: {},
  activeRoomId: null,
  typingByRoom: {},
  localUnreadsByRoom: {},
  jumpTarget: null,

  setActiveRoom: (roomId) =>
    set((state) => {
      if (!roomId) return { activeRoomId: null };
      const localUnreadsByRoom = { ...state.localUnreadsByRoom };
      delete localUnreadsByRoom[roomId];
      return { activeRoomId: roomId, localUnreadsByRoom };
    }),

  requestJump: (roomId, eventId) =>
    set((state) => {
      const localUnreadsByRoom = { ...state.localUnreadsByRoom };
      delete localUnreadsByRoom[roomId];
      return {
        activeRoomId: roomId,
        localUnreadsByRoom,
        jumpTarget: { roomId, eventId, nonce: (state.jumpTarget?.nonce ?? 0) + 1 },
      };
    }),

  clearJump: () => set({ jumpTarget: null }),

  appendMessage: (roomId, msg) =>
    set((state) => {
      const existing = state.messages[roomId] ?? [];
      // deduplicate by eventId
      if (existing.find((m) => m.eventId === msg.eventId)) return state;
      const capped = [...existing, msg].slice(-500); // keep last 500
      const localUnreadsByRoom =
        roomId !== state.activeRoomId
          ? { ...state.localUnreadsByRoom, [roomId]: true }
          : state.localUnreadsByRoom;
      return { messages: { ...state.messages, [roomId]: capped }, localUnreadsByRoom };
    }),

  prependMessages: (roomId, msgs) =>
    set((state) => {
      const existing = state.messages[roomId] ?? [];
      const merged = [...msgs, ...existing];
      // deduplicate
      const seen = new Set<string>();
      const deduped = merged.filter((m) => {
        if (seen.has(m.eventId)) return false;
        seen.add(m.eventId);
        return true;
      });
      return { messages: { ...state.messages, [roomId]: deduped } };
    }),

  setMessages: (roomId, msgs) =>
    set((state) => ({ messages: { ...state.messages, [roomId]: msgs } })),

  setTyping: (roomId, userIds) =>
    set((state) => ({
      typingByRoom: { ...state.typingByRoom, [roomId]: userIds },
    })),

  clearRoom: (roomId) =>
    set((state) => {
      const next = { ...state.messages };
      delete next[roomId];
      return { messages: next };
    }),

  updateMessage: (roomId, msg) =>
    set((state) => {
      const existing = state.messages[roomId] || [];
      const updated = existing.map(m => m.eventId === msg.eventId ? msg : m);
      return { messages: { ...state.messages, [roomId]: updated } };
    }),

  replaceMessage: (roomId, oldEventId, newMsg) =>
    set((state) => {
      const existing = state.messages[roomId] ?? [];
      const idx = existing.findIndex((m) => m.eventId === oldEventId);
      if (idx === -1) {
        // Old entry not found — check if newMsg is already present before appending
        if (existing.some((m) => m.eventId === newMsg.eventId)) return state;
        return { messages: { ...state.messages, [roomId]: [...existing, newMsg] } };
      }
      // Swap old entry at idx with newMsg, preserving order
      const next = [...existing];
      next[idx] = newMsg;
      return { messages: { ...state.messages, [roomId]: next } };
    }),
}));
