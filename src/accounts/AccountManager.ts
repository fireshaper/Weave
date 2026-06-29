import {
  createClient,
  MatrixClient,
  ClientEvent,
  RoomEvent,
  RoomMemberEvent,
  IndexedDBStore,
  Room,
  NotificationCountType,
  MatrixEventEvent,
  SyncState,
} from "matrix-js-sdk";
import type { MatrixEvent } from "matrix-js-sdk";
import { CryptoEvent } from "matrix-js-sdk/lib/crypto-api/CryptoEvent";
import type { VerificationRequest } from "matrix-js-sdk/lib/crypto-api/verification";
import { VerificationPhase } from "matrix-js-sdk/lib/crypto-api/verification";
import { decodeRecoveryKey } from "matrix-js-sdk/lib/crypto-api/recovery-key";
import { deriveRecoveryKeyFromPassphrase } from "matrix-js-sdk/lib/crypto-api/key-passphrase";
import type { AccountConfig } from "../types/matrix";
import { useAccountsStore } from "../store/accountsStore";
import { useRoomsStore } from "../store/roomsStore";
import { useTimelineStore } from "../store/timelineStore";
import { useInboxStore } from "../store/inboxStore";
import type { RoomSummary } from "../types/matrix";
import { buildMessageFromEvent } from "../utils/buildMessage";
import { getCurrentWindow, UserAttentionType } from "@tauri-apps/api/window";

/** Outcome of a forced decryption retry pass over all loaded timelines. */
export interface RetryDecryptionResult {
  /** Total encrypted events scanned. */
  scanned: number;
  /** Events that were undecryptable (UTD) before the retry. */
  failedBefore: number;
  /** Previously-failed events that decrypted successfully on retry. */
  recovered: number;
  /** Previously-failed events still undecryptable after the retry. */
  stillFailed: number;
}

class AccountManager {
  private clients: Map<string, MatrixClient> = new Map();
  /** Cached space→children mapping per account, kept fresh by hydrateRoomList.
   *  Used by incremental buildRoomSummary calls (from event listeners) so that
   *  spaceIds are never wiped mid-session when no explicit map is provided. */
  private spaceChildMaps: Map<string, Map<string, Set<string>>> = new Map();
  /** True once an account's initial sync (PREPARED) has completed. During the
   *  initial sync the SDK replays every room's cached timeline through the
   *  RoomEvent.Timeline handler; those replayed events must NOT mark rooms as
   *  locally unread (read receipts aren't reconciled yet, so per-event read
   *  checks are unreliable at that point). Only genuinely live events that
   *  arrive after this flag is set should flag a room unread. */
  private initialSyncComplete: Map<string, boolean> = new Map();
  /** Temporary in-memory keys set by the UI before calling bootstrapSecretStorage.
   *  Using a plain Map avoids any React/Zustand batching delays between the set
   *  and the synchronous callback read inside the SDK. */
  private pendingKeys: Map<string, string> = new Map();
  /** Called when a stored access token is rejected with a 401. */
  onInvalidToken: ((accountId: string) => void) | null = null;

  /** Buffered verification requests that arrived before the UI registered its handler. */
  private _pendingVerificationRequests: Array<{ request: VerificationRequest; accountId: string }> = [];

  private _onVerificationRequest: ((request: VerificationRequest, accountId: string) => void) | null = null;

  /** Called when an incoming verification request arrives.
   *  Setting this flushes any requests that arrived before the UI was ready. */
  get onVerificationRequest() {
    return this._onVerificationRequest;
  }
  set onVerificationRequest(cb: ((request: VerificationRequest, accountId: string) => void) | null) {
    this._onVerificationRequest = cb;
    if (cb && this._pendingVerificationRequests.length > 0) {
      const pending = this._pendingVerificationRequests.splice(0);
      console.log(`[AccountManager] Flushing ${pending.length} buffered verification request(s).`);
      for (const { request, accountId } of pending) {
        // Only replay requests that are still in a non-terminal phase.
        // VerificationPhase: Unsent=1, Requested=2, Ready=3, Started=4, Cancelled=5, Done=6
        const phase = request.phase as number;
        if (phase < VerificationPhase.Cancelled) cb(request, accountId);
      }
    }
  }

  setPendingKey(accountId: string, key: string): void {
    this.pendingKeys.set(accountId, key);
  }

  clearPendingKey(accountId: string): void {
    this.pendingKeys.delete(accountId);
  }

  async addAccount(config: AccountConfig): Promise<MatrixClient> {
    if (this.clients.has(config.id)) {
      return this.clients.get(config.id)!;
    }
    const client = await this.createClientAsync(config);
    this.clients.set(config.id, client);
    await this.startSync(client, config);
    return client;
  }

  async removeAccount(accountId: string): Promise<void> {
    const client = this.clients.get(accountId);
    if (client) {
      client.stopClient();
      this.clients.delete(accountId);
      this.initialSyncComplete.delete(accountId);
      this.spaceChildMaps.delete(accountId);
    }
  }

  getClient(accountId: string): MatrixClient | undefined {
    return this.clients.get(accountId);
  }

  getAllClients(): [string, MatrixClient][] {
    return Array.from(this.clients.entries());
  }

