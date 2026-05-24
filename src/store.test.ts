import { describe, test, expect, beforeEach, vi } from "vitest";
import { useStore } from "./store";
import { invoke } from "@tauri-apps/api/core";

describe("SiteWatcher Store Tests", () => {
  beforeEach(() => {
    // Reset store state to initial defaults before each test
    useStore.setState({
      sites: [],
      settings: null,
      histories: {},
      isLoading: false,
      currentRoute: "popover",
      selectedSiteId: null,
    });
    vi.clearAllMocks();
  });

  test("should initialize with default states", () => {
    const state = useStore.getState();
    expect(state.sites).toEqual([]);
    expect(state.settings).toBeNull();
    expect(state.isLoading).toBe(false);
    expect(state.currentRoute).toBe("popover");
    expect(state.selectedSiteId).toBeNull();
  });

  test("should update current route via setRoute", () => {
    useStore.getState().setRoute("dashboard");
    expect(useStore.getState().currentRoute).toBe("dashboard");

    useStore.getState().setRoute("settings");
    expect(useStore.getState().currentRoute).toBe("settings");
  });

  test("should update selected site ID via selectSite", () => {
    useStore.getState().selectSite("some-site-uuid");
    expect(useStore.getState().selectedSiteId).toBe("some-site-uuid");

    useStore.getState().selectSite(null);
    expect(useStore.getState().selectedSiteId).toBeNull();
  });

  test("should load settings and update store", async () => {
    const mockSettings = {
      launch_at_startup: true,
      global_check_interval: 300,
      request_timeout: 10,
      ssl_warning_threshold: 30,
      response_time_warning: 2000,
      history_retention: 30,
      theme: "dark" as const,
      notification_cooldown: 900,
      user_agent: "SiteWatcher/1.0",
    };

    // Override mock invoke output for this test
    vi.mocked(invoke).mockResolvedValueOnce(mockSettings);

    await useStore.getState().loadSettings();

    expect(invoke).toHaveBeenCalledWith("get_settings");
    expect(useStore.getState().settings).toEqual(mockSettings);
  });

  test("should load sites and trigger history loading for each", async () => {
    const mockSites = [
      {
        id: "site-1",
        url: "https://google.com",
        name: "Google",
        check_interval_secs: 60,
        expected_status: 200,
        ssl_check: true,
        keyword_check: null,
        keyword_present: null,
        timeout_secs: 5,
        tags: [],
        enabled: true,
        created_at: "",
        latest_result: null,
      },
    ];

    vi.mocked(invoke)
      .mockResolvedValueOnce(mockSites) // for get_sites
      .mockResolvedValueOnce([]); // for get_site_history for site-1

    await useStore.getState().loadSites();

    expect(useStore.getState().isLoading).toBe(false);
    expect(useStore.getState().sites).toEqual(mockSites);
    expect(invoke).toHaveBeenCalledWith("get_sites");
    expect(invoke).toHaveBeenCalledWith("get_site_history", {
      siteId: "site-1",
      limit: 24,
    });
  });
});
