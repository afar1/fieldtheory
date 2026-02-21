import Foundation

struct DataSafetyPolicy {
    let modeName: String
    let allowLegacyWrites: Bool
    let allowCloudWrites: Bool
    let allowNativeDeletes: Bool
    let requireLegacyBackups: Bool

    static let strict = DataSafetyPolicy(
        modeName: "STRICT",
        allowLegacyWrites: false,
        allowCloudWrites: false,
        allowNativeDeletes: false,
        requireLegacyBackups: true
    )
}

struct DataPaths {
    let legacyRoots: [URL]
    let primaryLegacyRoot: URL?
    let nativeRoot: URL
    let nativeDatabaseURL: URL
    let backupRoot: URL
    let backupMarkerURL: URL
    let recordingsRoot: URL

    static func `default`() -> DataPaths {
        let home = URL(fileURLWithPath: NSHomeDirectory(), isDirectory: true)
        let supportRoot = home
            .appendingPathComponent("Library", isDirectory: true)
            .appendingPathComponent("Application Support", isDirectory: true)

        return make(supportRoot: supportRoot, fileManager: .default)
    }

    static func make(supportRoot: URL, fileManager: FileManager = .default) -> DataPaths {
        let candidateNames = [
            "fieldtheory-mac",
            "field-theory",
            "littleai-mac",
            "Oscar",
            "Field Theory",
            "Little One Experimental",
        ]

        let candidateRoots = candidateNames.map { supportRoot.appendingPathComponent($0, isDirectory: true) }
        let existingLegacyRoots = candidateRoots.filter { fileManager.fileExists(atPath: $0.path) }

        let primaryLegacyRoot = existingLegacyRoots.first { root in
            fileManager.fileExists(atPath: root.appendingPathComponent("clipboard.db", isDirectory: false).path)
        }

        let nativeRoot = supportRoot.appendingPathComponent("Field Theory Native", isDirectory: true)
        let backupRoot = nativeRoot.appendingPathComponent("legacy-backups", isDirectory: true)
        let nativeDatabaseURL = nativeRoot.appendingPathComponent("clipboard-native.db", isDirectory: false)
        let backupMarkerURL = nativeRoot.appendingPathComponent(".legacy-backup-v1.complete", isDirectory: false)
        let recordingsRoot = nativeRoot.appendingPathComponent("recordings", isDirectory: true)

        return DataPaths(
            legacyRoots: existingLegacyRoots,
            primaryLegacyRoot: primaryLegacyRoot,
            nativeRoot: nativeRoot,
            nativeDatabaseURL: nativeDatabaseURL,
            backupRoot: backupRoot,
            backupMarkerURL: backupMarkerURL,
            recordingsRoot: recordingsRoot
        )
    }
}

enum DataSafetyError: Error {
    case legacyWritesBlocked(URL)
}

@MainActor
final class DataSafetyManager {
    private let policy: DataSafetyPolicy
    private let paths: DataPaths
    private let fileManager: FileManager

    init(
        policy: DataSafetyPolicy = .strict,
        paths: DataPaths = .default(),
        fileManager: FileManager = .default
    ) {
        self.policy = policy
        self.paths = paths
        self.fileManager = fileManager
    }

    func policySummary() -> String {
        let legacyPath = paths.primaryLegacyRoot?.lastPathComponent ?? "none"
        return "Mode=\(policy.modeName), legacy=\(legacyPath), legacyWrites=\(policy.allowLegacyWrites), cloudWrites=\(policy.allowCloudWrites), nativeDeletes=\(policy.allowNativeDeletes)"
    }

    func canWriteToCloud() -> Bool {
        policy.allowCloudWrites
    }

    func canDeleteFromNativeStore() -> Bool {
        policy.allowNativeDeletes
    }

    func dataPaths() -> DataPaths {
        paths
    }

    func currentPolicy() -> DataSafetyPolicy {
        policy
    }

    func ensureSafeFilesystemLayout() throws {
        try fileManager.createDirectory(at: paths.nativeRoot, withIntermediateDirectories: true)
        try fileManager.createDirectory(at: paths.backupRoot, withIntermediateDirectories: true)
        try fileManager.createDirectory(at: paths.recordingsRoot, withIntermediateDirectories: true)

        if policy.requireLegacyBackups {
            try backupLegacyFilesIfNeeded()
        }
    }

    func assertLegacyWriteAllowed(for url: URL) throws {
        guard policy.allowLegacyWrites else {
            throw DataSafetyError.legacyWritesBlocked(url)
        }
    }

    private func backupLegacyFilesIfNeeded() throws {
        if fileManager.fileExists(atPath: paths.backupMarkerURL.path) {
            return
        }

        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.dateFormat = "yyyyMMdd-HHmmss"
        let timestamp = formatter.string(from: Date())
        let destination = paths.backupRoot.appendingPathComponent(timestamp, isDirectory: true)
        try fileManager.createDirectory(at: destination, withIntermediateDirectories: true)

        let fileNames = [
            "clipboard.db",
            "clipboard.db-wal",
            "clipboard.db-shm",
            "preferences.json",
            "supabase-session.json",
        ]

        var copiedAnyFile = false

        for legacyRoot in paths.legacyRoots {
            let legacyDestination = destination.appendingPathComponent(legacyRoot.lastPathComponent, isDirectory: true)
            try fileManager.createDirectory(at: legacyDestination, withIntermediateDirectories: true)

            for fileName in fileNames {
                let source = legacyRoot.appendingPathComponent(fileName, isDirectory: false)
                guard fileManager.fileExists(atPath: source.path) else { continue }
                let target = legacyDestination.appendingPathComponent(fileName, isDirectory: false)
                try fileManager.copyItem(at: source, to: target)
                copiedAnyFile = true
            }
        }

        let marker = """
        backupVersion=1
        completedAt=\(Date().timeIntervalSince1970)
        policy=\(policy.modeName)
        primaryLegacyRoot=\(paths.primaryLegacyRoot?.path ?? "none")
        legacyRoots=\(paths.legacyRoots.map { $0.path }.joined(separator: ","))
        nativeRoot=\(paths.nativeRoot.path)
        copiedAnyFile=\(copiedAnyFile)
        """
        try marker.data(using: .utf8)?.write(to: paths.backupMarkerURL)
    }
}
