import React from "react";
import "./DateSeparator.css";

interface DateSeparatorProps {
  timestamp: number;
}

const DateSeparator: React.FC<DateSeparatorProps> = ({ timestamp }) => {
  const label = formatDateLabel(timestamp);
  return (
    <div className="date-separator">
      <span className="date-separator-line" />
      <span className="date-separator-label">{label}</span>
      <span className="date-separator-line" />
    </div>
  );
};

function formatDateLabel(ts: number): string {
  const d = new Date(ts);
  const now = new Date();
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);

  if (isSameDay(d, now)) return "Today";
  if (isSameDay(d, yesterday)) return "Yesterday";
  return d.toLocaleDateString([], { weekday: "long", month: "long", day: "numeric", year: d.getFullYear() !== now.getFullYear() ? "numeric" : undefined });
}

function isSameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate();
}

export default DateSeparator;
