# Mobile Library Sync

The first supported publish slice lives in the Mac native sync layer.

Agents and CLI tools can publish one existing local Library markdown file through the authenticated Mac app surfaces:

- Renderer IPC: `fieldTheorySync:publishLibraryDocument`
- Browser helper: `POST /native/field-theory-sync/publish-library-document` with `{ "filePath": "/absolute/path/to/doc.md" }`

The publish path uses the Mac app `AuthManager` session and writes the selected document to the `library_documents` table with the same `source_path`, `source_kind`, `content_hash`, and `client_id` shape as background Library sync.

Status is available through:

- Renderer IPC: `fieldTheorySync:getLibraryStatus`
- Browser helper: `GET /native/field-theory-sync/library-status`

Status reports whether Library sync is ready, the last sync and push timestamps, the last error, and the count of pending local documents when auth and cloud sync are available.

Remaining CLI hook: add `ft mobile publish <doc>` or `ft library sync --file <doc>` as a thin browser-helper client. It should discover the local browser-helper address/token, call the publish endpoint, and print the structured `reason` values directly, especially `not_authenticated` and `sync_disabled`.
