# Weave

A modern [Matrix](https://matrix.org) protocol desktop chat client built with Tauri 2, React 19, and TypeScript. Weave focuses on a clean multi-account experience with end-to-end encryption, spaces, and native desktop integration.

> Identifier: `com.antigravity.weave` · Version `0.1.0`

## Features

- **Multi-account** — sign in to multiple Matrix accounts and switch between them instantly.
- **End-to-end encryption** — E2EE backed by the matrix-js-sdk Rust/WASM crypto stack, with secret storage, key backup, and device verification.
- **OS keychain integration** — recovery keys are stored securely in the native OS keychain, keyed by Matrix user ID so they survive token refresh and re-login.
- **Spaces** — browse and filter rooms by Matrix spaces, with a dedicated space switcher.
- **Rich timeline** — message edits, reactions, redactions, late decryption, local echo, emoji picker, encrypted image rendering, typing indicators, and date separators.
- **Members & profiles** — member lists, user profile modals, and room info modals.
- **Native desktop integration** — system tray with unread tooltip, desktop notifications, and minimize-to-tray.
- **Theming** — light/dark theming with global design tokens.

## Tech Stack

| Layer | Technology |
|-------|-----------|
| UI & state | React 19, TypeScript 5.8, React Router 7, Zustand 5, Lucide React |
| Matrix | matrix-js-sdk 41 (Rust crypto via WASM) |
| Desktop shell | Tauri 2 (Rust) with plugins: notification, store, keyring, opener |
| Build | Vite 7, vite-plugin-node-polyfills, vite-plugin-wasm, vite-plugin-top-level-await |

## Architecture

Three layers communicate via Tauri IPC:

```
React + TypeScript (UI + state)
    ↕ Tauri IPC
Tauri / Rust (notifications, tray, OS keychain, persistent store)
    ↕ HTTP / WSS
Matrix homeserver (via matrix-js-sdk)
```

### State management

Zustand drives three stores:

- **`accountsStore`** — accounts list, active account, per-account sync state, E2EE unlock flags.
- **`roomsStore`** — room summaries per account, active space filter, and the space → children mapping.
- **`timelineStore`** — messages per room (capped at 500), typing indicators, and reactions.

### AccountManager

[`AccountManager`](src/accounts/AccountManager.ts) is the central hub. It creates and holds the matrix-js-sdk client instances, registers all SDK event listeners, and drives the three Zustand stores. A single instance is shared across the app (initialized in [App.tsx](src/App.tsx)).

### Storage

| What | Where |
|------|-------|
| Account configs (userId, deviceId, access token reference) | Tauri plugin-store (`accounts.json`) |
| E2EE recovery keys | OS keychain via the keyring plugin, keyed by Matrix `userId` |
| Message cache, sync tokens, crypto state | IndexedDB (managed by matrix-js-sdk) |

### Tauri commands

Defined in [src-tauri/src/lib.rs](src-tauri/src/lib.rs):

- `send_notification` — show a native desktop notification.
- `update_tray_tooltip` — update the tray tooltip with the current unread count.

Permissions are declared in [src-tauri/capabilities/default.json](src-tauri/capabilities/default.json).

## Getting Started

### Prerequisites

- [Node.js](https://nodejs.org) (LTS)
- [Rust](https://www.rust-lang.org/tools/install) toolchain
- Platform-specific Tauri dependencies — see the [Tauri prerequisites guide](https://v2.tauri.app/start/prerequisites/)

### Install

```bash
npm install
```

### Develop

```bash
# Frontend dev server only (Vite on port 1420)
npm run dev

# Full Tauri desktop app (spawns Vite internally)
npm run tauri dev
```

### Build

```bash
npm run build        # TypeScript check + Vite bundle
npm run tauri build  # Full desktop app bundle
```

### Type check

```bash
npx tsc --noEmit
```

> The Rust crypto runs as WASM and requires `public/matrix_sdk_crypto_wasm_bg.wasm` to be present.

## Project Structure

```
src/
  accounts/      AccountManager + credential store
  components/    UI components (timeline, member list, dialogs, modals, pickers)
  contexts/      Theme context
  hooks/         useTraySync and other hooks
  store/         Zustand stores (accounts, rooms, timeline)
  styles/        Global theme tokens
  types/         Matrix type definitions
  utils/         Reaction/message builders, user color helpers
  views/         AppLayout, LoginPage, RoomView, SettingsPage
src-tauri/       Rust backend (commands, tray, plugins)
```

## License

No license has been specified for this project yet.
