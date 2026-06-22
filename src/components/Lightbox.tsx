import React, { useEffect } from "react";
import { X } from "lucide-react";
import { useLightboxStore } from "../store/lightboxStore";
import "./Lightbox.css";

/**
 * Full-screen overlay for viewing an image at full size. Mounted once at the app
 * root and driven by `useLightboxStore`. Close via the backdrop, the close
 * button, or Escape.
 */
const Lightbox: React.FC = () => {
  const src = useLightboxStore((s) => s.src);
  const alt = useLightboxStore((s) => s.alt);
  const close = useLightboxStore((s) => s.close);

  useEffect(() => {
    if (!src) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [src, close]);

  if (!src) return null;

  return (
    <div className="lightbox-backdrop" onClick={close} role="dialog" aria-modal="true" aria-label={alt}>
      <button className="lightbox-close" onClick={close} aria-label="Close image">
        <X size={24} />
      </button>
      <img
        src={src}
        alt={alt}
        className="lightbox-image"
        // Don't let clicks on the image itself close the overlay.
        onClick={(e) => e.stopPropagation()}
      />
    </div>
  );
};

export default Lightbox;
