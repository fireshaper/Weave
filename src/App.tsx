import React, { useEffect } from "react";
import { Routes, Route, Navigate, useNavigate } from "react-router-dom";
import LoginPage from "./views/LoginPage";
import AppLayout from "./views/AppLayout";
import SettingsPage from "./views/SettingsPage";
import Lightbox from "./components/Lightbox";
import { useAccountsStore } from "./store/accountsStore";
import { accountManager } from "./accounts/AccountManager";
import { loadAccounts, deleteAccount } from "./accounts/credentialStore";

const App: React.FC = () => {
  const accounts = useAccountsStore((s) => s.accounts);
  const addAccount = useAccountsStore((s) => s.addAccount);
  const removeAccount = useAccountsStore((s) => s.removeAccount);
  const navigate = useNavigate();

  // On startup: hydrate persisted accounts and reconnect clients
  useEffect(() => {
    // Handle a revoked/expired access token — remove the account and force re-login.
    accountManager.onInvalidToken = async (accountId: string) => {
      console.warn(`[App] Account ${accountId} has an invalid token. Removing and redirecting to login.`);
      await accountManager.removeAccount(accountId);
      removeAccount(accountId);
      await deleteAccount(accountId);
      // NOTE: we intentionally do NOT delete the E2EE key here.
      // The recovery key belongs to the Matrix user (not the session),
      // so it should survive session expiry and be reusable on re-login.
      navigate("/login", { replace: true, state: { reason: "session_expired" } });
    };

    (async () => {
      const persisted = await loadAccounts();
      for (const config of persisted) {
        addAccount(config);
        await accountManager.addAccount(config);
      }
      if (persisted.length > 0) {
        navigate("/app", { replace: true });
      }
    })();
  }, []);

  return (
    <>
      <Routes>
      <Route
        path="/"
        element={accounts.length > 0 ? <Navigate to="/app" replace /> : <LoginPage />}
      />
      <Route path="/login" element={<LoginPage />} />
      <Route
        path="/app"
        element={accounts.length > 0 ? <AppLayout /> : <Navigate to="/" replace />}
      />
      <Route
        path="/app/settings"
        element={accounts.length > 0 ? <SettingsPage /> : <Navigate to="/" replace />}
      />
      </Routes>
      <Lightbox />
    </>
  );
};

export default App;
