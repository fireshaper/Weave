import React, { useEffect, useRef, useState } from "react";
import type { MatrixMessage } from "../types/matrix";
import { accountManager } from "../accounts/AccountManager";
import { useAccountsStore } from "../store/accountsStore";
import { fetchMediaResponse } from "../utils/media";
import { useLightboxStore } from "../store/lightboxStore";

interface EncryptedImageProps {
  encryptedFile: NonNullable<MatrixMessage["encryptedFile"]>;
  alt?: string;
  className?: string;
}

/**
 * Downloads and decrypts a Matrix encrypted media attachment (content.file)
 * using the Web Crypto API per the Matrix spec §11.5 (AES-256-CTR).
 *
 * The encrypted blob is downloaded via the authenticated media endpoint (with a
 * legacy fallback), decrypted client-side, and exposed as an object URL.
 */
const EncryptedImage: React.FC<EncryptedImageProps> = ({
  encryptedFile,
  alt = "Attachment",
  className,
}) => {
  const activeAccountId = useAccountsStore((s) => s.activeAccountId);
  const openLightbox = useLightboxStore((s) => s.open);
  const [objectUrl, setObjectUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const revokeRef = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function decrypt() {
      try {
        // 1. Validate the mxc:// URI
        const mxcUrl = encryptedFile.url;
        if (!mxcUrl?.startsWith("mxc://")) {
          throw new Error(`Invalid mxc URL: ${mxcUrl}`);
        }

        const client = activeAccountId ? accountManager.getClient(activeAccountId) : undefined;
        if (!client) throw new Error("No active Matrix client to download media");

        // 2. Fetch the encrypted blob (authenticated endpoint, legacy fallback)
        const resp = await fetchMediaResponse(client, mxcUrl, { type: "download" });
        const encryptedBuffer = await resp.arrayBuffer();

        // 3. Verify the ciphertext integrity BEFORE decrypting (Matrix spec
        //    §11.5: hashes.sha256 is an unpadded-base64 SHA-256 of the
        //    ciphertext). A mismatch means the homeserver/CDN served tampered
        //    or corrupt data — refuse to decrypt or display it.
        const expectedHash = encryptedFile.hashes?.sha256;
        if (expectedHash) {
          const digest = await crypto.subtle.digest("SHA-256", encryptedBuffer);
          const actualHash = bytesToBase64(new Uint8Array(digest));
          if (normalizeBase64(actualHash) !== normalizeBase64(expectedHash)) {
            throw new IntegrityError("Media failed its SHA-256 integrity check");
          }
        }

        // 4. Import the AES key (base64url → raw bytes)
        const rawKey = base64urlDecode(encryptedFile.key.k);
        const cryptoKey = await crypto.subtle.importKey(
          "raw",
          rawKey,
          { name: "AES-CTR" },
          false,
          ["decrypt"],
        );

        // 5. Decode the IV – Matrix spec stores it base64-encoded but zero-pads the
        //    last 8 bytes to form a 16-byte AES block.  We use the first 8 bytes as
        //    the actual counter nonce (the high 64 bits of the 128-bit AES-CTR block).
        const iv = base64Decode(encryptedFile.iv);

        // 6. Decrypt (AES-256-CTR, 64-bit counter)
        const decrypted = await crypto.subtle.decrypt(
          { name: "AES-CTR", counter: iv, length: 64 },
          cryptoKey,
          encryptedBuffer,
        );

        if (cancelled) return;

        // 7. Create a blob URL so the browser can display it
        const blob = new Blob([decrypted]);
        const url = URL.createObjectURL(blob);
        revokeRef.current = url;
        setObjectUrl(url);
      } catch (e) {
        if (!cancelled) {
          console.error("[EncryptedImage] Failed to decrypt media:", e);
          setError(e instanceof IntegrityError ? "Integrity check failed" : "Failed to load image");
        }
      }
    }

    decrypt();

    return () => {
      cancelled = true;
      if (revokeRef.current) {
        URL.revokeObjectURL(revokeRef.current);
        revokeRef.current = null;
      }
    };
  // Only re-run if the file reference or active account changes
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [encryptedFile.url, activeAccountId]);

  if (error) {
    return <span className="msg-body" style={{ color: "var(--text-muted)", fontStyle: "italic" }}>🔒 {error}</span>;
  }

  if (!objectUrl) {
    return (
      <span className="msg-body" style={{ color: "var(--text-muted)", fontStyle: "italic" }}>
        🔒 Decrypting image…
      </span>
    );
  }

  return (
    <img
      src={objectUrl}
      alt={alt}
      className={className}
      style={{ cursor: "zoom-in" }}
      onClick={() => openLightbox(objectUrl, alt)}
    />
  );
};

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Thrown when downloaded ciphertext fails its SHA-256 hash check. */
class IntegrityError extends Error {}

/** Encode raw bytes as standard (padded) base64. */
function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

/** Normalize a base64 string for comparison: map URL-safe chars to the standard
 *  alphabet and drop trailing padding (Matrix hashes are unpadded base64). */
function normalizeBase64(b64: string): string {
  return b64.replace(/-/g, "+").replace(/_/g, "/").replace(/=+$/, "");
}

/** Decode a base64url string to a Uint8Array */
function base64urlDecode(b64url: string): Uint8Array {
  // base64url → base64: replace URL-safe chars and pad
  const b64 = b64url.replace(/-/g, "+").replace(/_/g, "/");
  return base64Decode(b64);
}

/** Decode a standard base64 string to a Uint8Array */
function base64Decode(b64: string): Uint8Array {
  const padded = b64.padEnd(b64.length + ((4 - (b64.length % 4)) % 4), "=");
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

export default EncryptedImage;
