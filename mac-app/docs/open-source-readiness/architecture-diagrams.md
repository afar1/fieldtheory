# Architecture Diagrams

Date: May 31, 2026

These diagrams summarize the current Mac app shape from code inspection. They are meant to help public readers orient themselves before reading the detailed docs.

**Renderer to main process**

```mermaid
flowchart LR
  Renderer["React renderer"]
  Preload["preload.ts capability bridge"]
  Main["Electron main process"]
  Local["Local files, databases, OS APIs"]
  Cloud["Supabase and account services"]
  Release["Updater and packaging services"]

  Renderer --> Preload
  Preload --> Main
  Main --> Local
  Main --> Cloud
  Main --> Release
```

**Local-first data model**

```mermaid
flowchart TD
  User["User action"]
  Library["~/.fieldtheory library and commands"]
  UserData["Electron userData"]
  Clipboard["clipboard.db and figures"]
  Account["Optional account session"]
  River["River shared documents"]
  Sync["Internal Library/command sync"]

  User --> Library
  User --> UserData
  UserData --> Clipboard
  UserData --> Account
  Account --> River
  Account --> Sync
  River --> Library
  Sync --> Library
```

**Account-backed surfaces**

```mermaid
flowchart LR
  Auth["authManager"]
  Session["supabase-session.json"]
  Account["accountIpc"]
  Quota["quotaIpc"]
  Metrics["metricsIpc"]
  River["sharedFiles/team services"]
  Supabase["Supabase"]

  Auth --> Session
  Auth --> Supabase
  Account --> Supabase
  Quota --> Supabase
  Metrics --> Supabase
  River --> Supabase
```

**Maintainer release boundary**

```mermaid
flowchart TD
  Contributor["Contributor"]
  Dev["dev, test, build"]
  Maintainer["Maintainer"]
  Package["package/package:experimental"]
  Signing["signing and notarization"]
  Feeds["GitHub release feeds"]
  Updater["packaged app updater"]

  Contributor --> Dev
  Maintainer --> Package
  Package --> Signing
  Signing --> Feeds
  Feeds --> Updater
```