  private async createClientAsync(config: AccountConfig): Promise<MatrixClient> {
    // Use a stable key derived from userId+deviceId so the IndexedDB store and
    // crypto database survive account removal/re-addition without key-ID conflicts.
    const stableKey = `${config.userId}:${config.deviceId}`;
    const store = new IndexedDBStore({
      indexedDB: window.indexedDB,
      localStorage: window.localStorage,
      dbName: `matrix-js-sdk-${stableKey}`,
    });



    const client = createClient({
      baseUrl: config.homeserver,
      accessToken: config.accessToken,
      userId: config.userId,
      deviceId: config.deviceId,
      store: store,
      timelineSupport: true,
      cryptoCallbacks: {
        getSecretStorageKey: async ({ keys }, _name) => {
          console.log("[AccountManager] getSecretStorageKey called by RustCrypto", { keys, _name });
          const inputKey = this.pendingKeys.get(config.id);
          if (!inputKey) {
            console.log("[AccountManager] No pending key for account", config.id, "- aborting SSSS");
            throw new Error("No secret storage key provided by UI (Expected if cross-signing is not yet unlocked)");
          }

          for (const [keyId, keyInfo] of Object.entries<any>(keys)) {
            if (inputKey.startsWith("Es") || inputKey.includes(" ")) {
              try {
                console.log("[AccountManager] Attempting to base58 decode recovery key");
                const decoded = decodeRecoveryKey(inputKey);
                return [keyId, decoded];
              } catch (e) {
                console.warn("[AccountManager] Failed to base58 decode recovery key", e);
              }
            } else if (keyInfo.passphrase) {
              try {
                console.log("[AccountManager] Attempting to derive PBKDF2 key from passphrase");
                const derived = await deriveRecoveryKeyFromPassphrase(
                  inputKey,
                  keyInfo.passphrase.salt,
                  keyInfo.passphrase.iterations,
                  keyInfo.passphrase.bits
                );
                return [keyId, derived];
              } catch (e) {
                console.warn("[AccountManager] Failed to derive PBKDF2 key", e);
              }
            }
          }
          
          console.log("[AccountManager] No valid key derivation strategy succeeded");
          return null;
        },
      },
    });

    try {
      await store.startup();
    } catch (err) {
      console.warn("Failed to startup IndexedDBStore, data might not persist", err);
    }

    return client;
  }

