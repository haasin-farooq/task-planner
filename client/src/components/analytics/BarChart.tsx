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

/** Warm editorial color tokens matching the project design system. */
const COLORS = {
  highlighted: "#E8734A", // accent orange
  normal: "#9C9590", // warm gray
  grid: "#E8E4DF", // dark-border
  axisText: "#6B6B6B",
  tooltipBg: "#FFFFFF",
  tooltipBorder: "#E8E4DF",
};

/**
 * A thin wrapper around Recharts BarChart styled with the warm editorial
 * design system. Renders inside a ResponsiveContainer so it adapts to its
 * parent width automatically.
 *
 * Bars are colored with the orange accent when `highlight` is true, or warm
 * gray otherwise. Supports both horizontal and vertical layouts.
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
      className="w-full rounded-lg border border-[#E8E4DF] bg-white p-4"
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
                tick={{ fontSize: 12, fill: COLORS.axisText }}
                tickLine={false}
                axisLine={{ stroke: COLORS.grid }}
              />
              <YAxis
                type="category"
                dataKey="label"
                tick={{ fontSize: 12, fill: COLORS.axisText }}
                tickLine={false}
                axisLine={{ stroke: COLORS.grid }}
                width={75}
              />
            </>
          ) : (
            <>
              <XAxis
                dataKey="label"
                tick={{ fontSize: 12, fill: COLORS.axisText }}
                tickLine={false}
                axisLine={{ stroke: COLORS.grid }}
              />
              <YAxis
                domain={maxValue != null ? [0, maxValue] : undefined}
                tick={{ fontSize: 12, fill: COLORS.axisText }}
                tickLine={false}
                axisLine={{ stroke: COLORS.grid }}
              />
            </>
          )}

          <Tooltip
            formatter={tooltipFormatter}
            contentStyle={{
              backgroundColor: COLORS.tooltipBg,
              border: `1px solid ${COLORS.tooltipBorder}`,
              borderRadius: 8,
              fontSize: 13,
            }}
            labelStyle={{ color: COLORS.axisText, fontWeight: 600 }}
            cursor={{ fill: "rgba(232, 228, 223, 0.3)" }}
          />

          <Bar dataKey="value" radius={[4, 4, 0, 0]}>
            {data.map((entry, index) => (
              <Cell
                key={`cell-${index}`}
                fill={entry.highlight ? COLORS.highlighted : COLORS.normal}
              />
            ))}
          </Bar>
        </RechartsBarChart>
      </ResponsiveContainer>
    </div>
  );
}
