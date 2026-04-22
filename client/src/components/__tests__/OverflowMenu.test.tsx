import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi } from "vitest";
import OverflowMenu from "../OverflowMenu";

describe("OverflowMenu", () => {
  it("renders a trigger button with correct aria attributes", () => {
    render(<OverflowMenu taskId="task-1" />);
    const trigger = screen.getByRole("button", { name: /⋯/ });
    expect(trigger).toHaveAttribute("aria-haspopup", "menu");
    expect(trigger).toHaveAttribute("aria-expanded", "false");
  });

  it("opens the menu on click and sets aria-expanded to true", async () => {
    const user = userEvent.setup();
    render(<OverflowMenu taskId="task-1" />);

    const trigger = screen.getByRole("button", { name: /⋯/ });
    await user.click(trigger);

    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("menu")).toBeInTheDocument();
    expect(
      screen.getByRole("menuitem", { name: "Mark Complete" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("menuitem", { name: "View Details" }),
    ).toBeInTheDocument();
  });

  it("closes the menu on Escape key", async () => {
    const user = userEvent.setup();
    render(<OverflowMenu taskId="task-1" />);

    await user.click(screen.getByRole("button", { name: /⋯/ }));
    expect(screen.getByRole("menu")).toBeInTheDocument();

    await user.keyboard("{Escape}");
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("closes the menu on outside click", async () => {
    const user = userEvent.setup();
    render(
      <div>
        <span data-testid="outside">outside</span>
        <OverflowMenu taskId="task-1" />
      </div>,
    );

    await user.click(screen.getByRole("button", { name: /⋯/ }));
    expect(screen.getByRole("menu")).toBeInTheDocument();

    await user.click(screen.getByTestId("outside"));
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("calls onMarkComplete with taskId when Mark Complete is clicked", async () => {
    const user = userEvent.setup();
    const onMarkComplete = vi.fn();
    render(<OverflowMenu taskId="task-42" onMarkComplete={onMarkComplete} />);

    await user.click(screen.getByRole("button", { name: /⋯/ }));
    await user.click(screen.getByRole("menuitem", { name: "Mark Complete" }));

    expect(onMarkComplete).toHaveBeenCalledWith("task-42");
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("closes the menu when View Details is clicked", async () => {
    const user = userEvent.setup();
    render(<OverflowMenu taskId="task-1" />);

    await user.click(screen.getByRole("button", { name: /⋯/ }));
    await user.click(screen.getByRole("menuitem", { name: "View Details" }));

    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("toggles the menu open and closed on repeated clicks", async () => {
    const user = userEvent.setup();
    render(<OverflowMenu taskId="task-1" />);

    const trigger = screen.getByRole("button", { name: /⋯/ });

    await user.click(trigger);
    expect(screen.getByRole("menu")).toBeInTheDocument();

    await user.click(trigger);
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });
});
