import React, { useState } from "react";
import DOMPurify from "dompurify";
import { Smile, Reply, Copy, Check } from "lucide-react";
import Avatar from "./Avatar";
import EmojiPicker from "./EmojiPicker";
import EncryptedImage from "./EncryptedImage";
import { AuthedImage, AuthedVideo, AuthedAudio, AuthedFileLink } from "./AuthedMedia";
import type { MatrixMessage } from "../types/matrix";
import { getUserColor } from "../utils/userColor";
import "./MessageBubble.css";



interface ReplyPreview {
  sender: string;
  senderDisplayName?: string;
  body: string;
  isEncrypted?: boolean;
}

export interface ReadReceiptUser {
  userId: string;
  displayName: string;
  avatarUrl?: string;
}

interface MessageBubbleProps {
  message: MatrixMessage;
  isGrouped?: boolean;
  homeserver?: string;
  onReply?: (message: MatrixMessage) => void;
  onReact?: (message: MatrixMessage, emoji: string) => void;
  myUserId?: string;
  replyMessage?: ReplyPreview;
  readReceipts?: ReadReceiptUser[];
  /** Called when the user right-clicks the sender avatar or name */
  onContextMenuUser?: (userId: string, displayName: string, avatarUrl: string | undefined, x: number, y: number) => void;
  /** Called when the user clicks the reply quote — jumps to the replied-to event. */
  onJumpToEvent?: (eventId: string) => void;
}

