# Field Theory iOS 1.0 (84)

Built from phone build 83's source, with the approved Local/River interface.
Local and River use matching neutral cards, subtle Share controls, and native
recipient selection. Agent navigation and card controls are removed.

Sharing uses the Mac's existing river_documents, river_document_targets and
river_document_audience tables and approved contacts/groups. It never adds a
public target. Text edits create separate snapshots; retries reuse the same
snapshot. Failures keep the sheet open and never report delivery as successful.
River uses Supabase realtime subscriptions with targeted document reconciliation,
foreground/reconnect catch-up, and no polling. Cached River data remains usable
offline. No backend migration is included.

Queued voice audio now gets one offline model-preparation retry on resume after
local preparation failure. A ready engine with queued audio says Waiting to
transcribe. The reported screenshot's original inference error was no longer
persisted on the phone, so this fixes confirmed recovery/label gaps rather than
claiming a reproduced diagnosis of that inference failure.

34 focused recorder, sign-out, reviewer-isolation, River moderation and sharing
snapshot tests passed in Simulator. Device signing/build and installation are
separate gates. Two-account delivery under two seconds and the original idle
startup failure still require physical runtime testing. No automatic messages
or test shares were sent to contacts.