  private async startSync(client: MatrixClient, config: AccountConfig): Promise<void> {
    // Update sync state in store
    client.on(ClientEvent.Sync, (state, _prevState, data) => {
      useAccountsStore.getState().setSyncState(config.id, state as string);

      // Detect an invalidated access token (401 from the server)
      if (state === SyncState.Error) {
        const errCode = (data?.error as any)?.errcode ?? (data?.error as any)?.data?.errcode;
        if (errCode === "M_UNKNOWN_TOKEN" || (data?.error as any)?.httpStatus === 401) {
          console.warn(`[AccountManager] Access token for ${config.id} has been invalidated (401). Triggering re-auth.`);
          this.onInvalidToken?.(config.id);
          return;
        }
      }

      // Only do a full hydration on PREPARED (initial load). SYNCING fires on
      // every subsequent poll cycle — doing a full setRooms there replaces the
      // entire array each tick and is the primary cause of list flickering.
      if (state === "PREPARED") {
        this.initialSyncComplete.set(config.id, true);
        this.hydrateRoomList(client, config.id);
        // The SDK processes notification counts slightly after PREPARED fires.
        // Re-hydrate at 1 s and 4 s to catch both fast and slow initial syncs.
        setTimeout(() => this.hydrateRoomList(client, config.id), 1000);
        setTimeout(() => this.hydrateRoomList(client, config.id), 4000);
      }
    });

    // The SDK emits "Room.UnreadNotifications" every time a room's unread /
    // highlight count changes. This is the primary mechanism for keeping dots live.
    (client as any).on("Room.UnreadNotifications", (_notifData: unknown, room: Room | undefined) => {
      if (!room) return;
      const summary = this.buildRoomSummary(room, config.id);
      useRoomsStore.getState().updateRoom(config.id, summary);
      this.syncInboxReadState(room, config.id);
    });

    // Receipt events — clear badge when the local user (or server) marks read
    client.on(RoomEvent.Receipt, (_event, room) => {
      const summary = this.buildRoomSummary(room, config.id);
      useRoomsStore.getState().updateRoom(config.id, summary);
      this.syncInboxReadState(room, config.id);
    });

    // Handle late decrypted events
    client.on(MatrixEventEvent.Decrypted, (event) => {
      // Skip decryption failures — the SDK fires this event even when decryption
      // fails (event type becomes m.room.message with a UTD body). Processing those
      // would write UTD text into the timeline store and trigger a room list update
      // that could briefly flash the UTD message as the room preview.
      if (event.isDecryptionFailure?.()) return;

      const roomId = event.getRoomId();
      if (!roomId) return;
      const room = client.getRoom(roomId);
      if (!room) return;
      if (event.getType() !== "m.room.message" && event.getType() !== "m.room.encrypted") return;

      // If this is an edit (m.replace), update the original in place rather than
      // adding the edit event itself as a new message.
      if (this.applyEditIfReplacement(event, room)) return;

      const msg = buildMessageFromEvent(event, room, client);
      useTimelineStore.getState().updateMessage(room.roomId, msg);

      // E2EE rooms: push actions are only meaningful once the event is decrypted,
      // so this is where mentions in encrypted rooms get recorded.
      this.recordMentionIfHighlight(event, room, config.id);

      // Update room summary last message (since it might have been updated by this decryption)
      const roomSummary = this.buildRoomSummary(room, config.id);
      useRoomsStore.getState().updateRoom(config.id, roomSummary);
    });

    // New timeline events — skip local echoes (status !== null); they are
    // handled by LocalEchoUpdated once the server confirms them.
    client.on(RoomEvent.Timeline, (event, room, toStartOfTimeline) => {
      if (!room || toStartOfTimeline) return;
      if (event.status !== null && event.status !== undefined) return; // skip local echoes
      if (event.getType() !== "m.room.message" && event.getType() !== "m.room.encrypted") return;

      // Edit events (m.replace) — update the original message, don't append a new one.
      if (this.applyEditIfReplacement(event, room)) return;

      // Only flag the room as locally unread for genuinely new, unread messages.
      // During the initial sync the SDK replays each room's cached timeline through
      // this handler; those events fire before PREPARED, when read receipts aren't
      // yet reconciled, so we gate on initialSyncComplete rather than per-event read
      // checks (which are unreliable at that point). Our own messages never count.
      const myUserId = client.getUserId() ?? undefined;
      const isMine = event.getSender() === myUserId;
      const markUnread = (this.initialSyncComplete.get(config.id) ?? false) && !isMine;

      const msg = buildMessageFromEvent(event, room, client);
      useTimelineStore.getState().appendMessage(room.roomId, msg, markUnread);

      // Record an inbox entry if this event pinged the local user.
      this.recordMentionIfHighlight(event, room, config.id);

      // Update room summary last message
      const roomSummary = this.buildRoomSummary(room, config.id);
      useRoomsStore.getState().updateRoom(config.id, roomSummary);

      if (
        event.getSender() !== client.getUserId() &&
        this.isDirectRoom(room, config.id) &&
        !document.hasFocus()
      ) {
        try {
          getCurrentWindow().requestUserAttention(UserAttentionType.Informational);
        } catch (e) {
          console.warn("Failed to request user attention", e);
        }
      }
    });

    // Local echo confirmed by server — swap the temp-ID entry with the real one.
    // This fires after sendMessage() resolves and the server acknowledges the event.
    client.on(RoomEvent.LocalEchoUpdated, (event, room, oldEventId) => {
      if (!room) return;
      if (event.getType() !== "m.room.message" && event.getType() !== "m.room.encrypted") return;

      const msg = buildMessageFromEvent(event, room, client);

      // Replace the local echo (oldEventId) with the confirmed message, or append if new
      const store = useTimelineStore.getState();
      if (oldEventId) {
        store.replaceMessage(room.roomId, oldEventId, msg);
      } else {
        store.appendMessage(room.roomId, msg, false); // own message — never mark unread
      }

      const roomSummary = this.buildRoomSummary(room, config.id);
      useRoomsStore.getState().updateRoom(config.id, roomSummary);
    });

    // Room name/avatar changes
    client.on(RoomEvent.Name, (room) => {
      const summary = this.buildRoomSummary(room, config.id);
      useRoomsStore.getState().updateRoom(config.id, summary);
    });

    // New room joined or invited during live sync — add it incrementally so we don't need
    // to call hydrateRoomList (which replaces the whole array) just for one room.
    client.on(ClientEvent.Room, (room) => {
      const membership = room.getMyMembership();
      if (membership !== "join" && membership !== "invite") return;
      const summary = this.buildRoomSummary(room, config.id);
      useRoomsStore.getState().updateRoom(config.id, summary);
    });

    // Handle membership changes (like accepting an invite, or leaving a room)
    client.on(RoomEvent.MyMembership, (room, membership) => {
      if (membership === "join" || membership === "invite") {
        const summary = this.buildRoomSummary(room, config.id);
        useRoomsStore.getState().updateRoom(config.id, summary);
      } else if (membership === "leave") {
        useRoomsStore.getState().removeRoom(config.id, room.roomId);
      }
    });

    // Typing events
    client.on(RoomMemberEvent.Typing, (_event, member) => {
      const room = client.getRoom(member.roomId);
      if (!room) return;
      const typingMembers = room.getMembersWithMembership("join")
        .filter((m) => m.typing)
        .map((m) => m.userId);
      useTimelineStore.getState().setTyping(member.roomId, typingMembers);
    });

    // Reaction events (m.reaction)
    client.on(RoomEvent.Timeline, (event, room, toStartOfTimeline) => {
      if (!room || toStartOfTimeline) return;
      if (event.getType() !== "m.reaction") return;

      const relates = event.getContent()["m.relates_to"];
      if (!relates || relates.rel_type !== "m.annotation") return;

      const targetEventId: string | undefined = relates.event_id;
      const emoji: string | undefined = relates.key;
      if (!targetEventId || !emoji) return;
      const reactionEventId = event.getId() ?? "";
      const sender = event.getSender() ?? "";
      const myUserId = client.getUserId() ?? "";

      const store = useTimelineStore.getState();
      const msgs = store.messages[room.roomId] ?? [];
      const target = msgs.find((m) => m.eventId === targetEventId);
      if (!target) return;

      const newReactions = { ...target.reactions };
      newReactions[emoji] = (newReactions[emoji] ?? 0) + 1;

      const newMyReactions = { ...target.myReactions };
      if (sender === myUserId) {
        newMyReactions[emoji] = reactionEventId;
      }

      store.updateMessage(room.roomId, {
        ...target,
        reactions: newReactions,
        myReactions: newMyReactions,
      });
    });

    // Redaction events — handle reaction removal
    client.on(RoomEvent.Timeline, (event, room, toStartOfTimeline) => {
      if (!room || toStartOfTimeline) return;
      if (event.getType() !== "m.room.redaction") return;

      const redactedId = event.getAssociatedId?.() ?? (event.getContent() as any)["redacts"];
      if (!redactedId) return;

      const store = useTimelineStore.getState();
      const msgs = store.messages[room.roomId] ?? [];

      for (const target of msgs) {
        // Check if redactedId matches any myReaction event
        const emojiEntry = Object.entries(target.myReactions).find(
          ([, evId]) => evId === redactedId
        );
        if (emojiEntry) {
          const [emoji] = emojiEntry;
          const newReactions = { ...target.reactions };
          if ((newReactions[emoji] ?? 0) > 1) {
            newReactions[emoji] -= 1;
          } else {
            delete newReactions[emoji];
          }
          const newMyReactions = { ...target.myReactions };
          delete newMyReactions[emoji];
          store.updateMessage(room.roomId, {
            ...target,
            reactions: newReactions,
            myReactions: newMyReactions,
          });
          break;
        }
      }
    });

    try {
      // Stable prefix ensures the Rust crypto DB persists across account re-adds.
      // Using the ephemeral config.id would create a fresh DB every re-login,
      // causing key-upload 400s ("one time key already exists").
      const stableKey = `${config.userId}:${config.deviceId}`;
      await client.initRustCrypto({
        cryptoDatabasePrefix: `rust_crypto_${stableKey}`,
      });
      console.log(`[AccountManager] Initialized rust crypto for ${config.id}`);

      // Listen for incoming verification requests from other devices / users.
      client.on(CryptoEvent.VerificationRequestReceived, (request: VerificationRequest) => {
        console.log(`[AccountManager] Incoming verification request from ${request.otherUserId} (phase=${request.phase})`);
        if (this._onVerificationRequest) {
          this._onVerificationRequest(request, config.id);
        } else {
          // UI hasn't mounted yet — buffer the request so it's replayed on registration.
          console.log(`[AccountManager] UI not ready yet; buffering verification request.`);
          this._pendingVerificationRequests.push({ request, accountId: config.id });
        }
      });
    } catch (e) {
      console.error(`[AccountManager] Failed to init rust crypto for ${config.id}:`, e);
    }

    await client.startClient({ initialSyncLimit: 20, lazyLoadMembers: true });
  }

