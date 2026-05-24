import { useEffect, useState } from "react";
import { useStore } from "./store";
import { StatusPopover } from "./components/StatusPopover";
import { Dashboard } from "./components/Dashboard";

function App() {
  const { initListener, settings, loadSettings } = useStore();
  const [windowLabel, setWindowLabel] = useState<string>("main");
  const [ready, setReady] = useState(false);

  useEffect(() => {
    // 1. Initialize backend listeners
    let cleanup: (() => void) | undefined;
    initListener().then((cb) => {
      cleanup = cb;
    });

    // 2. Load global settings (including theme)
    loadSettings();

    // 3. Identify current window type (popover vs main dashboard)
    import("@tauri-apps/api/window").then(({ getCurrentWindow }) => {
      const appWindow = getCurrentWindow();
      setWindowLabel(appWindow.label);
      setReady(true);

      // Hide popover if it loses focus (blur) to give a native widget feel
      if (appWindow.label === "popover") {
        const unlisten = appWindow.onFocusChanged(({ payload: focused }) => {
          if (!focused) {
            appWindow.hide();
          }
        });
        return () => {
          unlisten.then((f) => f());
        };
      }
    });

    return () => {
      if (cleanup) cleanup();
    };
  }, []);

  // Theme application effect
  useEffect(() => {
    if (!settings) return;

    const applyTheme = (t: "light" | "dark" | "system") => {
      const root = document.documentElement;
      let isDark = t === "dark";

      if (t === "system") {
        isDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
      }

      if (isDark) {
        root.classList.add("dark");
      } else {
        root.classList.remove("dark");
      }
    };

    applyTheme(settings.theme);

    if (settings.theme === "system") {
      const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
      const handler = (e: MediaQueryListEvent) => {
        if (e.matches) {
          document.documentElement.classList.add("dark");
        } else {
          document.documentElement.classList.remove("dark");
        }
      };
      mediaQuery.addEventListener("change", handler);
      return () => mediaQuery.removeEventListener("change", handler);
    }
  }, [settings?.theme]);

  if (!ready) {
    return (
      <div className="w-screen h-screen flex items-center justify-center bg-neutral-950 text-zinc-400 text-xs">
        Loading SiteWatcher...
      </div>
    );
  }

  // Render the appropriate view depending on which window was opened!
  if (windowLabel === "popover") {
    return <StatusPopover />;
  }

  return <Dashboard />;
}

export default App;
