"use client";

import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import { useTranslations } from "next-intl";

interface PriceDataPoint {
  date: string;
  price: number;
  storeName?: string;
}

interface PriceChartProps {
  data: PriceDataPoint[];
  showStores?: boolean;
}

export function PriceChart({ data, showStores = false }: PriceChartProps) {
  const t = useTranslations("prices.chart");

  // Group data by date for single line or by store for multiple lines
  type ChartDataPoint = { date: string; [key: string]: string | number };
  const chartData: ChartDataPoint[] = showStores
    ? Object.values(
        data.reduce((acc: Record<string, ChartDataPoint>, item) => {
          const date = new Date(item.date).toLocaleDateString();
          if (!acc[date]) {
            acc[date] = { date };
          }
          acc[date][item.storeName || "Unknown"] = item.price;
          return acc;
        }, {})
      )
    : data.map((item) => ({
        date: new Date(item.date).toLocaleDateString(),
        price: item.price,
      }));

  // Get unique store names for multi-line chart
  const storeNames = showStores
    ? [...new Set(data.map((item) => item.storeName || "Unknown"))]
    : [];

  // Categorical series colours. The design system has no series scale — its
  // tokens name surfaces and states, not "store 3" — so the first series uses
  // the gauge token and the rest are fixed hues chosen to stay legible on both
  // the light and the dark card. Adding a scale is a separate piece of work.
  const colors = [
    "var(--gauge)",
    "#c2410c",
    "#7e22ce",
    "#0e7490",
    "#a16207",
  ];

  return (
    <div className="h-80 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={chartData}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
          <XAxis
            dataKey="date"
            tick={{ fontSize: 12, fill: "var(--muted-foreground)" }}
            stroke="var(--border)"
          />
          <YAxis
            tick={{ fontSize: 12, fill: "var(--muted-foreground)" }}
            stroke="var(--border)"
            tickFormatter={(value) => `€${value.toFixed(2)}`}
          />
          <Tooltip
            formatter={(value: number) => [`€${value.toFixed(2)}`, t("yAxis")]}
            labelFormatter={(label) => label}
          />
          {showStores ? (
            storeNames.map((storeName, index) => (
              <Line
                key={storeName}
                type="monotone"
                dataKey={storeName}
                stroke={colors[index % colors.length]}
                strokeWidth={2}
                dot={{ r: 4 }}
                activeDot={{ r: 6 }}
              />
            ))
          ) : (
            <Line
              type="monotone"
              dataKey="price"
              stroke="var(--gauge)"
              strokeWidth={2}
              dot={{ r: 4 }}
              activeDot={{ r: 6 }}
            />
          )}
          {showStores && <Legend />}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
