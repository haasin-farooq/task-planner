import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import axios from "axios";
import AnalyticsDashboard from "../AnalyticsDashboard";
import type { ExtendedAnalyticsSummary } from "../../types";

vi.mock("axios");
const mockedAxios = vi.mocked(axios, true);

// ---------------------------------------------------------------------------
// Test data factories
// ---------------------------------------------------------------------------

/** Minimal base AnalyticsSummary fields required by the interface */
const baseSummary: Pick<
  ExtendedAnalyticsSummary,
  | "dailyStats"
  | "difficultyBreakdown"
  | "performanceCategories"
  | "dailyProgressPercent"
  | "insufficientData"
> = {
  dailyStats: [],
  difficultyBreakdown: [],
  performanceCategories: [],
  dailyProgressPercent: 0,
  insufficientData: false,
};

/** Full ExtendedAnalyticsSummary with all optional sections populated */
function fullSummary(): ExtendedAnalyticsSummary {
  return {
    ...baseSummary,
    kpis: {
      totalCompleted: 25,
      completionRate: 85,
      avgEstimatedTime: 30,
      avgActualTime: 35,
      estimationAccuracy: 78,
      topImprovingCategory: "Writing",
      mostDelayedCategory: "Development",
    },
    weeklyTrends: [
      {
        weekStart: "2025-01-06",
        weekEnd: "2025-01-12",
        tasksCompleted: 5,
        totalActualTime: 150,
        avgActualTime: 30,
        avgEstimatedTime: 25,
        estimationAccuracy: 0.8,
        avgAbsolutePercentError: 20,
      },
      {
        weekStart: "2025-01-13",
        weekEnd: "2025-01-19",
        tasksCompleted: 7,
        totalActualTime: 210,
        avgActualTime: 30,
        avgEstimatedTime: 28,
        estimationAccuracy: 0.85,
        avgAbsolutePercentError: 15,
      },
    ],
    categoryPerformance: {
      stats: [
        {
          category: "Writing",
          avgEstimatedTime: 20,
          avgActualTime: 18,
          avgTimeOverrun: -2,
          sampleSize: 8,
        },
        {
          category: "Development",
          avgEstimatedTime: 45,
          avgActualTime: 55,
          avgTimeOverrun: 10,
          sampleSize: 12,
        },
      ],
      consistentlyFaster: ["Writing"],
      consistentlySlower: ["Development"],
    },
    insights: [
      {
        text: "You typically underestimate Development tasks by 22%.",
        magnitude: 22,
        type: "underestimation",
        category: "Development",
      },
      {
        text: "You are getting faster at Writing tasks.",
        magnitude: 15,
        type: "speed-improvement",
        category: "Writing",
      },
    ],
    estimationAccuracyTrend: {
      weeklyAccuracy: [
        {
          weekStart: "2025-01-06",
          weekEnd: "2025-01-12",
          tasksCompleted: 5,
          totalActualTime: 150,
          avgActualTime: 30,
          avgEstimatedTime: 25,
          estimationAccuracy: 0.75,
          avgAbsolutePercentError: 25,
        },
        {
          weekStart: "2025-01-13",
          weekEnd: "2025-01-19",
          tasksCompleted: 7,
          totalActualTime: 210,
          avgActualTime: 30,
          avgEstimatedTime: 28,
          estimationAccuracy: 0.85,
          avgAbsolutePercentError: 15,
        },
      ],
      trendLabel: "Improving",
    },
    difficultyCalibration: [
      {
        difficultyLevel: 1,
        avgEstimatedTime: 10,
        avgActualTime: 9,
        avgTimeOverrun: -1,
        taskCount: 5,
      },
      {
        difficultyLevel: 3,
        avgEstimatedTime: 30,
        avgActualTime: 38,
        avgTimeOverrun: 8,
        taskCount: 10,
      },
    ],
    recentChanges: {
      fasterCategories: [
        {
          category: "Writing",
          percentageChange: -15,
          recentAvgTime: 17,
          previousAvgTime: 20,
        },
      ],
      slowerCategories: [
        {
          category: "Development",
          percentageChange: 12,
          recentAvgTime: 56,
          previousAvgTime: 50,
        },
      ],
      largestOverruns: [
        {
          description: "Refactor auth module",
          estimatedTime: 30,
          actualTime: 75,
          overrunMinutes: 45,
        },
      ],
      limitedDataCategories: ["Design"],
    },
    dataStatus: {
      totalCompletedTasks: 25,
      weeksOfData: 4,
      daysOfData: 28,
    },
  };
}