const MessageBubble: React.FC<MessageBubbleProps> = ({ message, isGrouped, homeserver, onReply, onReact, myUserId, replyMessage, readReceipts, onContextMenuUser, onJumpToEvent }) => {
  const [copied, setCopied] = useState(false);
  const [showPicker, setShowPicker] = useState(false);

  const handleCopy = () => {
    const text = message.body ?? "";
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };
  const formatTime = (ts: number) =>
    new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

  const renderBody = () => {
    if (message.isRedacted) {
      return <span className="msg-redacted">Message deleted</span>;
    }

    if (message.isEncrypted && !message.body) {
      return (
        <span className="msg-encrypted" style={{ fontStyle: "italic", color: "var(--text-muted)" }}>
          🔒 Waiting for decryption keys...
        </span>
      );
    }

    switch (message.msgtype) {
      case "m.image": {
        const isGif =
          (message.info?.mimetype === "image/gif") ||
          (message.filename ?? message.body ?? "").toLowerCase().endsWith(".gif");
        const imageLabel = message.filename ?? "Attachment";
        // Encrypted attachment (E2EE rooms / DMs) — content.file takes priority.
        if (message.encryptedFile) {
          return (
            <div className="msg-image-container">
              <EncryptedImage
                encryptedFile={message.encryptedFile}
                alt={imageLabel}
                className={`msg-image${isGif ? " msg-image--gif" : ""}`}
              />
            </div>
          );
        }
        // Plain (unencrypted) attachment — downloaded via authenticated media.
        return (
          <div className="msg-image-container">
            <AuthedImage
              url={message.url}
              label={imageLabel}
              className={`msg-image${isGif ? " msg-image--gif" : ""}`}
            />
          </div>
        );
      }
      case "m.video": {
        return (
          <div className="msg-video-container">
            <AuthedVideo
              url={message.url}
              label={message.filename ?? message.body}
              className="msg-video"
            />
          </div>
        );
      }
      case "m.audio": {
        return (
          <div className="msg-audio-container">
            <span className="msg-audio-label">🎵 {message.filename ?? message.body}</span>
            <AuthedAudio
              url={message.url}
              label={message.filename ?? message.body}
              className="msg-audio"
            />
          </div>
        );
      }
      case "m.file": {
        return (
          <span className="msg-body msg-file">
            📎 <AuthedFileLink
              url={message.url}
              label={message.filename ?? message.body}
              className="msg-file-link"
            />
          </span>
        );
      }
      case "m.emote":
        return (
          <em className="msg-body msg-emote">
            * {message.senderDisplayName} {message.body}
          </em>
        );
      default: {
        // Strip Matrix reply fallback so we don't double-render the quote.
        // formattedBody: remove the <mx-reply>…</mx-reply> block the spec injects.
        // plainBody: remove the "> In reply to" quoted lines (everything before the first blank line).
        const strippedFormatted = message.formattedBody
          ? sanitizeHtml(stripMxReply(message.formattedBody))
          : undefined;
        const strippedPlain = message.replyToEventId
          ? stripPlainReplyFallback(message.body ?? "")
          : (message.body ?? "");

        return (
          <span
            className="msg-body"
            dangerouslySetInnerHTML={
              strippedFormatted
                ? { __html: strippedFormatted }
                : undefined
            }
          >
            {!strippedFormatted ? strippedPlain : undefined}
          </span>
        );
      }
    }
  };


  const MAX_VISIBLE_RECEIPTS = 5;
  const visibleReceipts = readReceipts?.slice(0, MAX_VISIBLE_RECEIPTS) ?? [];
  const overflowCount = (readReceipts?.length ?? 0) - MAX_VISIBLE_RECEIPTS;

  return (
    <div
      className={`msg-bubble ${isGrouped ? "msg-bubble--grouped" : ""} ${showPicker ? "msg-bubble--picker-open" : ""}`}
      data-event-id={message.eventId}
    >
      {/* Hover actions toolbar */}
      <div className="msg-actions">
        {/* Emoji picker wrapper — keep relative so picker floats above */}
        <div style={{ position: "relative" }}>
          <button
            className={`msg-action-btn ${showPicker ? "msg-action-btn--active" : ""}`}
            title="Add reaction"
            onClick={(e) => { e.stopPropagation(); setShowPicker((v) => !v); }}
          >
            <Smile size={14} />
          </button>
          {showPicker && onReact && (
            <EmojiPicker
              onSelect={(emoji) => onReact(message, emoji)}
              onClose={() => setShowPicker(false)}
            />
          )}
        </div>
        {onReply && (
          <button
            className="msg-action-btn"
            title="Reply"
            onClick={() => onReply(message)}
          >
            <Reply size={14} />
          </button>
        )}
        <button
          className="msg-action-btn"
          title="Copy text"
          onClick={handleCopy}
        >
          {copied ? <Check size={14} /> : <Copy size={14} />}
        </button>
      </div>

      {!isGrouped && (
        <div
          className="msg-avatar"
          onContextMenu={onContextMenuUser ? (e) => {
            e.preventDefault();
            e.stopPropagation();
            onContextMenuUser(message.sender, message.senderDisplayName ?? message.sender, message.senderAvatarUrl, e.clientX, e.clientY);
          } : undefined}
          style={onContextMenuUser ? { cursor: "context-menu" } : undefined}
        >
          <Avatar
            name={message.senderDisplayName ?? message.sender}
            avatarUrl={message.senderAvatarUrl}
            homeserver={homeserver}
            size={34}
          />
        </div>
      )}
      {isGrouped && <div className="msg-avatar-placeholder" />}

      <div className="msg-content">
        {!isGrouped && (
          <div className="msg-header">
            <span
              className="msg-sender"
              style={{ color: getUserColor(message.sender) }}
              onContextMenu={onContextMenuUser ? (e) => {
                e.preventDefault();
                e.stopPropagation();
                onContextMenuUser(message.sender, message.senderDisplayName ?? message.sender, message.senderAvatarUrl, e.clientX, e.clientY);
              } : undefined}
            >
              {message.senderDisplayName ?? message.sender}
            </span>
            <span className="msg-time">{formatTime(message.ts)}</span>
          </div>
        )}
        {message.replyToEventId && (
          <div
            className={`msg-reply-quote ${onJumpToEvent ? "msg-reply-quote--clickable" : ""}`}
            onClick={onJumpToEvent ? () => onJumpToEvent(message.replyToEventId!) : undefined}
            role={onJumpToEvent ? "button" : undefined}
            title={onJumpToEvent ? "Jump to message" : undefined}
          >
            {replyMessage ? (
              <>
                <span
                  className="msg-reply-sender"
                  style={{ color: getUserColor(replyMessage.sender) }}
                >
                  {replyMessage.senderDisplayName ?? replyMessage.sender}
                </span>
                <span className="msg-reply-body">
                  {replyMessage.isEncrypted
                    ? "🔒 Encrypted message"
                    : (replyMessage.body?.slice(0, 150) + ((replyMessage.body?.length ?? 0) > 150 ? "…" : ""))}
                </span>
              </>
            ) : (
              <span className="msg-reply-body msg-reply-body--unknown">↩ Original message not loaded</span>
            )}
          </div>
        )}
        {renderBody()}
        {message.isEdited && (
          <span className="msg-edited">(edited)</span>
        )}
        {Object.keys(message.reactions).length > 0 && (
          <div className="msg-reactions">
            {Object.entries(message.reactions).map(([emoji, count]) => {
              const mine = myUserId && message.myReactions?.[emoji];
              return (
                <button
                  key={emoji}
                  className={`msg-reaction ${mine ? "msg-reaction--mine" : ""}`}
                  onClick={() => onReact?.(message, emoji)}
                  title={mine ? "Remove reaction" : `React with ${emoji}`}
                >
                  {emoji} <span className="msg-reaction-count">{count}</span>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {isGrouped && <span className="msg-hover-time">{formatTime(message.ts)}</span>}

      {/* Read receipts — small avatars on the right */}
      {visibleReceipts.length > 0 && (
        <div className="msg-read-receipts" role="img" aria-label={`Read by ${visibleReceipts.map((r) => r.displayName).join(", ")}`}>
          {visibleReceipts.map((r) => (
            <div key={r.userId} className="msg-receipt-avatar" title={r.displayName}>
              <Avatar
                name={r.displayName}
                avatarUrl={r.avatarUrl}
                homeserver={homeserver}
                size={16}
              />
            </div>
          ))}
          {overflowCount > 0 && (
            <div className="msg-receipt-overflow" title={`+${overflowCount} more`}>
              +{overflowCount}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

// Strip <mx-reply>…</mx-reply> block — the Matrix spec injects this as a
// fallback for clients without native reply rendering. Since we render our
// own quote embed, we remove it before setting innerHTML.
function stripMxReply(html: string): string {
  return html.replace(/<mx-reply>[\s\S]*?<\/mx-reply>/i, "").trim();
}

// Strip the "> In reply to" plain-text fallback lines that Matrix clients
// prepend to the body. The spec format is a block of "> " prefixed lines
// followed by a blank line, then the actual message.
function stripPlainReplyFallback(body: string): string {
  // If the body starts with "> " (reply quote block), drop everything up to
  // and including the first blank line.
  if (!body.startsWith("> ")) return body;
  const blankLineIdx = body.indexOf("\n\n");
  return blankLineIdx !== -1 ? body.slice(blankLineIdx + 2) : body;
}

// Sanitize a Matrix formatted_body (untrusted HTML from other users) before it
// is injected via dangerouslySetInnerHTML. We use DOMPurify with an allowlist
// modelled on the Matrix spec's permitted subset (m.room.message → org.matrix
// custom HTML). A naive regex sanitizer is NOT sufficient here: it misses
// unquoted handlers (<img src=x onerror=…>), javascript: URLs, <svg>/<iframe>,
// and malformed-tag vectors — all of which would execute JS inside the Tauri
// webview (which has IPC access).
const MATRIX_ALLOWED_TAGS = [
  "font", "del", "s", "h1", "h2", "h3", "h4", "h5", "h6", "blockquote", "p",
  "a", "ul", "ol", "sup", "sub", "li", "b", "i", "u", "strong", "em", "strike",
  "code", "hr", "br", "div", "table", "thead", "tbody", "tr", "th", "td",
  "caption", "pre", "span", "img", "details", "summary",
];
const MATRIX_ALLOWED_ATTR = [
  "href", "target", "rel", "src", "alt", "title", "width", "height", "name",
  "start", "color", "class", "style",
  "data-mx-color", "data-mx-bg-color", "data-mx-spoiler",
];

function sanitizeHtml(html: string): string {
  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS: MATRIX_ALLOWED_TAGS,
    ALLOWED_ATTR: MATRIX_ALLOWED_ATTR,
    // Only permit safe URL schemes for href/src. mxc:// is intentionally not
    // resolvable here, so inline remote images in formatted bodies are dropped
    // rather than leaking a request to an arbitrary URL.
    ALLOWED_URI_REGEXP: /^(?:https?|mailto|tel):/i,
    FORBID_TAGS: ["script", "style", "iframe", "object", "embed", "form"],
    FORBID_ATTR: ["srcset"],
  });
}

// Force all sanitizer-approved links to open externally and without leaking the
// opener reference. Registered once at module load.
DOMPurify.addHook("afterSanitizeAttributes", (node) => {
  if (node.tagName === "A") {
    node.setAttribute("target", "_blank");
    node.setAttribute("rel", "noopener noreferrer");
  }
});

export default MessageBubble;
