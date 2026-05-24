import React from "react";
import { CheckResult } from "../store";

interface StatusTicksProps {
  history: CheckResult[];
  limit?: number;
}

export const StatusTicks: React.FC<StatusTicksProps> = ({ history = [], limit = 24 }) => {
  // Pad the history on the left with empty/unknown check results if there are fewer than `limit` items
  const paddedHistory = [...history].reverse();
  while (paddedHistory.length < limit) {
    paddedHistory.unshift({
      id: `pad-${paddedHistory.length}`,
      site_id: "",
      checked_at: "",
      status: "UNKNOWN",
      status_code: null,
      response_time_ms: null,
      ssl_valid: null,
      ssl_expiry_date: null,
      ssl_days_remaining: null,
      error_message: null,
      redirect_url: null,
      domain_expiry_date: null,
      domain_days_remaining: null,
    });
  }

  // If history exceeds limit, slice the latest `limit` elements
  const items = paddedHistory.slice(-limit);

  return (
    <div className="flex items-center gap-1">
      {items.map((item, idx) => {
        let colorClass = "bg-zinc-800";
        if (item.status === "UP") colorClass = "bg-emerald-500 hover:bg-emerald-400";
        else if (item.status === "WARNING") colorClass = "bg-amber-500 hover:bg-amber-400";
        else if (item.status === "DOWN") colorClass = "bg-red-500 hover:bg-red-400";

        const formattedTime = item.checked_at
          ? new Date(item.checked_at).toLocaleTimeString([], {
              hour: "2-digit",
              minute: "2-digit",
            })
          : "N/A";

        const tooltipText =
          item.status === "UNKNOWN"
            ? "No data"
            : `${formattedTime} - ${item.status} (${
                item.response_time_ms ? `${item.response_time_ms}ms` : "N/A"
              })`;

        return (
          <div
            key={item.id || idx}
            className={`h-6 w-1.5 rounded-sm transition-all duration-200 cursor-pointer relative group ${colorClass}`}
          >
            {/* Tooltip */}
            <div className="absolute bottom-8 left-1/2 -translate-x-1/2 scale-0 group-hover:scale-100 transition-all duration-150 bg-neutral-900 border border-zinc-800 text-[10px] text-zinc-300 px-2 py-1 rounded shadow-lg whitespace-nowrap z-50 pointer-events-none">
              {tooltipText}
            </div>
          </div>
        );
      })}
    </div>
  );
};