  /**
   * If `event` is an m.replace edit, apply its new content to the original
   * message already in the timeline store and return true. Returns false for
   * non-edit events. Shared by the Timeline and Decrypted listeners so edits
   * are handled identically on both the live and late-decryption paths.
   */
  private applyEditIfReplacement(event: MatrixEvent, room: Room): boolean {
    const content = event.getContent();
    const relatesTo = (content["m.relates_to"] || event.getWireContent?.()["m.relates_to"]) as any;
    if (relatesTo?.rel_type !== "m.replace") return false;

    const originalEventId: string | undefined = relatesTo.event_id;
    const newContent = content["m.new_content"] as any;
    if (originalEventId && newContent) {
      const store = useTimelineStore.getState();
      const msgs = store.messages[room.roomId] ?? [];
      const original = msgs.find((m) => m.eventId === originalEventId);
      if (original) {
        store.updateMessage(room.roomId, {
          ...original,
          body: newContent.body ?? original.body,
          formattedBody: newContent.formatted_body ?? original.formattedBody,
          isEdited: true,
        });
      }
    }
    return true; // It was an edit event — caller should not append it as a new message.
  }

  /**
   * Records an inbox mention if `event` triggers a highlight push action for the
   * local user (an @-mention, display-name match, or keyword). Skips own events
   * and anything the SDK doesn't flag as a highlight. Safe to call repeatedly —
   * the inbox store dedupes on event ID.
   */
  private recordMentionIfHighlight(event: MatrixEvent, room: Room, accountId: string): void {
    const client = this.clients.get(accountId);
    if (!client) return;
    const myUserId = client.getUserId();
    if (!myUserId || event.getSender() === myUserId) return;

    let highlight = false;
    try {
      highlight = client.getPushActionsForEvent(event)?.tweaks?.highlight ?? false;
    } catch {
      return; // push rules not ready yet — will be retried as more events arrive
    }
    if (!highlight) return;

    const eventId = event.getId();
    if (!eventId) return;
    const sender = event.getSender() ?? "";
    const member = room.getMember(sender);

    useInboxStore.getState().addMention({
      id: eventId,
      accountId,
      roomId: room.roomId,
      roomName: room.name ?? room.roomId,
      roomAvatarUrl: room.getMxcAvatarUrl?.() ?? undefined,
      sender,
      senderName: member?.name ?? sender,
      senderAvatarUrl: member?.getMxcAvatarUrl() ?? undefined,
      body: event.getContent()?.body ?? "",
      ts: event.getTs(),
      read: false,
    });
  }

