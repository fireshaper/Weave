import { create } from "zustand";
import type { RoomSummary } from "../types/matrix";

interface RoomsState {
  roomsByAccount: Record<string, RoomSummary[]>;
  setRooms: (accountId: string, rooms: RoomSummary[]) => void;
  updateRoom: (accountId: string, room: RoomSummary) => void;
  removeRoom: (accountId: string, roomId: string) => void;
  clearRooms: (accountId: string) => void;
  /** "home" | "personal" | <spaceRoomId> */
  activeSpaceId: string;
  setActiveSpaceId: (id: string) => void;
}

export const useRoomsStore = create<RoomsState>((set) => ({
  roomsByAccount: {},
  activeSpaceId: "home",

  setRooms: (accountId, rooms) =>
    set((state) => ({
      roomsByAccount: { ...state.roomsByAccount, [accountId]: rooms },
    })),

  updateRoom: (accountId, room) =>
    set((state) => {
      const existing = state.roomsByAccount[accountId] ?? [];
      const idx = existing.findIndex((r) => r.roomId === room.roomId);

      if (idx >= 0) {
        const prev = existing[idx];
        // Skip the update entirely if nothing meaningful changed — avoids
        // unnecessary React re-renders that cause the list to flicker.
        const tsChanged = prev.lastMessageTs !== room.lastMessageTs;
        const noChange =
          !tsChanged &&
          prev.unreadCount === room.unreadCount &&
          prev.notificationCount === room.notificationCount &&
          prev.lastMessage === room.lastMessage &&
          prev.name === room.name &&
          prev.avatarUrl === room.avatarUrl;
        if (noChange) return state; // bail out — nothing to do

        const updated = [...existing];
        updated[idx] = room;
        // Only re-sort when the timestamp changed — positional re-sorts on
        // every receipt/unread update are the primary cause of list jumping.
        if (tsChanged) {
          updated.sort((a, b) => (b.lastMessageTs ?? 0) - (a.lastMessageTs ?? 0));
        }
        return { roomsByAccount: { ...state.roomsByAccount, [accountId]: updated } };
      }

      // New room — prepend and sort
      const updated = [room, ...existing];
      updated.sort((a, b) => (b.lastMessageTs ?? 0) - (a.lastMessageTs ?? 0));
      return { roomsByAccount: { ...state.roomsByAccount, [accountId]: updated } };
    }),

  clearRooms: (accountId) =>
    set((state) => {
      const next = { ...state.roomsByAccount };
      delete next[accountId];
      return { roomsByAccount: next };
    }),

  removeRoom: (accountId, roomId) =>
    set((state) => {
      const existing = state.roomsByAccount[accountId];
      if (!existing) return state;
      return {
        roomsByAccount: {
          ...state.roomsByAccount,
          [accountId]: existing.filter((r) => r.roomId !== roomId),
        },
      };
    }),

  setActiveSpaceId: (id) => set({ activeSpaceId: id }),
}));
