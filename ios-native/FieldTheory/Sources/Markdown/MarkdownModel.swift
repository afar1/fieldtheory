import Foundation
import Markdown
import SwiftUI

/// A renderable block parsed from markdown via swift-markdown (cmark-gfm).
enum MDBlock: Identifiable {
    case heading(level: Int, text: AttributedString)
    case paragraph(AttributedString)
    case list(items: [MDListItem], ordered: Bool)
    case code(language: String?, code: String)
    case quote(blocks: [MDBlock])
    case rule
    case table(headers: [AttributedString], rows: [[AttributedString]])

    var id: UUID { UUID() }
}

struct MDListItem: Identifiable {
    let id = UUID()
    /// nil = plain item; true/false = task checkbox state.
    var checked: Bool?
    /// 1-based source line of the item marker, for checkbox toggling.
    var sourceLine: Int?
    var text: AttributedString
    var children: [MDListItem]
}

struct MarkdownStyling {
    var typography: ReadingTypography
    var textColor: Color
    var mutedColor: Color
    var accentColor: Color

    func body(_ weight: Font.Weight = .regular, italic: Bool = false) -> Font {
        typography.bodyFont(weight: weight, italic: italic)
    }
}

enum MarkdownParser {
    static func parse(_ content: String, styling: MarkdownStyling) -> [MDBlock] {
        let document = Document(parsing: content)
        return document.children.compactMap { block(from: $0, styling: styling) }
    }

    /// Strips YAML frontmatter (River cache files and some library docs carry it).
    static func stripFrontmatter(_ content: String) -> String {
        guard content.hasPrefix("---\n") || content.hasPrefix("---\r\n") else { return content }
        let lines = content.components(separatedBy: "\n")
        for index in 1..<min(lines.count, 60) {
            let line = lines[index].trimmingCharacters(in: .whitespaces)
            if line == "---" || line == "..." {
                return lines[(index + 1)...].joined(separator: "\n")
                    .trimmingCharacters(in: .newlines)
            }
        }
        return content
    }

    private static func block(from markup: Markup, styling: MarkdownStyling) -> MDBlock? {
        switch markup {
        case let heading as Heading:
            return .heading(level: heading.level, text: inlineText(heading, styling: styling, baseFont: headingFont(level: heading.level, styling: styling)))
        case let paragraph as Paragraph:
            return .paragraph(inlineText(paragraph, styling: styling, baseFont: styling.body()))
        case let list as UnorderedList:
            return .list(items: list.listItems.map { listItem($0, styling: styling) }, ordered: false)
        case let list as OrderedList:
            return .list(items: list.listItems.map { listItem($0, styling: styling) }, ordered: true)
        case let code as CodeBlock:
            return .code(language: code.language, code: code.code.trimmingCharacters(in: .newlines))
        case let quote as BlockQuote:
            return .quote(blocks: quote.children.compactMap { block(from: $0, styling: styling) })
        case is ThematicBreak:
            return .rule
        case let table as Markdown.Table:
            let headers = table.head.cells.map { inlineText($0, styling: styling, baseFont: styling.body(.semibold)) }
            let rows = table.body.rows.map { row in
                Array(row.cells.map { inlineText($0, styling: styling, baseFont: styling.body()) })
            }
            return .table(headers: Array(headers), rows: Array(rows))
        case let html as HTMLBlock:
            return .code(language: "html", code: html.rawHTML.trimmingCharacters(in: .newlines))
        default:
            return nil
        }
    }

    private static func headingFont(level: Int, styling: MarkdownStyling) -> Font {
        let typography = styling.typography
        switch level {
        case 1: return typography.font(size: typography.h1Size, weight: .semibold)
        case 2: return typography.font(size: typography.h2Size, weight: .semibold)
        default: return typography.font(size: typography.h3Size, weight: .semibold)
        }
    }

