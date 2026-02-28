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

  const colors = ["#2563eb", "#dc2626", "#16a34a", "#9333ea", "#ea580c"];

  return (
    <div className="h-80 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={chartData}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
          <XAxis
            dataKey="date"
            tick={{ fontSize: 12 }}
            stroke="#6b7280"
          />
          <YAxis
            tick={{ fontSize: 12 }}
            stroke="#6b7280"
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
              stroke="#2563eb"
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
