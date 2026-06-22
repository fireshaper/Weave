import React from "react";
import "./TypingIndicator.css";

interface TypingIndicatorProps {
  names: string[];
}

const TypingIndicator: React.FC<TypingIndicatorProps> = ({ names }) => {
  const text =
    names.length === 1
      ? `${names[0]} is typing`
      : names.length === 2
      ? `${names[0]} and ${names[1]} are typing`
      : names.length <= 4
      ? `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]} are typing`
      : "Several people are typing";

  return (
    <div className={`typing-indicator${names.length > 0 ? " typing-indicator--active" : ""}`} aria-live="polite">
      <div className="typing-indicator-inner">
        <div className="typing-dots">
          <span className="typing-dot" />
          <span className="typing-dot" />
          <span className="typing-dot" />
        </div>
        <span className="typing-text">{text}…</span>
      </div>
    </div>
  );
};

export default TypingIndicator;