    private static func listItem(_ item: ListItem, styling: MarkdownStyling) -> MDListItem {
        var checked: Bool?
        switch item.checkbox {
        case .checked: checked = true
        case .unchecked: checked = false
        default: checked = nil
        }

        var text = AttributedString()
        var children: [MDListItem] = []
        for child in item.children {
            switch child {
            case let paragraph as Paragraph:
                if !text.characters.isEmpty { text += AttributedString("\n") }
                text += inlineText(paragraph, styling: styling, baseFont: styling.body())
            case let nested as UnorderedList:
                children.append(contentsOf: nested.listItems.map { listItem($0, styling: styling) })
            case let nested as OrderedList:
                children.append(contentsOf: nested.listItems.map { listItem($0, styling: styling) })
            default:
                break
            }
        }
        return MDListItem(checked: checked, sourceLine: item.range?.lowerBound.line, text: text, children: children)
    }

    // MARK: - Inline rendering

    private struct InlineState {
        var bold = false
        var italic = false
        var strike = false
        var code = false
        var link: URL?
    }

    private static func inlineText(_ container: Markup, styling: MarkdownStyling, baseFont: Font) -> AttributedString {
        var result = AttributedString()
        for child in container.children {
            append(child, to: &result, state: InlineState(), styling: styling, baseFont: baseFont)
        }
        styleWikiLinks(&result, styling: styling)
        return result
    }

    private static func append(_ markup: Markup, to result: inout AttributedString, state: InlineState, styling: MarkdownStyling, baseFont: Font) {
        switch markup {
        case let text as Markdown.Text:
            result += styled(text.string, state: state, styling: styling, baseFont: baseFont)
        case let emphasis as Emphasis:
            var next = state; next.italic = true
            for child in emphasis.children { append(child, to: &result, state: next, styling: styling, baseFont: baseFont) }
        case let strong as Strong:
            var next = state; next.bold = true
            for child in strong.children { append(child, to: &result, state: next, styling: styling, baseFont: baseFont) }
        case let strike as Strikethrough:
            var next = state; next.strike = true
            for child in strike.children { append(child, to: &result, state: next, styling: styling, baseFont: baseFont) }
        case let code as InlineCode:
            var next = state; next.code = true
            result += styled(code.code, state: next, styling: styling, baseFont: baseFont)
        case let link as Markdown.Link:
            var next = state; next.link = link.destination.flatMap(URL.init(string:))
            for child in link.children { append(child, to: &result, state: next, styling: styling, baseFont: baseFont) }
        case let image as Markdown.Image:
            let alt = image.plainText.isEmpty ? "image" : image.plainText
            var next = state; next.italic = true
            result += styled("🖼 \(alt)", state: next, styling: styling, baseFont: baseFont)
        case is SoftBreak:
            result += AttributedString(" ")
        case is LineBreak:
            result += AttributedString("\n")
        case let html as InlineHTML:
            var next = state; next.code = true
            result += styled(html.rawHTML, state: next, styling: styling, baseFont: baseFont)
        default:
            for child in markup.children {
                append(child, to: &result, state: state, styling: styling, baseFont: baseFont)
            }
        }
    }

    private static func styled(_ string: String, state: InlineState, styling: MarkdownStyling, baseFont: Font) -> AttributedString {
        var attributed = AttributedString(string)
        var font = baseFont
        if state.bold { font = font.weight(.semibold) }
        if state.italic { font = font.italic() }
        if state.code {
            font = styling.typography.monoFont()
            attributed.backgroundColor = styling.mutedColor.opacity(0.14)
        }
        attributed.font = font
        if state.strike { attributed.strikethroughStyle = .single }
        if let url = state.link {
            attributed.link = url
            attributed.foregroundColor = Theme.link
            attributed.underlineStyle = .single
        } else {
            attributed.foregroundColor = styling.textColor
        }
        return attributed
    }

    /// Tints [[wiki links]] with the accent color, Mac-style.
    private static func styleWikiLinks(_ text: inout AttributedString, styling: MarkdownStyling) {
        let plain = String(text.characters)
        guard plain.contains("[[") else { return }
        guard let regex = try? NSRegularExpression(pattern: "\\[\\[([^\\]]+)\\]\\]") else { return }
        let matches = regex.matches(in: plain, range: NSRange(plain.startIndex..., in: plain))
        for match in matches {
            guard let range = Range(match.range, in: plain),
                  let attributedRange = Range(range, in: text) else { continue }
            text[attributedRange].foregroundColor = styling.accentColor
        }
    }
}
