import React, { useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { createClient } from "matrix-js-sdk";
import { v4 as uuidv4 } from "uuid";
import { LogIn, Server, User, Lock, Eye, EyeOff, Loader2, AlertCircle } from "lucide-react";
import { accountManager } from "../accounts/AccountManager";
import { saveAccount } from "../accounts/credentialStore";
import { useAccountsStore } from "../store/accountsStore";
import type { AccountConfig } from "../types/matrix";
import "./LoginPage.css";

const LoginPage: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const sessionExpired = (location.state as any)?.reason === "session_expired";
  const addAccount = useAccountsStore((s) => s.addAccount);

  const [homeserver, setHomeserver] = useState("https://matrix.org");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const hs = homeserver.trim().replace(/\/$/, "");
      const tempClient = createClient({ baseUrl: hs });

      const response = await tempClient.login("m.login.password", {
        user: username.trim(),
        password,
        initial_device_display_name: "Weave",
      });

      const config: AccountConfig = {
        id: uuidv4(),
        userId: response.user_id,
        homeserver: hs,
        accessToken: response.access_token,
        deviceId: response.device_id,
      };

      // Fetch profile info
      try {
        const profileClient = createClient({
          baseUrl: hs,
          accessToken: response.access_token,
          userId: response.user_id,
          deviceId: response.device_id,
        });
        const profile = await profileClient.getProfileInfo(response.user_id);
        config.displayName = profile.displayname;
        config.avatarUrl = profile.avatar_url ?? undefined;
      } catch {
        // non-fatal
      }

      await saveAccount(config);
      addAccount(config);
      await accountManager.addAccount(config);
      navigate("/app", { replace: true });
    } catch (err: any) {
      console.error(err);
      const msg = err?.data?.error ?? err?.message ?? "Login failed";
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-page">
      <div className="login-bg-orbs">
        <div className="orb orb-1" />
        <div className="orb orb-2" />
        <div className="orb orb-3" />
      </div>

      <div className="login-card">
        <div className="login-header">
          <div className="login-logo">
            <span className="login-logo-icon">W</span>
          </div>
          <h1>Welcome back</h1>
          <p>Sign in to your Weave account</p>
        </div>

        <form className="login-form" onSubmit={handleLogin}>
          {sessionExpired && (
            <div className="login-error" role="alert" style={{ marginBottom: 12 }}>
              <AlertCircle size={15} />
              <span>Your session has expired. Please sign in again.</span>
            </div>
          )}
          <div className="login-field">
            <label htmlFor="homeserver">
              <Server size={14} /> Homeserver
            </label>
            <input
              id="homeserver"
              type="url"
              value={homeserver}
              onChange={(e) => setHomeserver(e.target.value)}
              placeholder="https://matrix.org"
              required
              autoComplete="url"
            />
          </div>

          <div className="login-field">
            <label htmlFor="username">
              <User size={14} /> Username
            </label>
            <input
              id="username"
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="@user:matrix.org  or  user"
              required
              autoComplete="username"
            />
          </div>

          <div className="login-field">
            <label htmlFor="password">
              <Lock size={14} /> Password
            </label>
            <div className="login-field-row">
              <input
                id="password"
                type={showPassword ? "text" : "password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                required
                autoComplete="current-password"
              />
              <button
                type="button"
                className="login-eye-btn"
                onClick={() => setShowPassword((v) => !v)}
                aria-label="Toggle password visibility"
              >
                {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </div>

          {error && (
            <div className="login-error" role="alert">
              <AlertCircle size={15} />
              <span>{error}</span>
            </div>
          )}

          <button type="submit" className="login-btn" disabled={loading}>
            {loading ? (
              <><Loader2 size={16} className="login-spinner" /> Signing in…</>
            ) : (
              <><LogIn size={16} /> Sign In</>
            )}
          </button>
        </form>

        <p className="login-footer">
          New to Matrix?{" "}
          <a href="https://app.element.io/#/register" target="_blank" rel="noreferrer">
            Create an account
          </a>
        </p>
      </div>
    </div>
  );
};

export default LoginPage;
