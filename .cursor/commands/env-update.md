# env-update

---
name: env-update
description: Use this when a task involves generating, syncing, or troubleshooting .env files using 1Password CLI. Trigger this for env setup on new machines, adding new env vars, rotating secrets, or debugging missing/stale environment variables across routines or routines-hatchery.
---

# 1Password Environment Variable Management

## SECURITY — MANDATORY RULES

- **NEVER** read, cat, print, or output `.env`, `.env.local`, or any resolved env file. These contain secrets.
- **NEVER** run `op inject` without the `-o` flag — that prints secrets to stdout.
- **NEVER** run `op item get --reveal`, `op read`, or any command that outputs secret values.
- **NEVER** run `cat`, `head`, `tail`, `grep`, or `less` on `.env` or `.env.local` files.
- **ONLY** use `make env` (writes to file silently) and `make env-check` (outputs pass/fail only).
- If debugging a missing var, check the `.tpl` template file (safe — contains only `op://` references, not values).

Shared environment variables are managed through 1Password CLI (`op`). Secrets live in the **"Routines"** vault on `density.1password.com`. Each repo has a `.tpl` template file committed to git with `op://` references instead of real values.

## Repos and Templates

| Repo | Template | Output | Command |
|------|----------|--------|---------|
| `routines` | `.env.local.tpl` | `.env.local` | `make env` |
| `routines-hatchery` | `.env.tpl` | `.env` | `make env` |

## Generate .env from 1Password

```bash
# routines
cd /Users/benjmarston/Develop/routines
make env

# routines-hatchery
cd /Users/benjmarston/Develop/routines-hatchery
make env
```

Or without Make:
```bash
op inject -i .env.local.tpl -o .env.local
```

## Validate all references resolve

```bash
make env-check
```

## Adding a new env var

1. **If it's a secret**: add the value to 1Password in the "Routines" vault, under the appropriate item (or create a new item). Then add the `op://Routines/ItemName/field` reference to the `.tpl` file.
2. **If it's config** (URL, flag, non-sensitive): add it as a plain value directly in the `.tpl` file.
3. Commit the `.tpl` change. Team members pull and re-run `make env`.

## Updating a secret value

Just update it in 1Password. No code change needed. Next `make env` picks it up.

## Rotating a secret

1. Update the value in 1Password
2. Team members re-run `make env`
3. No PR or template change required

## 1Password vault structure

Secrets are organized by service in the "Routines" vault:

- **Supabase Cloud** — url, anon_key, service_role_key, direct_url
- **Dashboard Supabase** — database_url, direct_url, service_role, database_direct_url
- **Postgres Core** — host, username, password
- **Google Maps** — api_key
- **Density** — factory_api_token, internal_api_key
- **Typeform** — api_key
- **ShipStation** — v1_key, v1_secret, v2_api_key
- **Stripe** — publishable_key, secret_key, webhook_secret
- **Stripe Prices** — base_monthly, base_annual, addon_monthly, addon_annual, hardware_3pack, hardware_single
- **Mapbox** — access_token
- **Resend** — api_key
- **EasyPost** — api_key, webhook_secret
- **Quo** — api_key, phone_number_id
- **Quo Hatchery** — api_key, phone_number_id, webhook_signing_key
- **ClickHouse** — host, username, password
- **Anthropic** — api_key
- **StatsIG** — client_key_dev, server_secret_dev
- **Routines Internal** — api_secret, agent_issuer_token
- **Routines JWT** — public_key, private_key
- **Hatchery** — worker_token, admin_token, control_plane_token, control_plane_url
- **Twilio** — account_sid, auth_token, phone_number
- **DigitalOcean** — api_token
- **Langfuse** — secret_key, public_key
- **HubSpot** — private_app_token, app_secret
- **Vercel** — api_token
- **DataDog** — api_key, app_key
- **Browser Use** — api_key
- **Face Recognition** — shared_secret
- **Ring Test** — user_email, phone, address, latitude, longitude, place_id, ring_app_url, ring_email, ring_password
- **LiteLLM** — master_key

## Prerequisites

Team members need:
1. 1Password desktop app: `brew install --cask 1password`
2. 1Password CLI: `brew install 1password-cli`
3. CLI integration enabled: 1Password > Settings > Developer > "Integrate with 1Password CLI"
4. Access to the "Routines" vault (admin grants this)

## Troubleshooting

- **"not signed in"**: Run `eval $(op signin)` or ensure the desktop app is unlocked
- **"item not found"**: Check vault access — run `op vault list` to confirm you can see "Routines"
- **"field not found"**: The item exists but the field name doesn't match the template. Run `op item get "ItemName" --vault "Routines"` to see available fields
