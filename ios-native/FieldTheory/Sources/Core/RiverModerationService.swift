import Foundation
import Supabase

/// The server-shaped payload for an authenticated River report. It contains
/// report metadata only; document content is deliberately absent.
struct RiverContentReportPayload: Encodable, Equatable, Sendable {
    let id: UUID
    let reporter_user_id: UUID
    let reported_document_id: UUID
    let reported_author_id: UUID
    let reason: String
    let notes: String?
    let document_title: String
    let original_source_path: String?
}

/// An authenticated transport for the River report queue. Confirmation must
/// query through the reporter's normal RLS scope, never a privileged client.
protocol RiverReportTransport: Sendable {
    func insert(_ report: RiverContentReportPayload) async throws -> UUID
    func reportExists(id: UUID, reporterID: UUID) async throws -> Bool
}

/// The report state the client can establish. `.statusUnknown` is intentional:
/// a lost response can follow a successful insert, so retrying the UUID could
/// create a misleading duplicate error.
enum RiverReportSubmission: Equatable {
    case submitted
    case confirmedAfterUnknownInsert
    case statusUnknown
}

private struct RiverContentReportResponse: Decodable {
    let id: UUID
}

private struct SupabaseRiverReportTransport: RiverReportTransport {
    let client: SupabaseClient

    func insert(_ report: RiverContentReportPayload) async throws -> UUID {
        let response: RiverContentReportResponse = try await client
            .from("river_content_reports")
            .insert(report)
            .select("id")
            .single()
            .execute()
            .value
        return response.id
    }

    func reportExists(id: UUID, reporterID: UUID) async throws -> Bool {
        let reports: [RiverContentReportResponse] = try await client
            .from("river_content_reports")
            .select("id")
            .eq("id", value: id.uuidString)
            .eq("reporter_user_id", value: reporterID.uuidString)
            .limit(1)
            .execute()
            .value
        return reports.contains { $0.id == id }
    }
}

/// App-owned authenticated report submission. The Supabase RLS policy admits
/// only a pending report whose reporter identity matches the current session.
/// This service does not remove content or take action against an author.
enum RiverModerationService {
    static func submitReport(
        _ draft: RiverReportDraft,
        reporterID: UUID,
        client: SupabaseClient
    ) async throws -> RiverReportSubmission {
        try await submitReport(
            draft,
            reporterID: reporterID,
            transport: SupabaseRiverReportTransport(client: client)
        )
    }

    static func submitReport(
        _ draft: RiverReportDraft,
        reporterID: UUID,
        transport: any RiverReportTransport
    ) async throws -> RiverReportSubmission {
        let report = try makePayload(from: draft, reporterID: reporterID)
        do {
            // UUID comparison avoids treating Postgres's canonical lower-case
            // response as different from UUID().uuidString on this platform.
            guard try await transport.insert(report) == report.id else {
                return await confirmAfterUnknownInsert(report, transport: transport)
            }
            return .submitted
        } catch {
            return await confirmAfterUnknownInsert(report, transport: transport)
        }
    }

    static func makePayload(
        from draft: RiverReportDraft,
        reporterID: UUID
    ) throws -> RiverContentReportPayload {
        guard let reportID = UUID(uuidString: draft.reportID) else {
            throw RiverModerationError.invalidReportIdentifier
        }
        guard let documentID = UUID(uuidString: draft.itemID) else {
            throw RiverModerationError.unsupportedDocument
        }
        guard let authorID = draft.authorID.flatMap(UUID.init(uuidString:)) else {
            throw RiverModerationError.unsupportedAuthor
        }
        return RiverContentReportPayload(
            id: reportID,
            reporter_user_id: reporterID,
            reported_document_id: documentID,
            reported_author_id: authorID,
            reason: draft.reason.rawValue,
            notes: draft.notes.isEmpty ? nil : draft.notes,
            document_title: String(draft.title.prefix(500)),
            original_source_path: draft.sourcePath.map { String($0.prefix(1000)) }
        )
    }

    private static func confirmAfterUnknownInsert(
        _ report: RiverContentReportPayload,
        transport: any RiverReportTransport
    ) async -> RiverReportSubmission {
        do {
            if try await transport.reportExists(id: report.id, reporterID: report.reporter_user_id) {
                return .confirmedAfterUnknownInsert
            }
        } catch {
            // A second network failure leaves the state unknown. The caller
            // must not represent this as a definitive failed submission.
        }
        return .statusUnknown
    }
}

enum RiverModerationError: LocalizedError, Equatable {
    case invalidReportIdentifier
    case unsupportedDocument
    case unsupportedAuthor

    var errorDescription: String? {
        switch self {
        case .invalidReportIdentifier:
            "This report could not be prepared. Close it and try again."
        case .unsupportedDocument:
            "This document cannot be reported from this River view."
        case .unsupportedAuthor:
            "This item does not have a reportable River author."
        }
    }
}
