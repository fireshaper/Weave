import { useEffect, useState } from "react";
import { accountManager } from "../accounts/AccountManager";
import { useAccountsStore } from "../store/accountsStore";
import { fetchMediaObjectUrl, mediaSpecKey, type MediaSpec } from "../utils/media";

interface AuthedMediaResult {
  /** Displayable URL (object URL for mxc media, or the original http(s) URL). */
  url: string | null;
  loading: boolean;
  error: boolean;
}

/**
 * Resolves an mxc:// URI to a displayable object URL by downloading it through
 * the authenticated media endpoint with the relevant account's access token.
 *
 * - http(s) URLs are returned unchanged.
 * - Defaults to the active account; pass `accountId` to fetch with a specific
 *   account's token (needed when rendering another account's avatar, e.g. in
 *   the account switcher, since authenticated media is scoped per homeserver).
 * - Returns `url: null` while loading or on failure so callers can fall back to
 *   a placeholder.
 */
export function useAuthedMedia(
  src: string | undefined,
  spec: MediaSpec,
  accountId?: string,
): AuthedMediaResult {
  const activeAccountId = useAccountsStore((s) => s.activeAccountId);
  const effectiveAccountId = accountId ?? activeAccountId;

  const [url, setUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!src) {
      setUrl(null);
      setError(false);
      setLoading(false);
      return;
    }
    if (src.startsWith("http")) {
      setUrl(src);
      setError(false);
      setLoading(false);
      return;
    }
    if (!src.startsWith("mxc://")) {
      setUrl(null);
      setError(true);
      setLoading(false);
      return;
    }

    const client = effectiveAccountId ? accountManager.getClient(effectiveAccountId) : undefined;
    if (!client) {
      setUrl(null);
      setError(true);
      setLoading(false);
      return;
    }

    let cancelled = false;
    let objectUrl: string | null = null;
    setLoading(true);
    setError(false);

    fetchMediaObjectUrl(client, src, spec)
      .then((u) => {
        if (cancelled) {
          URL.revokeObjectURL(u);
          return;
        }
        objectUrl = u;
        setUrl(u);
      })
      .catch(() => {
        if (!cancelled) {
          setError(true);
          setUrl(null);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
    // `spec` is a fresh object each render — key on its stable serialization.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [src, effectiveAccountId, mediaSpecKey(spec)]);

  return { url, loading, error };
}
