import SwiftUI
import UIKit

/// Reading typography ported from mac-app/src/utils/librarianTypography.ts.
/// Preset ids and preference keys intentionally match the Mac app so that
/// preference sync later is a straight value copy.
enum TypographyPresetID: String, CaseIterable, Identifiable {
    case book   // Serif — Source Serif 4
    case note   // Sans  — Source Sans 3
    case draft  // Mono  — Source Code Pro

    var id: String { rawValue }

    var displayName: String {
        switch self {
        case .book: return "Serif"
        case .note: return "Sans Serif"
        case .draft: return "Mono"
        }
    }

    var fontFamily: String {
        switch self {
        case .book: return "Source Serif 4"
        case .note: return "Source Sans 3"
        case .draft: return "Source Code Pro"
        }
    }

    /// Matches the Mac presets: book 1.66, note 1.58, draft 1.7.
    var presetLineHeight: CGFloat {
        switch self {
        case .book: return 1.66
        case .note: return 1.58
        case .draft: return 1.7
        }
    }
}

enum LineHeightID: String, CaseIterable, Identifiable {
    case tight, normal, loose

    var id: String { rawValue }

    var displayName: String { rawValue.capitalized }

    /// tight 1.45 / loose 1.82, normal falls back to the preset value.
    func resolved(for preset: TypographyPresetID) -> CGFloat {
        switch self {
        case .tight: return 1.45
        case .normal: return preset.presetLineHeight
        case .loose: return 1.82
        }
    }

    /// Paragraph spacing in em, from resolveLibrarianParagraphSpacing.
    var paragraphSpacingEm: CGFloat {
        switch self {
        case .tight: return 0.36
        case .normal: return 0.52
        case .loose: return 0.78
        }
    }
}

enum TextSizeID: String, CaseIterable, Identifiable {
    case small, normal, large

    var id: String { rawValue }

    var displayName: String { rawValue.capitalized }

    /// The Mac adjusts measure width; on a phone the column is fixed, so the
    /// equivalent control is body point size.
    var bodySize: CGFloat {
        switch self {
        case .small: return 15
        case .normal: return 17
        case .large: return 19
        }
    }
}

/// Resolved reading typography for a given set of preferences.
struct ReadingTypography {
    let preset: TypographyPresetID
    let lineHeight: LineHeightID
    let textSize: TextSizeID

    var bodySize: CGFloat { textSize.bodySize }
    var lineHeightMultiple: CGFloat { lineHeight.resolved(for: preset) }
    var paragraphSpacing: CGFloat { lineHeight.paragraphSpacingEm * bodySize }

    /// Heading scale from prose.css: h1 1.55em, h2 1.18em, h3 1em.
    var h1Size: CGFloat { (bodySize * 1.55).rounded() }
    var h2Size: CGFloat { (bodySize * 1.18).rounded() }
    var h3Size: CGFloat { bodySize }

    /// Extra line spacing in points (SwiftUI lineSpacing is additive).
    var lineSpacing: CGFloat { bodySize * (lineHeightMultiple - 1) * 0.62 }

    func bodyFont(weight: Font.Weight = .regular, italic: Bool = false) -> Font {
        var font = Font.custom(preset.fontFamily, size: bodySize).weight(weight)
        if italic { font = font.italic() }
        return font
    }

    func font(size: CGFloat, weight: Font.Weight = .regular) -> Font {
        Font.custom(preset.fontFamily, size: size).weight(weight)
    }

    func monoFont(size: CGFloat? = nil) -> Font {
        Font.custom("Source Code Pro", size: size ?? (bodySize - 2))
    }

    func uiBodyFont(weight: UIFont.Weight = .regular) -> UIFont {
        UIFont.variable(family: preset.fontFamily, size: bodySize, weight: weight)
    }
}

extension UIFont {
    /// Resolves a variable font at an explicit wght axis value, bypassing the
    /// named-instance lottery that variable TTFs sometimes lose on iOS.
    static func variable(family: String, size: CGFloat, weight: UIFont.Weight = .regular) -> UIFont {
        let wght: CGFloat
        switch weight {
        case .semibold: wght = 600
        case .bold: wght = 700
        case .medium: wght = 500
        case .light: wght = 300
        default: wght = 400
        }
        let descriptor = UIFontDescriptor(fontAttributes: [
            .family: family,
            kCTFontVariationAttribute as UIFontDescriptor.AttributeName: [2003265652: wght],
        ])
        return UIFont(descriptor: descriptor, size: size)
    }
}
