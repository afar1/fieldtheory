import SwiftUI

/// An authenticated, durable report to the app-owned River report queue. It
/// makes no claim that filing a report removes content or resolves a concern.
struct RiverReportComposer: View {
    let item: RiverItem

    @Environment(AppModel.self) private var model
    @Environment(ToastCenter.self) private var toast
    @Environment(\.dismiss) private var dismiss

    @State private var reason: RiverReportReason = .harassment
    @State private var notes = ""
    @State private var reportID = UUID().uuidString
    @State private var submitting = false
    @State private var reportStatusUnknown = false
    @State private var submissionError: String?

    private var draft: RiverReportDraft {
        RiverReportDraft(
            item: item,
            reason: reason,
            notes: notes,
            reportID: reportID
        )
    }

    var body: some View {
        NavigationStack {
            Form {
                Section("What are you reporting?") {
                    Picker("Reason", selection: $reason) {
                        ForEach(RiverReportReason.allCases) { reason in
                            Text(reason.label).tag(reason)
                        }
                    }

                    TextField("Additional details (optional)", text: $notes, axis: .vertical)
                        .lineLimit(3...7)
                }

                Section("Report context") {
                    LabeledContent("Document", value: item.title)
                    LabeledContent("Author", value: item.authorLabel)
                    LabeledContent("Report ID", value: draft.reportID)
                    Text("The report includes this document and author context plus your notes. It does not copy the document content.")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }

                Section {
                    Text("Submitting creates a private report for Field Theory review. It does not remove the content, block the author for other people, or determine the outcome.")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }

                if model.isReviewerDemoStorage {
                    Section {
                        Text("Reporting is unavailable in Reviewer Demo. Demo fixtures are never sent to the Field Theory report queue.")
                            .font(.footnote)
                            .foregroundStyle(.secondary)
                    }
                } else if !model.canSubmitRiverReports {
                    Section {
                        Text("Sign in with an active connection to submit a report. You can still contact support from River safety.")
                            .font(.footnote)
                            .foregroundStyle(.secondary)
                    }
                }

                if let submissionError {
                    Section {
                        Text(submissionError)
                            .foregroundStyle(.red)
                    }
                }
            }
            .navigationTitle("Report content")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    if submitting {
                        ProgressView()
                    } else {
                        Button("Submit report") { submitReport() }
                            .disabled(!model.canSubmitRiverReports || reportStatusUnknown)
                            .accessibilityIdentifier("SubmitRiverReport")
                    }
                }
            }
        }
    }

    private func submitReport() {
        guard !model.isReviewerDemoStorage else {
            submissionError = "Reporting is unavailable in Reviewer Demo."
            return
        }
        guard let reporterID = model.auth.userId, model.canSubmitRiverReports else {
            submissionError = "Sign in with an active connection to submit a report."
            return
        }
        guard notes.count <= 2_000 else {
            submissionError = "Additional details must be 2,000 characters or fewer."
            return
        }
        submitting = true
        reportStatusUnknown = false
        submissionError = nil
        let frozenDraft = draft
        let frozenWorkspace = model.workspaceGeneration
        let client = model.auth.client
        Task {
            do {
                let result = try await RiverModerationService.submitReport(
                    frozenDraft,
                    reporterID: reporterID,
                    client: client
                )
                guard model.acceptsRiverReportResult(
                    workspace: frozenWorkspace,
                    reporterID: reporterID
                ) else { return }
                switch result {
                case .submitted, .confirmedAfterUnknownInsert:
                    toast.show("Report submitted for review", symbol: "checkmark.circle")
                    dismiss()
                case .statusUnknown:
                    reportStatusUnknown = true
                    submissionError = "We couldn't confirm this report's status. Do not submit it again. Contact support with report ID \(frozenDraft.reportID)."
                }
            } catch let error as RiverModerationError {
                guard model.acceptsRiverReportResult(
                    workspace: frozenWorkspace,
                    reporterID: reporterID
                ) else { return }
                submissionError = error.localizedDescription
            } catch {
                guard model.acceptsRiverReportResult(
                    workspace: frozenWorkspace,
                    reporterID: reporterID
                ) else { return }
                submissionError = "We couldn't confirm this report's status. Do not submit it again. Contact support with report ID \(frozenDraft.reportID)."
            }
            guard model.acceptsRiverReportResult(
                workspace: frozenWorkspace,
                reporterID: reporterID
            ) else { return }
            submitting = false
        }
    }
}

/// Explains the actual client-side safeguards and makes local account blocks
/// reversible. It deliberately distinguishes a local block from moderation
/// of the service-wide River.
struct RiverSafetyPolicyView: View {
    @Environment(AppModel.self) private var model
    @Environment(ToastCenter.self) private var toast
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            List {
                Section("River content policy") {
                    Text("River is for material people have the right to share with their team. Do not post harassment, threats, hateful or discriminatory material, sexual or graphic content, private personal information, or material that infringes someone else’s rights.")
                    Text("Reports are submitted to Field Theory for human follow-up. Filing a report does not automatically remove content or create an account action.")
                        .foregroundStyle(.secondary)
                }

                Section("Your local blocks") {
                    if model.river.blockedAuthors.isEmpty {
                        Text("No blocked authors")
                            .foregroundStyle(.secondary)
                    } else {
                        ForEach(model.river.blockedAuthors) { author in
                            HStack {
                                Text(author.authorLabel.isEmpty ? "Unknown author" : author.authorLabel)
                                Spacer()
                                Button("Unblock") { unblock(author) }
                                    .buttonStyle(.bordered)
                            }
                            .accessibilityIdentifier("BlockedRiverAuthor-\(author.authorID)")
                        }
                    }
                    Text("Blocking hides this author’s River items on this device for this signed-in account. It does not remove the content from River, notify the author, or file a report.")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }

                Section("Contact") {
                    Link("Contact Field Theory support", destination: AppLinks.support)
                        .accessibilityIdentifier("RiverSupportLink")
                }
            }
            .navigationTitle("River safety")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") { dismiss() }
                }
            }
        }
    }

    private func unblock(_ author: RiverBlockedAuthor) {
        Task {
            if await model.river.unblockAuthor(author) {
                toast.show("Author unblocked", symbol: "person.badge.minus")
            } else {
                toast.show("Couldn’t unblock author", symbol: "exclamationmark.triangle")
            }
        }
    }
}
