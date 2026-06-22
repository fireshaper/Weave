import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import { ThemeProvider } from "./contexts/ThemeContext";
import { ErrorBoundary } from "react-error-boundary";
import "./styles/theme.css";
import "./index.css";

const ErrorFallback = ({ error }: { error: any }) => (
  <div style={{ padding: 20, color: "red", backgroundColor: "black", flex: 1, minHeight: "100vh" }}>
    <h2>Application crashed on startup:</h2>
    <pre style={{ whiteSpace: "pre-wrap", background: "#f8d7da", color: "black", padding: 10, borderRadius: 4 }}>
      {error?.message || String(error)}
      {"\n"}
      {error?.stack}
    </pre>
  </div>
);

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <ErrorBoundary FallbackComponent={ErrorFallback}>
      <BrowserRouter>
        <ThemeProvider>
          <App />
        </ThemeProvider>
      </BrowserRouter>
    </ErrorBoundary>
  </React.StrictMode>
);

// Suppress the native browser right-click context menu globally.
// The app provides its own context menus for interactive elements.
document.addEventListener("contextmenu", (e) => e.preventDefault());

// ── SDK noise suppression ────────────────────────────────────────────────────
// The Rust crypto backend occasionally emits a benign 400 "One time key already
// exists" error when the server-side OTK state is ahead of the local crypto DB.
// This happens after the crypto DB prefix was changed, and naturally resolves once
// other devices claim the server's existing keys. The SDK handles it internally —
// encryption never breaks — so we suppress the console noise here.
{
  const _origError = console.error.bind(console);
  console.error = (...args: unknown[]) => {
    const msg = typeof args[0] === "string" ? args[0] : String(args[0] ?? "");
    if (
      msg.includes("Failed to process outgoing request") &&
      msg.includes("One time key") &&
      msg.includes("already exists")
    ) {
      // Demote to a one-time debug note so developers can still find it if needed.
      console.debug("[SDK/crypto] Suppressed benign OTK-already-exists 400 (server state ahead of local DB).");
      return;
    }
    _origError(...args);
  };
}

// Dismiss the splash screen once React has painted its first frame.
// Double-rAF ensures the browser has composited at least one frame before we hide.
requestAnimationFrame(() => {
  requestAnimationFrame(() => {
    const splash = document.getElementById("splash");
    if (splash) {
      splash.classList.add("fade-out");
      // Remove from DOM after the CSS transition completes
      splash.addEventListener("transitionend", () => splash.remove(), { once: true });
    }
  });
});
