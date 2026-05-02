# Field Theory (Mac)

This is a minimal Electron + Vite desktop viewer for Supabase data. It shares the same OTP sign-in flow as the mobile app and lists todos, observations, and transcripts.

## Setup

1. Copy `.env.example` to `.env.local` and fill in `VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY`.
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
4. Request a code via email, verify the OTP, and press **Refresh** to load your lists.

For production builds, run `npm run build` and then `npm start` to launch Electron against the compiled assets.

## URL Protocol

Packaged production builds register the `fieldtheory://` URL scheme for deep links from the CLI and other local tools.
Development and experimental builds do not register that scheme by default.
To test protocol registration locally, launch the app with `FT_REGISTER_FIELD_THEORY_PROTOCOL=true npm run dev`.
