import type { Room } from "matrix-js-sdk";

/**
 * Reads existing reaction aggregations for a given event from the SDK's
 * built-in relation store. Returns `{ reactions, myReactions }` ready to
 * be spread into a MatrixMessage.
 */
export function buildReactions(
  room: Room,
  eventId: string,
  myUserId: string
): { reactions: Record<string, number>; myReactions: Record<string, string> } {
  const reactions: Record<string, number> = {};
  const myReactions: Record<string, string> = {};

  try {
    const relations = room
      .getUnfilteredTimelineSet()
      .relations
      .getChildEventsForEvent(eventId, "m.annotation", "m.reaction");

    if (!relations) return { reactions, myReactions };

    for (const event of relations.getRelations()) {
      const key: string | undefined = event.getContent()?.["m.relates_to"]?.key;
      if (!key) continue;

      reactions[key] = (reactions[key] ?? 0) + 1;

      const sender = event.getSender();
      if (sender === myUserId) {
        const evId = event.getId();
        if (evId) myReactions[key] = evId;
      }
    }
  } catch {
    // Non-fatal — relation store may not be populated yet
  }

  return { reactions, myReactions };
}
