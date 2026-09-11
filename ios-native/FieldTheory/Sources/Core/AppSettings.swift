import SwiftUI

struct WordSubstitution: Codable, Equatable {
    var from: String
    var to: String
}

struct WordSubstitutionChange: Encodable {
    let from: String
    let to: String?

    enum CodingKeys: String, CodingKey { case from, to }
    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(from, forKey: .from)
        if let to { try container.encode(to, forKey: .to) }
        else { try container.encodeNil(forKey: .to) }
    }
}

@MainActor
@Observable
final class WordSubstitutionSettings {
    private struct State: Codable {
        var pairs: [WordSubstitution] = []
        var synced: [WordSubstitution] = []
    }
    private var state = State()
    private var userId: String?
    private(set) var revision = 0
    var onChange: (() -> Void)?
    var pairs: [WordSubstitution] { state.pairs }

    func selectUser(_ id: String?) {
        guard userId != id else { return }
        userId = id
        revision += 1
        state = id.flatMap { UserDefaults.standard.data(forKey: "word-substitutions-" + $0) }
            .flatMap { try? JSONDecoder().decode(State.self, from: $0) } ?? State()
    }

    func set(_ pairs: [WordSubstitution]) {
        guard userId != nil else { return }
        state.pairs = pairs
        revision += 1
        persist()
        onChange?()
    }

    func changes() -> [WordSubstitutionChange] {
        state.synced.filter { old in !state.pairs.contains { $0.from == old.from } }
            .map { WordSubstitutionChange(from: $0.from, to: nil) }
        + state.pairs.filter { pair in !state.synced.contains(pair) }
            .map { WordSubstitutionChange(from: $0.from, to: $0.to) }
    }

    func accept(_ pairs: [WordSubstitution], userId: String, revision: Int) {
        guard self.userId == userId, self.revision == revision else { return }
        state = State(pairs: pairs, synced: pairs)
        persist()
    }

    private func persist() {
        guard let userId, let data = try? JSONEncoder().encode(state) else { return }
        UserDefaults.standard.set(data, forKey: "word-substitutions-" + userId)
    }

    func apply(to text: String) -> String {
        Self.apply(pairs, to: text)
    }

    static func apply(_ pairs: [WordSubstitution], to text: String) -> String {
        pairs.reduce(text) { result, pair in
            guard !pair.from.isEmpty, pair.from != pair.to,
                  let regex = try? NSRegularExpression(
                    pattern: "\\b" + NSRegularExpression.escapedPattern(for: pair.from) + "\\b",
                    options: .caseInsensitive) else { return result }
            return regex.stringByReplacingMatches(in: result,
                range: NSRange(result.startIndex..., in: result),
                withTemplate: NSRegularExpression.escapedTemplate(for: pair.to))
        }
    }
}

/// User preferences. Keys deliberately mirror the Mac app's localStorage keys
/// (librarian-typography-preset, librarian-line-height, accentPreset,
/// library-new-doc-location) so a future server-side preference sync is a
/// straight value copy in both directions.
@MainActor
@Observable
final class AppSettings {
    private let defaults: UserDefaults

    var typographyPreset: TypographyPresetID {
        didSet { defaults.set(typographyPreset.rawValue, forKey: "librarian-typography-preset") }
    }

    var lineHeight: LineHeightID {
        didSet { defaults.set(lineHeight.rawValue, forKey: "librarian-line-height") }
    }

    var textSize: TextSizeID {
        didSet { defaults.set(textSize.rawValue, forKey: "librarian-text-size") }
    }

    var showLineNumbers: Bool {
        didSet { defaults.set(showLineNumbers, forKey: "librarian-show-line-numbers") }
    }

    var accentPreset: AccentPreset {
        didSet { defaults.set(accentPreset.rawValue, forKey: "accentPreset") }
    }

    var appearanceMode: AppearanceMode {
        didSet { defaults.set(appearanceMode.rawValue, forKey: "appearance-mode") }
    }

    /// Where the floating mic lives, as screen fractions; nil = default
    /// bottom-trailing perch.
    var micPositionFraction: CGPoint? {
        didSet {
            if let point = micPositionFraction {
                defaults.set(Double(point.x), forKey: "mic-pos-x")
                defaults.set(Double(point.y), forKey: "mic-pos-y")
            } else {
                defaults.removeObject(forKey: "mic-pos-x")
                defaults.removeObject(forKey: "mic-pos-y")
            }
        }
    }

    var newDocFolder: String {
        didSet { defaults.set(newDocFolder, forKey: "library-new-doc-location") }
    }

    /// Copy transcriptions to the clipboard as soon as they finish.
    var autoCopyTranscripts: Bool {
        didSet { defaults.set(autoCopyTranscripts, forKey: "voice-auto-copy") }
    }

    /// source_path prefixes (top-level folders) the phone materializes.
    /// Empty array means "everything" until the user narrows it.
    var syncedFolders: [String]? {
        didSet { defaults.set(syncedFolders, forKey: "library-synced-folders") }
    }

    var typography: ReadingTypography {
        ReadingTypography(preset: typographyPreset, lineHeight: lineHeight, textSize: textSize)
    }

    init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
        typographyPreset = TypographyPresetID(rawValue: defaults.string(forKey: "librarian-typography-preset") ?? "") ?? .book
        lineHeight = LineHeightID(rawValue: defaults.string(forKey: "librarian-line-height") ?? "") ?? .normal
        textSize = TextSizeID(rawValue: defaults.string(forKey: "librarian-text-size") ?? "") ?? .normal
        showLineNumbers = defaults.object(forKey: "librarian-show-line-numbers") as? Bool ?? true
        accentPreset = AccentPreset(rawValue: defaults.string(forKey: "accentPreset") ?? "") ?? .forest
        appearanceMode = AppearanceMode(rawValue: defaults.string(forKey: "appearance-mode") ?? "") ?? .system
        newDocFolder = defaults.string(forKey: "library-new-doc-location") ?? "Ambition"
        autoCopyTranscripts = defaults.object(forKey: "voice-auto-copy") as? Bool ?? true
        // Engine selection was removed when Voice became Parakeet-only.
        defaults.removeObject(forKey: "ft.speechEngineChoice.v1")
        syncedFolders = defaults.stringArray(forKey: "library-synced-folders")
        if let x = defaults.object(forKey: "mic-pos-x") as? Double,
           let y = defaults.object(forKey: "mic-pos-y") as? Double {
            micPositionFraction = CGPoint(x: x, y: y)
        }
    }
}

enum AppearanceMode: String, CaseIterable, Identifiable {
    case system, light, dark

    var id: String { rawValue }

    var displayName: String {
        switch self {
        case .system: return "System"
        case .light: return "Light"
        case .dark: return "Dark"
        }
    }

    var colorScheme: ColorScheme? {
        switch self {
        case .system: return nil
        case .light: return .light
        case .dark: return .dark
        }
    }
}
