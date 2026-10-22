import Foundation
import Supabase

struct RiverRecipient: Identifiable, Hashable {
    let targetID: String
    let kind: String
    let label: String
    let members: [String]
    var id: String { "\(kind):\(targetID)" }
}

struct RiverContactRow: Decodable {
    let owner_user_id: String
    let contact_user_id: String?
    let contact_email: String?
}
struct RiverGroupRow: Decodable {
    struct Member: Decodable { let member_user_id: String; let status: String }
    let id: String
    let owner_user_id: String
    let name: String
    let river_share_group_members: [Member]
}
struct RiverRemoteDocument: Decodable {
    let id: String
    let title: String
    let content: String
    let created_by: String
    let created_at: String
    let updated_at: String
    let author_initials: String?
    let author_callsign: String?
    let revision: Int?
}

/// Uses the same recipient grants and RLS as the Mac River. No polling.
struct RiverTransport {
    static func snapshotID(sourceID: String, text: String) -> String {
        Hashing.sha256Hex(sourceID + ":" + Hashing.sha256Hex(text))
    }

    let client: SupabaseClient

    private func requireOwner(_ userID: String) throws {
        try Task.checkCancellation()
        guard client.auth.currentUser?.id.uuidString.lowercased() == userID else { throw CancellationError() }
    }

    func recipients(userID: String) async throws -> [RiverRecipient] {
        try requireOwner(userID)
        let contacts: [RiverContactRow] = try await client.from("contacts")
            .select("owner_user_id, contact_user_id, contact_email")
            .eq("relationship_type", value: "team").eq("status", value: "accepted")
            .execute().value
        let groups: [RiverGroupRow] = try await client.from("river_share_groups")
            .select("id, owner_user_id, name, river_share_group_members(member_user_id,status)")
            .is("deleted_at", value: nil).execute().value
        var people: [String: RiverRecipient] = [:]
        for contact in contacts {
            let owner = contact.owner_user_id.lowercased()
            let member = contact.contact_user_id?.lowercased()
            let isIncomingEmail = contact.contact_email?.lowercased() == client.auth.currentUser?.email?.lowercased()
            guard owner == userID || member == userID || isIncomingEmail else { continue }
            guard let other = owner == userID ? member : owner, other != userID else { continue }
            // Incoming contact_email identifies us, not the sender.
            let label = owner == userID ? (contact.contact_email ?? "Contact") : "Team owner"
            people[other] = RiverRecipient(targetID: other, kind: "person", label: label, members: [other])
        }
        let teams = groups.compactMap { group -> RiverRecipient? in
            let members = Set([group.owner_user_id.lowercased()] + group.river_share_group_members.filter { $0.status == "accepted" }.map { $0.member_user_id.lowercased() })
            guard members.contains(userID) else { return nil }
            return RiverRecipient(targetID: group.id, kind: "group", label: group.name, members: members.filter { $0 != userID }.sorted())
        }
        let result = teams + people.values.sorted { $0.label.localizedCaseInsensitiveCompare($1.label) == .orderedAscending }
        struct Person: Decodable { let id: String; let callsign: String? }
        let ids = result.filter { $0.kind == "person" }.map(\.targetID)
        try requireOwner(userID)
        guard !ids.isEmpty else { return result }
        let profiles: [Person] = (try? await client.from("profiles").select("id,callsign").in("id", values: ids).execute().value) ?? []
        try requireOwner(userID)
        return result.map { recipient in
            guard recipient.kind == "person", let name = profiles.first(where: { $0.id.lowercased() == recipient.targetID })?.callsign,
                  !name.trimmingCharacters(in: .whitespaces).isEmpty else { return recipient }
            return RiverRecipient(targetID: recipient.targetID, kind: recipient.kind, label: name, members: recipient.members)
        }
    }

