import type { ReactNode } from "react";
import {
  ResponsiveContainer,
  BarChart as RechartsBarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  Cell,
} from "recharts";

export interface BarChartProps {
  data: { label: string; value: number; highlight?: boolean }[];
  ariaLabel: string;
  maxValue?: number;
  layout?: "horizontal" | "vertical";
}

/**
 * A thin wrapper around Recharts BarChart styled with the warm editorial
 * design system. Renders inside a ResponsiveContainer so it adapts to its
 * parent width automatically.
 *
 * Uses CSS variables for theme-aware colors.
 *
 * Requirements: 4.1, 10.2, 10.5, 11.1
 */
export default function BarChart({
  data,
  ariaLabel,
  maxValue,
  layout = "horizontal",
}: BarChartProps) {
  const isVertical = layout === "vertical";
  const height = isVertical ? Math.max(250, data.length * 40) : 250;

  // Recharts v3 Tooltip formatter has a complex intersection type.
  // We cast through `never` to satisfy both branches of the union.
  const tooltipFormatter = ((value: unknown): ReactNode =>
    String(Number(value))) as never;

  return (
    <div
      aria-label={ariaLabel}
      role="img"
      className="w-full rounded-lg border border-dark-border bg-dark-card p-4"
    >
      <ResponsiveContainer width="100%" height={height}>
        <RechartsBarChart
          data={data}
          layout={isVertical ? "vertical" : "horizontal"}
          margin={{ top: 8, right: 16, bottom: 4, left: isVertical ? 80 : 0 }}
        >
          {isVertical ? (
            <>
              <XAxis
                type="number"
                domain={maxValue != null ? [0, maxValue] : undefined}
                tick={{ fontSize: 12, fill: "var(--color-text-secondary)" }}
                tickLine={false}
                axisLine={{ stroke: "var(--color-border)" }}
              />
              <YAxis
                type="category"
                dataKey="label"
                tick={{ fontSize: 12, fill: "var(--color-text-secondary)" }}
                tickLine={false}
                axisLine={{ stroke: "var(--color-border)" }}
                width={75}
              />
            </>
          ) : (
            <>
              <XAxis
                dataKey="label"
                tick={{ fontSize: 12, fill: "var(--color-text-secondary)" }}
                tickLine={false}
                axisLine={{ stroke: "var(--color-border)" }}
              />
              <YAxis
                domain={maxValue != null ? [0, maxValue] : undefined}
                tick={{ fontSize: 12, fill: "var(--color-text-secondary)" }}
                tickLine={false}
                axisLine={{ stroke: "var(--color-border)" }}
              />
            </>
          )}

          <Tooltip
            formatter={tooltipFormatter}
            contentStyle={{
              backgroundColor: "var(--color-card)",
              border: "1px solid var(--color-border)",
              borderRadius: 8,
              fontSize: 13,
              color: "var(--color-text-primary)",
            }}
            labelStyle={{
              color: "var(--color-text-secondary)",
              fontWeight: 600,
            }}
            cursor={{ fill: "rgba(232, 228, 223, 0.15)" }}
          />

          <Bar dataKey="value" radius={[4, 4, 0, 0]}>
            {data.map((entry, index) => (
              <Cell
                key={`cell-${index}`}
                fill={entry.highlight ? "var(--color-accent)" : "#9C9590"}
              />
            ))}
          </Bar>
        </RechartsBarChart>
      </ResponsiveContainer>
    </div>
  );
}