/** Summary with only base fields — no optional extended sections */
function minimalSummary(): ExtendedAnalyticsSummary {
  return {
    ...baseSummary,
    dataStatus: {
      totalCompletedTasks: 0,
      weeksOfData: 0,
      daysOfData: 0,
    },
  };
}

/** Summary with low data counts to trigger low-data states */
function lowDataSummary(): ExtendedAnalyticsSummary {
  return {
    ...baseSummary,
    insufficientData: true,
    kpis: {
      totalCompleted: 2,
      completionRate: 50,
      avgEstimatedTime: 20,
      avgActualTime: 25,
      estimationAccuracy: 60,
      topImprovingCategory: null,
      mostDelayedCategory: null,
    },
    weeklyTrends: [
      {
        weekStart: "2025-01-06",
        weekEnd: "2025-01-12",
        tasksCompleted: 2,
        totalActualTime: 50,
        avgActualTime: 25,
        avgEstimatedTime: 20,
        estimationAccuracy: 0.6,
        avgAbsolutePercentError: 40,
      },
    ],
    insights: [],
    estimationAccuracyTrend: {
      weeklyAccuracy: [
        {
          weekStart: "2025-01-06",
          weekEnd: "2025-01-12",
          tasksCompleted: 2,
          totalActualTime: 50,
          avgActualTime: 25,
          avgEstimatedTime: 20,
          estimationAccuracy: 0.6,
          avgAbsolutePercentError: 40,
        },
      ],
      trendLabel: "Stable",
    },
    recentChanges: {
      fasterCategories: [],
      slowerCategories: [],
      largestOverruns: [],
      limitedDataCategories: [],
    },
    dataStatus: {
      totalCompletedTasks: 2,
      weeksOfData: 1,
      daysOfData: 7,
    },
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mockGet(data: ExtendedAnalyticsSummary) {
  mockedAxios.get.mockResolvedValueOnce({ data });
}

function mockGetError() {
  mockedAxios.get.mockRejectedValueOnce(new Error("Network error"));
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("AnalyticsDashboard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // -----------------------------------------------------------------------
  // All sections render when full data is provided
  // -----------------------------------------------------------------------
  describe("renders all sections with full data", () => {
    it("renders the dashboard heading and all section labels", async () => {
      mockGet(fullSummary());
      render(<AnalyticsDashboard userId="user-1" />);

      await waitFor(() => {
        expect(
          screen.getByRole("region", { name: "Analytics dashboard" }),
        ).toBeInTheDocument();
      });

      // Overview tab (default) — KPI Panel
      expect(
        screen.getByRole("region", { name: "Key Performance Indicators" }),
      ).toBeInTheDocument();

      // Time & Categories tab — Category Performance
      fireEvent.click(screen.getByText("Time & Categories"));
      expect(
        screen.getByRole("region", { name: "Category Performance" }),
      ).toBeInTheDocument();

      // Estimation tab — Estimation Accuracy, Difficulty Calibration
      fireEvent.click(screen.getByText("Estimation"));
      expect(
        screen.getByRole("region", { name: "Estimation Accuracy" }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("region", { name: "Difficulty Calibration" }),
      ).toBeInTheDocument();

      // Trends tab — Weekly Behavior Trends
      fireEvent.click(screen.getByText("Trends"));
      expect(
        screen.getByRole("region", { name: "Weekly Behavior Trends" }),
      ).toBeInTheDocument();

      // AI Learning tab — Behavioral Insights, Recent Behavioral Changes
      fireEvent.click(screen.getByText("AI Learning"));
      expect(
        screen.getByRole("region", { name: "Behavioral Insights" }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("region", { name: "Recent Behavioral Changes" }),
      ).toBeInTheDocument();
    });

    it("renders KPI values from the summary", async () => {
      mockGet(fullSummary());
      render(<AnalyticsDashboard userId="user-1" />);

      await waitFor(() => {
        expect(screen.getByText("25")).toBeInTheDocument();
      });

      expect(screen.getByText("85%")).toBeInTheDocument();
      expect(screen.getByText("78%")).toBeInTheDocument();
    });
  });

  // -----------------------------------------------------------------------
  // Sections hidden when optional data is absent (backward compatibility)
  // -----------------------------------------------------------------------
  describe("hides sections when optional data is absent", () => {
    it("does not render optional sections when data is missing", async () => {
      mockGet(minimalSummary());
      render(<AnalyticsDashboard userId="user-1" />);

      await waitFor(() => {
        expect(
          screen.getByRole("region", { name: "Analytics dashboard" }),
        ).toBeInTheDocument();
      });

      // Optional sections should not be present
      expect(
        screen.queryByRole("region", { name: "Weekly Behavior Trends" }),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByRole("region", { name: "Category Performance" }),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByRole("region", { name: "Behavioral Insights" }),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByRole("region", { name: "Estimation Accuracy" }),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByRole("region", { name: "Difficulty Calibration" }),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByRole("region", { name: "Recent Behavioral Changes" }),
      ).not.toBeInTheDocument();
    });

    it("renders the zero-completed welcome state when totalCompleted is 0", async () => {
      mockGet(minimalSummary());
      render(<AnalyticsDashboard userId="user-1" />);

      await waitFor(() => {
        expect(
          screen.getByText("Welcome to Your Analytics Dashboard"),
        ).toBeInTheDocument();
      });
    });

    it("renders the insufficient data banner when flagged", async () => {
      const summary = lowDataSummary();
      mockGet(summary);
      render(<AnalyticsDashboard userId="user-1" />);

      await waitFor(() => {
        expect(screen.getByTestId("insufficient-data")).toBeInTheDocument();
      });

      expect(screen.getByText(/Not enough data yet/)).toBeInTheDocument();
    });
  });

  // -----------------------------------------------------------------------
  // Low-data states render correctly for each section
  // -----------------------------------------------------------------------
  describe("low-data states", () => {
    it("shows KPI low-data state when totalCompleted < 5", async () => {
      mockGet(lowDataSummary());
      render(<AnalyticsDashboard userId="user-1" />);

      await waitFor(() => {
        expect(
          screen.getByRole("region", { name: "Key Performance Indicators" }),
        ).toBeInTheDocument();
      });

      // KPIPanel shows LowDataState when totalCompleted < 5
      expect(screen.getByText(/KPI Overview/i)).toBeInTheDocument();
    });

    it("shows Weekly Trends low-data state when weeksOfData < 2", async () => {
      mockGet(lowDataSummary());
      render(<AnalyticsDashboard userId="user-1" />);

      await waitFor(() => {
        expect(
          screen.getByRole("region", { name: "Analytics dashboard" }),
        ).toBeInTheDocument();
      });

      // Weekly Trends is on the "Trends" tab
      fireEvent.click(screen.getByText("Trends"));

      expect(
        screen.getByRole("region", { name: "Weekly Behavior Trends" }),
      ).toBeInTheDocument();

      // WeeklyTrends shows LowDataState when weeksOfData < 2
      expect(screen.getByText(/Weekly Trends/i)).toBeInTheDocument();
    });

    it("shows Insights low-data state when totalCompleted < 10", async () => {
      const summary = lowDataSummary();
      // Ensure insights section is present but with low data
      summary.insights = [];
      mockGet(summary);
      render(<AnalyticsDashboard userId="user-1" />);

      await waitFor(() => {
        expect(
          screen.getByRole("region", { name: "Analytics dashboard" }),
        ).toBeInTheDocument();
      });

      // Insights is on the "AI Learning" tab
      fireEvent.click(screen.getByText("AI Learning"));

      expect(
        screen.getByRole("region", { name: "Behavioral Insights" }),
      ).toBeInTheDocument();

      // InsightsPanel shows LowDataState when totalCompleted < 10
      expect(
        screen.getByText(/more to unlock behavioral insights/i),
      ).toBeInTheDocument();
    });

    it("shows Estimation Accuracy low-data state when weeksOfData < 2", async () => {
      mockGet(lowDataSummary());
      render(<AnalyticsDashboard userId="user-1" />);

      await waitFor(() => {
        expect(
          screen.getByRole("region", { name: "Analytics dashboard" }),
        ).toBeInTheDocument();
      });

      // Estimation Accuracy is on the "Estimation" tab
      fireEvent.click(screen.getByText("Estimation"));

      expect(
        screen.getByRole("region", { name: "Estimation Accuracy" }),
      ).toBeInTheDocument();
    });

    it("shows Recent Changes low-data state when daysOfData < 14", async () => {
      mockGet(lowDataSummary());
      render(<AnalyticsDashboard userId="user-1" />);

      await waitFor(() => {
        expect(
          screen.getByRole("region", { name: "Analytics dashboard" }),
        ).toBeInTheDocument();
      });

      // Recent Changes is on the "AI Learning" tab
      fireEvent.click(screen.getByText("AI Learning"));

      expect(
        screen.getByRole("region", { name: "Recent Behavioral Changes" }),
      ).toBeInTheDocument();
    });
  });

  // -----------------------------------------------------------------------
  // Date range selector updates trigger re-fetch
  // -----------------------------------------------------------------------
  describe("date range selector", () => {
    it("renders start and end date inputs", async () => {
      mockGet(fullSummary());
      render(<AnalyticsDashboard userId="user-1" />);

      await waitFor(() => {
        expect(screen.getByLabelText("Start date")).toBeInTheDocument();
      });

      expect(screen.getByLabelText("End date")).toBeInTheDocument();
    });

    it("re-fetches analytics when start date changes", async () => {
      mockGet(fullSummary());
      render(<AnalyticsDashboard userId="user-1" />);

      await waitFor(() => {
        expect(mockedAxios.get).toHaveBeenCalledTimes(1);
      });

      // Change start date atomically — triggers a single new fetch
      mockGet(fullSummary());
      const startInput = screen.getByLabelText("Start date");
      fireEvent.change(startInput, { target: { value: "2025-01-01" } });

      await waitFor(() => {
        expect(mockedAxios.get).toHaveBeenCalledTimes(2);
      });
    });

    it("re-fetches analytics when end date changes", async () => {
      mockGet(fullSummary());
      render(<AnalyticsDashboard userId="user-1" />);

      await waitFor(() => {
        expect(mockedAxios.get).toHaveBeenCalledTimes(1);
      });

      // Change end date atomically — triggers a single new fetch
      mockGet(fullSummary());
      const endInput = screen.getByLabelText("End date");
      fireEvent.change(endInput, { target: { value: "2025-02-01" } });

      await waitFor(() => {
        expect(mockedAxios.get).toHaveBeenCalledTimes(2);
      });
    });
  });

  // -----------------------------------------------------------------------
  // Accessibility: aria-labels present, semantic HTML used
  // -----------------------------------------------------------------------
  describe("accessibility", () => {
    it("has an aria-label on the main dashboard section", async () => {
      mockGet(fullSummary());
      render(<AnalyticsDashboard userId="user-1" />);

      await waitFor(() => {
        expect(
          screen.getByRole("region", { name: "Analytics dashboard" }),
        ).toBeInTheDocument();
      });
    });

    it("uses a fieldset with legend for the date range selector", async () => {
      mockGet(fullSummary());
      render(<AnalyticsDashboard userId="user-1" />);

      await waitFor(() => {
        expect(screen.getByText("Date Range")).toBeInTheDocument();
      });

      // The date range selector uses a <fieldset> with <legend>
      const fieldset = screen.getByRole("group");
      expect(fieldset).toBeInTheDocument();
    });

    it("uses semantic heading for the dashboard title", async () => {
      mockGet(fullSummary());
      render(<AnalyticsDashboard userId="user-1" />);

      await waitFor(() => {
        expect(
          screen.getByRole("heading", { name: "Analytics Dashboard" }),
        ).toBeInTheDocument();
      });
    });

    it("has aria-labels on date inputs", async () => {
      mockGet(fullSummary());
      render(<AnalyticsDashboard userId="user-1" />);

      await waitFor(() => {
        expect(screen.getByLabelText("Start date")).toBeInTheDocument();
      });

      expect(screen.getByLabelText("End date")).toBeInTheDocument();
    });

    it("shows loading state with aria-live", async () => {
      // Don't resolve the mock immediately
      mockedAxios.get.mockReturnValueOnce(new Promise(() => {}));
      render(<AnalyticsDashboard userId="user-1" />);

      expect(screen.getByText("Loading analytics…")).toBeInTheDocument();
      expect(screen.getByText("Loading analytics…")).toHaveAttribute(
        "aria-live",
        "polite",
      );
    });

    it("shows error state with role=alert", async () => {
      mockGetError();
      render(<AnalyticsDashboard userId="user-1" />);

      await waitFor(() => {
        expect(
          screen.getByText("Failed to load analytics. Please try again."),
        ).toBeInTheDocument();
      });

      expect(screen.getByRole("alert")).toBeInTheDocument();
    });
  });

  // -----------------------------------------------------------------------
  // Fetch behavior
  // -----------------------------------------------------------------------
  describe("fetch behavior", () => {
    it("fetches analytics on mount with the userId", async () => {
      mockGet(fullSummary());
      render(<AnalyticsDashboard userId="user-42" />);

      await waitFor(() => {
        expect(mockedAxios.get).toHaveBeenCalledTimes(1);
      });

      const [url] = mockedAxios.get.mock.calls[0];
      expect(url).toBe("/api/analytics/user-42");
    });

    it("passes startDate and endDate as query params", async () => {
      mockGet(fullSummary());
      render(<AnalyticsDashboard userId="user-1" />);

      await waitFor(() => {
        expect(mockedAxios.get).toHaveBeenCalledTimes(1);
      });

      const [, config] = mockedAxios.get.mock.calls[0];
      expect(config).toHaveProperty("params");
      expect(config!.params).toHaveProperty("startDate");
      expect(config!.params).toHaveProperty("endDate");
    });
  });
});
