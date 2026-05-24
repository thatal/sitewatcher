import React, { useState, useEffect } from "react";
import { useStore, Site } from "../store";
import {
  Search,
  Plus,
  Settings as SettingsIcon,
  RefreshCw,
  TrendingUp,
  Activity,
  AlertTriangle,
  CheckCircle,
  Clock,
  Shield,
  ShieldAlert,
  Play,
  Pause,
  Trash2,
  Edit2,
  Tag,
  ArrowUpDown,
  SearchCode,
  Globe,
  X,
} from "lucide-react";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { SiteDialog } from "./SiteDialog";
import { SettingsDialog } from "./SettingsDialog";

export const Dashboard: React.FC = () => {
  const {
    sites,
    loadSites,
    histories,
    loadSiteHistory,
    triggerCheck,
    deleteSite,
    updateSite,
    currentRoute,
    setRoute,
  } = useStore();

  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("ALL");
  const [selectedTag, setSelectedTag] = useState<string>("ALL");
  const [selectedSiteId, setSelectedSiteId] = useState<string | null>(null);

  // Sorting
  const [sortBy, setSortBy] = useState<"name" | "status" | "time">("name");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("asc");

  // Modals
  const [siteDialogOpen, setSiteDialogOpen] = useState(false);
  const [editingSite, setEditingSite] = useState<Site | null>(null);
  const [siteToDelete, setSiteToDelete] = useState<Site | null>(null);
  const [settingsDialogOpen, setSettingsDialogOpen] = useState(false);
  
  const [checkingSiteId, setCheckingSiteId] = useState<string | null>(null);

  useEffect(() => {
    loadSites();
  }, []);

  // Listen to external navigation events (from system tray popover / menu)
  useEffect(() => {
    if (currentRoute === "add_site") {
      setSiteDialogOpen(true);
    } else if (currentRoute === "settings") {
      setSettingsDialogOpen(true);
    } else if (currentRoute === "dashboard") {
      setSiteDialogOpen(false);
      setSettingsDialogOpen(false);
    }
  }, [currentRoute]);

  // Update selected site id when sites load
  useEffect(() => {
    if (sites.length > 0 && !selectedSiteId) {
      setSelectedSiteId(sites[0].id);
    }
  }, [sites]);

  // Load history when selected site changes
  useEffect(() => {
    if (selectedSiteId) {
      loadSiteHistory(selectedSiteId, 50);
    }
  }, [selectedSiteId]);

  const handleTriggerCheck = async (id: string) => {
    setCheckingSiteId(id);
    await triggerCheck(id);
    await loadSiteHistory(id, 50);
    setCheckingSiteId(null);
  };

  const confirmDelete = async () => {
    if (!siteToDelete) return;
    const id = siteToDelete.id;
    setSiteToDelete(null);
    await deleteSite(id);
    if (selectedSiteId === id) {
      const freshSites = useStore.getState().sites;
      setSelectedSiteId(freshSites.length > 0 ? freshSites[0].id : null);
    }
  };

  const handleToggleEnable = async (site: Site) => {
    await updateSite({
      ...site,
      enabled: !site.enabled,
    });
  };

  const handleEdit = (site: Site) => {
    setEditingSite(site);
    setSiteDialogOpen(true);
    setRoute("add_site");
  };

  const handleAddClick = () => {
    setEditingSite(null);
    setSiteDialogOpen(true);
    setRoute("add_site");
  };

  // Get all unique tags
  const allTags = Array.from(new Set(sites.flatMap((s) => s.tags)));

  // Filter & sort sites
  const filteredSites = sites
    .filter((s) => {
      const matchesSearch =
        s.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        s.url.toLowerCase().includes(searchQuery.toLowerCase());
      
      const status = s.latest_result?.status || "UNKNOWN";
      const matchesStatus = statusFilter === "ALL" || status === statusFilter;
      
      const matchesTag = selectedTag === "ALL" || s.tags.includes(selectedTag);

      return matchesSearch && matchesStatus && matchesTag;
    })
    .sort((a, b) => {
      let multiplier = sortOrder === "asc" ? 1 : -1;
      if (sortBy === "name") {
        return a.name.localeCompare(b.name) * multiplier;
      } else if (sortBy === "status") {
        const statusA = a.latest_result?.status || "UNKNOWN";
        const statusB = b.latest_result?.status || "UNKNOWN";
        return statusA.localeCompare(statusB) * multiplier;
      } else if (sortBy === "time") {
        const timeA = a.latest_result?.response_time_ms || 0;
        const timeB = b.latest_result?.response_time_ms || 0;
        return (timeA - timeB) * multiplier;
      }
      return 0;
    });

  const selectedSite = sites.find((s) => s.id === selectedSiteId);
  const selectedHistory = selectedSiteId ? histories[selectedSiteId] || [] : [];
  
  // Format chart data (newest on the right)
  const chartData = [...selectedHistory]
    .reverse()
    .map((h) => ({
      time: new Date(h.checked_at).toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
      }),
      latency: h.response_time_ms || 0,
      status: h.status,
    }));

  // Stats
  const totalCount = sites.length;
  const upCount = sites.filter((s) => s.enabled && s.latest_result?.status === "UP").length;
  const warningCount = sites.filter((s) => s.enabled && s.latest_result?.status === "WARNING").length;
  const downCount = sites.filter((s) => s.enabled && s.latest_result?.status === "DOWN").length;

  const toggleSort = (field: "name" | "status" | "time") => {
    if (sortBy === field) {
      setSortOrder(sortOrder === "asc" ? "desc" : "asc");
    } else {
      setSortBy(field);
      setSortOrder("asc");
    }
  };

  return (
    <div className="w-full h-screen bg-neutral-950 text-zinc-100 flex flex-col font-sans select-none overflow-hidden">
      {/* Header */}
      <div className="px-6 py-4 bg-neutral-900 border-b border-zinc-800 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-2">
          <Activity className="text-emerald-500" size={20} />
          <h1 className="text-base font-bold tracking-tight text-zinc-100">SiteWatcher Dashboard</h1>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={() => {
              setSettingsDialogOpen(true);
              setRoute("settings");
            }}
            className="p-2 border border-zinc-800 hover:bg-zinc-850 rounded-lg text-zinc-300 flex items-center gap-1.5 text-xs font-semibold cursor-pointer transition"
          >
            <SettingsIcon size={14} />
            Settings
          </button>
          <button
            onClick={handleAddClick}
            className="py-2 px-3.5 bg-zinc-100 hover:bg-zinc-200 text-neutral-900 rounded-lg flex items-center gap-1 text-xs font-bold cursor-pointer transition shadow"
          >
            <Plus size={14} />
            Add Website
          </button>
        </div>
      </div>

      {/* Main Workspace */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left Side: Sites List Panel */}
        <div className="w-96 border-r border-zinc-850 flex flex-col bg-neutral-900/30 overflow-hidden">
          {/* Stats Bar */}
          <div className="grid grid-cols-4 border-b border-zinc-850 shrink-0">
            <div className="p-3 text-center border-r border-zinc-850/60">
              <div className="text-[10px] text-zinc-500 font-bold uppercase tracking-wider">Total</div>
              <div className="text-sm font-bold text-zinc-300 mt-0.5">{totalCount}</div>
            </div>
            <div className="p-3 text-center border-r border-zinc-850/60">
              <div className="text-[10px] text-zinc-500 font-bold uppercase tracking-wider">Up</div>
              <div className="text-sm font-bold text-emerald-400 mt-0.5">{upCount}</div>
            </div>
            <div className="p-3 text-center border-r border-zinc-850/60">
              <div className="text-[10px] text-zinc-500 font-bold uppercase tracking-wider">Warn</div>
              <div className="text-sm font-bold text-amber-400 mt-0.5">{warningCount}</div>
            </div>
            <div className="p-3 text-center">
              <div className="text-[10px] text-zinc-500 font-bold uppercase tracking-wider">Down</div>
              <div className="text-sm font-bold text-red-400 mt-0.5">{downCount}</div>
            </div>
          </div>

          {/* Search and Filter */}
          <div className="p-3 border-b border-zinc-850 space-y-2 shrink-0">
            <div className="relative">
              <Search className="absolute left-2.5 top-2.5 text-zinc-600" size={14} />
              <input
                type="text"
                placeholder="Search by label or URL..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full bg-zinc-950 border border-zinc-850 rounded-lg pl-8 pr-3 py-2 text-xs text-zinc-100 placeholder:text-zinc-650 focus:outline-none focus:border-zinc-750"
              />
            </div>

            <div className="grid grid-cols-2 gap-2">
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="bg-zinc-950 border border-zinc-850 rounded-lg px-2 py-1.5 text-[10px] text-zinc-400 font-medium focus:outline-none focus:border-zinc-750"
              >
                <option value="ALL">All Statuses</option>
                <option value="UP">UP Status</option>
                <option value="WARNING">WARNING Status</option>
                <option value="DOWN">DOWN Status</option>
              </select>

              <select
                value={selectedTag}
                onChange={(e) => setSelectedTag(e.target.value)}
                className="bg-zinc-950 border border-zinc-850 rounded-lg px-2 py-1.5 text-[10px] text-zinc-400 font-medium focus:outline-none focus:border-zinc-750"
              >
                <option value="ALL">All Tags</option>
                {allTags.map((tag) => (
                  <option key={tag} value={tag}>
                    {tag}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Table Headers / Sort buttons */}
          <div className="px-4 py-2 border-b border-zinc-850/60 bg-zinc-950/40 flex items-center justify-between text-[9px] font-bold text-zinc-500 uppercase tracking-wider shrink-0">
            <button
              onClick={() => toggleSort("name")}
              className="flex items-center gap-1 hover:text-zinc-300"
            >
              Site Name
              <ArrowUpDown size={10} />
            </button>
            <div className="flex gap-4">
              <button
                onClick={() => toggleSort("time")}
                className="flex items-center gap-1 hover:text-zinc-300"
              >
                Latency
                <ArrowUpDown size={10} />
              </button>
              <button
                onClick={() => toggleSort("status")}
                className="flex items-center gap-1 hover:text-zinc-300"
              >
                Status
                <ArrowUpDown size={10} />
              </button>
            </div>
          </div>

          {/* Sites list */}
          <div className="flex-1 overflow-y-auto p-2 space-y-1">
            {filteredSites.length === 0 ? (
              <div className="p-6 text-center text-xs text-zinc-500">No matching sites found.</div>
            ) : (
              filteredSites.map((s) => {
                const isSelected = selectedSiteId === s.id;
                const status = s.latest_result?.status || "UNKNOWN";
                
                let dotColor = "bg-zinc-700";
                if (status === "UP") dotColor = "bg-emerald-500";
                else if (status === "WARNING") dotColor = "bg-amber-500";
                else if (status === "DOWN") dotColor = "bg-red-500";

                return (
                  <div
                    key={s.id}
                    onClick={() => setSelectedSiteId(s.id)}
                    className={`p-3 rounded-lg flex items-center justify-between cursor-pointer transition ${
                      isSelected
                        ? "bg-zinc-900 border border-zinc-800 shadow"
                        : "bg-zinc-900/10 border border-zinc-950 hover:bg-zinc-900/40"
                    }`}
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <div className={`w-2 h-2 rounded-full shrink-0 ${dotColor}`}></div>
                        <div className="text-xs font-semibold text-zinc-200 truncate">{s.name}</div>
                      </div>
                      <div className="text-[10px] text-zinc-500 truncate mt-1 pl-4 max-w-[200px]">
                        {s.url}
                      </div>
                    </div>

                    <div className="flex items-center gap-3 shrink-0">
                      <span className="text-[10px] text-zinc-400 font-mono">
                        {s.latest_result?.response_time_ms
                          ? `${s.latest_result.response_time_ms}ms`
                          : "N/A"}
                      </span>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Right Side: Site Analytics Panel */}
        <div className="flex-1 flex flex-col overflow-hidden bg-neutral-950">
          {selectedSite ? (
            <div className="flex-1 overflow-y-auto p-6 space-y-6">
              {/* Site Overview Details & Actions */}
              <div className="bg-neutral-900 border border-zinc-850 p-5 rounded-xl flex justify-between items-start">
                <div className="space-y-2">
                  <div className="flex items-center gap-2.5">
                    <h2 className="text-lg font-bold text-zinc-100">{selectedSite.name}</h2>
                    <span
                      className={`px-2 py-0.5 text-xs font-bold border rounded-lg ${
                        selectedSite.latest_result?.status === "UP"
                          ? "bg-emerald-950/20 border-emerald-800/40 text-emerald-400"
                          : selectedSite.latest_result?.status === "WARNING"
                          ? "bg-amber-950/20 border-amber-800/40 text-amber-400"
                          : "bg-red-950/20 border-red-800/40 text-red-400"
                      }`}
                    >
                      {selectedSite.latest_result?.status || "UNKNOWN"}
                    </span>
                  </div>
                  <div className="text-xs text-zinc-500 font-mono break-all">{selectedSite.url}</div>
                  
                  {/* Tags */}
                  {selectedSite.tags.length > 0 && (
                    <div className="flex items-center gap-1.5 pt-1">
                      <Tag size={12} className="text-zinc-600" />
                      <div className="flex gap-1">
                        {selectedSite.tags.map((t) => (
                          <span
                            key={t}
                            className="px-1.5 py-0.5 bg-zinc-950 text-zinc-400 border border-zinc-850 rounded text-[9px]"
                          >
                            {t}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                <div className="flex items-center gap-2">
                  <button
                    onClick={() => handleTriggerCheck(selectedSite.id)}
                    disabled={checkingSiteId === selectedSite.id}
                    className="p-2 border border-zinc-805 bg-zinc-950 hover:bg-zinc-900 text-zinc-300 rounded-lg text-xs font-semibold cursor-pointer transition flex items-center gap-1.5"
                  >
                    <RefreshCw
                      size={14}
                      className={checkingSiteId === selectedSite.id ? "animate-spin" : ""}
                    />
                    Check Now
                  </button>

                  <button
                    onClick={() => handleToggleEnable(selectedSite as unknown as Site)}
                    className="p-2 border border-zinc-805 bg-zinc-950 hover:bg-zinc-900 text-zinc-300 rounded-lg text-xs font-semibold cursor-pointer transition flex items-center gap-1.5"
                  >
                    {selectedSite.enabled ? (
                      <>
                        <Pause size={14} className="text-amber-500" />
                        Pause Checks
                      </>
                    ) : (
                      <>
                        <Play size={14} className="text-emerald-500" />
                        Resume Checks
                      </>
                    )}
                  </button>

                  <button
                    onClick={() => handleEdit(selectedSite as unknown as Site)}
                    className="p-2 border border-zinc-805 bg-zinc-950 hover:bg-zinc-900 text-zinc-300 rounded-lg text-xs font-semibold cursor-pointer transition flex items-center gap-1.5"
                  >
                    <Edit2 size={14} />
                    Edit
                  </button>

                  <button
                    onClick={() => setSiteToDelete(selectedSite as unknown as Site)}
                    className="p-2 border border-red-950/30 bg-red-950/10 hover:bg-red-950/20 hover:border-red-900/50 text-red-400 rounded-lg text-xs font-semibold cursor-pointer transition flex items-center gap-1.5"
                  >
                    <Trash2 size={14} />
                    Delete
                  </button>
                </div>
              </div>

              {/* Chart Card */}
              <div className="bg-neutral-900 border border-zinc-850 p-5 rounded-xl space-y-4">
                <div className="flex items-center justify-between border-b border-zinc-850/60 pb-3">
                  <div className="flex items-center gap-1.5">
                    <TrendingUp className="text-zinc-500" size={16} />
                    <h3 className="text-xs font-bold text-zinc-400 uppercase tracking-wider">
                      Response Latency Trend (Last 50 checks)
                    </h3>
                  </div>
                  <div className="text-[10px] text-zinc-500 font-semibold flex items-center gap-1">
                    <Clock size={12} />
                    <span>Updated live</span>
                  </div>
                </div>

                <div className="h-64 w-full text-xs">
                  {chartData.length === 0 ? (
                    <div className="h-full flex items-center justify-center text-zinc-500">
                      Gathering monitoring logs...
                    </div>
                  ) : (
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={chartData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                        <defs>
                          <linearGradient id="colorLatency" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#10b981" stopOpacity={0.2} />
                            <stop offset="95%" stopColor="#10b981" stopOpacity={0.0} />
                          </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" stroke="#27272a" vertical={false} />
                        <XAxis dataKey="time" stroke="#71717a" tickLine={false} axisLine={false} />
                        <YAxis stroke="#71717a" tickLine={false} axisLine={false} unit="ms" />
                        <Tooltip
                          contentStyle={{
                            backgroundColor: "#18181b",
                            borderColor: "#27272a",
                            borderRadius: "8px",
                            color: "#f4f4f5",
                          }}
                          labelStyle={{ fontWeight: "bold" }}
                        />
                        <Area
                          type="monotone"
                          dataKey="latency"
                          name="Latency"
                          stroke="#10b981"
                          strokeWidth={2}
                          fillOpacity={1}
                          fill="url(#colorLatency)"
                        />
                      </AreaChart>
                    </ResponsiveContainer>
                  )}
                </div>
              </div>

              {/* SSL & Domain Details Cards & Diagnostics */}
              <div className="grid grid-cols-2 gap-6">
                {/* Left Column: SSL & Domain */}
                <div className="space-y-6">
                  {/* SSL Box */}
                  <div className="bg-neutral-900 border border-zinc-850 p-5 rounded-xl space-y-4">
                    <h3 className="text-xs font-bold text-zinc-400 uppercase tracking-wider border-b border-zinc-850/60 pb-3 flex items-center gap-1.5">
                      <Shield size={16} className="text-zinc-500" />
                      SSL Certification Details
                    </h3>

                    {selectedSite.ssl_check ? (
                      <div className="space-y-3">
                        <div className="flex items-center justify-between text-xs">
                          <span className="text-zinc-500">Security Status</span>
                          {selectedSite.latest_result?.ssl_valid ? (
                            <span className="flex items-center gap-1 text-emerald-400 font-bold">
                              <CheckCircle size={14} />
                              Trusted Certificate
                            </span>
                          ) : selectedSite.latest_result?.ssl_valid === false ? (
                            <span className="flex items-center gap-1 text-red-400 font-bold">
                              <ShieldAlert size={14} />
                              Invalid / Untrusted
                            </span>
                          ) : (
                            <span className="text-zinc-400">Waiting for check...</span>
                          )}
                        </div>

                        <div className="flex items-center justify-between text-xs">
                          <span className="text-zinc-500">Days Remaining</span>
                          <span className="text-zinc-200 font-semibold font-mono">
                            {selectedSite.latest_result?.ssl_days_remaining !== null &&
                            selectedSite.latest_result?.ssl_days_remaining !== undefined
                              ? `${selectedSite.latest_result.ssl_days_remaining} Days`
                              : "N/A"}
                          </span>
                        </div>

                        <div className="flex items-center justify-between text-xs">
                          <span className="text-zinc-500">Expiration Date</span>
                          <span className="text-zinc-200 font-semibold truncate max-w-[200px] font-mono">
                            {selectedSite.latest_result?.ssl_expiry_date
                              ? new Date(selectedSite.latest_result.ssl_expiry_date).toLocaleDateString()
                              : "N/A"}
                          </span>
                        </div>
                      </div>
                    ) : (
                      <div className="text-xs text-zinc-500 py-2">
                        SSL certification checks are disabled for this site.
                      </div>
                    )}
                  </div>

                  {/* Domain Registration Details Box */}
                  <div className="bg-neutral-900 border border-zinc-850 p-5 rounded-xl space-y-4">
                    <h3 className="text-xs font-bold text-zinc-400 uppercase tracking-wider border-b border-zinc-850/60 pb-3 flex items-center gap-1.5">
                      <Globe size={16} className="text-zinc-500" />
                      Domain Registration Details
                    </h3>

                    <div className="space-y-3">
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-zinc-500">Domain Name</span>
                        <span className="text-zinc-200 font-semibold truncate max-w-[200px] font-mono">
                          {selectedSite.url.replace("https://", "").replace("http://", "").split("/")[0].split(":")[0]}
                        </span>
                      </div>

                      {selectedSite.latest_result?.domain_expiry_date ? (
                        <>
                          <div className="flex items-center justify-between text-xs">
                            <span className="text-zinc-500">Days Remaining</span>
                            <span className={`font-bold font-mono ${
                              selectedSite.latest_result.domain_days_remaining !== null && selectedSite.latest_result.domain_days_remaining <= 30
                                ? "text-amber-400"
                                : "text-zinc-200"
                            }`}>
                              {selectedSite.latest_result.domain_days_remaining !== null &&
                              selectedSite.latest_result.domain_days_remaining !== undefined
                                ? `${selectedSite.latest_result.domain_days_remaining} Days`
                                : "N/A"}
                            </span>
                          </div>

                          <div className="flex items-center justify-between text-xs">
                            <span className="text-zinc-500">Expiration Date</span>
                            <span className="text-zinc-200 font-semibold font-mono">
                              {new Date(selectedSite.latest_result.domain_expiry_date).toLocaleDateString()}
                            </span>
                          </div>
                        </>
                      ) : (
                        <div className="text-xs text-zinc-500 py-1">
                          Domain details will appear after the next check.
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                {/* Diagnostics Box */}
                <div className="bg-neutral-900 border border-zinc-850 p-5 rounded-xl space-y-4">
                  <h3 className="text-xs font-bold text-zinc-400 uppercase tracking-wider border-b border-zinc-850/60 pb-3 flex items-center gap-1.5">
                    <SearchCode size={16} className="text-zinc-500" />
                    Diagnostics & Flags
                  </h3>

                  <div className="space-y-3">
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-zinc-500">Check Interval</span>
                      <span className="text-zinc-200 font-semibold">
                        Every {selectedSite.check_interval_secs / 60} mins
                      </span>
                    </div>

                    <div className="flex items-center justify-between text-xs">
                      <span className="text-zinc-500">Expected HTTP Status</span>
                      <span className="text-zinc-200 font-semibold font-mono">
                        {selectedSite.expected_status}
                      </span>
                    </div>

                    {selectedSite.keyword_check && (
                      <div className="text-xs flex flex-col gap-1">
                        <span className="text-zinc-500">Keyword Check</span>
                        <span className="text-zinc-200 font-semibold bg-zinc-950 p-1.5 border border-zinc-850 rounded font-mono text-[10px]">
                          Must be {selectedSite.keyword_present ? "PRESENT" : "ABSENT"}: "
                          {selectedSite.keyword_check}"
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* Error log if present */}
              {selectedSite.latest_result?.error_message && (
                <div className="bg-red-950/10 border border-red-900/20 p-5 rounded-xl space-y-3">
                  <h3 className="text-xs font-bold text-red-400 uppercase tracking-wider flex items-center gap-1.5">
                    <AlertTriangle size={14} />
                    Last Error Diagnostics
                  </h3>
                  <div className="text-xs text-red-300 leading-relaxed font-mono bg-black/30 p-3 rounded border border-red-900/25 break-words">
                    {selectedSite.latest_result.error_message}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center text-center p-6">
              <Activity className="text-zinc-700 mb-3" size={36} />
              <p className="text-sm text-zinc-400 font-medium">Select a website monitor from the list.</p>
            </div>
          )}
        </div>
      </div>

      {/* Modals */}
      {siteToDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div className="w-full max-w-md bg-neutral-900 border border-zinc-800 rounded-xl shadow-2xl overflow-hidden flex flex-col">
            <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-800">
              <h2 className="text-sm font-semibold text-zinc-100 flex items-center gap-2">
                <AlertTriangle size={16} className="text-amber-500" />
                Delete Monitor
              </h2>
              <button
                onClick={() => setSiteToDelete(null)}
                className="p-1 rounded-md text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200 transition cursor-pointer"
              >
                <X size={16} />
              </button>
            </div>
            <div className="p-6 text-zinc-300 text-xs leading-relaxed space-y-2 select-text">
              <p>
                Are you sure you want to delete <span className="font-semibold text-zinc-100">{siteToDelete.name}</span>?
              </p>
              <p className="text-zinc-500">
                This will permanently delete the website monitor and erase all associated latency logs, history events, and status checks. This action cannot be undone.
              </p>
            </div>
            <div className="px-6 py-4 bg-zinc-950 border-t border-zinc-800 flex justify-end gap-3">
              <button
                onClick={() => setSiteToDelete(null)}
                className="px-4 py-2 border border-zinc-800 bg-zinc-950 hover:bg-zinc-900 text-zinc-400 rounded-lg text-xs font-semibold cursor-pointer transition"
              >
                Cancel
              </button>
              <button
                onClick={confirmDelete}
                className="px-4 py-2 bg-red-600 hover:bg-red-500 text-white rounded-lg text-xs font-bold cursor-pointer transition"
              >
                Yes, Delete
              </button>
            </div>
          </div>
        </div>
      )}
      {siteDialogOpen && (
        <SiteDialog
          site={editingSite}
          onClose={() => {
            setSiteDialogOpen(false);
            setEditingSite(null);
            setRoute("dashboard");
          }}
        />
      )}
      {settingsDialogOpen && (
        <SettingsDialog
          onClose={() => {
            setSettingsDialogOpen(false);
            setRoute("dashboard");
          }}
        />
      )}
    </div>
  );
};
