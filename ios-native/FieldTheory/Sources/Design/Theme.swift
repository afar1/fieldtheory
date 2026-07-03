import SwiftUI

/// Color tokens ported from mac-app/src/design/tokens.ts so the phone and the
/// Mac read as the same product.
enum AccentPreset: String, CaseIterable, Identifiable {
    case forest, ocean, purple, rose, coral, gold

    var id: String { rawValue }

    var displayName: String { rawValue.capitalized }

    var light: Color {
        switch self {
        case .forest: return Color(hex: 0x14372A)
        case .ocean: return Color(hex: 0x1E3A5F)
        case .purple: return Color(hex: 0x4A2C6A)
        case .rose: return Color(hex: 0x6A2C4A)
        case .coral: return Color(hex: 0xC45844)
        case .gold: return Color(hex: 0x8A6914)
        }
    }

    var dark: Color {
        switch self {
        case .forest: return Color(hex: 0x3D8B6A)
        case .ocean: return Color(hex: 0x4A90D9)
        case .purple: return Color(hex: 0x9B6DCA)
        case .rose: return Color(hex: 0xCA6D9B)
        case .coral: return Color(hex: 0xE8836E)
        case .gold: return Color(hex: 0xD4A934)
        }
    }
}

struct Theme {
    /// Warm paper background, like the Mac app's light mode.
    static let lightBackground = Color(hex: 0xFAF9F7)
    static let lightBackgroundAlt = Color(hex: 0xF5F4F2)
    static let lightText = Color(hex: 0x1A1A1A)
    static let lightTextMuted = Color(hex: 0x6B6B6B)
    static let lightBorder = Color(hex: 0xE0E0E0)

    static let darkBackground = Color(hex: 0x15181E)
    static let darkBackgroundAlt = Color(hex: 0x1C1F26)
    static let darkText = Color(hex: 0xE8E8E8)
    static let darkTextMuted = Color(hex: 0xA8A8A8)
    static let darkBorder = Color(hex: 0x2A2D35)

    static let unread = Color(hex: 0xDC2626)
    static let markRead = Color(hex: 0x16A34A)
    static let link = Color(hex: 0x2563EB)

    static func background(_ scheme: ColorScheme) -> Color {
        scheme == .dark ? darkBackground : lightBackground
    }

    static func backgroundAlt(_ scheme: ColorScheme) -> Color {
        scheme == .dark ? darkBackgroundAlt : lightBackgroundAlt
    }

    static func text(_ scheme: ColorScheme) -> Color {
        scheme == .dark ? darkText : lightText
    }

    static func textMuted(_ scheme: ColorScheme) -> Color {
        scheme == .dark ? darkTextMuted : lightTextMuted
    }

    static func border(_ scheme: ColorScheme) -> Color {
        scheme == .dark ? darkBorder : lightBorder
    }

    static func accent(_ preset: AccentPreset, _ scheme: ColorScheme) -> Color {
        scheme == .dark ? preset.dark : preset.light
    }
}

extension Color {
    init(hex: UInt32) {
        self.init(
            .sRGB,
            red: Double((hex >> 16) & 0xFF) / 255,
            green: Double((hex >> 8) & 0xFF) / 255,
            blue: Double(hex & 0xFF) / 255,
            opacity: 1
        )
    }
}
