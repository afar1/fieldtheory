import Foundation

enum SafetySeverity: String {
    case info
    case warning
    case blocking
}

struct SafetyCheckResult {
    let id: String
    let passed: Bool
    let severity: SafetySeverity
    let message: String
}

struct SafetyAuditReport {
    let generatedAt: Date
    let checks: [SafetyCheckResult]

    var blockingIssues: [SafetyCheckResult] {
        checks.filter { $0.passed == false && $0.severity == .blocking }
    }

    var summaryLine: String {
        let failed = checks.filter { $0.passed == false }
        if failed.isEmpty {
            return "Safety audit passed (\(checks.count) checks)."
        }

        let blocking = failed.filter { $0.severity == .blocking }.count
        return "Safety audit failed: \(failed.count) issues (\(blocking) blocking)."
    }
}

@MainActor
final class SafetyAuditor {
    func audit(
        policy: DataSafetyPolicy,
        paths: DataPaths,
        clipboardStore: ClipboardStore,
        syncService: SyncService,
        fileManager: FileManager = .default
    ) -> SafetyAuditReport {
        var checks: [SafetyCheckResult] = []

        checks.append(
            SafetyCheckResult(
                id: "policy.mode",
                passed: policy.modeName.uppercased() == "STRICT",
                severity: .blocking,
                message: "Policy mode must remain STRICT."
            )
        )

        checks.append(
            SafetyCheckResult(
                id: "legacy.writes",
                passed: policy.allowLegacyWrites == false,
                severity: .blocking,
                message: "Legacy writes must be disabled."
            )
        )

        checks.append(
            SafetyCheckResult(
                id: "cloud.writes",
                passed: syncService.supportsCloudWrites == false && policy.allowCloudWrites == false,
                severity: .blocking,
                message: "Cloud writes must be disabled by default."
            )
        )

        checks.append(
            SafetyCheckResult(
                id: "native.deletes",
                passed: clipboardStore.supportsDelete == false && policy.allowNativeDeletes == false,
                severity: .warning,
                message: "Native delete operations should remain disabled in strict mode."
            )
        )

        checks.append(
            SafetyCheckResult(
                id: "backup.marker",
                passed: fileManager.fileExists(atPath: paths.backupMarkerURL.path),
                severity: .warning,
                message: "Backup marker should exist after safety layout initialization."
            )
        )

        checks.append(
            SafetyCheckResult(
                id: "native.db.path",
                passed: paths.nativeDatabaseURL.path.contains("Field Theory Native"),
                severity: .blocking,
                message: "Native DB path must point to isolated Field Theory Native directory."
            )
        )

        return SafetyAuditReport(generatedAt: Date(), checks: checks)
    }
}
