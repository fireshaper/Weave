import type { MatrixClient } from "matrix-js-sdk";

export type MediaSpec =
  | { type: "thumbnail"; width: number; height: number; method?: "crop" | "scale" }
  | { type: "download" };

/**
 * Build an HTTP(S) URL for an mxc:// URI via the SDK. When `useAuthentication`
 * is true this returns the authenticated `/_matrix/client/v1/media/...`
 * endpoint (MSC3916); otherwise the legacy `/_matrix/media/v3/...` endpoint.
 */
export function mxcToHttpUrl(
  client: MatrixClient,
  mxc: string,
  spec: MediaSpec,
  useAuthentication: boolean,
): string | null {
  if (spec.type === "thumbnail") {
    return client.mxcUrlToHttp(
      mxc,
      spec.width,
      spec.height,
      spec.method ?? "crop",
      false,
      false,
      useAuthentication,
    );
  }
  return client.mxcUrlToHttp(mxc, undefined, undefined, undefined, false, false, useAuthentication);
}

/**
 * Fetch media bytes for an mxc:// URI. Prefers the authenticated media
 * endpoint (sending the account's access token), and transparently falls back
 * to the legacy unauthenticated endpoint for older homeservers that predate
 * MSC3916. Throws if neither endpoint succeeds.
 */
export async function fetchMediaResponse(
  client: MatrixClient,
  mxc: string,
  spec: MediaSpec,
): Promise<Response> {
  const token = client.getAccessToken();
  const authedUrl = token ? mxcToHttpUrl(client, mxc, spec, true) : null;

  if (authedUrl) {
    try {
      const resp = await fetch(authedUrl, { headers: { Authorization: `Bearer ${token}` } });
      if (resp.ok) return resp;
      // 404/400 → server most likely doesn't support authenticated media yet;
      // fall through to the legacy endpoint. Other statuses fall through too as
      // a last resort before we surface an error.
    } catch {
      // Network error on the authed endpoint — try legacy before giving up.
    }
  }

  const legacyUrl = mxcToHttpUrl(client, mxc, spec, false);
  if (!legacyUrl) throw new Error(`Could not resolve mxc URL: ${mxc}`);
  const resp = await fetch(legacyUrl);
  if (!resp.ok) throw new Error(`HTTP ${resp.status} fetching media`);
  return resp;
}

/** Fetch media and wrap it in an object URL. Caller is responsible for
 *  revoking the returned URL with URL.revokeObjectURL when done. */
export async function fetchMediaObjectUrl(
  client: MatrixClient,
  mxc: string,
  spec: MediaSpec,
): Promise<string> {
  const resp = await fetchMediaResponse(client, mxc, spec);
  return URL.createObjectURL(await resp.blob());
}

/** Stable string key for a MediaSpec, for use in React dependency arrays. */
export function mediaSpecKey(spec: MediaSpec): string {
  return spec.type === "thumbnail"
    ? `t:${spec.width}x${spec.height}:${spec.method ?? "crop"}`
    : "d";
}
