import SwiftUI

/// User preferences. Keys deliberately mirror the Mac app's localStorage keys
/// (librarian-typography-preset, librarian-line-height, accentPreset,
/// library-new-doc-location) so a future server-side preference sync is a
/// straight value copy in both directions.
@MainActor
@Observable
final class AppSettings {
    private let defaults = UserDefaults.standard

    var typographyPreset: TypographyPresetID {
        didSet { defaults.set(typographyPreset.rawValue, forKey: "librarian-typography-preset") }
    }

    var lineHeight: LineHeightID {
        didSet { defaults.set(lineHeight.rawValue, forKey: "librarian-line-height") }
    }

    var textSize: TextSizeID {
        didSet { defaults.set(textSize.rawValue, forKey: "librarian-text-size") }
    }

    var accentPreset: AccentPreset {
        didSet { defaults.set(accentPreset.rawValue, forKey: "accentPreset") }
    }

    var appearanceMode: AppearanceMode {
        didSet { defaults.set(appearanceMode.rawValue, forKey: "appearance-mode") }
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

    init() {
        typographyPreset = TypographyPresetID(rawValue: defaults.string(forKey: "librarian-typography-preset") ?? "") ?? .book
        lineHeight = LineHeightID(rawValue: defaults.string(forKey: "librarian-line-height") ?? "") ?? .normal
        textSize = TextSizeID(rawValue: defaults.string(forKey: "librarian-text-size") ?? "") ?? .normal
        accentPreset = AccentPreset(rawValue: defaults.string(forKey: "accentPreset") ?? "") ?? .forest
        appearanceMode = AppearanceMode(rawValue: defaults.string(forKey: "appearance-mode") ?? "") ?? .system
        newDocFolder = defaults.string(forKey: "library-new-doc-location") ?? "scratchpad"
        autoCopyTranscripts = defaults.object(forKey: "voice-auto-copy") as? Bool ?? true
        syncedFolders = defaults.stringArray(forKey: "library-synced-folders")
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
