import { create } from "zustand";
import type { AccountConfig } from "../types/matrix";

interface AccountsState {
  accounts: AccountConfig[];
  activeAccountId: string | null;
  syncStates: Record<string, string>;
  addAccount: (config: AccountConfig) => void;
  removeAccount: (id: string) => void;
  setActiveAccount: (id: string) => void;
  setSyncState: (accountId: string, state: string) => void;
  updateAccount: (config: Partial<AccountConfig> & { id: string }) => void;
  isE2EEUnlocked: Record<string, boolean>;
  setE2EEUnlocked: (accountId: string, unlocked: boolean) => void;
}

export const useAccountsStore = create<AccountsState>((set) => ({
  accounts: [],
  activeAccountId: null,
  syncStates: {},

  addAccount: (config) =>
    set((state) => {
      const exists = state.accounts.find((a) => a.id === config.id);
      if (exists) return state;
      const newAccounts = [...state.accounts, config];
      return {
        accounts: newAccounts,
        activeAccountId: state.activeAccountId ?? config.id,
      };
    }),

  removeAccount: (id) =>
    set((state) => {
      const newAccounts = state.accounts.filter((a) => a.id !== id);
      const newActive =
        state.activeAccountId === id
          ? (newAccounts[0]?.id ?? null)
          : state.activeAccountId;
      return { accounts: newAccounts, activeAccountId: newActive };
    }),

  setActiveAccount: (id) => set({ activeAccountId: id }),

  setSyncState: (accountId, syncState) =>
    set((state) => ({
      syncStates: { ...state.syncStates, [accountId]: syncState },
    })),

  updateAccount: (partial) =>
    set((state) => ({
      accounts: state.accounts.map((a) =>
        a.id === partial.id ? { ...a, ...partial } : a
      ),
    })),

  isE2EEUnlocked: {},

  setE2EEUnlocked: (accountId, unlocked) =>
    set((state) => ({
      isE2EEUnlocked: { ...state.isE2EEUnlocked, [accountId]: unlocked },
    })),
}));
