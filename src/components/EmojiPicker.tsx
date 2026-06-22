import React, { useEffect, useRef } from "react";
import Picker, { Theme } from "emoji-picker-react";
import { useTheme } from "../contexts/ThemeContext";
import "./EmojiPicker.css";

interface EmojiPickerProps {
  onSelect: (emoji: string) => void;
  onClose: () => void;
}

const EmojiPicker: React.FC<EmojiPickerProps> = ({ onSelect, onClose }) => {
  const ref = useRef<HTMLDivElement>(null);
  const { theme } = useTheme(); // Assuming we have this to match light/dark

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
    <div className="emoji-picker-wrapper" ref={ref}>
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
