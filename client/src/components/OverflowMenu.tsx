import { useState, useRef, useEffect, useCallback } from "react";

export interface OverflowMenuProps {
  taskId: string;
  onMarkComplete?: (taskId: string) => void;
}

/**
 * Keyboard-accessible three-dot overflow menu with "Mark Complete" and "View Details" actions.
 *
 * - Opens with Enter/Space on the trigger button
 * - Closes with Escape key or outside click
 * - Uses aria-haspopup="menu" and aria-expanded for accessibility
 * - Styled with Tailwind dark theme classes
 *
 * Requirements: 5.9, 10.3
 */
export default function OverflowMenu({
  taskId,
  onMarkComplete,
}: OverflowMenuProps) {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const close = useCallback(() => {
    setIsOpen(false);
    triggerRef.current?.focus();
  }, []);

  // Close on outside click
  useEffect(() => {
    if (!isOpen) return;

    function handleClickOutside(event: MouseEvent) {
      if (
        containerRef.current &&
        !containerRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false);
      }
    }

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [isOpen]);

  // Close on Escape key
  useEffect(() => {
    if (!isOpen) return;

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        close();
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, close]);

  function handleToggle() {
    setIsOpen((prev) => !prev);
  }

  function handleMarkComplete() {
    onMarkComplete?.(taskId);
    setIsOpen(false);
  }

  function handleViewDetails() {
    // Placeholder action — no-op for now
    setIsOpen(false);
  }

  return (
    <div ref={containerRef} className="relative inline-block">
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={isOpen}
        onClick={handleToggle}
        className="flex h-8 w-8 items-center justify-center rounded text-gray-400 hover:bg-dark-border hover:text-white focus:outline-none focus:ring-2 focus:ring-accent"
      >
        ⋯
      </button>

      {isOpen && (
        <div
          role="menu"
          className="absolute right-0 z-10 mt-1 w-40 rounded-md border border-dark-border bg-dark-card py-1 shadow-lg"
        >
          <button
            role="menuitem"
            type="button"
            onClick={handleMarkComplete}
            className="block w-full px-4 py-2 text-left text-sm text-gray-200 hover:bg-dark-surface hover:text-white focus:bg-dark-surface focus:text-white focus:outline-none"
          >
            Mark Complete
          </button>
          <button
            role="menuitem"
            type="button"
            onClick={handleViewDetails}
            className="block w-full px-4 py-2 text-left text-sm text-gray-200 hover:bg-dark-surface hover:text-white focus:bg-dark-surface focus:text-white focus:outline-none"
          >
            View Details
          </button>
        </div>
      )}
    </div>
  );
}
