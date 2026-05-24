import React, { useState, useEffect } from "react";
import { useStore } from "../store";
import { StatusTicks } from "./StatusTicks";
import {
  Activity,
  Plus,
  RefreshCw,
  Settings as SettingsIcon,
  Shield,
  ShieldAlert,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  Clock,
  Globe,
} from "lucide-react";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";

export const StatusPopover: React.FC = () => {
  const { sites, loadSites, triggerCheck, histories } = useStore();
  const [expandedSiteId, setExpandedSiteId] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    loadSites();
  }, []);

  const handleRefreshAll = async () => {
    setRefreshing(true);
    // Reload from db
    await loadSites();
    // Fire checks for all enabled sites
    const promises = sites
      .filter((s) => s.enabled)
      .map((s) => triggerCheck(s.id));
    await Promise.all(promises);
    setRefreshing(false);
  };

  const openDashboardWindow = async (route: string) => {
    try {
      const mainWin = await WebviewWindow.getByLabel("main");
      if (mainWin) {
        await mainWin.emit("navigate", route);
        await mainWin.show();
        await mainWin.setFocus();
      }
    } catch (e) {
      console.error("Error showing main window:", e);
    }
    
    try {
      const { getCurrentWindow } = await import("@tauri-apps/api/window");
      await getCurrentWindow().hide();
    } catch (e) {
      console.error("Error hiding popover window:", e);
    }
  };

  // Helper to format last checked string
  const formatLastChecked = (timeStr?: string) => {
    if (!timeStr) return "Never";
    const date = new Date(timeStr);
    const diffMs = Date.now() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    
    if (diffMins < 1) return "Just now";
    if (diffMins === 1) return "1 min ago";
    if (diffMins < 60) return `${diffMins} min ago`;
    return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  };

  // Stats calculation
  const totalCount = sites.filter((s) => s.enabled).length;
  const upCount = sites.filter((s) => s.enabled && s.latest_result?.status === "UP").length;
  const warningCount = sites.filter((s) => s.enabled && s.latest_result?.status === "WARNING").length;
  const downCount = sites.filter((s) => s.enabled && s.latest_result?.status === "DOWN").length;

  return (
    <div className="w-full h-screen bg-neutral-950 text-zinc-100 flex flex-col font-sans select-none border border-zinc-800 rounded-lg overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3 bg-neutral-900 border-b border-zinc-800 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-2">
          <div className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse"></div>
          <span className="text-sm font-bold tracking-tight text-zinc-100">SiteWatcher</span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleRefreshAll}
            disabled={refreshing}
            className={`p-1.5 rounded-md text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200 transition ${
              refreshing ? "animate-spin" : ""
            }`}
          >
            <RefreshCw size={14} />
          </button>
          <button
            onClick={() => openDashboardWindow("settings")}
            className="p-1.5 rounded-md text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200 transition"
          >
            <SettingsIcon size={14} />
          </button>
        </div>
      </div>

      {/* Sites List */}
      <div className="flex-1 overflow-y-auto p-2 space-y-1.5">
        {sites.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-48 text-center px-4">
            <Activity className="text-zinc-600 mb-2" size={28} />
            <p className="text-xs text-zinc-400 font-medium">No sites monitored yet.</p>
            <button
              onClick={() => openDashboardWindow("add_site")}
              className="mt-3 px-3 py-1.5 bg-zinc-100 hover:bg-zinc-200 text-neutral-900 rounded-md text-xs font-bold transition flex items-center gap-1 cursor-pointer"
            >
              <Plus size={14} />
              Add Your First Site
            </button>
          </div>
        ) : (
          sites.map((site) => {
            const isExpanded = expandedSiteId === site.id;
            const res = site.latest_result;
            const status = res?.status || "UNKNOWN";
            const history = histories[site.id] || [];

            let badgeColor = "bg-zinc-800/40 border-zinc-700 text-zinc-400";
            if (status === "UP") badgeColor = "bg-emerald-950/20 border-emerald-800/40 text-emerald-400";
            else if (status === "WARNING") badgeColor = "bg-amber-950/20 border-amber-800/40 text-amber-400";
            else if (status === "DOWN") badgeColor = "bg-red-950/20 border-red-800/40 text-red-400";

            return (
              <div
                key={site.id}
                className={`border rounded-lg transition-all ${
                  isExpanded
                    ? "bg-zinc-900/40 border-zinc-800 shadow-md"
                    : "bg-zinc-900/20 border-zinc-900 hover:border-zinc-800"
                }`}
              >
                {/* Site Header Row */}
                <div
                  onClick={() => setExpandedSiteId(isExpanded ? null : site.id)}
                  className="px-3 py-2.5 flex items-center justify-between cursor-pointer gap-2"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    {/* Favicon or fallback */}
                    <div className="w-5 h-5 rounded bg-zinc-800 flex items-center justify-center font-bold text-[10px] text-zinc-400 shrink-0 uppercase">
                      {site.name.slice(0, 2)}
                    </div>
                    <div className="min-w-0">
                      <div className="text-xs font-semibold text-zinc-200 truncate leading-tight">
                        {site.name}
                      </div>
                      <div className="text-[10px] text-zinc-500 truncate mt-0.5 max-w-[160px]">
                        {site.url.replace("https://", "").replace("http://", "")}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <span className={`px-1.5 py-0.5 text-[9px] font-bold border rounded ${badgeColor}`}>
                      {status}
                    </span>
                    {isExpanded ? <ChevronUp size={14} className="text-zinc-500" /> : <ChevronDown size={14} className="text-zinc-500" />}
                  </div>
                </div>

                {/* Expanded Details */}
                {isExpanded && (
                  <div className="px-3 pb-3 pt-1 border-t border-zinc-800/40 text-[11px] space-y-2 text-zinc-400">
                    {/* Metrics Row */}
                    <div className="grid grid-cols-3 gap-2 py-1">
                      <div className="bg-zinc-950/50 p-1.5 rounded border border-zinc-900">
                        <div className="text-[9px] text-zinc-500 uppercase tracking-wider font-semibold">
                          Response Time
                        </div>
                        <div className="text-xs font-bold text-zinc-200 mt-0.5">
                          {res?.response_time_ms ? `${res.response_time_ms} ms` : "N/A"}
                        </div>
                      </div>

                      <div className="bg-zinc-950/50 p-1.5 rounded border border-zinc-900">
                        <div className="text-[9px] text-zinc-500 uppercase tracking-wider font-semibold">
                          HTTP Status
                        </div>
                        <div className="text-xs font-bold text-zinc-200 mt-0.5">
                          {res?.status_code || "N/A"}
                        </div>
                      </div>

                      <div className="bg-zinc-950/50 p-1.5 rounded border border-zinc-900 flex items-center justify-between">
                        <div>
                          <div className="text-[9px] text-zinc-500 uppercase tracking-wider font-semibold">
                            SSL Cert
                          </div>
                          <div className="text-xs font-bold text-zinc-200 mt-0.5">
                            {res?.ssl_days_remaining !== null && res?.ssl_days_remaining !== undefined
                              ? `${res.ssl_days_remaining}d`
                              : "N/A"}
                          </div>
                        </div>
                        {site.ssl_check && res?.ssl_valid ? (
                          <Shield size={14} className="text-emerald-500 shrink-0" />
                        ) : site.ssl_check && res?.ssl_valid === false ? (
                          <ShieldAlert size={14} className="text-red-500 shrink-0" />
                        ) : null}
                      </div>
                    </div>

                    {/* Sparkline History */}
                    <div className="space-y-1">
                      <div className="flex items-center justify-between text-[9px] text-zinc-500">
                        <span>Status Ticks (Last 24h)</span>
                        <div className="flex items-center gap-1">
                          <Clock size={10} />
                          <span>Last checked {formatLastChecked(res?.checked_at)}</span>
                        </div>
                      </div>
                      <div className="bg-zinc-950/40 p-2 rounded border border-zinc-900 flex justify-center">
                        <StatusTicks history={history} limit={24} />
                      </div>
                    </div>

                    {/* Domain Expiry details if present */}
                    {res?.domain_expiry_date && (
                      <div className="p-2 bg-zinc-950/30 rounded border border-zinc-900 flex justify-between items-center text-[10px]">
                        <div className="flex items-center gap-1 text-zinc-500">
                          <Globe size={11} className="text-zinc-650 shrink-0" />
                          <span>Domain Expires</span>
                        </div>
                        <span className={`font-medium ${
                          res.domain_days_remaining !== null && res.domain_days_remaining <= 30
                            ? "text-amber-400 font-bold"
                            : "text-zinc-350"
                        }`}>
                          {new Date(res.domain_expiry_date).toLocaleDateString()} ({res.domain_days_remaining}d remaining)
                        </span>
                      </div>
                    )}

                    {/* Redirect Chain / Error messages */}
                    {res?.redirect_url && (
                      <div className="p-2 bg-zinc-950/50 rounded border border-zinc-900 flex items-start gap-1">
                        <ExternalLink size={12} className="shrink-0 mt-0.5 text-zinc-500" />
                        <span className="text-[10px] break-all leading-relaxed">
                          Redirected to: <span className="text-zinc-300 font-semibold">{res.redirect_url}</span>
                        </span>
                      </div>
                    )}

                    {res?.error_message && (
                      <div className="p-2 bg-red-950/10 rounded border border-red-900/20 text-red-300 text-[10px] leading-relaxed break-words font-mono">
                        {res.error_message}
                      </div>
                    )}

                    {/* Site Actions */}
                    <div className="flex gap-2 justify-end pt-1">
                      <button
                        onClick={() => openDashboardWindow("dashboard")}
                        className="px-2.5 py-1 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 font-semibold rounded text-[10px] cursor-pointer transition"
                      >
                        More Metrics
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      {/* Footer Stats summary and Add Site button */}
      <div className="px-4 py-3 bg-neutral-900 border-t border-zinc-800 flex items-center justify-between shrink-0">
        <div className="text-[10px] text-zinc-500 font-medium">
          {totalCount > 0 ? (
            <div className="flex gap-2">
              <span>Fleet: {totalCount}</span>
              <span className="text-emerald-500">Up: {upCount}</span>
              {warningCount > 0 && <span className="text-amber-500">Warn: {warningCount}</span>}
              {downCount > 0 && <span className="text-red-500">Down: {downCount}</span>}
            </div>
          ) : (
            <span>0 sites monitored</span>
          )}
        </div>

        <button
          onClick={() => openDashboardWindow("add_site")}
          className="px-3 py-1.5 bg-zinc-100 hover:bg-zinc-200 text-neutral-900 font-bold rounded-lg text-xs flex items-center gap-1 cursor-pointer transition"
        >
          <Plus size={12} />
          Add Site
        </button>
      </div>
    </div>
  );
};
