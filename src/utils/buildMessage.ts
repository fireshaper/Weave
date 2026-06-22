import { MsgType } from "matrix-js-sdk";
import type { MatrixClient, MatrixEvent, Room } from "matrix-js-sdk";
import type { MatrixMessage } from "../types/matrix";
import { buildReactions } from "./buildReactions";

/**
 * Builds a normalized {@link MatrixMessage} from an SDK timeline event.
 *
 * This is the single source of truth for event → message mapping, shared by
 * the live event listeners in AccountManager (Timeline / Decrypted /
 * LocalEchoUpdated) and the initial/paginated hydration in RoomView. Keeping
 * one implementation prevents the field-by-field drift these call sites
 * previously had (e.g. `isEdited` being computed in some places but not others).
 *
 * Note: edit (m.replace) events should be filtered out by the caller — this
 * produces a standalone message. `isEdited` reflects whether THIS message has
 * been superseded by a later edit (via `event.replacingEvent()`); the SDK's
 * `getContent()` already returns the replaced (latest) content in that case.
 */
export function buildMessageFromEvent(
  event: MatrixEvent,
  room: Room,
  client: MatrixClient,
): MatrixMessage {
  const content = event.getContent();
  const sender = event.getSender() ?? "";
  const member = room.getMember(sender);
  const eventId = event.getId() ?? "";
  const wasEdited = !!event.replacingEvent?.();

  return {
    eventId,
    roomId: room.roomId,
    sender,
    senderDisplayName: member?.name ?? sender,
    senderAvatarUrl: member?.getMxcAvatarUrl() ?? undefined,
    body: content.body ?? "",
    formattedBody: content.formatted_body,
    msgtype: content.msgtype ?? MsgType.Text,
    ts: event.getTs(),
    isEncrypted: event.isEncrypted(),
    isRedacted: event.isRedacted(),
    isEdited: wasEdited || undefined,
    replyToEventId: content["m.relates_to"]?.["m.in_reply_to"]?.event_id,
    ...buildReactions(room, eventId, client.getUserId() ?? ""),
    url: content.url,
    encryptedFile: content.file,
    filename: content.filename ?? content.body,
    info: content.info,
  };
}