  /** Mark a room's inbox mentions read once its highlight count has cleared. */
  private syncInboxReadState(room: Room, accountId: string): void {
    const highlight = room.getUnreadNotificationCount(NotificationCountType.Highlight) ?? 0;
    if (highlight === 0) {
      useInboxStore.getState().markRoomRead(accountId, room.roomId);
    }
  }

  private hydrateRoomList(client: MatrixClient, accountId: string): void {
    const rooms = client.getRooms().filter((r) => r.getMyMembership() === "join" || r.getMyMembership() === "invite");

    // Build a map: roomId → set of space roomIds that contain this room.
    // We do this by iterating every space and reading its m.space.child state events.
    const spaceChildMap = new Map<string, Set<string>>();
    for (const space of rooms) {
      if (!space.isSpaceRoom()) continue;
      const childEvents = space.currentState.getStateEvents("m.space.child");
      for (const ev of childEvents) {
        const childRoomId = ev.getStateKey();
        if (!childRoomId) continue;
        if (!spaceChildMap.has(childRoomId)) spaceChildMap.set(childRoomId, new Set());
        spaceChildMap.get(childRoomId)!.add(space.roomId);
      }
    }

    // Cache so incremental buildRoomSummary calls (from event listeners) can
    // always resolve spaceIds without needing to rebuild the full map.
    this.spaceChildMaps.set(accountId, spaceChildMap);

    const summaries: RoomSummary[] = rooms
      .map((r) => this.buildRoomSummary(r, accountId, spaceChildMap))
      .sort((a, b) => (b.lastMessageTs ?? 0) - (a.lastMessageTs ?? 0));
    useRoomsStore.getState().setRooms(accountId, summaries);

    // Backfill the inbox: any room that still has outstanding highlights has
    // unread pings — scan its loaded timeline so the inbox isn't empty on launch.
    for (const room of rooms) {
      if (room.isSpaceRoom()) continue;
      const highlight = room.getUnreadNotificationCount(NotificationCountType.Highlight) ?? 0;
      if (highlight <= 0) continue;
      const events = room.getLiveTimeline?.()?.getEvents?.() ?? [];
      for (const ev of events) {
        const type = ev.getType();
        if (type !== "m.room.message" && type !== "m.room.encrypted") continue;
        this.recordMentionIfHighlight(ev, room, accountId);
      }
    }
  }

  buildRoomSummary(
    room: Room,
    accountId: string,
    spaceChildMap?: Map<string, Set<string>>,
  ): RoomSummary {
    // Fall back to the cached map so incremental updates (from event listeners
    // that don't pass a map) still produce correct spaceIds.
    const effectiveMap = spaceChildMap ?? this.spaceChildMaps.get(accountId);
    const notifs = room.getUnreadNotificationCount(NotificationCountType.Highlight) ?? 0;
    const unread = room.getUnreadNotificationCount(NotificationCountType.Total) ?? 0;
    const timeline = room.getLiveTimeline?.()?.getEvents?.() ?? [];

    // Find the most recent event that is a successfully decrypted message.
    // We exclude:
    //   • events still typed "m.room.encrypted" (not yet attempted)
    //   • events where isDecryptionFailure() is true — after a failed decryptEventIfNeeded
    //     the SDK changes the internal type to "m.room.message" with a UTD body, so we
    //     must explicitly filter these out to prevent the UTD text flashing in the preview.
    const reversed = [...timeline].reverse();
    const lastEvent = reversed.find((e: any) => {
      if (e.isDecryptionFailure?.()) return false;
      const type = e.getType();
      if (type === "m.room.message") return true;
      if (type === "m.room.encrypted") return false;
      return false;
    });

    // Separately grab the timestamp from the most recent message-or-encrypted event
    // (excluding UTD failures) so sort order is still correct even when no preview is available.
    const lastAnyEvent = reversed.find((e: any) => {
      if (e.isDecryptionFailure?.()) return false;
      return e.getType() === "m.room.message" || e.getType() === "m.room.encrypted";
    });

    // If there's a recent encrypted event but we couldn't find a decrypted preview,
    // show a stable placeholder rather than "Unable to decrypt".
    const hasEncryptedWithNoPreview = !lastEvent && lastAnyEvent?.getType() === "m.room.encrypted";

    const client = this.clients.get(accountId);
    const myUserId = client?.getUserId() ?? undefined;

    let lastMessageTs = lastAnyEvent?.getTs?.();
    if (!lastMessageTs && room.getMyMembership() === "invite" && myUserId) {
      lastMessageTs = room.currentState?.getStateEvents("m.room.member", myUserId)?.getTs();
    }

    // The raw notification count (NotificationCountType.Total) counts thread
    // notifications and, on a cold start from the IndexedDB cache, can stay
    // non-zero for encrypted rooms even when the timeline has actually been read
    // (the homeserver can't apply push rules to E2EE content, so it over-counts).
    // Reconcile against the user's read receipt: if it has reached the latest
    // message, the room is read — this prevents phantom unread dots on relaunch.
    const latestEventId = lastAnyEvent?.getId?.();
    const isRead =
      myUserId && latestEventId ? room.hasUserReadEvent(myUserId, latestEventId) : false;

    return {
      roomId: room.roomId,
      accountId,
      name: room.name ?? room.roomId,
      avatarUrl: room.getMxcAvatarUrl?.() ?? undefined,
      topic: room.currentState?.getStateEvents("m.room.topic", "")?.getContent()?.topic,
      lastMessage: hasEncryptedWithNoPreview
        ? "🔒 Encrypted message"
        : (lastEvent?.getContent?.()?.body ?? undefined),
      lastMessageTs,
      lastMessageSender: lastEvent?.getSender?.() ?? undefined,
      unreadCount: isRead ? 0 : unread,
      notificationCount: isRead ? 0 : notifs,
      isDirect: this.isDirectRoom(room, accountId),
      memberCount: room.getJoinedMemberCount?.() ?? 0,
      roomType: room.isSpaceRoom() ? "m.space" : undefined,
      spaceIds: effectiveMap ? Array.from(effectiveMap.get(room.roomId) ?? []) : [],
      membership: room.getMyMembership(),
    };
  }

