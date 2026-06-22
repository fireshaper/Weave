import { create } from "zustand";
import type { InboxMention } from "../types/matrix";

/** Max mentions retained per account (newest kept). */
const MAX_MENTIONS = 100;

interface InboxState {
  /** Mentions keyed by accountId, newest first. */
  mentionsByAccount: Record<string, InboxMention[]>;
  /** Add a mention (deduped by id). No-op if already present. */
  addMention: (mention: InboxMention) => void;
  /** Mark every mention in a room as read (e.g. once its highlight count clears). */
  markRoomRead: (accountId: string, roomId: string) => void;
  /** Mark all of an account's mentions as read. */
  markAllRead: (accountId: string) => void;
  /** Drop a single mention from the list. */
  removeMention: (accountId: string, id: string) => void;
  /** Forget all mentions for an account (e.g. on sign-out). */
  clearAccount: (accountId: string) => void;
}

export const useInboxStore = create<InboxState>((set) => ({
  mentionsByAccount: {},

  addMention: (mention) =>
    set((state) => {
      const existing = state.mentionsByAccount[mention.accountId] ?? [];
      if (existing.some((m) => m.id === mention.id)) return state;
      const next = [mention, ...existing]
        .sort((a, b) => b.ts - a.ts)
        .slice(0, MAX_MENTIONS);
      return {
        mentionsByAccount: { ...state.mentionsByAccount, [mention.accountId]: next },
      };
    }),

  markRoomRead: (accountId, roomId) =>
    set((state) => {
      const existing = state.mentionsByAccount[accountId];
      if (!existing) return state;
      let changed = false;
      const next = existing.map((m) => {
        if (m.roomId === roomId && !m.read) {
          changed = true;
          return { ...m, read: true };
        }
        return m;
      });
      if (!changed) return state;
      return { mentionsByAccount: { ...state.mentionsByAccount, [accountId]: next } };
    }),

  markAllRead: (accountId) =>
    set((state) => {
      const existing = state.mentionsByAccount[accountId];
      if (!existing || existing.every((m) => m.read)) return state;
      const next = existing.map((m) => (m.read ? m : { ...m, read: true }));
      return { mentionsByAccount: { ...state.mentionsByAccount, [accountId]: next } };
    }),

  removeMention: (accountId, id) =>
    set((state) => {
      const existing = state.mentionsByAccount[accountId];
      if (!existing) return state;
      return {
        mentionsByAccount: {
          ...state.mentionsByAccount,
          [accountId]: existing.filter((m) => m.id !== id),
        },
      };
    }),

  clearAccount: (accountId) =>
    set((state) => {
      const next = { ...state.mentionsByAccount };
      delete next[accountId];
      return { mentionsByAccount: next };
    }),
}));
