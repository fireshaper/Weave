import React, { useEffect, useRef, useState } from "react";
import ReactDOM from "react-dom";
import "./ContextMenu.css";

export interface ContextMenuItem {
  id: string;
  label: string;
  icon?: React.ReactNode;
  /** If true, renders a divider before this item */
  divider?: boolean;
  /** If true, renders in destructive (red) style */
  danger?: boolean;
  /** If true, item is greyed out and non-interactive */
  disabled?: boolean;
  onClick: () => void;
}

interface ContextMenuProps {
  x: number;
  y: number;
  items: ContextMenuItem[];
  onClose: () => void;
}

const MENU_WIDTH = 220;
const ITEM_HEIGHT = 36;
const PADDING = 8; // viewport edge padding

const ContextMenu: React.FC<ContextMenuProps> = ({ x, y, items, onClose }) => {
  const menuRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x, y });
  const [visible, setVisible] = useState(false);

  // Clamp position inside viewport on mount
  useEffect(() => {
    const totalItems = items.length;
    const dividers = items.filter((i) => i.divider).length;
    const estimatedHeight = totalItems * ITEM_HEIGHT + dividers * 9 + 16; // items + divider gaps + padding

    const vw = window.innerWidth;
    const vh = window.innerHeight;

    let cx = x;
    let cy = y;

    if (cx + MENU_WIDTH + PADDING > vw) cx = vw - MENU_WIDTH - PADDING;
    if (cx < PADDING) cx = PADDING;
    if (cy + estimatedHeight + PADDING > vh) cy = vh - estimatedHeight - PADDING;
    if (cy < PADDING) cy = PADDING;

    setPos({ x: cx, y: cy });
    // Trigger visible on next frame so the enter animation fires
    requestAnimationFrame(() => setVisible(true));
  }, [x, y, items]);

  // Close on outside click, Escape, or scroll
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    const handleScroll = () => onClose();
    const handleContextMenu = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        e.preventDefault();
        onClose();
      }
    };

    // Slight delay so the click that opened the menu doesn't immediately close it
    const t = setTimeout(() => {
      document.addEventListener("mousedown", handleClick);
      document.addEventListener("contextmenu", handleContextMenu);
    }, 50);

    document.addEventListener("keydown", handleKey);
    window.addEventListener("scroll", handleScroll, true);

    return () => {
      clearTimeout(t);
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("contextmenu", handleContextMenu);
      document.removeEventListener("keydown", handleKey);
      window.removeEventListener("scroll", handleScroll, true);
    };
  }, [onClose]);

  const handleItemClick = (item: ContextMenuItem) => {
    if (item.disabled) return;
    item.onClick();
    onClose();
  };

  return ReactDOM.createPortal(
    <div
      ref={menuRef}
      className={`ctx-menu ${visible ? "ctx-menu--visible" : ""}`}
      style={{ top: pos.y, left: pos.x }}
      role="menu"
      aria-label="Context menu"
    >
      {items.map((item) => (
        <React.Fragment key={item.id}>
          {item.divider && <div className="ctx-menu-divider" role="separator" />}
          <button
            className={`ctx-menu-item ${item.danger ? "ctx-menu-item--danger" : ""} ${item.disabled ? "ctx-menu-item--disabled" : ""}`}
            onClick={() => handleItemClick(item)}
            role="menuitem"
            disabled={item.disabled}
            tabIndex={item.disabled ? -1 : 0}
          >
            {item.icon && <span className="ctx-menu-item-icon">{item.icon}</span>}
            <span className="ctx-menu-item-label">{item.label}</span>
          </button>
        </React.Fragment>
      ))}
    </div>,
    document.body
  );
};

export default ContextMenu;
