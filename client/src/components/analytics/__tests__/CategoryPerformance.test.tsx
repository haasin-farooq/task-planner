import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import CategoryPerformance from "../CategoryPerformance";
import type { CategoryPerformanceStat } from "../../../types";

const sampleStats: CategoryPerformanceStat[] = [
  {
    category: "Development",
    avgEstimatedTime: 30,
    avgActualTime: 45,
    avgTimeOverrun: 15,
    sampleSize: 10,
  },
  {
    category: "Writing",
    avgEstimatedTime: 20,
    avgActualTime: 15,
    avgTimeOverrun: -5,
    sampleSize: 8,
  },
  {
    category: "Design",
    avgEstimatedTime: 25,
    avgActualTime: 28,
    avgTimeOverrun: 3,
    sampleSize: 2,
  },
];

describe("CategoryPerformance", () => {
  it("renders a semantic table with correct column headers", () => {
    render(
      <CategoryPerformance
        stats={sampleStats}
        consistentlyFaster={[]}
        consistentlySlower={[]}
      />,
    );

    expect(screen.getByRole("table")).toBeInTheDocument();
    expect(screen.getByText("Category")).toBeInTheDocument();
    expect(screen.getByText("Avg Estimated")).toBeInTheDocument();
    expect(screen.getByText("Avg Actual")).toBeInTheDocument();
    expect(screen.getByText("Avg Overrun")).toBeInTheDocument();
    expect(screen.getByText("Sample Size")).toBeInTheDocument();
  });

  it("renders all category rows", () => {
    render(
      <CategoryPerformance
        stats={sampleStats}
        consistentlyFaster={[]}
        consistentlySlower={[]}
      />,
    );

    expect(screen.getByText("Development")).toBeInTheDocument();
    expect(screen.getByText("Writing")).toBeInTheDocument();
    expect(screen.getByText("Design")).toBeInTheDocument();
  });

  it("sorts by avg overrun descending by default", () => {
    render(
      <CategoryPerformance
        stats={sampleStats}
        consistentlyFaster={[]}
        consistentlySlower={[]}
      />,
    );

    const rows = screen.getAllByRole("row");
    // Row 0 is header, rows 1-3 are data
    const firstDataRow = rows[1];
    const lastDataRow = rows[3];

    expect(within(firstDataRow).getByText("Development")).toBeInTheDocument();
    expect(within(lastDataRow).getByText("Writing")).toBeInTheDocument();
  });

  it("toggles sort direction when clicking the same column header", async () => {
    const user = userEvent.setup();
    render(
      <CategoryPerformance
        stats={sampleStats}
        consistentlyFaster={[]}
        consistentlySlower={[]}
      />,
    );

    // Click "Avg Overrun" to toggle from desc to asc
    await user.click(screen.getByText("Avg Overrun"));

    const rows = screen.getAllByRole("row");
    const firstDataRow = rows[1];
    expect(within(firstDataRow).getByText("Writing")).toBeInTheDocument();
  });

  it("sorts by a different column when clicking its header", async () => {
    const user = userEvent.setup();
    render(
      <CategoryPerformance
        stats={sampleStats}
        consistentlyFaster={[]}
        consistentlySlower={[]}
      />,
    );

    await user.click(screen.getByText("Category"));

    const rows = screen.getAllByRole("row");
    // Alphabetical ascending: Design, Development, Writing
    expect(within(rows[1]).getByText("Design")).toBeInTheDocument();
    expect(within(rows[2]).getByText("Development")).toBeInTheDocument();
    expect(within(rows[3]).getByText("Writing")).toBeInTheDocument();
  });

  it("shows insufficient-data indicator for categories with < 3 tasks", () => {
    render(
      <CategoryPerformance
        stats={sampleStats}
        consistentlyFaster={[]}
        consistentlySlower={[]}
      />,
    );

    // Design has sampleSize 2, should show warning
    expect(screen.getByText(/1 more needed/)).toBeInTheDocument();
  });

  it("does not show insufficient-data indicator for categories with >= 3 tasks", () => {
    const sufficientStats: CategoryPerformanceStat[] = [
      {
        category: "Development",
        avgEstimatedTime: 30,
        avgActualTime: 45,
        avgTimeOverrun: 15,
        sampleSize: 5,
      },
    ];

    render(
      <CategoryPerformance
        stats={sufficientStats}
        consistentlyFaster={[]}
        consistentlySlower={[]}
      />,
    );

    expect(screen.queryByText(/more needed/)).not.toBeInTheDocument();
  });

  it("formats time values in minutes", () => {
    render(
      <CategoryPerformance
        stats={sampleStats}
        consistentlyFaster={[]}
        consistentlySlower={[]}
      />,
    );

    expect(screen.getByText("30 min")).toBeInTheDocument();
    expect(screen.getByText("45 min")).toBeInTheDocument();
  });

  it("formats positive overrun with + prefix", () => {
    render(
      <CategoryPerformance
        stats={sampleStats}
        consistentlyFaster={[]}
        consistentlySlower={[]}
      />,
    );

    expect(screen.getByText("+15 min")).toBeInTheDocument();
  });

  it("renders Consistently Faster list", () => {
    render(
      <CategoryPerformance
        stats={sampleStats}
        consistentlyFaster={["Writing", "Admin"]}
        consistentlySlower={[]}
      />,
    );

    expect(screen.getByText("Consistently Faster")).toBeInTheDocument();
    const fasterSection = screen
      .getByText("Consistently Faster")
      .closest("div")!;
    expect(within(fasterSection).getByText("Writing")).toBeInTheDocument();
    expect(within(fasterSection).getByText("Admin")).toBeInTheDocument();
  });

  it("renders Consistently Slower list", () => {
    render(
      <CategoryPerformance
        stats={sampleStats}
        consistentlyFaster={[]}
        consistentlySlower={["Development"]}
      />,
    );

    expect(screen.getByText("Consistently Slower")).toBeInTheDocument();
    const slowerSection = screen
      .getByText("Consistently Slower")
      .closest("div")!;
    expect(within(slowerSection).getByText("Development")).toBeInTheDocument();
  });

  it("does not render faster/slower lists when both are empty", () => {
    render(
      <CategoryPerformance
        stats={sampleStats}
        consistentlyFaster={[]}
        consistentlySlower={[]}
      />,
    );

    expect(screen.queryByText("Consistently Faster")).not.toBeInTheDocument();
    expect(screen.queryByText("Consistently Slower")).not.toBeInTheDocument();
  });

  it("shows empty state when stats array is empty", () => {
    render(
      <CategoryPerformance
        stats={[]}
        consistentlyFaster={[]}
        consistentlySlower={[]}
      />,
    );

    expect(
      screen.getByText("No category data available yet."),
    ).toBeInTheDocument();
  });

  it("has an accessible section label", () => {
    render(
      <CategoryPerformance
        stats={sampleStats}
        consistentlyFaster={[]}
        consistentlySlower={[]}
      />,
    );

    expect(
      screen.getByRole("region", { name: "Category Performance" }),
    ).toBeInTheDocument();
  });

  it("sets aria-sort on the active sort column", () => {
    render(
      <CategoryPerformance
        stats={sampleStats}
        consistentlyFaster={[]}
        consistentlySlower={[]}
      />,
    );

    const overrunHeader = screen.getByText("Avg Overrun").closest("th")!;
    expect(overrunHeader).toHaveAttribute("aria-sort", "descending");

    const categoryHeader = screen.getByText("Category").closest("th")!;
    expect(categoryHeader).toHaveAttribute("aria-sort", "none");
  });
});
