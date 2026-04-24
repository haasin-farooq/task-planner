import { useState, useCallback } from "react";
import { Outlet } from "react-router-dom";
import LeftSidebar from "./LeftSidebar";
import RightSidebar from "./RightSidebar";
import ThemeToggle from "./ThemeToggle";
import { useTaskData } from "../App";

/**
 * AppShell — root layout component replacing the old NavBar + <main> structure.
 *
 * Renders a three-panel warm-themed dashboard:
 *   LeftSidebar | MainContent (<Outlet />) | RightSidebar
 *
 * Manages mobile sidebar toggle state via a hamburger button.
 *
 * Responsive breakpoints:
 *   ≥1024px (lg): all three panels side by side
 *   768–1023px (md–lg): LeftSidebar + MainContent, RightSidebar hidden
 *   <768px: LeftSidebar as hamburger overlay, MainContent full width,
 *           RightSidebar content stacks below main content
 *
 * Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 9.1, 9.2, 9.3, 10.7
 */
export default function AppShell(): JSX.Element {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const { tasks, completedTaskIds, inProgressTaskIds } = useTaskData();

  const handleOpenSidebar = useCallback(() => {
    setSidebarOpen(true);
  }, []);

  const handleCloseSidebar = useCallback(() => {
    setSidebarOpen(false);
  }, []);

  return (
    <div className="flex flex-col md:flex-row h-screen w-full bg-dark-bg overflow-hidden">
      {/* Left sidebar navigation — hidden on mobile, visible at md+ as sticky sidebar */}
      <LeftSidebar isOpen={sidebarOpen} onClose={handleCloseSidebar} />

      {/* Scrollable content area: on mobile scrolls main + stacked right sidebar together */}
      <main className="flex-1 min-h-0 min-w-0 overflow-y-auto overflow-x-hidden pt-6 pb-6">
        {/* Mobile hamburger button — visible only below md breakpoint */}
        <div className="md:hidden flex items-center justify-between px-4 py-3 bg-dark-surface border-b border-dark-border">
          <button
            type="button"
            aria-label="Open navigation menu"
            onClick={handleOpenSidebar}
            className="p-2 rounded-lg text-text-secondary hover:text-text-primary hover:bg-dark-hover transition-colors"
          >
            <svg
              className="w-6 h-6"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M4 6h16M4 12h16M4 18h16"
              />
            </svg>
          </button>
          <ThemeToggle />
        </div>

        {/* Desktop theme toggle — top right of content area, hidden on mobile */}
        <div className="hidden md:flex justify-end px-6 -mb-4">
          <ThemeToggle />
        </div>

        <Outlet />

        {/* Mobile-only: RightSidebar content stacked below main content */}
        <div className="md:hidden">
          <RightSidebar
            tasks={tasks}
            completedTaskIds={completedTaskIds}
            inProgressTaskIds={inProgressTaskIds}
          />
        </div>
      </main>

      {/* Desktop right sidebar — visible only at lg (≥1024px) as a fixed-width column */}
      <div className="hidden lg:block shrink-0">
        <RightSidebar
          tasks={tasks}
          completedTaskIds={completedTaskIds}
          inProgressTaskIds={inProgressTaskIds}
        />
      </div>
    </div>
  );
}
