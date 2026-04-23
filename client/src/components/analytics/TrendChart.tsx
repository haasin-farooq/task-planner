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

/** Warm editorial color tokens matching the project design system. */
const COLORS = {
  primary: "#E8734A", // accent orange
  secondary: "#9C9590", // warm gray
  grid: "#E8E4DF", // dark-border
  axisText: "#6B6B6B",
  tooltipBg: "#FFFFFF",
  tooltipBorder: "#E8E4DF",
};

/**
 * A thin wrapper around Recharts LineChart styled with the warm editorial
 * design system. Renders inside a ResponsiveContainer so it adapts to its
 * parent width automatically.
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
      className="w-full rounded-lg border border-[#E8E4DF] bg-white p-4"
    >
      <ResponsiveContainer width="100%" height={height}>
        <LineChart
          data={data}
          margin={{ top: 8, right: 16, bottom: 4, left: 0 }}
        >
          <CartesianGrid strokeDasharray="3 3" stroke={COLORS.grid} />

          <XAxis
            dataKey="label"
            tick={{ fontSize: 12, fill: COLORS.axisText }}
            tickLine={false}
            axisLine={{ stroke: COLORS.grid }}
          />

          <YAxis
            tick={{ fontSize: 12, fill: COLORS.axisText }}
            tickLine={false}
            axisLine={{ stroke: COLORS.grid }}
            tickFormatter={format}
          />

          <Tooltip
            formatter={tooltipFormatter}
            contentStyle={{
              backgroundColor: COLORS.tooltipBg,
              border: `1px solid ${COLORS.tooltipBorder}`,
              borderRadius: 8,
              fontSize: 13,
            }}
            labelStyle={{ color: COLORS.axisText, fontWeight: 600 }}
          />

          {showSecondaryLine && <Legend />}

          <Line
            type="monotone"
            dataKey="value"
            name={valueLabel}
            stroke={COLORS.primary}
            strokeWidth={2}
            dot={{ r: 4, fill: COLORS.primary, strokeWidth: 0 }}
            activeDot={{ r: 6, fill: COLORS.primary, strokeWidth: 0 }}
          />

          {showSecondaryLine && (
            <Line
              type="monotone"
              dataKey="secondaryValue"
              name={secondaryLabel}
              stroke={COLORS.secondary}
              strokeWidth={2}
              strokeDasharray="4 3"
              dot={{ r: 4, fill: COLORS.secondary, strokeWidth: 0 }}
              activeDot={{ r: 6, fill: COLORS.secondary, strokeWidth: 0 }}
            />
          )}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
