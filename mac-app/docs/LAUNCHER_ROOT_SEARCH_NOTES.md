# Launcher Root Search Notes

This branch starts the broader Alfred/Raycast-style root search with app launching and a warmed file index. The result model now names the planned root-search kinds so future slices can add behavior without changing the portable-command contract.

Open decisions before expanding beyond apps:

- System settings coverage: decide whether to use a curated list of `x-apple.systempreferences:` URLs first, or a generated index of panes.
- Contacts and calendar: decide whether these should use macOS Contacts/Calendar permissions directly or an app connector path, and define the empty-permission state before indexing anything.
- General files and recent documents: apostrophe-prefixed file search now uses a warmed Field Theory index for common user file roots and the Field Theory library. A later custom index should add user-selected roots plus FSEvents so updates flow in without periodic rebuilds.
- URLs and web searches: define syntax for direct URLs versus web search queries so ordinary launcher searches do not unexpectedly open a browser.
- Natural-language parsing depth: decide which phrases should become actions from root search, and which should remain ordinary text search.
- Calculator, units, currency, and time zones: choose local-only parsing where possible, and decide whether exchange rates require live data.
- Dictionary and spelling: decide whether to route through the system Dictionary app, a local dictionary source, or web fallback.
- System commands: keep destructive or session-changing actions behind confirmation. Lock and sleep are safer than restart, shutdown, erase, or logout.
- Terminal commands: decide whether root search should run commands directly, open a terminal with the command prefilled, or create a confirm-first handoff.
