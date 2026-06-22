import { create } from "zustand";

interface LightboxState {
  /** Object/blob URL of the image currently shown full-screen, or null when closed. */
  src: string | null;
  /** Accessible label / alt text for the open image. */
  alt: string;
  open: (src: string, alt?: string) => void;
  close: () => void;
}

/**
 * Controls the single app-level <Lightbox /> overlay. Image renderers call
 * `open()` with their already-resolved object URL so the full-screen view reuses
 * the same decrypted/authenticated blob without re-downloading.
 */
export const useLightboxStore = create<LightboxState>((set) => ({
  src: null,
  alt: "Image",
  open: (src, alt = "Image") => set({ src, alt }),
  close: () => set({ src: null }),
}));
