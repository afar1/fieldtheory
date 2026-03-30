# Field Theory Settings — Bookmarks Panel

## Purpose

The settings page should **not** execute installation/setup directly.
It should:
- explain what Bookmarks does
- show current status
- show exact CLI commands to run
- help the user understand what is enabled and what data is stored locally

The CLI remains authoritative for actions.

---

## Panel title

**Field Theory Bookmarks**

---

## Disabled state

### Status
- Connected: No
- Dataset initialized: No
- Bookmarks stored locally: 0

### Description
Sync your X bookmarks into a local Field Theory corpus so agents can search, retrieve, and analyze them over time.

### Setup instructions
Run in terminal:

```bash
cd ~/dev/field-theory/tools/cli
ft bookmarks enable
```

### Help text
This will:
- authenticate with X
- pull bookmarks into local storage
- initialize the bookmarks dataset
- prepare the corpus for future syncs and analysis

---

## Enabled state

### Status fields
- Connected: Yes / No
- Dataset initialized: Yes / No
- Bookmarks stored locally: <count>
- Last updated: <timestamp>
- Sync mode: API sync
- Historical completeness: API may expose only part of your bookmarks; browser backfill can recover older ones

### Suggested actions
#### Sync now
```bash
cd ~/dev/field-theory/tools/cli
ft bookmarks sync
```

#### View summary
```bash
cd ~/dev/field-theory/tools/cli
ft bookmarks summary
```

#### Enable daily updates
```bash
cd ~/dev/field-theory/tools/cli
ft job enable --id x-bookmarks --cron "0 7 * * *"
```

#### Backfill older bookmarks (future)
```bash
cd ~/dev/field-theory/tools/cli
ft bookmarks backfill
```

---

## Tone / UX guidance

The settings page should feel:
- informative
- trustworthy
- CLI-native
- copy-paste friendly

It should avoid pretending the GUI is the control plane.
The GUI explains and reflects state; the CLI performs the actions.
