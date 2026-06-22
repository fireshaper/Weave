# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**Weave** is a Matrix protocol desktop chat client (identifier: `com.antigravity.weave`) built with Tauri 2 (Rust backend) + React 19 + TypeScript. It supports E2EE via the matrix-js-sdk Rust/WASM crypto backend, multi-account management, spaces, and system tray integration.

## Commands

```bash
# Frontend dev server (Vite on port 1420)
npm run dev

# Full Tauri desktop app (spawns Vite internally)
npm run tauri dev

# Production build
npm run build          # TypeScript check + Vite bundle
npm run tauri build    # Full desktop app bundle

# Type check only
npx tsc --noEmit
```

There is no test suite currently.

## Architecture

Three layers communicate via Tauri IPC:

```
React + TypeScript (UI + state)
    ↕ Tauri IPC
Tauri/Rust (notifications, tray, OS keychain, persistent store)
    ↕ HTTP
Matrix homeserver (via matrix-js-sdk)
```

**State management** uses Zustand with three stores:
- `accountsStore` — accounts list, active account, per-account sync state, E2EE unlock flags
- `roomsStore` — room summaries per account, active space filter, space→children mapping
- `timelineStore` — messages per room (capped at 500), typing indicators, reactions

**`AccountManager`** (`src/accounts/AccountManager.ts`) is the central hub. It creates and holds matrix-js-sdk client instances, registers all SDK event listeners, and drives all three Zustand stores. One `AccountManager` instance is shared across the app (initialized in `App.tsx`).

## Key Data Flows

### Startup / Account Loading
1. `App.tsx` loads persisted accounts from Tauri store → calls `accountManager.addAccount()` for each
2. `addAccount()` creates an IndexedDB-backed matrix client keyed by `userId:deviceId`, starts sync with `lazyLoadMembers: true`
3. `AppLayout.tsx` watches for sync state `PREPARED` → attempts E2EE auto-unlock from OS keychain; if no key found, shows `KeyUnlockDialog`

### E2EE Unlock Flow
- Keys are stored in OS keychain keyed by Matrix `userId` (stable across re-logins)
- Auto-unlock: `bootstrapSecretStorage` + `restoreKeyBackup` called silently if key exists
- Manual unlock: `KeyUnlockDialog` accepts recovery key or passphrase; saves to keychain on success
- Users can skip unlock (banner shown to re-unlock later)

### Message Pipeline
`RoomEvent.Timeline` → `AccountManager` handler → appends to `timelineStore` (deduplicating on `eventId`)
- Edits (`m.replace` relation): updates existing message in place
- Reactions: tracked separately with "my reactions" for redaction support
- Local echo: `RoomEvent.LocalEchoUpdated` swaps temp IDs → real server IDs
- Late decryption: `MatrixEventEvent.Decrypted` updates already-stored messages

## Storage Strategy

| What | Where |
|------|-------|
| Account configs (userId, deviceId, accessToken reference) | Tauri plugin-store (`accounts.json`) |
| E2EE recovery keys | OS keychain via `tauri-plugin-keyring`, key = Matrix `userId` |
| Message cache, sync tokens, crypto state | IndexedDB (matrix-js-sdk managed) |

## Important Patterns

**Stable IDs**: Account UUIDs and IndexedDB prefixes are stable across re-login sessions. E2EE keys are keyed by `userId` not account UUID, so they survive token refresh.

**Space hierarchy**: `roomsStore` builds a `roomId → Set<spaceId>` map from `m.space.child` state events. `RoomList` filters by `activeSpaceId`; "home" shows all rooms.

**Reaction aggregation**: Uses SDK's built-in relation store via `src/utils/buildReactions.ts`. Reactions are immutable objects; redaction removes them.

**CSS**: Per-component CSS files with BEM-like kebab-case class names. Global tokens in `src/styles/theme.css`.

**Tauri commands** are defined in `src-tauri/src/lib.rs`: `send_notification`, `update_tray_tooltip`. Permissions are declared in `src-tauri/capabilities/default.json`.

## Tech Stack Versions

- React 19, TypeScript 5.8, Vite 7, React Router v7
- Zustand 5, matrix-js-sdk 41, Lucide React
- Tauri 2 with plugins: notification, store, keyring, opener
- Rust crypto runs as WASM (requires `public/matrix_sdk_crypto_wasm_bg.wasm`)
- Node polyfills via `vite-plugin-node-polyfills` (crypto, buffer needed by SDK)
