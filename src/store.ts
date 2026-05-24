import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

export interface Site {
  id: string;
  url: string;
  name: string;
  check_interval_secs: number;
  expected_status: number;
  ssl_check: boolean;
  keyword_check: string | null;
  keyword_present: boolean | null;
  timeout_secs: number;
  tags: string[];
  enabled: boolean;
  created_at: string;
}

export interface CheckResult {
  id: string;
  site_id: string;
  checked_at: string;
  status: "UP" | "DOWN" | "WARNING" | "UNKNOWN";
  status_code: number | null;
  response_time_ms: number | null;
  ssl_valid: boolean | null;
  ssl_expiry_date: string | null;
  ssl_days_remaining: number | null;
  error_message: string | null;
  redirect_url: string | null;
  domain_expiry_date: string | null;
  domain_days_remaining: number | null;
}

export interface SiteWithStatus {
  id: string;
  url: string;
  name: string;
  check_interval_secs: number;
  expected_status: number;
  ssl_check: boolean;
  keyword_check: string | null;
  keyword_present: boolean | null;
  timeout_secs: number;
  tags: string[];
  enabled: boolean;
  created_at: string;
  latest_result: CheckResult | null;
}

export interface Settings {
  launch_at_startup: boolean;
  global_check_interval: number;
  request_timeout: number;
  ssl_warning_threshold: number;
  response_time_warning: number;
  history_retention: number;
  theme: "light" | "dark" | "system";
  notification_cooldown: number;
  user_agent: string;
}

interface SiteWatcherStore {
  sites: SiteWithStatus[];
  settings: Settings | null;
  histories: Record<string, CheckResult[]>;
  isLoading: boolean;
  currentRoute: "popover" | "dashboard" | "add_site" | "settings";
  selectedSiteId: string | null;

  loadSites: () => Promise<void>;
  loadSettings: () => Promise<void>;
  addSite: (site: Partial<Site>) => Promise<void>;
  updateSite: (site: Site) => Promise<void>;
  deleteSite: (id: string) => Promise<void>;
  updateSettings: (settings: Settings) => Promise<void>;
  loadSiteHistory: (siteId: string, limit?: number) => Promise<void>;
  triggerCheck: (siteId: string) => Promise<void>;
  testConnection: (
    url: string,
    expectedStatus: number,
    sslCheck: boolean,
    keywordCheck: string | null,
    keywordPresent: boolean | null,
    timeoutSecs: number
  ) => Promise<CheckResult>;
  setRoute: (route: "popover" | "dashboard" | "add_site" | "settings") => void;
  selectSite: (id: string | null) => void;
  initListener: () => Promise<() => void>;
}

export const useStore = create<SiteWatcherStore>((set, get) => ({
  sites: [],
  settings: null,
  histories: {},
  isLoading: false,
  currentRoute: "popover",
  selectedSiteId: null,

  loadSites: async () => {
    set({ isLoading: true });
    try {
      const sites = await invoke<SiteWithStatus[]>("get_sites");
      set({ sites, isLoading: false });
      
      // Load history for each site to display sparklines initially
      for (const site of sites) {
        get().loadSiteHistory(site.id, 24);
      }
    } catch (e) {
      console.error("Failed to load sites", e);
      set({ isLoading: false });
    }
  },

  loadSettings: async () => {
    try {
      const settings = await invoke<Settings>("get_settings");
      set({ settings });
    } catch (e) {
      console.error("Failed to load settings", e);
    }
  },

  addSite: async (siteData) => {
    try {
      const fullSite = {
        id: crypto.randomUUID(),
        created_at: new Date().toISOString(),
        ...siteData,
      };
      await invoke("add_site", { site: fullSite });
      await get().loadSites();
    } catch (e) {
      console.error("Failed to add site", e);
      throw e;
    }
  },

  updateSite: async (site) => {
    try {
      await invoke("update_site", { site });
      await get().loadSites();
    } catch (e) {
      console.error("Failed to update site", e);
      throw e;
    }
  },

  deleteSite: async (id) => {
    try {
      await invoke("delete_site", { id });
      await get().loadSites();
    } catch (e) {
      console.error("Failed to delete site", e);
      throw e;
    }
  },

  updateSettings: async (settings) => {
    try {
      await invoke("update_settings", { settings });
      set({ settings });
    } catch (e) {
      console.error("Failed to update settings", e);
      throw e;
    }
  },

  loadSiteHistory: async (siteId, limit = 50) => {
    try {
      const history = await invoke<CheckResult[]>("get_site_history", {
        siteId,
        limit,
      });
      set((state) => ({
        histories: {
          ...state.histories,
          [siteId]: history,
        },
      }));
    } catch (e) {
      console.error(`Failed to load history for ${siteId}`, e);
    }
  },

  triggerCheck: async (siteId) => {
    try {
      await invoke("trigger_check", { id: siteId });
      // Reload sites to get new status
      await get().loadSites();
    } catch (e) {
      console.error(`Failed to trigger check for ${siteId}`, e);
    }
  },

  testConnection: async (
    url,
    expectedStatus,
    sslCheck,
    keywordCheck,
    keywordPresent,
    timeoutSecs
  ) => {
    return await invoke<CheckResult>("test_connection", {
      url,
      expectedStatus,
      sslCheck,
      keywordCheck,
      keywordPresent,
      timeoutSecs,
    });
  },

  setRoute: (route) => set({ currentRoute: route }),
  selectSite: (id) => set({ selectedSiteId: id }),

  initListener: async () => {
    const unlistenStatus = await listen<CheckResult>(
      "site-status-changed",
      (event) => {
        const checkRes = event.payload;
        set((state) => {
          // Update sites list with new result
          const updatedSites = state.sites.map((s) => {
            if (s.id === checkRes.site_id) {
              return { ...s, latest_result: checkRes };
            }
            return s;
          });

          // Prepend check result to history
          const prevHistory = state.histories[checkRes.site_id] || [];
          const updatedHistory = [checkRes, ...prevHistory].slice(0, 50);

          return {
            sites: updatedSites,
            histories: {
              ...state.histories,
              [checkRes.site_id]: updatedHistory,
            },
          };
        });
      }
    );

    const unlistenNavigate = await listen<string>("navigate", (event) => {
      const dest = event.payload as any;
      set({ currentRoute: dest });
    });

    return () => {
      unlistenStatus();
      unlistenNavigate();
    };
  },
}));