    func documents(userID: String, documentIDs: Set<String>? = nil) async throws -> [RiverRemoteDocument] {
        try requireOwner(userID)
        let ids: [String] = try await client.rpc("river_private_document_ids").execute().value
        var query = client.from("river_documents").select("id,title,content,created_by,created_at,updated_at,author_initials,author_callsign,revision").is("deleted_at", value: nil)
        query = query.or("created_by.eq.\(userID)" + (ids.isEmpty ? "" : ",id.in.(\(ids.joined(separator: ",")))"))
        if let documentIDs {
            guard !documentIDs.isEmpty else { return [] }
            let rows: [RiverRemoteDocument] = try await query.in("id", values: Array(documentIDs)).execute().value
            try requireOwner(userID)
            return rows
        }
        var rows: [RiverRemoteDocument] = []
        var offset = 0
        while true {
            try Task.checkCancellation()
            let page: [RiverRemoteDocument] = try await query.order("id").range(from: offset, to: offset + 199).execute().value
            try requireOwner(userID)
            rows.append(contentsOf: page)
            if page.count < 200 { return rows }
            offset += page.count
        }
    }

    func share(text: String, sourceID: String, selected: [RiverRecipient], userID: String) async throws {
        // Resolve again at send time; never trust a stale sheet's membership.
        let available = try await recipients(userID: userID)
        let fresh = try selected.map { selected -> RiverRecipient in
            guard let current = available.first(where: { $0.id == selected.id }) else { throw RiverShareError.destinationUnavailable }
            return current
        }
        guard !fresh.isEmpty else { throw RiverShareError.destinationUnavailable }
        let path = "Voice/\(Self.snapshotID(sourceID: sourceID, text: text)).md"
        let title = String(text.split(separator: "\n").first.map(String.init)?.prefix(80) ?? "Voice".prefix(80))
        struct Profile: Decodable { let callsign: String? }
        let profile: Profile? = try? await client.from("profiles").select("callsign").eq("id", value: userID).single().execute().value
        let session = try await client.auth.session
        guard session.user.id.uuidString.lowercased() == userID else { throw CancellationError() }
        let initials = String((session.user.email ?? "FT").prefix(2)).uppercased()
        let row: [String: AnyJSON] = [
            "author_initials": .string(initials), "author_callsign": profile?.callsign.map(AnyJSON.string) ?? .null,
            "kind": .string("document"), "path": .string(path), "title": .string(title),
            "content": .string(text), "content_hash": .string(Hashing.sha256Hex(text)),
            "client_id": .string("ios-" + Self.snapshotID(sourceID: sourceID, text: text)),
            "client_created_at_ms": .integer(Int(Timestamps.nowMs())),
            "created_by": .string(userID), "updated_by": .string(userID),
            "original_source_path": .string(path), "shared_name": .string(title), "deleted_at": .null
        ]
        struct Saved: Decodable { let id: String }
        try requireOwner(userID)
        let saved: Saved = try await client.from("river_documents").upsert(row, onConflict: "created_by,client_id").select("id").single().execute().value
        struct Target: Decodable { let id: String; let target_kind: String; let target_id: String }
        let rows: [[String: AnyJSON]] = fresh.map { ["document_id": .string(saved.id), "target_kind": .string($0.kind), "target_id": .string($0.targetID), "created_by": .string(userID), "revoked_at": .null] }
        try requireOwner(userID)
        let targets: [Target] = try await client.from("river_document_targets").upsert(rows, onConflict: "document_id,target_kind,target_id").select("id,target_kind,target_id").execute().value
        let audience: [[String: AnyJSON]] = fresh.flatMap { recipient -> [[String: AnyJSON]] in
            guard let target = targets.first(where: { $0.target_kind == recipient.kind && $0.target_id == recipient.targetID }) else { return [] }
            return recipient.members.map { ["document_id": .string(saved.id), "recipient_user_id": .string($0), "granted_by_user_id": .string(userID), "source_type": .string(recipient.kind), "source_id": .string(target.id), "revoked_at": .null] }
        }
        if !audience.isEmpty {
            try requireOwner(userID)
            try await client.from("river_document_audience").upsert(audience, onConflict: "document_id,recipient_user_id,source_type,source_id").execute()
        }
    }
}
enum RiverShareError: LocalizedError {
    case destinationUnavailable
    var errorDescription: String? { "This recipient is no longer available. Open Share again to refresh." }
}
