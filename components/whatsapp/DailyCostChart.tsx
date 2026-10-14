"use client";

import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { useTheme } from "@/components/ThemeProvider";
import { formatUsd } from "@/lib/ai/models";

export interface DailyPoint {
  date: string; // YYYY-MM-DD
  cost: number;
  replies: number;
}

function shortDate(value: string) {
  return new Date(value + "T00:00:00").toLocaleDateString("es-CO", { day: "2-digit", month: "short" });
}

/** Costo diario de IA (una sola serie: no lleva leyenda, el título la nombra). */
export function DailyCostChart({ data }: { data: DailyPoint[] }) {
  const { theme } = useTheme();
  const dark = theme === "dark";
  const barColor = dark ? "#F08421" : "#C2610F"; // naranja más oscuro en claro: contraste ≥ 3:1
  const axisColor = dark ? "rgba(255,252,224,0.4)" : "rgba(23,16,11,0.45)";
  const gridColor = dark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.08)";
  const tooltipBg = dark ? "#17100B" : "#FFFCE0";
  const tooltipBorder = dark ? "rgba(255,255,255,0.1)" : "rgba(0,0,0,0.1)";
  const tooltipText = dark ? "#FFFCE0" : "#17100B";

  return (
    <ResponsiveContainer width="100%" height={240}>
      <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }} barCategoryGap={2}>
        <CartesianGrid vertical={false} stroke={gridColor} />
        <XAxis
          dataKey="date"
          tickFormatter={shortDate}
          stroke={axisColor}
          fontSize={11}
          tickLine={false}
          minTickGap={24}
        />
        <YAxis
          stroke={axisColor}
          fontSize={11}
          tickLine={false}
          axisLine={false}
          width={48}
          tickFormatter={(v: number) => `$${v < 1 ? v.toFixed(2) : v.toFixed(0)}`}
        />
        <Tooltip
          cursor={{ fill: dark ? "rgba(255,255,255,0.05)" : "rgba(0,0,0,0.05)" }}
          contentStyle={{ background: tooltipBg, border: `1px solid ${tooltipBorder}`, borderRadius: 8 }}
          labelStyle={{ color: tooltipText }}
          itemStyle={{ color: tooltipText }}
          labelFormatter={(v) => shortDate(String(v))}
          formatter={(value, _name, item) => [
            `${formatUsd(Number(value), 4)} · ${(item.payload as DailyPoint).replies} respuestas`,
            "Costo",
          ]}
        />
        <Bar dataKey="cost" fill={barColor} radius={[4, 4, 0, 0]} maxBarSize={28} />
      </BarChart>
    </ResponsiveContainer>
  );
}