  /**
   * Determines whether a room is a DM using the user's m.direct account data
   * (the authoritative source in Matrix), with a fallback to member-count.
   * Using member count alone is unstable with lazy member loading and causes
   * flickering as members load in after initial sync.
   */
  private isDirectRoom(room: Room, accountId: string): boolean {
    const client = this.clients.get(accountId);
    if (client) {
      const dmMap = client.getAccountData("m.direct" as any)?.getContent() ?? {};
      const allDmRoomIds = Object.values(dmMap as Record<string, string[]>).flat();
      if (allDmRoomIds.includes(room.roomId)) return true;
    }
    // Fallback: 2-person room with only member events (before account data loads)
    // For invites, you are not joined yet, so we must check invited + joined count
    const memberCount = room.getJoinedMemberCount?.() ?? 0;
    const inviteAndJoinedCount = room.getInvitedAndJoinedMemberCount?.() ?? memberCount;
    return memberCount === 2 || inviteAndJoinedCount === 2;
  }

  /**
   * Record a room as a direct message in the user's m.direct account data.
   * Matrix's createRoom({ is_direct: true }) only flags the invite for the
   * invitee — the *inviting* client must update m.direct itself, otherwise the
   * room isn't recognised as a DM and future "Message" actions create duplicates.
   */
  async addDirectMessage(accountId: string, otherUserId: string, roomId: string): Promise<void> {
    const client = this.clients.get(accountId);
    if (!client) return;
    const current = (client.getAccountData("m.direct" as any)?.getContent() ?? {}) as Record<string, string[]>;
    const dmMap: Record<string, string[]> = { ...current };
    const list = dmMap[otherUserId] ? [...dmMap[otherUserId]] : [];
    if (!list.includes(roomId)) list.push(roomId);
    dmMap[otherUserId] = list;
    try {
      await client.setAccountData("m.direct" as any, dmMap as any);
    } catch (e) {
      console.warn("[AccountManager] Failed to update m.direct:", e);
    }
  }

  async ensureOwnKeysFetched(accountId: string): Promise<void> {
    const client = this.clients.get(accountId);
    if (!client) return;
    const userId = client.getUserId();
    if (!userId) return;
    try {
      const crypto = client.getCrypto() as any;
      const olmMachine = crypto?.olmMachine ?? crypto?._olmMachine;
      const processor = crypto?.outgoingRequestProcessor;
      if (olmMachine && processor) {
        const { UserId } = await import("@matrix-org/matrix-sdk-crypto-wasm");
        const keyReq = olmMachine.queryKeysForUsers([new UserId(userId)]);
        if (keyReq) await processor.makeOutgoingRequest(keyReq);
        console.log("[AccountManager] ensureOwnKeysFetched: /keys/query sent for", userId);
      }
    } catch (e) {
      console.warn("[AccountManager] ensureOwnKeysFetched failed (non-fatal):", e);
    }
  }

  async retryDecryption(accountId: string): Promise<RetryDecryptionResult> {
    const client = this.getClient(accountId);
    if (!client) return { scanned: 0, failedBefore: 0, recovered: 0, stillFailed: 0 };

    const crypto = client.getCrypto() as any;
    const rooms = client.getRooms();
    let scanned = 0;
    let failedBefore = 0;
    let recovered = 0;
    let stillFailed = 0;

    for (const room of rooms) {
      // Cover the live timeline AND any earlier paginated windows
      const timelineSet = room.getUnfilteredTimelineSet();
      const timelines = timelineSet?.getTimelines() ?? [room.getLiveTimeline()].filter(Boolean);

      for (const timeline of timelines) {
        const events = timeline?.getEvents() ?? [];
        for (const ev of events) {
          if (!ev.isEncrypted()) continue;
          scanned++;
          const wasFailed = ev.isDecryptionFailure?.() ?? false;
          try {
            if (wasFailed) {
              failedBefore++;
              // Already-failed (UTD) events keep a placeholder clearEvent, which
              // makes shouldAttemptDecryption() return false — so decryptEventIfNeeded()
              // silently no-ops on exactly the messages we just imported keys for.
              // Force a real re-decryption.
              await (ev as any).attemptDecryption(crypto, { isRetry: true });
            } else {
              await client.decryptEventIfNeeded(ev);
            }
          } catch {
            // Don't log every failure — it floods the console for rooms with many encrypted events
          }

          if (wasFailed) {
            if (ev.isDecryptionFailure?.()) {
              stillFailed++;
            } else {
              recovered++;
              // Don't rely solely on the MatrixEventEvent.Decrypted emit to refresh
              // the UI — push the freshly-decrypted message into the store directly.
              if (ev.getType() === "m.room.message" || ev.getType() === "m.room.encrypted") {
                if (!this.applyEditIfReplacement(ev, room)) {
                  const msg = buildMessageFromEvent(ev, room, client);
                  useTimelineStore.getState().updateMessage(room.roomId, msg);
                }
              }
            }
          }
        }
      }
    }
    const result = { scanned, failedBefore, recovered, stillFailed };
    console.log(`[AccountManager] retryDecryption ${accountId}:`, result);
    return result;
  }

