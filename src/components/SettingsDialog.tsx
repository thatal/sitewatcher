import React, { useState, useEffect, useRef } from "react";
import { useStore, Settings } from "../store";
import { X, Save, Download, Upload, AlertTriangle, ShieldCheck } from "lucide-react";

interface SettingsDialogProps {
  onClose: () => void;
}

export const SettingsDialog: React.FC<SettingsDialogProps> = ({ onClose }) => {
  const { settings, updateSettings, loadSettings, sites, addSite } = useStore();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [launchAtStartup, setLaunchAtStartup] = useState(true);
  const [globalCheckInterval, setGlobalCheckInterval] = useState(300);
  const [requestTimeout, setRequestTimeout] = useState(10);
  const [sslWarningThreshold, setSslWarningThreshold] = useState(30);
  const [responseTimeWarning, setResponseTimeWarning] = useState(2000);
  const [historyRetention, setHistoryRetention] = useState(30);
  const [theme, setTheme] = useState<"light" | "dark" | "system">("system");
  const [notificationCooldown, setNotificationCooldown] = useState(900);
  const [userAgent, setUserAgent] = useState("SiteWatcher/1.0");

  const [statusMsg, setStatusMsg] = useState<{ type: "success" | "error"; text: string } | null>(null);

  useEffect(() => {
    loadSettings();
  }, []);

  useEffect(() => {
    if (settings) {
      setLaunchAtStartup(settings.launch_at_startup);
      setGlobalCheckInterval(settings.global_check_interval);
      setRequestTimeout(settings.request_timeout);
      setSslWarningThreshold(settings.ssl_warning_threshold);
      setResponseTimeWarning(settings.response_time_warning);
      setHistoryRetention(settings.history_retention);
      setTheme(settings.theme);
      setNotificationCooldown(settings.notification_cooldown);
      setUserAgent(settings.user_agent);
    }
  }, [settings]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setStatusMsg(null);
    try {
      const config: Settings = {
        launch_at_startup: launchAtStartup,
        global_check_interval: globalCheckInterval,
        request_timeout: requestTimeout,
        ssl_warning_threshold: sslWarningThreshold,
        response_time_warning: responseTimeWarning,
        history_retention: historyRetention,
        theme,
        notification_cooldown: notificationCooldown,
        user_agent: userAgent,
      };
      await updateSettings(config);
      setStatusMsg({ type: "success", text: "Settings saved successfully." });
    } catch (err: any) {
      setStatusMsg({ type: "error", text: err.toString() || "Failed to save settings." });
    }
  };

  const handleExport = () => {
    try {
      // Export only site details, not status results
      const sitesToExport = sites.map((s) => ({
        url: s.url,
        name: s.name,
        check_interval_secs: s.check_interval_secs,
        expected_status: s.expected_status,
        ssl_check: s.ssl_check,
        keyword_check: s.keyword_check,
        keyword_present: s.keyword_present,
        timeout_secs: s.timeout_secs,
        tags: s.tags,
        enabled: s.enabled,
      }));

      const dataStr = JSON.stringify(sitesToExport, null, 2);
      const dataUri = "data:application/json;charset=utf-8," + encodeURIComponent(dataStr);

      const exportFileDefaultName = `sitewatcher-backup-${new Date().toISOString().slice(0, 10)}.json`;

      const linkElement = document.createElement("a");
      linkElement.setAttribute("href", dataUri);
      linkElement.setAttribute("download", exportFileDefaultName);
      linkElement.click();
    } catch (e: any) {
      setStatusMsg({ type: "error", text: "Failed to export configuration." });
    }
  };

  const handleImportClick = () => {
    fileInputRef.current?.click();
  };

  const handleImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (event) => {
      try {
        const content = event.target?.result as string;
        const parsed = JSON.parse(content);

        if (!Array.isArray(parsed)) {
          throw new Error("Invalid format. Root must be an array of sites.");
        }

        let importCount = 0;
        for (const item of parsed) {
          if (item.url) {
            await addSite({
              url: item.url,
              name: item.name || item.url,
              check_interval_secs: item.check_interval_secs || 300,
              expected_status: item.expected_status || 200,
              ssl_check: item.ssl_check !== false,
              keyword_check: item.keyword_check || null,
              keyword_present: item.keyword_present !== false,
              timeout_secs: item.timeout_secs || 10,
              tags: Array.isArray(item.tags) ? item.tags : [],
              enabled: item.enabled !== false,
            });
            importCount++;
          }
        }

        setStatusMsg({
          type: "success",
          text: `Successfully imported ${importCount} sites.`,
        });
      } catch (err: any) {
        setStatusMsg({
          type: "error",
          text: `Failed to import: ${err.message || "Invalid JSON"}`,
        });
      }
    };
    reader.readAsText(file);
    e.target.value = ""; // Clear file selector
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-lg bg-neutral-900 border border-zinc-800 rounded-xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-800">
          <h2 className="text-lg font-semibold text-zinc-100">Global Settings</h2>
          <button
            onClick={onClose}
            className="p-1 rounded-md text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200 transition"
          >
            <X size={18} />
          </button>
        </div>

        <form onSubmit={handleSave} className="flex-1 overflow-y-auto p-6 space-y-4">
          {statusMsg && (
            <div
              className={`p-3 border rounded-lg flex items-start gap-2 text-xs ${
                statusMsg.type === "success"
                  ? "bg-emerald-950/40 border-emerald-800/60 text-emerald-200"
                  : "bg-red-950/40 border-red-800/60 text-red-200"
              }`}
            >
              {statusMsg.type === "success" ? (
                <ShieldCheck size={16} className="shrink-0 mt-0.5" />
              ) : (
                <AlertTriangle size={16} className="shrink-0 mt-0.5" />
              )}
              <span>{statusMsg.text}</span>
            </div>
          )}

          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2">
              <label className="flex items-center gap-2 cursor-pointer pt-1">
                <input
                  type="checkbox"
                  checked={launchAtStartup}
                  onChange={(e) => setLaunchAtStartup(e.target.checked)}
                  className="accent-zinc-700 bg-zinc-950 border-zinc-800 rounded"
                />
                <span className="text-xs font-semibold text-zinc-300">Launch SiteWatcher at system startup</span>
              </label>
            </div>

            <div>
              <label className="block text-xs font-semibold text-zinc-400 mb-1.5">
                Default Check Interval
              </label>
              <select
                value={globalCheckInterval}
                onChange={(e) => setGlobalCheckInterval(Number(e.target.value))}
                className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-sm text-zinc-100 focus:outline-none focus:border-zinc-700"
              >
                <option value={60}>1 min</option>
                <option value={300}>5 min</option>
                <option value={900}>15 min</option>
                <option value={1800}>30 min</option>
                <option value={3600}>60 min</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-zinc-400 mb-1.5">
                UI Theme
              </label>
              <select
                value={theme}
                onChange={(e) => setTheme(e.target.value as any)}
                className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-sm text-zinc-100 focus:outline-none focus:border-zinc-700"
              >
                <option value="system">Follow System</option>
                <option value="dark">Dark Theme</option>
                <option value="light">Light Theme</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-zinc-400 mb-1.5">
                SSL Expiry Warn Threshold
              </label>
              <select
                value={sslWarningThreshold}
                onChange={(e) => setSslWarningThreshold(Number(e.target.value))}
                className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-sm text-zinc-100 focus:outline-none focus:border-zinc-700"
              >
                <option value={7}>7 Days</option>
                <option value={14}>14 Days</option>
                <option value={30}>30 Days</option>
                <option value={60}>60 Days</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-zinc-400 mb-1.5">
                Response Time Warn Limit
              </label>
              <input
                type="number"
                value={responseTimeWarning}
                onChange={(e) => setResponseTimeWarning(Number(e.target.value))}
                min={100}
                max={30000}
                className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-sm text-zinc-100 focus:outline-none focus:border-zinc-700"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-zinc-400 mb-1.5">
                Notification Cooldown
              </label>
              <select
                value={notificationCooldown}
                onChange={(e) => setNotificationCooldown(Number(e.target.value))}
                className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-sm text-zinc-100 focus:outline-none focus:border-zinc-700"
              >
                <option value={300}>5 min</option>
                <option value={900}>15 min</option>
                <option value={1800}>30 min</option>
                <option value={3600}>60 min</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-zinc-400 mb-1.5">
                History Data Retention
              </label>
              <select
                value={historyRetention}
                onChange={(e) => setHistoryRetention(Number(e.target.value))}
                className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-sm text-zinc-100 focus:outline-none focus:border-zinc-700"
              >
                <option value={7}>7 Days</option>
                <option value={30}>30 Days</option>
                <option value={90}>90 Days</option>
              </select>
            </div>

            <div className="col-span-2">
              <label className="block text-xs font-semibold text-zinc-400 mb-1.5">
                User Agent HTTP Header
              </label>
              <input
                type="text"
                value={userAgent}
                onChange={(e) => setUserAgent(e.target.value)}
                placeholder="SiteWatcher/1.0"
                className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-sm text-zinc-100 focus:outline-none focus:border-zinc-700"
              />
            </div>
          </div>

          <div className="border-t border-zinc-850 pt-5 mt-4 space-y-3">
            <h3 className="text-xs font-bold text-zinc-500 uppercase tracking-wider">
              Backup & Configuration Import
            </h3>
            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={handleExport}
                className="py-2.5 px-3 border border-zinc-800 hover:bg-zinc-850 rounded-lg text-xs font-semibold text-zinc-200 flex items-center justify-center gap-1.5 transition cursor-pointer"
              >
                <Download size={14} />
                Export Site List
              </button>

              <button
                type="button"
                onClick={handleImportClick}
                className="py-2.5 px-3 border border-zinc-800 hover:bg-zinc-850 rounded-lg text-xs font-semibold text-zinc-200 flex items-center justify-center gap-1.5 transition cursor-pointer"
              >
                <Upload size={14} />
                Import Site List
              </button>
              
              <input
                type="file"
                ref={fileInputRef}
                onChange={handleImportFile}
                accept=".json"
                className="hidden"
              />
            </div>
          </div>
        </form>

        <div className="px-6 py-4 bg-zinc-950 border-t border-zinc-800 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 border border-zinc-850 hover:bg-zinc-900 text-zinc-400 rounded-lg text-xs font-semibold cursor-pointer transition"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSave}
            className="px-4 py-2 bg-zinc-100 hover:bg-zinc-200 text-neutral-900 rounded-lg text-xs font-bold cursor-pointer transition flex items-center gap-1"
          >
            <Save size={14} />
            Save Changes
          </button>
        </div>
      </div>
    </div>
  );
};
