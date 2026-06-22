import React from "react";
import { useAuthedMedia } from "../hooks/useAuthedMedia";
import "./Avatar.css";

interface AvatarProps {
  name: string;
  avatarUrl?: string;
  /** @deprecated No longer used — media is resolved via the account's client.
   *  Kept for call-site compatibility. */
  homeserver?: string;
  /** Account whose token downloads the avatar. Defaults to the active account;
   *  pass explicitly when rendering another account's avatar (e.g. switcher). */
  accountId?: string;
  size?: number;
  className?: string;
}

const COLORS = [
  "#4f8ef7", "#a855f7", "#06b6d4", "#10b981", "#f59e0b",
  "#ef4444", "#ec4899", "#8b5cf6", "#14b8a6", "#f97316",
];

function getColor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  return COLORS[Math.abs(hash) % COLORS.length];
}

function getInitials(name: string): string {
  const clean = name.replace(/^@/, "").replace(/:.*/, "");
  const parts = clean.split(/\s+/);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }
  return clean.slice(0, 2).toUpperCase();
}

const Avatar: React.FC<AvatarProps> = ({ name, avatarUrl, accountId, size = 32, className = "" }) => {
  const color = getColor(name);
  const initials = getInitials(name);
  const borderRadius = "50%";

  // Download the thumbnail via the authenticated media endpoint. Request 2x the
  // display size for retina. Returns null while loading / on error → initials.
  const px = size * 2;
  const { url: resolvedUrl } = useAuthedMedia(
    avatarUrl,
    { type: "thumbnail", width: px, height: px, method: "crop" },
    accountId,
  );

  if (resolvedUrl) {
    return (
      <img
        src={resolvedUrl}
        alt={name}
        className={`avatar ${className}`}
        style={{ width: size, height: size, borderRadius }}
        onError={(e) => {
          // Fall back to initials on load error
          const el = e.currentTarget;
          el.style.display = "none";
          const fallback = el.nextElementSibling as HTMLElement | null;
          if (fallback) fallback.style.display = "flex";
        }}
      />
    );
  }

  return (
    <div
      className={`avatar avatar-initials ${className}`}
      style={{
        width: size,
        height: size,
        background: color,
        fontSize: size < 28 ? 10 : size < 40 ? 13 : 16,
        borderRadius,
      }}
      aria-label={name}
      title={name}
    >
      {initials}
    </div>
  );
};

export default Avatar;