  /**
   * Ask our other devices to forward the megolm sessions for messages we still
   * can't decrypt ("key gossip"). This is the recovery path for DMs that were
   * decrypted on another device (e.g. Element) but whose keys never made it into
   * the encrypted key backup — restoring the backup can't help, but the device
   * that holds the keys can forward them over to-device messages.
   *
   * Enables outgoing m.room_key_request on the OlmMachine, re-runs decryption so
   * the machine registers exactly which sessions are missing (queuing a request
   * for each), then flushes those requests to the server immediately rather than
   * waiting for the next sync. The other device must be online and trust this
   * one (Unlock cross-signs it first) for the keys to actually come back; when
   * they do, the SDK retries decryption and our Decrypted handler unlocks the
   * message automatically.
   */
  async requestRoomKeysForFailures(accountId: string): Promise<void> {
    const client = this.getClient(accountId);
    if (!client) return;
    try {
      const crypto = client.getCrypto() as any;
      const olmMachine = crypto?.olmMachine ?? crypto?._olmMachine;
      const requestsManager = crypto?.outgoingRequestsManager;
      if (!olmMachine) {
        console.warn("[AccountManager] requestRoomKeysForFailures: no OlmMachine available.");
        return;
      }
      // Turn on to-device key requests so failed decryptions queue a gossip
      // request for the missing session instead of silently giving up.
      try {
        olmMachine.roomKeyRequestsEnabled = true;
      } catch (e) {
        console.warn("[AccountManager] could not enable roomKeyRequestsEnabled:", e);
      }
      // Re-run decryption: each still-missing session gets registered and a
      // request queued on the machine.
      await this.retryDecryption(accountId);
      // Flush the queued requests now instead of waiting for the next sync.
      if (requestsManager?.doProcessOutgoingRequests) {
        await requestsManager.doProcessOutgoingRequests();
      }
      console.log("[AccountManager] requestRoomKeysForFailures: key requests sent for", accountId);
    } catch (e) {
      console.warn("[AccountManager] requestRoomKeysForFailures failed (non-fatal):", e);
    }
  }

