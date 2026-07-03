import SwiftUI

/// Renders parsed markdown blocks with the reading typography. The spacing
/// model follows prose.css: paragraph spacing from the line-height mode,
/// larger top margins ahead of headings.
struct MarkdownView: View {
    let blocks: [MDBlock]
    let styling: MarkdownStyling
    /// Lazy for full documents (the reader); eager for small embeds
    /// (quotes, river cards).
    var lazy = false
    /// Called with the 1-based source line when a task checkbox is tapped.
    var onToggleCheckbox: ((Int) -> Void)?

    var body: some View {
        if lazy {
            LazyVStack(alignment: .leading, spacing: 0) { rows }
        } else {
            VStack(alignment: .leading, spacing: 0) { rows }
        }
    }

    private var rows: some View {
        ForEach(Array(blocks.enumerated()), id: \.offset) { index, block in
            blockView(block)
                .padding(.top, topSpacing(for: block, at: index))
        }
    }

    private func topSpacing(for block: MDBlock, at index: Int) -> CGFloat {
        guard index > 0 else { return 0 }
        if case .spacer = block { return 0 }
        // An explicit spacer above already carries the rhythm; keep the
        // residual gap minimal so one blank line ≈ one empty line.
        if case .spacer = blocks[index - 1] {
            return styling.typography.bodySize * 0.2
        }
        switch block {
        case .heading(let level, _):
            return level <= 2 ? styling.typography.bodySize * 1.35 : styling.typography.bodySize * 1.15
        default:
            return styling.typography.paragraphSpacing
        }
    }

    @ViewBuilder
    private func blockView(_ block: MDBlock) -> some View {
        switch block {
        case .heading(_, let text):
            Text(text)
                .lineSpacing(styling.typography.lineSpacing * 0.6)
                .fixedSize(horizontal: false, vertical: true)
        case .paragraph(let text):
            Text(text)
                .lineSpacing(styling.typography.lineSpacing)
                .fixedSize(horizontal: false, vertical: true)
        case .list(let items, let ordered):
            MDListView(items: items, ordered: ordered, depth: 0, styling: styling, onToggleCheckbox: onToggleCheckbox)
        case .code(let language, let code):
            codeView(language: language, code: code)
        case .quote(let blocks):
            HStack(alignment: .top, spacing: 0) {
                RoundedRectangle(cornerRadius: 1.5)
                    .fill(styling.mutedColor.opacity(0.5))
                    .frame(width: 3)
                MarkdownView(blocks: blocks, styling: styling, onToggleCheckbox: onToggleCheckbox)
                    .padding(.leading, 12)
            }
        case .rule:
            Rectangle()
                .fill(styling.mutedColor.opacity(0.3))
                .frame(height: 1)
                .padding(.vertical, 4)
        case .table(let headers, let rows):
            tableView(headers: headers, rows: rows)
        case .spacer(let lines):
            // One blank source line = one empty text line, like the Mac.
            Color.clear
                .frame(height: CGFloat(lines) * styling.typography.bodySize * styling.typography.lineHeightMultiple * 0.92)
        }
    }

    private func codeView(language: String?, code: String) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            if let language, !language.isEmpty {
                Text(language)
                    .font(styling.typography.monoFont(size: 11))
                    .foregroundStyle(styling.mutedColor)
                    .padding(.bottom, 6)
            }
            ScrollView(.horizontal, showsIndicators: false) {
                Text(code)
                    .font(styling.typography.monoFont(size: styling.typography.bodySize - 3))
                    .foregroundStyle(styling.textColor)
                    .textSelection(.enabled)
            }
        }
        .padding(13)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(styling.mutedColor.opacity(0.09), in: RoundedRectangle(cornerRadius: 9))
    }

    private func tableView(headers: [AttributedString], rows: [[AttributedString]]) -> some View {
        ScrollView(.horizontal, showsIndicators: false) {
            Grid(alignment: .topLeading, horizontalSpacing: 18, verticalSpacing: 7) {
                GridRow {
                    ForEach(Array(headers.enumerated()), id: \.offset) { _, header in
                        Text(header)
                    }
                }
                Divider()
                ForEach(Array(rows.enumerated()), id: \.offset) { _, row in
                    GridRow {
                        ForEach(Array(row.enumerated()), id: \.offset) { _, cell in
                            Text(cell)
                        }
                    }
                }
            }
        }
    }
}

/// Recursive list renderer (a named struct so SwiftUI's opaque return types
/// don't chase their own tail).
struct MDListView: View {
    let items: [MDListItem]
    let ordered: Bool
    let depth: Int
    let styling: MarkdownStyling
    var onToggleCheckbox: ((Int) -> Void)?

    var body: some View {
        VStack(alignment: .leading, spacing: styling.typography.paragraphSpacing * 0.55) {
            ForEach(Array(items.enumerated()), id: \.element.id) { index, item in
                VStack(alignment: .leading, spacing: styling.typography.paragraphSpacing * 0.55) {
                    HStack(alignment: .firstTextBaseline, spacing: 9) {
                        marker(for: item, index: index)
                        Text(item.text)
                            .lineSpacing(styling.typography.lineSpacing)
                            .fixedSize(horizontal: false, vertical: true)
                            .opacity(item.checked == true ? 0.55 : 1)
                            .strikethroughIfDone(item.checked == true)
                    }
                    if !item.children.isEmpty {
                        MDListView(items: item.children, ordered: false, depth: depth + 1, styling: styling, onToggleCheckbox: onToggleCheckbox)
                            .padding(.leading, 24)
                    }
                }
            }
        }
        .padding(.leading, depth == 0 ? 2 : 0)
    }

    @ViewBuilder
    private func marker(for item: MDListItem, index: Int) -> some View {
        if let checked = item.checked {
            Button {
                if let line = item.sourceLine { onToggleCheckbox?(line) }
            } label: {
                Image(systemName: checked ? "checkmark.square.fill" : "square")
                    .font(.system(size: styling.typography.bodySize * 0.92))
                    .foregroundStyle(checked ? styling.accentColor : styling.mutedColor)
            }
            .buttonStyle(.plain)
        } else if ordered {
            Text("\(index + 1).")
                .font(styling.typography.monoFont(size: styling.typography.bodySize - 3))
                .foregroundStyle(styling.mutedColor)
        } else {
            Circle()
                .fill(styling.mutedColor.opacity(0.75))
                .frame(width: 4.5, height: 4.5)
                .alignmentGuide(.firstTextBaseline) { $0[VerticalAlignment.center] + 3.5 }
        }
    }
}

private extension View {
    @ViewBuilder
    func strikethroughIfDone(_ done: Bool) -> some View {
        if done { self.strikethrough() } else { self }
    }
}
