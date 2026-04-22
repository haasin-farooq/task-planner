import { useState, useCallback } from "react";
import { Outlet } from "react-router-dom";
import LeftSidebar from "./LeftSidebar";
import RightSidebar from "./RightSidebar";
import { useTaskData } from "../App";

/**
 * AppShell — root layout component replacing the old NavBar + <main> structure.
 *
 * Renders a three-panel dark-themed dashboard:
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
  const { tasks, completedTaskIds } = useTaskData();

  const handleOpenSidebar = useCallback(() => {
    setSidebarOpen(true);
  }, []);

  const handleCloseSidebar = useCallback(() => {
    setSidebarOpen(false);
  }, []);

  return (
    <div className="dark">
      <div className="flex flex-col md:flex-row h-screen w-screen bg-dark-bg overflow-hidden">
        {/* Left sidebar navigation — hidden on mobile, visible at md+ as sticky sidebar */}
        <LeftSidebar isOpen={sidebarOpen} onClose={handleCloseSidebar} />

        {/* Scrollable content area: on mobile scrolls main + stacked right sidebar together */}
        <main className="flex-1 overflow-y-auto">
          {/* Mobile hamburger button — visible only below md breakpoint */}
          <div className="md:hidden flex items-center px-4 py-3 bg-dark-surface border-b border-dark-border">
            <button
              type="button"
              aria-label="Open navigation menu"
              onClick={handleOpenSidebar}
              className="p-2 rounded-lg text-gray-400 hover:text-white hover:bg-dark-card transition-colors"
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
          </div>

          <Outlet />

          {/* Mobile-only: RightSidebar content stacked below main content */}
          <div className="md:hidden">
            <RightSidebar tasks={tasks} completedTaskIds={completedTaskIds} />
          </div>
        </main>

        {/* Desktop right sidebar — visible only at lg (≥1024px) as a fixed-width column */}
        <div className="hidden lg:block">
          <RightSidebar tasks={tasks} completedTaskIds={completedTaskIds} />
        </div>
      </div>
    </div>
  );
}
