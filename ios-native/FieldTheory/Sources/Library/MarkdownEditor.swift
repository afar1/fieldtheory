import SwiftUI
import UIKit

/// Reports whether a markdown editor currently has the keyboard, and how to
/// insert text at its cursor — the floating mic routes transcriptions here.
@MainActor
@Observable
final class EditorFocusBus {
    var isEditing = false
    var insertHandler: ((String) -> Void)?

    func insert(_ text: String) -> Bool {
        guard isEditing, let insertHandler else { return false }
        insertHandler(text)
        return true
    }
}

/// Live-styled markdown editing on UITextView + TextKit 2: instant, native,
/// no web view. Syntax stays visible but styled (Bear-style); checkboxes
/// toggle on tap; lists continue on return.
struct MarkdownEditor: UIViewRepresentable {
    @Binding var text: String
    let styling: MarkdownStyling
    let focusBus: EditorFocusBus?
    var focusOnAppear = false
    var onEditingChanged: ((Bool) -> Void)?

    func makeUIView(context: Context) -> UITextView {
        let textView = LineNumberedTextView()
        textView.backgroundColor = .clear
        textView.alwaysBounceVertical = true
        textView.keyboardDismissMode = .interactive
        textView.autocorrectionType = .yes
        textView.autocapitalizationType = .sentences
        textView.smartQuotesType = .no
        textView.smartDashesType = .no
        textView.spellCheckingType = .yes
        textView.textContainerInset = UIEdgeInsets(top: 18, left: 44, bottom: 140, right: 18)
        textView.gutterColor = UIColor(styling.mutedColor).withAlphaComponent(0.45)
        textView.delegate = context.coordinator
        textView.inputAccessoryView = context.coordinator.makeToolbar()

        let tap = UITapGestureRecognizer(target: context.coordinator, action: #selector(Coordinator.handleTap(_:)))
        tap.delegate = context.coordinator
        textView.addGestureRecognizer(tap)

        context.coordinator.textView = textView
        context.coordinator.styling = styling
        textView.attributedText = context.coordinator.styled(text)
        if focusOnAppear {
            DispatchQueue.main.async { textView.becomeFirstResponder() }
        }
        return textView
    }

    func updateUIView(_ textView: UITextView, context: Context) {
        context.coordinator.parent = self
        context.coordinator.styling = styling
        if textView.text != text {
            let selected = textView.selectedRange
            textView.attributedText = context.coordinator.styled(text)
            textView.selectedRange = NSRange(
                location: min(selected.location, (text as NSString).length),
                length: 0
            )
        }
    }

    func makeCoordinator() -> Coordinator {
        Coordinator(parent: self)
    }

    @MainActor
    final class Coordinator: NSObject, UITextViewDelegate, UIGestureRecognizerDelegate {
        var parent: MarkdownEditor
        weak var textView: UITextView?
        var styling: MarkdownStyling

        init(parent: MarkdownEditor) {
            self.parent = parent
            self.styling = parent.styling
        }

        // MARK: Styling

        func styled(_ string: String) -> NSAttributedString {
            MarkdownEditorStyler.style(string, styling: styling)
        }

        private func restyle(_ textView: UITextView) {
            let selected = textView.selectedRange
            let offset = textView.contentOffset
            textView.attributedText = styled(textView.text)
            textView.selectedRange = selected
            textView.contentOffset = offset
        }

        // MARK: UITextViewDelegate

        func textViewDidChange(_ textView: UITextView) {
            restyle(textView)
            parent.text = textView.text
            (textView as? LineNumberedTextView)?.invalidateLineNumbers()
        }

        func scrollViewDidScroll(_ scrollView: UIScrollView) {
            (scrollView as? LineNumberedTextView)?.setNeedsDisplay()
        }

        func textViewDidBeginEditing(_ textView: UITextView) {
            parent.focusBus?.isEditing = true
            parent.focusBus?.insertHandler = { [weak textView] inserted in
                textView?.insertText(inserted)
            }
            parent.onEditingChanged?(true)
        }

        func textViewDidEndEditing(_ textView: UITextView) {
            parent.focusBus?.isEditing = false
            parent.focusBus?.insertHandler = nil
            parent.onEditingChanged?(false)
        }

        func textView(_ textView: UITextView, shouldChangeTextIn range: NSRange, replacementText replacement: String) -> Bool {
            guard replacement == "\n" else { return true }
            return handleReturn(textView, range: range)
        }

        /// List continuation: return inside a list item carries the marker to
        /// the next line; return on an empty item ends the list.
        private func handleReturn(_ textView: UITextView, range: NSRange) -> Bool {
            let nsText = textView.text as NSString
            let lineRange = nsText.lineRange(for: NSRange(location: range.location, length: 0))
            let line = nsText.substring(with: lineRange).trimmingCharacters(in: .newlines)

            guard let match = MarkdownEditorStyler.listPrefix(of: line) else { return true }

            let contentAfterMarker = String(line.dropFirst(match.fullMarker.count))
            if contentAfterMarker.trimmingCharacters(in: .whitespaces).isEmpty {
                // Empty item: end the list by clearing the marker.
                let markerRange = NSRange(location: lineRange.location, length: match.fullMarker.count)
                textView.textStorage.replaceCharacters(in: markerRange, with: "")
                textView.selectedRange = NSRange(location: lineRange.location, length: 0)
                textViewDidChange(textView)
                return false
            }

            textView.insertText("\n" + match.nextMarker)
            return false
        }

        // MARK: Checkbox taps

        @objc func handleTap(_ gesture: UITapGestureRecognizer) {
            guard let textView else { return }
            let point = gesture.location(in: textView)
            guard let position = textView.closestPosition(to: point) else { return }
            let index = textView.offset(from: textView.beginningOfDocument, to: position)

            let nsText = textView.text as NSString
            guard index < nsText.length else { return }
            let lineRange = nsText.lineRange(for: NSRange(location: index, length: 0))
            let line = nsText.substring(with: lineRange)

            guard let boxRange = MarkdownEditorStyler.checkboxRange(in: line) else { return }
            let absoluteBox = NSRange(location: lineRange.location + boxRange.location, length: boxRange.length)
            // Only toggle when the tap lands on/near the checkbox marker.
            guard index <= absoluteBox.location + absoluteBox.length + 1 else { return }

            let current = nsText.substring(with: absoluteBox)
            let toggled = current.contains("x") || current.contains("X") ? "[ ]" : "[x]"
            textView.textStorage.replaceCharacters(in: absoluteBox, with: toggled)
            textViewDidChange(textView)
        }

        func gestureRecognizer(_ gestureRecognizer: UIGestureRecognizer, shouldRecognizeSimultaneouslyWith other: UIGestureRecognizer) -> Bool {
            true
        }

        // MARK: Toolbar

        /// A horizontally scrollable format bar (UIToolbar clips overflow),
        /// with the keyboard-dismiss button pinned on the trailing edge.
        func makeToolbar() -> UIView {
            let input = UIInputView(frame: CGRect(x: 0, y: 0, width: 320, height: 48), inputViewStyle: .keyboard)
            input.allowsSelfSizing = true
            input.translatesAutoresizingMaskIntoConstraints = false
            input.heightAnchor.constraint(equalToConstant: 48).isActive = true

            let scroll = UIScrollView()
            scroll.translatesAutoresizingMaskIntoConstraints = false
            scroll.showsHorizontalScrollIndicator = false
            scroll.alwaysBounceHorizontal = true
            input.addSubview(scroll)

            let dismiss = accessoryButton("keyboard.chevron.compact.down", #selector(dismissKeyboard))
            dismiss.translatesAutoresizingMaskIntoConstraints = false
            input.addSubview(dismiss)

            let tools = UIStackView(arrangedSubviews: [
                accessoryButton("checkmark.square", #selector(insertCheckbox)),
                accessoryButton("list.bullet", #selector(insertBullet)),
                accessoryButton("list.number", #selector(insertNumbered)),
                accessoryButton("bold", #selector(wrapBold)),
                accessoryButton("italic", #selector(wrapItalic)),
                accessoryButton("chevron.left.forwardslash.chevron.right", #selector(wrapCode)),
                accessoryButton("link", #selector(insertLink)),
            ])
            tools.axis = .horizontal
            tools.spacing = 2
            tools.translatesAutoresizingMaskIntoConstraints = false
            scroll.addSubview(tools)

            NSLayoutConstraint.activate([
                scroll.leadingAnchor.constraint(equalTo: input.leadingAnchor, constant: 6),
                scroll.topAnchor.constraint(equalTo: input.topAnchor),
                scroll.bottomAnchor.constraint(equalTo: input.bottomAnchor),
                scroll.trailingAnchor.constraint(equalTo: dismiss.leadingAnchor, constant: -4),

                dismiss.trailingAnchor.constraint(equalTo: input.trailingAnchor, constant: -8),
                dismiss.centerYAnchor.constraint(equalTo: input.centerYAnchor),

                tools.leadingAnchor.constraint(equalTo: scroll.contentLayoutGuide.leadingAnchor),
                tools.trailingAnchor.constraint(equalTo: scroll.contentLayoutGuide.trailingAnchor),
                tools.topAnchor.constraint(equalTo: scroll.contentLayoutGuide.topAnchor),
                tools.bottomAnchor.constraint(equalTo: scroll.contentLayoutGuide.bottomAnchor),
                tools.heightAnchor.constraint(equalTo: scroll.frameLayoutGuide.heightAnchor),
            ])
            return input
        }

        private func accessoryButton(_ systemName: String, _ action: Selector) -> UIButton {
            var configuration = UIButton.Configuration.plain()
            configuration.image = UIImage(
                systemName: systemName,
                withConfiguration: UIImage.SymbolConfiguration(pointSize: 16, weight: .medium)
            )
            configuration.contentInsets = NSDirectionalEdgeInsets(top: 12, leading: 11, bottom: 12, trailing: 11)
            let button = UIButton(configuration: configuration)
            button.tintColor = .label
            button.addTarget(self, action: action, for: .touchUpInside)
            return button
        }

        @objc private func insertCheckbox() { prefixCurrentLine(with: "- [ ] ") }
        @objc private func insertBullet() { prefixCurrentLine(with: "- ") }
        @objc private func insertNumbered() { prefixCurrentLine(with: "1. ") }
        @objc private func wrapBold() { wrapSelection(prefix: "**", suffix: "**") }
        @objc private func wrapItalic() { wrapSelection(prefix: "*", suffix: "*") }
        @objc private func wrapCode() { wrapSelection(prefix: "`", suffix: "`") }
        @objc private func insertLink() { wrapSelection(prefix: "[", suffix: "](url)") }
        @objc private func dismissKeyboard() { textView?.resignFirstResponder() }

        private func prefixCurrentLine(with marker: String) {
            guard let textView else { return }
            let nsText = textView.text as NSString
            let lineRange = nsText.lineRange(for: NSRange(location: textView.selectedRange.location, length: 0))
            let line = nsText.substring(with: lineRange)
            if line.hasPrefix(marker) {
                textView.textStorage.replaceCharacters(in: NSRange(location: lineRange.location, length: marker.count), with: "")
                textView.selectedRange = NSRange(location: max(lineRange.location, textView.selectedRange.location - marker.count), length: 0)
            } else {
                textView.textStorage.replaceCharacters(in: NSRange(location: lineRange.location, length: 0), with: marker)
                textView.selectedRange = NSRange(location: textView.selectedRange.location + marker.count, length: 0)
            }
            textViewDidChange(textView)
        }

        private func wrapSelection(prefix: String, suffix: String) {
            guard let textView else { return }
            let range = textView.selectedRange
            let nsText = textView.text as NSString
            let selectedText = range.length > 0 ? nsText.substring(with: range) : ""
            let replacement = prefix + selectedText + suffix
            textView.textStorage.replaceCharacters(in: range, with: replacement)
            if range.length == 0 {
                textView.selectedRange = NSRange(location: range.location + prefix.count, length: 0)
            } else {
                textView.selectedRange = NSRange(location: range.location, length: replacement.count)
            }
            textViewDidChange(textView)
        }
    }
}

/// UITextView with a Mac-style line-number gutter, drawn per source line
/// using TextKit 2 layout fragments.
final class LineNumberedTextView: UITextView {
    var gutterColor: UIColor = .tertiaryLabel

    private var lineStartOffsets: [Int] = []
    private let numberFont = UIFont.monospacedDigitSystemFont(ofSize: 11, weight: .regular)

    override var text: String! {
        didSet { invalidateLineNumbers() }
    }

    override var attributedText: NSAttributedString! {
        didSet { invalidateLineNumbers() }
    }

    func invalidateLineNumbers() {
        let nsText = (text ?? "") as NSString
        var offsets: [Int] = [0]
        nsText.enumerateSubstrings(in: NSRange(location: 0, length: nsText.length), options: [.byLines, .substringNotRequired]) { _, _, enclosingRange, _ in
            let next = enclosingRange.location + enclosingRange.length
            if next <= nsText.length { offsets.append(next) }
        }
        lineStartOffsets = offsets
        setNeedsDisplay()
    }

    private func lineNumber(forCharacterAt offset: Int) -> Int {
        var low = 0
        var high = lineStartOffsets.count - 1
        while low < high {
            let mid = (low + high + 1) / 2
            if lineStartOffsets[mid] <= offset { low = mid } else { high = mid - 1 }
        }
        return low + 1
    }

    override func layoutSubviews() {
        super.layoutSubviews()
        setNeedsDisplay()
    }

    override func draw(_ rect: CGRect) {
        super.draw(rect)
        guard let layoutManager = textLayoutManager,
              let contentManager = layoutManager.textContentManager else { return }

        let attributes: [NSAttributedString.Key: Any] = [
            .font: numberFont,
            .foregroundColor: gutterColor,
        ]
        let originY = textContainerInset.top

        // Start at the viewport, not the document head — ensuresLayout from
        // the top would lay out the whole document on every draw.
        let startLocation = layoutManager.textViewportLayoutController.viewportRange?.location

        layoutManager.enumerateTextLayoutFragments(from: startLocation, options: [.ensuresLayout]) { fragment in
            let frame = fragment.layoutFragmentFrame
            let fragmentTop = frame.minY + originY
            guard fragmentTop <= rect.maxY + 40 else { return false }
            guard fragmentTop >= rect.minY - 40 else { return true }

            let offset = contentManager.offset(from: contentManager.documentRange.location, to: fragment.rangeInElement.location)
            let number = "\(self.lineNumber(forCharacterAt: offset))" as NSString
            let size = number.size(withAttributes: attributes)
            // First text line of the fragment, right-aligned in the gutter.
            let firstLineHeight = fragment.textLineFragments.first?.typographicBounds.height ?? size.height
            let numberY = fragmentTop + (firstLineHeight - size.height) / 2
            number.draw(at: CGPoint(x: 34 - size.width, y: numberY), withAttributes: attributes)
            return true
        }
    }
}

/// The single-pass attributed-string styler for editing mode.
enum MarkdownEditorStyler {
    struct ListMarkerMatch {
        let fullMarker: String
        let nextMarker: String
    }

    private static let headingRegex = try! NSRegularExpression(pattern: "^(#{1,6})\\s", options: [])
    private static let checkboxRegex = try! NSRegularExpression(pattern: "^(\\s*)([-*+])\\s\\[( |x|X)\\]\\s", options: [])
    private static let bulletRegex = try! NSRegularExpression(pattern: "^(\\s*)([-*+])\\s", options: [])
    private static let numberRegex = try! NSRegularExpression(pattern: "^(\\s*)(\\d+)([.)])\\s", options: [])
    private static let boldRegex = try! NSRegularExpression(pattern: "\\*\\*(.+?)\\*\\*", options: [])
    private static let italicRegex = try! NSRegularExpression(pattern: "(?<![\\*\\w])\\*([^\\*\n]+?)\\*(?!\\*)", options: [])
    private static let codeSpanRegex = try! NSRegularExpression(pattern: "`([^`\n]+?)`", options: [])
    private static let strikeRegex = try! NSRegularExpression(pattern: "~~(.+?)~~", options: [])
    private static let linkRegex = try! NSRegularExpression(pattern: "\\[([^\\]]+)\\]\\(([^)]+)\\)", options: [])
    private static let wikiRegex = try! NSRegularExpression(pattern: "\\[\\[([^\\]]+)\\]\\]", options: [])

    static func listPrefix(of line: String) -> ListMarkerMatch? {
        let range = NSRange(location: 0, length: (line as NSString).length)
        if let match = checkboxRegex.firstMatch(in: line, range: range) {
            let full = (line as NSString).substring(with: match.range)
            let indent = (line as NSString).substring(with: match.range(at: 1))
            return ListMarkerMatch(fullMarker: full, nextMarker: "\(indent)- [ ] ")
        }
        if let match = numberRegex.firstMatch(in: line, range: range) {
            let full = (line as NSString).substring(with: match.range)
            let indent = (line as NSString).substring(with: match.range(at: 1))
            let number = Int((line as NSString).substring(with: match.range(at: 2))) ?? 0
            let punctuation = (line as NSString).substring(with: match.range(at: 3))
            return ListMarkerMatch(fullMarker: full, nextMarker: "\(indent)\(number + 1)\(punctuation) ")
        }
        if let match = bulletRegex.firstMatch(in: line, range: range) {
            let full = (line as NSString).substring(with: match.range)
            let indent = (line as NSString).substring(with: match.range(at: 1))
            let bullet = (line as NSString).substring(with: match.range(at: 2))
            return ListMarkerMatch(fullMarker: full, nextMarker: "\(indent)\(bullet) ")
        }
        return nil
    }

    /// NSRange of the "[ ]"/"[x]" cell within the given line, if any.
    static func checkboxRange(in line: String) -> NSRange? {
        let range = NSRange(location: 0, length: (line as NSString).length)
        guard let match = checkboxRegex.firstMatch(in: line, range: range) else { return nil }
        // The bracket cell starts right after "<indent><bullet> ".
        let indentLength = match.range(at: 1).length
        let start = indentLength + match.range(at: 2).length + 1
        return NSRange(location: start, length: 3)
    }

    /// How visible markdown syntax markers are while editing: ghosts, not text.
    private static let markerAlpha: CGFloat = 0.16

    static func style(_ string: String, styling: MarkdownStyling) -> NSAttributedString {
        let typography = styling.typography
        let textColor = UIColor(styling.textColor)
        let mutedColor = UIColor(styling.mutedColor)
        let accentColor = UIColor(styling.accentColor)

        let bodyFont = UIFont.variable(family: typography.preset.fontFamily, size: typography.bodySize)
        let result = NSMutableAttributedString(string: string)
        let fullRange = NSRange(location: 0, length: result.length)

        // The Mac's reading rhythm: full preset line height plus real
        // paragraph air, so prose never reads as a wall.
        let baseParagraph = NSMutableParagraphStyle()
        baseParagraph.lineHeightMultiple = typography.lineHeightMultiple * 0.92
        baseParagraph.paragraphSpacing = typography.paragraphSpacing

        result.addAttributes([
            .font: bodyFont,
            .foregroundColor: textColor,
            .paragraphStyle: baseParagraph,
        ], range: fullRange)

        let nsString = string as NSString
        var insideFence = false
        let monoFont = UIFont.variable(family: "Source Code Pro", size: typography.bodySize - 2)

        nsString.enumerateSubstrings(in: fullRange, options: [.byLines, .substringNotRequired]) { _, lineRange, _, _ in
            let line = nsString.substring(with: lineRange)
            let lineNSRange = NSRange(location: 0, length: (line as NSString).length)

            if line.trimmingCharacters(in: .whitespaces).hasPrefix("```") {
                insideFence.toggle()
                result.addAttribute(.foregroundColor, value: mutedColor, range: lineRange)
                result.addAttribute(.font, value: monoFont, range: lineRange)
                return
            }
            if insideFence {
                result.addAttribute(.font, value: monoFont, range: lineRange)
                return
            }

            // Headings: bigger type, breathing room above, ghosted #
            if let match = headingRegex.firstMatch(in: line, range: lineNSRange) {
                let level = match.range(at: 1).length
                let size = level == 1 ? typography.h1Size : (level == 2 ? typography.h2Size : typography.h3Size)
                let font = UIFont.variable(family: typography.preset.fontFamily, size: size, weight: .semibold)
                result.addAttribute(.font, value: font, range: lineRange)
                let headingParagraph = NSMutableParagraphStyle()
                headingParagraph.lineHeightMultiple = 1.18
                headingParagraph.paragraphSpacingBefore = typography.bodySize * (level <= 2 ? 1.0 : 0.7)
                headingParagraph.paragraphSpacing = typography.paragraphSpacing * 0.7
                result.addAttribute(.paragraphStyle, value: headingParagraph, range: lineRange)
                let markerRange = NSRange(location: lineRange.location, length: match.range.length)
                result.addAttribute(.foregroundColor, value: mutedColor.withAlphaComponent(markerAlpha), range: markerRange)
                return
            }

            // Checkbox lines
            if let match = checkboxRegex.firstMatch(in: line, range: lineNSRange) {
                let markerRange = NSRange(location: lineRange.location, length: match.range.length)
                result.addAttribute(.foregroundColor, value: accentColor, range: markerRange)
                let state = (line as NSString).substring(with: match.range(at: 3))
                if state.lowercased() == "x" {
                    let rest = NSRange(location: lineRange.location + match.range.length,
                                       length: lineRange.length - match.range.length)
                    if rest.length > 0 {
                        result.addAttribute(.foregroundColor, value: mutedColor, range: rest)
                        result.addAttribute(.strikethroughStyle, value: NSUnderlineStyle.single.rawValue, range: rest)
                    }
                }
            } else if let match = bulletRegex.firstMatch(in: line, range: lineNSRange) {
                let markerRange = NSRange(location: lineRange.location + match.range(at: 2).location, length: match.range(at: 2).length)
                result.addAttribute(.foregroundColor, value: accentColor, range: markerRange)
            } else if let match = numberRegex.firstMatch(in: line, range: lineNSRange) {
                let markerRange = NSRange(location: lineRange.location, length: match.range.length)
                result.addAttribute(.foregroundColor, value: accentColor, range: markerRange)
            } else if line.hasPrefix(">") {
                result.addAttribute(.foregroundColor, value: mutedColor, range: lineRange)
            }

            // Inline spans within this line
            func mapped(_ range: NSRange) -> NSRange {
                NSRange(location: lineRange.location + range.location, length: range.length)
            }

            for match in boldRegex.matches(in: line, range: lineNSRange) {
                let current = result.attribute(.font, at: mapped(match.range).location, effectiveRange: nil) as? UIFont ?? bodyFont
                let bold = UIFont.variable(family: typography.preset.fontFamily, size: current.pointSize, weight: .semibold)
                result.addAttribute(.font, value: bold, range: mapped(match.range))
                dimMarkers(result, match: match, in: lineRange, markerLength: 2, color: mutedColor)
            }
            for match in italicRegex.matches(in: line, range: lineNSRange) {
                let range = mapped(match.range)
                let current = result.attribute(.font, at: range.location, effectiveRange: nil) as? UIFont ?? bodyFont
                if let italicDescriptor = current.fontDescriptor.withSymbolicTraits(.traitItalic) {
                    result.addAttribute(.font, value: UIFont(descriptor: italicDescriptor, size: current.pointSize), range: range)
                }
                dimMarkers(result, match: match, in: lineRange, markerLength: 1, color: mutedColor)
            }
            for match in codeSpanRegex.matches(in: line, range: lineNSRange) {
                result.addAttribute(.font, value: monoFont, range: mapped(match.range))
                result.addAttribute(.backgroundColor, value: mutedColor.withAlphaComponent(0.13), range: mapped(match.range))
            }
            for match in strikeRegex.matches(in: line, range: lineNSRange) {
                result.addAttribute(.strikethroughStyle, value: NSUnderlineStyle.single.rawValue, range: mapped(match.range(at: 1)))
                result.addAttribute(.foregroundColor, value: mutedColor, range: mapped(match.range))
            }
            for match in linkRegex.matches(in: line, range: lineNSRange) {
                result.addAttribute(.foregroundColor, value: UIColor(Theme.link), range: mapped(match.range(at: 1)))
                // The (url) part fades to a ghost; the words stay readable.
                let urlStart = match.range(at: 1).location + match.range(at: 1).length
                let urlRange = NSRange(location: urlStart, length: match.range.location + match.range.length - urlStart)
                result.addAttribute(.foregroundColor, value: mutedColor.withAlphaComponent(markerAlpha + 0.1), range: mapped(urlRange))
                let openBracket = NSRange(location: match.range.location, length: 1)
                result.addAttribute(.foregroundColor, value: mutedColor.withAlphaComponent(markerAlpha), range: mapped(openBracket))
            }
            for match in wikiRegex.matches(in: line, range: lineNSRange) {
                result.addAttribute(.foregroundColor, value: accentColor, range: mapped(match.range))
            }
        }

        return result
    }

    private static func dimMarkers(_ result: NSMutableAttributedString, match: NSTextCheckingResult, in lineRange: NSRange, markerLength: Int, color: UIColor) {
        let start = NSRange(location: lineRange.location + match.range.location, length: markerLength)
        let end = NSRange(location: lineRange.location + match.range.location + match.range.length - markerLength, length: markerLength)
        result.addAttribute(.foregroundColor, value: color.withAlphaComponent(markerAlpha), range: start)
        result.addAttribute(.foregroundColor, value: color.withAlphaComponent(markerAlpha), range: end)
    }
}
