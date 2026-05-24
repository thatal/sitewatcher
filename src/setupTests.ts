import "@testing-library/jest-dom";
import { vi } from "vitest";

// Mock Tauri core API
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn((cmd, _args) => {
    if (cmd === "get_sites") {
      return Promise.resolve([]);
    }
    if (cmd === "get_settings") {
      return Promise.resolve({
        launch_at_startup: true,
        global_check_interval: 300,
        request_timeout: 10,
        ssl_warning_threshold: 30,
        response_time_warning: 2000,
        history_retention: 30,
        theme: "system",
        notification_cooldown: 900,
        user_agent: "SiteWatcher/1.0",
      });
    }
    return Promise.resolve(null);
  }),
}));

// Mock Tauri event API
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(() => Promise.resolve(() => {})), // returns unlisten fn
}));

// Mock Tauri window API
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: vi.fn(() => ({
    label: "main",
    show: vi.fn().mockResolvedValue(undefined),
    hide: vi.fn().mockResolvedValue(undefined),
    setFocus: vi.fn().mockResolvedValue(undefined),
    moveWindow: vi.fn().mockResolvedValue(undefined),
    isVisible: vi.fn().mockResolvedValue(true),
  })),
}));

// Mock Tauri webviewWindow API
vi.mock("@tauri-apps/api/webviewWindow", () => ({
  WebviewWindow: {
    getByLabel: vi.fn(() => ({
      show: vi.fn().mockResolvedValue(undefined),
      setFocus: vi.fn().mockResolvedValue(undefined),
    })),
  },
}));

// Mock ResizeObserver which is needed by Recharts in jsdom
class ResizeObserverMock {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver = ResizeObserverMock;