  /**
   * Cross-sign THIS device using our own self-signing key and publish the
   * signature, marking the session as verified to other users/devices so they
   * start sharing room keys with it. This is the non-interactive alternative to
   * the device-to-device SAS dance (which requires a second session to respond).
   *
   * If the cross-signing private keys are already cached locally (the Security
   * tab shows "Keys loaded"), no key is needed — `crossSignDevice` signs using
   * the in-memory self-signing key. Otherwise the provided Security Key /
   * passphrase is used to import them from secret storage first.
   *
   * After signing, restores key backup and retries decryption so DMs that were
   * stuck on "Waiting for decryption keys" backfill once peers re-share keys.
   */
  async selfVerifyWithSecurityKey(
    accountId: string,
    key: string | null,
  ): Promise<{ ok: boolean; crossSigned: boolean; needsKey?: boolean; error?: string }> {
    const client = this.getClient(accountId);
    if (!client) return { ok: false, crossSigned: false, error: "Account not found." };
    const crypto = client.getCrypto() as any;
    if (!crypto) return { ok: false, crossSigned: false, error: "Crypto backend is not running. Restart the app." };
    const userId = client.getUserId();
    const deviceId = client.getDeviceId();
    if (!userId || !deviceId) return { ok: false, crossSigned: false, error: "Missing user/device id." };

    const trimmed = key?.trim() || null;
    try {
      // If the self-signing private key isn't already in the crypto machine,
      // import it from secret storage using the supplied Security Key.
      let xs = await crypto.getCrossSigningStatus().catch(() => null);
      if (!xs?.privateKeysCachedLocally?.selfSigningKey) {
        if (!trimmed) {
          return {
            ok: false,
            crossSigned: false,
            needsKey: true,
            error: "Cross-signing keys aren't loaded. Enter your Security Key first (“Re-enter Security Key”).",
          };
        }
        this.setPendingKey(accountId, trimmed);
        try {
          // Accept the SSSS key; a bad MAC on a single secret (e.g. a stale
          // backup key) is non-fatal for cross-signing import.
          try {
            await crypto.bootstrapSecretStorage({ setupNewKeyBackup: false, setupNewSecretStorage: false });
          } catch (e: any) {
            const msg = (e?.message ?? "").toLowerCase();
            if (!msg.includes("bad mac") && !msg.includes("bad_mac")) {
              return { ok: false, crossSigned: false, error: e?.message ?? "Security Key was rejected." };
            }
          }
          // Ensure our public cross-signing keys are known before importing the
          // private halves (importCrossSigningKeys silently no-ops otherwise).
          await this.ensureOwnKeysFetched(accountId);
          this.setPendingKey(accountId, trimmed);
          try {
            await crypto.bootstrapCrossSigning({ setupNewCrossSigning: false });
          } catch (e: any) {
            const msg = (e?.message ?? "").toLowerCase();
            if (!msg.includes("bad mac") && !msg.includes("bad_mac")) {
              return { ok: false, crossSigned: false, error: e?.message ?? "Could not load cross-signing keys." };
            }
          }
        } finally {
          this.clearPendingKey(accountId);
        }
        xs = await crypto.getCrossSigningStatus().catch(() => null);
      }

      if (!xs?.privateKeysCachedLocally?.selfSigningKey) {
        return {
          ok: false,
          crossSigned: false,
          error: xs?.privateKeysInSecretStorage
            ? "Cross-signing secrets are stored but couldn't be decrypted with this key (bad MAC). Reset cross-signing from a working session, then retry."
            : "Cross-signing isn't set up on this account. Set it up from another session (e.g. Element) first.",
        };
      }

      // The actual fix: sign this device with the self-signing key and publish it.
      await crypto.crossSignDevice(deviceId);

      const status = await crypto.getDeviceVerificationStatus(userId, deviceId).catch(() => null);
      const crossSigned = !!(status?.signedByOwner ?? status?.crossSigningVerified ?? status?.isVerified?.());

      // Backfill the stuck messages: restore the backup, then retry decryption a
      // few times to catch keys peers re-share now that we're trusted.
      if (trimmed && crypto.loadSessionBackupPrivateKeyFromSecretStorage) {
        this.setPendingKey(accountId, trimmed);
        try {
          await crypto.loadSessionBackupPrivateKeyFromSecretStorage();
        } catch {
          /* non-fatal */
        } finally {
          this.clearPendingKey(accountId);
        }
      }
      if (crypto.restoreKeyBackup) {
        if (trimmed) this.setPendingKey(accountId, trimmed);
        crypto.restoreKeyBackup()
          .then(() => this.retryDecryption(accountId))
          .catch(() => {})
          .finally(() => this.clearPendingKey(accountId));
      }
      this.retryDecryption(accountId);
      setTimeout(() => this.retryDecryption(accountId), 5000);
      setTimeout(() => this.retryDecryption(accountId), 15000);

      console.log(`[AccountManager] crossSignDevice OK for ${deviceId} (crossSigned=${crossSigned}).`);
      return { ok: true, crossSigned };
    } catch (e: any) {
      this.clearPendingKey(accountId);
      console.error("[AccountManager] selfVerifyWithSecurityKey failed:", e);
      return { ok: false, crossSigned: false, error: e?.message ?? "Verification failed." };
    }
  }

  /**
   * Pull megolm session keys down from the encrypted key backup and retry
   * decrypting everything. This is the recovery path for messages this user sent
   * from another device (or received) while this session was untrusted — the
   * keys aren't gossiped retroactively, but they are in the backup if the
   * originating device had backup enabled. Requires the backup decryption key,
   * which is loaded from secret storage using the provided Security Key.
   */
  async restoreKeyBackupAndRetry(
    accountId: string,
    key: string | null,
  ): Promise<{ ok: boolean; imported?: number; total?: number; error?: string }> {
    const client = this.getClient(accountId);
    if (!client) return { ok: false, error: "Account not found." };
    const crypto = client.getCrypto() as any;
    if (!crypto) return { ok: false, error: "Crypto backend is not running. Restart the app." };

    const trimmed = key?.trim() || null;
    if (trimmed) this.setPendingKey(accountId, trimmed);
    try {
      if (crypto.loadSessionBackupPrivateKeyFromSecretStorage) {
        try {
          await crypto.loadSessionBackupPrivateKeyFromSecretStorage();
        } catch (e: any) {
          console.warn("[AccountManager] loadSessionBackupPrivateKeyFromSecretStorage failed:", e?.message ?? e);
        }
      }

      let imported: number | undefined;
      let total: number | undefined;
      if (crypto.restoreKeyBackup) {
        try {
          const res = await crypto.restoreKeyBackup();
          imported = res?.imported;
          total = res?.total;
        } catch (e: any) {
          return { ok: false, error: e?.message ?? "Key backup restore failed (no backup, or wrong key)." };
        }
      } else {
        return { ok: false, error: "Key backup is not available in this SDK build." };
      }

      await this.retryDecryption(accountId);
      setTimeout(() => this.retryDecryption(accountId), 4000);
      console.log(`[AccountManager] restoreKeyBackup imported ${imported}/${total} keys.`);
      return { ok: true, imported, total };
    } finally {
      this.clearPendingKey(accountId);
    }
  }

  async acceptInvite(accountId: string, roomId: string): Promise<void> {
    const client = this.getClient(accountId);
    if (!client) return;
    await client.joinRoom(roomId);
  }

  async declineInvite(accountId: string, roomId: string): Promise<void> {
    const client = this.getClient(accountId);
    if (!client) return;
    await client.leave(roomId);
  }
}

export const accountManager = new AccountManager();
