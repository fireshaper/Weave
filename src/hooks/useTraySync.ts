import { useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useRoomsStore } from "../store/roomsStore";
import { useAccountsStore } from "../store/accountsStore";

/**
 * Watches total unread count across all accounts and syncs it to the
 * system tray tooltip via a Tauri backend command.
 */
export function useTraySync() {
  const roomsByAccount = useRoomsStore((s) => s.roomsByAccount);
  const accounts = useAccountsStore((s) => s.accounts);
  const lastCount = useRef<number>(-1);

  useEffect(() => {
    const totalUnread = accounts.reduce((sum, account) => {
      const rooms = roomsByAccount[account.id] ?? [];
      return sum + rooms.reduce((s, r) => s + r.notificationCount, 0);
    }, 0);

    if (totalUnread === lastCount.current) return;
    lastCount.current = totalUnread;

    invoke("update_tray_tooltip", { count: totalUnread }).catch(() => {
      // Non-fatal — tray may not be initialized in all environments
    });
  }, [roomsByAccount, accounts]);
}
