import type { ReactNode } from "react";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  CartesianGrid,
} from "recharts";

export interface TrendChartProps {
  data: { label: string; value: number; secondaryValue?: number }[];
  ariaLabel: string;
  height?: number;
  showSecondaryLine?: boolean;
  valueLabel?: string;
  secondaryLabel?: string;
  formatValue?: (value: number) => string;
}

/**
 * A thin wrapper around Recharts LineChart styled with the warm editorial
 * design system. Renders inside a ResponsiveContainer so it adapts to its
 * parent width automatically.
 *
 * Uses CSS variables for theme-aware colors.
 *
 * Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 10.2, 10.5, 11.1
 */
export default function TrendChart({
  data,
  ariaLabel,
  height = 250,
  showSecondaryLine = false,
  valueLabel = "Value",
  secondaryLabel = "Secondary",
  formatValue,
}: TrendChartProps) {
  const format = formatValue ?? ((v: number) => String(v));

  // Recharts v3 Tooltip formatter has a complex intersection type.
  // We cast through `never` to satisfy both branches of the union.
  const tooltipFormatter = ((value: unknown): ReactNode =>
    format(Number(value))) as never;

  return (
    <div
      aria-label={ariaLabel}
      role="img"
      className="w-full rounded-lg border border-dark-border bg-dark-card p-4"
    >
      <ResponsiveContainer width="100%" height={height}>
        <LineChart
          data={data}
          margin={{ top: 8, right: 16, bottom: 4, left: 0 }}
        >
          <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />

          <XAxis
            dataKey="label"
            tick={{ fontSize: 12, fill: "var(--color-text-secondary)" }}
            tickLine={false}
            axisLine={{ stroke: "var(--color-border)" }}
          />

          <YAxis
            tick={{ fontSize: 12, fill: "var(--color-text-secondary)" }}
            tickLine={false}
            axisLine={{ stroke: "var(--color-border)" }}
            tickFormatter={format}
          />

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
          />

          {showSecondaryLine && <Legend />}

          <Line
            type="monotone"
            dataKey="value"
            name={valueLabel}
            stroke="var(--color-accent)"
            strokeWidth={2}
            dot={{ r: 4, fill: "var(--color-accent)", strokeWidth: 0 }}
            activeDot={{ r: 6, fill: "var(--color-accent)", strokeWidth: 0 }}
          />

          {showSecondaryLine && (
            <Line
              type="monotone"
              dataKey="secondaryValue"
              name={secondaryLabel}
              stroke="#9C9590"
              strokeWidth={2}
              strokeDasharray="4 3"
              dot={{ r: 4, fill: "#9C9590", strokeWidth: 0 }}
              activeDot={{ r: 6, fill: "#9C9590", strokeWidth: 0 }}
            />
          )}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
