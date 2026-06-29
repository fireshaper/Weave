import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import Picker, { Theme } from "emoji-picker-react";
import { useTheme } from "../contexts/ThemeContext";
import "./EmojiPicker.css";

// Must match the picker height in EmojiPicker.css (420px) plus the 8px gap.
const PICKER_HEIGHT = 420 + 8;

interface EmojiPickerProps {
  onSelect: (emoji: string) => void;
  onClose: () => void;
  /** Preferred side; auto-flips when there isn't room. Defaults to "top". */
  placement?: "top" | "bottom";
}

const EmojiPicker: React.FC<EmojiPickerProps> = ({ onSelect, onClose, placement = "top" }) => {
  const ref = useRef<HTMLDivElement>(null);
  const { theme } = useTheme(); // Assuming we have this to match light/dark

  // Resolve top/bottom from the trigger's position before paint to avoid a flash.
  const [resolvedPlacement, setResolvedPlacement] = useState<"top" | "bottom">(placement);
  useLayoutEffect(() => {
    // The wrapper is absolutely positioned inside the trigger's relative container,
    // so the parent's rect tells us where the button sits in the viewport.
    const anchor = ref.current?.parentElement;
    if (!anchor) return;
    const rect = anchor.getBoundingClientRect();
    const spaceBelow = window.innerHeight - rect.bottom;
    const spaceAbove = rect.top;
    let next = placement;
    if (placement === "bottom" && spaceBelow < PICKER_HEIGHT && spaceAbove > spaceBelow) {
      next = "top";
    } else if (placement === "top" && spaceAbove < PICKER_HEIGHT && spaceBelow > spaceAbove) {
      next = "bottom";
    }
    setResolvedPlacement(next);
  }, [placement]);

  // Close on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose();
      }
    };
    // Use capture so it fires before the hover toolbar disappears
    document.addEventListener("mousedown", handler, true);
    return () => document.removeEventListener("mousedown", handler, true);
  }, [onClose]);

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose]);

  return (
    <div className={`emoji-picker-wrapper emoji-picker-wrapper--${resolvedPlacement}`} ref={ref}>
      <Picker 
        onEmojiClick={(emojiData) => {
          onSelect(emojiData.emoji);
          onClose();
        }}
        theme={theme === 'dark' ? Theme.DARK : Theme.LIGHT}
        searchDisabled={false}
        skinTonesDisabled={true}
        autoFocusSearch={false}
      />
    </div>
  );
};

export default EmojiPicker;
