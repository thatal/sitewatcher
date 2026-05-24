import React, { useState, useEffect } from "react";
import { useStore, Site } from "../store";
import { X, Check, Activity, AlertCircle } from "lucide-react";

interface SiteDialogProps {
  site: Site | null;
  onClose: () => void;
}

export const SiteDialog: React.FC<SiteDialogProps> = ({ site, onClose }) => {
  const { addSite, updateSite, testConnection } = useStore();
  
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [checkInterval, setCheckInterval] = useState(300);
  const [expectedStatus, setExpectedStatus] = useState(200);
  const [sslCheck, setSslCheck] = useState(true);
  const [keywordCheck, setKeywordCheck] = useState("");
  const [keywordPresent, setKeywordPresent] = useState(true);
  const [timeoutSecs, setTimeoutSecs] = useState(10);
  const [tags, setTags] = useState("");
  const [enabled, setEnabled] = useState(true);

  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{
    status: "UP" | "DOWN" | "WARNING" | "UNKNOWN";
    code?: number | null;
    time?: number | null;
    error?: string | null;
  } | null>(null);
  
  const [errorMsg, setErrorMsg] = useState("");

  useEffect(() => {
    if (site) {
      setName(site.name);
      setUrl(site.url);
      setCheckInterval(site.check_interval_secs);
      setExpectedStatus(site.expected_status);
      setSslCheck(site.ssl_check);
      setKeywordCheck(site.keyword_check || "");
      setKeywordPresent(site.keyword_present !== false);
      setTimeoutSecs(site.timeout_secs);
      setTags(site.tags.join(", "));
      setEnabled(site.enabled);
    } else {
      setName("");
      setUrl("https://");
      setCheckInterval(300);
      setExpectedStatus(200);
      setSslCheck(true);
      setKeywordCheck("");
      setKeywordPresent(true);
      setTimeoutSecs(10);
      setTags("");
      setEnabled(true);
    }
    setTestResult(null);
    setErrorMsg("");
  }, [site]);

  const handleTestConnection = async () => {
    if (!url || url === "https://" || url === "http://") {
      setErrorMsg("Please enter a valid URL to test.");
      return;
    }
    setErrorMsg("");
    setTesting(true);
    setTestResult(null);
    try {
      const res = await testConnection(
        url,
        expectedStatus,
        sslCheck,
        keywordCheck || null,
        keywordCheck ? keywordPresent : null,
        timeoutSecs
      );
      setTestResult({
        status: res.status,
        code: res.status_code,
        time: res.response_time_ms,
        error: res.error_message,
      });
    } catch (e: any) {
      setTestResult({
        status: "DOWN",
        error: e.toString() || "Connection check failed.",
      });
    } finally {
      setTesting(false);
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!url || url === "https://" || url === "http://") {
      setErrorMsg("URL is required.");
      return;
    }
    setErrorMsg("");

    const tagsArray = tags
      .split(",")
      .map((t) => t.trim())
      .filter((t) => t.length > 0);

    const siteData = {
      name: name || new URL(url).hostname || url,
      url,
      check_interval_secs: checkInterval,
      expected_status: expectedStatus,
      ssl_check: sslCheck,
      keyword_check: keywordCheck || null,
      keyword_present: keywordCheck ? keywordPresent : null,
      timeout_secs: timeoutSecs,
      tags: tagsArray,
      enabled,
    };

    try {
      if (site) {
        await updateSite({
          ...site,
          ...siteData,
        });
      } else {
        await addSite(siteData);
      }
      onClose();
    } catch (e: any) {
      setErrorMsg(e.toString() || "Failed to save site.");
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-lg bg-neutral-900 border border-zinc-800 rounded-xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-800">
          <h2 className="text-lg font-semibold text-zinc-100">
            {site ? "Edit Monitored Site" : "Add Website to Watch"}
          </h2>
          <button
            onClick={onClose}
            className="p-1 rounded-md text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200 transition"
          >
            <X size={18} />
          </button>
        </div>

        <form onSubmit={handleSave} className="flex-1 overflow-y-auto p-6 space-y-4">
          {errorMsg && (
            <div className="p-3 bg-red-950/40 border border-red-800/60 rounded-lg flex items-start gap-2 text-red-200 text-xs">
              <AlertCircle size={16} className="shrink-0 mt-0.5" />
              <span>{errorMsg}</span>
            </div>
          )}

          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2">
              <label className="block text-xs font-semibold text-zinc-400 mb-1.5">
                Site Name / Label
              </label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="My API Gateway"
                className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:border-zinc-700"
              />
            </div>

            <div className="col-span-2">
              <label className="block text-xs font-semibold text-zinc-400 mb-1.5">
                Target URL (required)
              </label>
              <input
                type="text"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://example.com"
                required
                className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-sm text-zinc-100 focus:outline-none focus:border-zinc-700"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-zinc-400 mb-1.5">
                Check Interval
              </label>
              <select
                value={checkInterval}
                onChange={(e) => setCheckInterval(Number(e.target.value))}
                className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-sm text-zinc-100 focus:outline-none focus:border-zinc-700"
              >
                <option value={60}>Every 1 min</option>
                <option value={300}>Every 5 min</option>
                <option value={900}>Every 15 min</option>
                <option value={1800}>Every 30 min</option>
                <option value={3600}>Every 1 hour</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-zinc-400 mb-1.5">
                Expected HTTP Status
              </label>
              <input
                type="number"
                value={expectedStatus}
                onChange={(e) => setExpectedStatus(Number(e.target.value))}
                min={100}
                max={599}
                className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-sm text-zinc-100 focus:outline-none focus:border-zinc-700"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-zinc-400 mb-1.5">
                Request Timeout (seconds)
              </label>
              <input
                type="number"
                value={timeoutSecs}
                onChange={(e) => setTimeoutSecs(Number(e.target.value))}
                min={1}
                max={120}
                className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-sm text-zinc-100 focus:outline-none focus:border-zinc-700"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-zinc-400 mb-1.5">
                Tags (comma separated)
              </label>
              <input
                type="text"
                value={tags}
                onChange={(e) => setTags(e.target.value)}
                placeholder="production, api"
                className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:border-zinc-700"
              />
            </div>
          </div>

          <div className="space-y-3 pt-2">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={sslCheck}
                onChange={(e) => setSslCheck(e.target.checked)}
                className="accent-zinc-700 bg-zinc-950 border-zinc-800 rounded"
              />
              <span className="text-xs font-medium text-zinc-300">Enable SSL Certificate Validation</span>
            </label>

            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={enabled}
                onChange={(e) => setEnabled(e.target.checked)}
                className="accent-zinc-700 bg-zinc-950 border-zinc-800 rounded"
              />
              <span className="text-xs font-medium text-zinc-300">Active monitoring enabled</span>
            </label>
          </div>

          <div className="border-t border-zinc-850 pt-4 space-y-3">
            <h3 className="text-xs font-bold text-zinc-500 uppercase tracking-wider">
              Keyword Match Checker (Optional)
            </h3>
            <div className="grid grid-cols-3 gap-3 items-end">
              <div className="col-span-2">
                <label className="block text-[10px] font-semibold text-zinc-400 mb-1">
                  Response body must contain / not contain:
                </label>
                <input
                  type="text"
                  value={keywordCheck}
                  onChange={(e) => setKeywordCheck(e.target.value)}
                  placeholder='e.g. "success" or "error"'
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:border-zinc-700"
                />
              </div>
              <div>
                <select
                  value={keywordPresent ? "true" : "false"}
                  onChange={(e) => setKeywordPresent(e.target.value === "true")}
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-sm text-zinc-100 focus:outline-none focus:border-zinc-700"
                >
                  <option value="true">Must Be Present</option>
                  <option value="false">Must Be Absent</option>
                </select>
              </div>
            </div>
          </div>

          {/* Connection Test Result */}
          {testResult && (
            <div
              className={`p-4 border rounded-xl flex flex-col gap-1 text-xs ${
                testResult.status === "UP"
                  ? "bg-emerald-950/20 border-emerald-800/40 text-emerald-200"
                  : testResult.status === "WARNING"
                  ? "bg-amber-950/20 border-amber-800/40 text-amber-200"
                  : "bg-red-950/20 border-red-800/40 text-red-200"
              }`}
            >
              <div className="flex items-center gap-1.5 font-bold uppercase tracking-wider text-[10px]">
                <Activity size={12} />
                <span>Test Connection: {testResult.status}</span>
              </div>
              {testResult.code && (
                <div>
                  HTTP Status Code: <span className="font-semibold">{testResult.code}</span>
                </div>
              )}
              {testResult.time !== undefined && (
                <div>
                  Response Latency: <span className="font-semibold">{testResult.time} ms</span>
                </div>
              )}
              {testResult.error && (
                <div className="mt-1 p-2 bg-black/40 rounded border border-zinc-800/40 font-mono text-[10px] break-all">
                  {testResult.error}
                </div>
              )}
            </div>
          )}
        </form>

        <div className="px-6 py-4 bg-zinc-950 border-t border-zinc-800 flex items-center justify-between">
          <button
            type="button"
            onClick={handleTestConnection}
            disabled={testing}
            className="px-4 py-2 border border-zinc-800 hover:bg-zinc-900 rounded-lg text-xs font-semibold text-zinc-300 disabled:opacity-50 cursor-pointer flex items-center gap-1.5 transition"
          >
            {testing ? (
              <span className="w-3 h-3 border border-zinc-400 border-t-transparent rounded-full animate-spin"></span>
            ) : null}
            Test Connection
          </button>

          <div className="flex gap-2">
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
              <Check size={14} />
              Save Config
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
