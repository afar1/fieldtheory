# Field Theory (Mac)

This is the Electron + Vite macOS app for Field Theory.
The release build is local-first by default: core tools work without requiring login, and unfinished Field Theory cloud sync is gated for internal users only.
Clipboard history is local-only and must never be synced by Field Theory.

## Setup

1. Copy `.env.example` to `.env.local` and fill in `VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY` when testing Supabase-backed auth, feedback, or internal sync surfaces.
2. Install dependencies:
   ```bash
   cd mac-app
   npm install
   ```
3. Start the app in development mode:
   ```bash
   npm run dev
   ```
   - Vite serves the renderer on port 5173.
   - Electron launches once the dev server is ready.
4. Launch the app. Login is optional for local tools; use OTP only when testing authenticated surfaces.

For production builds, run `npm run build` and then `npm start` to launch Electron against the compiled assets.

## URL Protocol

Packaged production builds register the `fieldtheory://` URL scheme for deep links from the CLI and other local tools.
Development and experimental builds do not register that scheme by default.
To test protocol registration locally, launch the app with `FT_REGISTER_FIELD_THEORY_PROTOCOL=true npm run dev`.
