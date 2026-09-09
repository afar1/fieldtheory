import SwiftUI

struct VoiceDeliveryView: View {
    let item: TranscriptItem
    let onSend: () -> Void
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss

    private var store: TranscriptStore { model.transcripts }
    private var events: [VoiceDeliveryEvent] { store.events(for: item) }

    var body: some View {
        NavigationStack {
            List {
                Section("Delivery") {
                    Text(VoiceDelivery.status(item: item, events: events, receipt: store.receipt(for: item)))
                        .font(.headline)
                    LabeledContent("Saved on phone", value: item.createdAtMs.msToDate.formatted(date: .abbreviated, time: .standard))
                    if item.isCloudSaved && !events.contains(where: { $0.stage == "uploaded" }) {
                        Text("Upload confirmed. Its server timestamp is unavailable.").foregroundStyle(.secondary)
                    }
                    ForEach(Array(events.enumerated()), id: \.element.id) { index, event in
                        VStack(alignment: .leading, spacing: 4) {
                            Text(VoiceDelivery.label(event.stage))
                            Text(event.time_source == "server" ? "Server timestamp" : event.time_source == "codex" ? "Reported by Codex" : "Observed by Mac")
                                .font(.caption2).foregroundStyle(.secondary)
                            if let date = event.date {
                                Text(date.formatted(date: .abbreviated, time: .standard)).font(.caption).foregroundStyle(.secondary)
                                if index > 0, let previous = events[index - 1].date, date >= previous {
                                    Text("\(Int(date.timeIntervalSince(previous))) seconds after previous stage")
                                        .font(.caption).foregroundStyle(.secondary)
                                }
                            }
                        }
                    }
                    if let receipt = store.receipt(for: item), ["failed", "needs_user"].contains(receipt.status), let summary = receipt.summary, !summary.isEmpty {
                        Text(summary)
                    }
                    if events.isEmpty {
                        Text("Detailed delivery history is not available yet. Status is based on confirmed upload and agent receipts.").font(.caption).foregroundStyle(.secondary)
                    }
                    if !item.wasSentToAgent && item.actionPolicy != "send" {
                        Button("Send to agent") { dismiss(); onSend() }
                    }
                }
                Section("Mac observations") {
                    let workerIDs = Set(events.compactMap(\.worker_id))
                    ForEach(store.runnerPresence.filter { workerIDs.isEmpty || workerIDs.contains($0.worker_id) }, id: \.worker_id) { presence in
                        VStack(alignment: .leading, spacing: 4) {
                            if workerIDs.isEmpty { Text("Account Mac — not yet assigned").font(.caption) }
                            Text(presence.online == true ? "Network last observed available" : presence.online == false ? "Network last observed unavailable" : "Network state unavailable")
                            if let heard = VoiceDelivery.date(presence.last_seen_at) {
                                Text("Last heard \(heard.formatted(.relative(presentation: .named)))" + (Date().timeIntervalSince(heard) > 90 ? " · Stale" : ""))
                                    .font(.caption).foregroundStyle(.secondary)
                            }
                            Text(presence.sleeping == true ? "Last observed asleep" : presence.locked == true ? "Last observed locked" : presence.locked == false ? "Last observed unlocked" : "Lock state unavailable")
                            if let date = VoiceDelivery.date(presence.observed_at ?? presence.last_seen_at) {
                                Text(date.formatted(date: .abbreviated, time: .standard) + (Date().timeIntervalSince(date) > 90 ? " · Stale observation" : "")).font(.caption).foregroundStyle(.secondary)
                            }
                        }
                    }
                    ForEach(store.runnerEvents.filter {
                        (workerIDs.isEmpty || workerIDs.contains($0.worker_id)) && ($0.date ?? .distantPast) >= item.createdAtMs.msToDate.addingTimeInterval(-300)
                    }.reversed()) { event in
                        LabeledContent(event.event == "network" ? (event.online == true ? "Network connected" : event.online == false ? "Network disconnected" : "Network changed") : event.event.capitalized, value: event.date?.formatted(date: .omitted, time: .standard) ?? "Time unavailable")
                    }
                    if workerIDs.isEmpty { Text("No Mac receipt yet.").foregroundStyle(.secondary) }
                    Text("Mac observations use the Mac’s clock. These timestamps show sequence, not proof that locking caused a delay.")
                        .font(.caption).foregroundStyle(.secondary)
                }
                Section {
                    if let refreshed = store.deliveryRefreshedAt {
                        Text("Last checked \(refreshed.formatted(date: .omitted, time: .standard))").font(.caption)
                    }
                    Button("Refresh") { Task { await model.sync.refreshDeliveryItem(item.id) } }
                }
            }
            .task(id: item.id) { await model.sync.refreshDeliveryItem(item.id) }
            .navigationTitle("Delivery timeline")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } } }
        }
    }
}
