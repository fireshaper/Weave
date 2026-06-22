import React from "react";
import { useAuthedMedia } from "../hooks/useAuthedMedia";
import { useLightboxStore } from "../store/lightboxStore";

/**
 * Plain (unencrypted) media renderers that download via the authenticated
 * media endpoint. Because an <img>/<video>/<audio>/<a> element cannot attach
 * an Authorization header, the bytes are fetched into an object URL first.
 *
 * Note: video/audio are served as fully-buffered blobs (no HTTP range/seek
 * support). Acceptable for typical chat attachments; large-file streaming would
 * require a service-worker-based auth shim.
 */

interface MediaProps {
  /** mxc:// URI (or http(s) URL). */
  url?: string;
  label: string;
  className?: string;
}

const Placeholder: React.FC<{ text: string }> = ({ text }) => (
  <span className="msg-body" style={{ color: "var(--text-muted)", fontStyle: "italic" }}>
    {text}
  </span>
);

export const AuthedImage: React.FC<MediaProps> = ({ url, label, className }) => {
  const { url: resolved, error } = useAuthedMedia(url, { type: "download" });
  const openLightbox = useLightboxStore((s) => s.open);
  if (error) return <Placeholder text={`🖼 ${label}`} />;
  if (!resolved) return <Placeholder text="Loading image…" />;
  return (
    <img
      src={resolved}
      alt={label}
      className={className}
      style={{ cursor: "zoom-in" }}
      onClick={() => openLightbox(resolved, label)}
    />
  );
};

export const AuthedVideo: React.FC<MediaProps> = ({ url, label, className }) => {
  const { url: resolved, error } = useAuthedMedia(url, { type: "download" });
  if (error) return <Placeholder text={`🎬 ${label}`} />;
  if (!resolved) return <Placeholder text="Loading video…" />;
  return (
    <video src={resolved} controls preload="metadata" className={className}>
      Your browser does not support the video tag.
    </video>
  );
};

export const AuthedAudio: React.FC<MediaProps> = ({ url, label, className }) => {
  const { url: resolved, error } = useAuthedMedia(url, { type: "download" });
  if (error) return <Placeholder text={`🎵 ${label}`} />;
  if (!resolved) return <Placeholder text="Loading audio…" />;
  return <audio src={resolved} controls preload="metadata" className={className} />;
};

export const AuthedFileLink: React.FC<MediaProps> = ({ url, label, className }) => {
  const { url: resolved, error } = useAuthedMedia(url, { type: "download" });
  if (error || !resolved) {
    return <span className={className}>{label}</span>;
  }
  return (
    <a href={resolved} download={label} target="_blank" rel="noreferrer" className={className}>
      {label}
    </a>
  );
};
