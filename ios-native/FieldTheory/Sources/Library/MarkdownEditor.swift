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

/// The rich editing surface: markdown lives in storage, but syntax markers
/// are concealed (zero-width) everywhere except the line the caret is on,
/// where they ghost in for precise editing. Reading and writing are the same
/// view — tap anywhere and type. Styling is applied as attribute-only
/// mutations on the changed lines, never a full attributed-string rebuild.
struct MarkdownEditor: UIViewRepresentable {
    @Binding var text: String
    let styling: MarkdownStyling
    let focusBus: EditorFocusBus?
    var focusOnAppear = false
    var onEditingChanged: ((Bool) -> Void)?
    var onPullDismiss: (() -> Void)?

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
        // Constant layout: chrome and tab-bar transitions must never reflow
        // the text (that reflow was the reading jitter).
        textView.contentInsetAdjustmentBehavior = .never
        textView.textContainerInset = UIEdgeInsets(top: 64, left: 44, bottom: 160, right: 18)
        textView.gutterColor = UIColor(styling.mutedColor).withAlphaComponent(0.45)
        textView.delegate = context.coordinator
        textView.inputAccessoryView = context.coordinator.makeToolbar()

        let tap = UITapGestureRecognizer(target: context.coordinator, action: #selector(Coordinator.handleTap(_:)))
        tap.delegate = context.coordinator
        textView.addGestureRecognizer(tap)

        context.coordinator.textView = textView
        context.coordinator.styling = styling
        context.coordinator.setInitialText(text)
        context.coordinator.observeKeyboard()
        if focusOnAppear {
            DispatchQueue.main.async { textView.becomeFirstResponder() }
        }
        return textView
    }

    func updateUIView(_ textView: UITextView, context: Context) {
        context.coordinator.parent = self
        if textView.text != text {
            context.coordinator.setInitialText(text, preservingSelectionOf: textView)
        } else if context.coordinator.stylingSignatureChanged(styling) {
            context.coordinator.styling = styling
            context.coordinator.applyFullStyles()
        }
    }

    func makeCoordinator() -> Coordinator {
        Coordinator(parent: self)
    }

    @MainActor
    final class Coordinator: NSObject, UITextViewDelegate, UIGestureRecognizerDelegate {
        var parent: MarkdownEditor
        weak var textView: UITextView?
        var styling: MarkdownStyling {
            didSet { signature = Self.signature(of: styling) }
        }

        private var signature: String
        private var revealedLineRange: NSRange?
        private var pulledToDismiss = false
        private var keyboardObservers: [NSObjectProtocol] = []

        init(parent: MarkdownEditor) {
            self.parent = parent
            self.styling = parent.styling
            self.signature = Self.signature(of: parent.styling)
        }

        deinit {
            for observer in keyboardObservers {
                NotificationCenter.default.removeObserver(observer)
            }
        }

        static func signature(of styling: MarkdownStyling) -> String {
            let typography = styling.typography
            return "\(typography.preset.rawValue)-\(typography.bodySize)-\(typography.lineHeightMultiple)-\(styling.textColor.description)-\(styling.accentColor.description)"
        }

        func stylingSignatureChanged(_ next: MarkdownStyling) -> Bool {
            Self.signature(of: next) != signature
        }

        // MARK: Text + styling lifecycle

        func setInitialText(_ string: String, preservingSelectionOf existing: UITextView? = nil) {
            guard let textView else { return }
            let selection = existing?.selectedRange
            textView.attributedText = NSAttributedString(string: string)
            applyFullStyles()
            if let selection {
                textView.selectedRange = NSRange(
                    location: min(selection.location, (string as NSString).length),
                    length: 0
                )
            }
            (textView as? LineNumberedTextView)?.invalidateLineNumbers()
        }

        func applyFullStyles() {
            guard let textView else { return }
            let caretLine = currentCaretLineRange()
            MarkdownEditorStyler.apply(
                to: textView.textStorage,
                styling: styling,
                revealedLineRange: caretLine
            )
            revealedLineRange = caretLine
        }

        private func currentCaretLineRange() -> NSRange? {
            guard let textView else { return nil }
            let nsText = textView.text as NSString
            guard nsText.length > 0 else { return nil }
            let location = min(textView.selectedRange.location, nsText.length)
            return nsText.lineRange(for: NSRange(location: location, length: 0))
        }

        /// Restyle just the lines around the caret after an edit; fall back
        /// to a full pass when fences may have toggled.
        private func restyleAfterEdit(_ textView: UITextView) {
            let nsText = textView.text as NSString
            guard nsText.length > 0 else { return }
            let caret = min(textView.selectedRange.location, nsText.length)
            let caretLine = nsText.lineRange(for: NSRange(location: caret, length: 0))

            // Extend one line up so newline splits restyle both halves.
            var span = caretLine
            if caretLine.location > 0 {
                let previous = nsText.lineRange(for: NSRange(location: caretLine.location - 1, length: 0))
                span = NSUnionRange(span, previous)
            }

            let touched = nsText.substring(with: span)
            if touched.contains("```") {
                applyFullStyles()
                return
            }

            MarkdownEditorStyler.applyLines(
                in: span,
                to: textView.textStorage,
                styling: styling,
                revealedLineRange: caretLine
            )
            revealedLineRange = caretLine
        }

        // MARK: UITextViewDelegate

        func textViewDidChange(_ textView: UITextView) {
            restyleAfterEdit(textView)
            parent.text = textView.text
            (textView as? LineNumberedTextView)?.invalidateLineNumbers()
        }

        func textViewDidChangeSelection(_ textView: UITextView) {
            let next = currentCaretLineRange()
            guard next != revealedLineRange else { return }
            let nsText = textView.text as NSString

            if let previous = revealedLineRange, previous.location <= nsText.length,
               NSMaxRange(previous) <= nsText.length {
                MarkdownEditorStyler.applyLines(
                    in: previous, to: textView.textStorage,
                    styling: styling, revealedLineRange: nil
                )
            }
            if let next, NSMaxRange(next) <= nsText.length {
                MarkdownEditorStyler.applyLines(
                    in: next, to: textView.textStorage,
                    styling: styling, revealedLineRange: next
                )
            }
            revealedLineRange = next
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
                let markerRange = NSRange(location: lineRange.location, length: match.fullMarker.count)
                textView.textStorage.replaceCharacters(in: markerRange, with: "")
                textView.selectedRange = NSRange(location: lineRange.location, length: 0)
                textViewDidChange(textView)
                return false
            }

            textView.insertText("\n" + match.nextMarker)
            return false
        }

        // MARK: Scrolling (gutter + pull-to-dismiss)

        func scrollViewDidScroll(_ scrollView: UIScrollView) {
            (scrollView as? LineNumberedTextView)?.setNeedsDisplay()
            if scrollView.contentOffset.y < -70, !pulledToDismiss, scrollView.isTracking {
                pulledToDismiss = true
                UIImpactFeedbackGenerator(style: .medium).impactOccurred()
                parent.onPullDismiss?()
            }
        }

        // MARK: Keyboard avoidance (manual, because inset adjustment is off)

        func observeKeyboard() {
            let center = NotificationCenter.default
            keyboardObservers.append(center.addObserver(forName: UIResponder.keyboardWillChangeFrameNotification, object: nil, queue: .main) { [weak self] note in
                MainActor.assumeIsolated { self?.adjustForKeyboard(note) }
            })
            keyboardObservers.append(center.addObserver(forName: UIResponder.keyboardWillHideNotification, object: nil, queue: .main) { [weak self] _ in
                MainActor.assumeIsolated {
                    self?.textView?.contentInset.bottom = 0
                    self?.textView?.verticalScrollIndicatorInsets.bottom = 0
                }
            })
        }

        private func adjustForKeyboard(_ note: Notification) {
            guard let textView,
                  let frame = note.userInfo?[UIResponder.keyboardFrameEndUserInfoKey] as? CGRect,
                  let window = textView.window else { return }
            let keyboardTop = window.bounds.height - frame.minY
            let overlap = max(0, keyboardTop - max(0, window.bounds.maxY - textView.convert(textView.bounds, to: window).maxY))
            textView.contentInset.bottom = overlap
            textView.verticalScrollIndicatorInsets.bottom = overlap
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
            let firstLineHeight = fragment.textLineFragments.first?.typographicBounds.height ?? size.height
            let numberY = fragmentTop + (firstLineHeight - size.height) / 2
            number.draw(at: CGPoint(x: 34 - size.width, y: numberY), withAttributes: attributes)
            return true
        }
    }
}

/// Attribute-only markdown styling with marker concealment. Markers take
/// effectively zero width unless their line is "revealed" (caret present),
/// where they ghost in for editing.
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
        let indentLength = match.range(at: 1).length
        let start = indentLength + match.range(at: 2).length + 1
        return NSRange(location: start, length: 3)
    }

    /// Test/compat convenience: style a fresh string.
    static func style(_ string: String, styling: MarkdownStyling) -> NSAttributedString {
        let storage = NSTextStorage(string: string)
        apply(to: storage, styling: styling, revealedLineRange: nil)
        return storage
    }

    /// Full-document attribute pass.
    static func apply(to storage: NSTextStorage, styling: MarkdownStyling, revealedLineRange: NSRange?) {
        let nsString = storage.string as NSString
        storage.beginEditing()
        var insideFence = false
        nsString.enumerateSubstrings(in: NSRange(location: 0, length: nsString.length), options: [.byLines, .substringNotRequired]) { _, lineRange, enclosingRange, _ in
            let line = nsString.substring(with: lineRange)
            let revealed = revealedLineRange.map { NSIntersectionRange($0, enclosingRange).length > 0 || $0.location == enclosingRange.location } ?? false
            insideFence = styleLine(
                line, lineRange: lineRange, storage: storage,
                styling: styling, revealed: revealed, insideFence: insideFence
            )
        }
        storage.endEditing()
    }

    /// Restyle just the lines intersecting `span` (attribute-only).
    static func applyLines(in span: NSRange, to storage: NSTextStorage, styling: MarkdownStyling, revealedLineRange: NSRange?) {
        let nsString = storage.string as NSString
        guard nsString.length > 0, span.location < nsString.length || span.location == 0 else { return }
        let safeSpan = NSIntersectionRange(span, NSRange(location: 0, length: nsString.length))
        guard safeSpan.length > 0 || nsString.length == 0 else { return }
        let lineSpan = nsString.lineRange(for: safeSpan)

        var insideFence = fenceState(before: lineSpan.location, in: nsString)
        storage.beginEditing()
        nsString.enumerateSubstrings(in: lineSpan, options: [.byLines, .substringNotRequired]) { _, lineRange, enclosingRange, _ in
            let line = nsString.substring(with: lineRange)
            let revealed = revealedLineRange.map { NSIntersectionRange($0, enclosingRange).length > 0 || $0.location == enclosingRange.location } ?? false
            insideFence = styleLine(
                line, lineRange: lineRange, storage: storage,
                styling: styling, revealed: revealed, insideFence: insideFence
            )
        }
        storage.endEditing()
    }

    /// Counts fence markers before `location` to know if we start inside one.
    private static func fenceState(before location: Int, in nsString: NSString) -> Bool {
        guard location > 0 else { return false }
        var count = 0
        nsString.enumerateSubstrings(in: NSRange(location: 0, length: location), options: [.byLines]) { substring, _, _, _ in
            if substring?.trimmingCharacters(in: .whitespaces).hasPrefix("```") == true {
                count += 1
            }
        }
        return count % 2 == 1
    }

    // MARK: Per-line styling

    /// Styles one line; returns the fence state after this line.
    @discardableResult
    private static func styleLine(
        _ line: String, lineRange: NSRange, storage: NSTextStorage,
        styling: MarkdownStyling, revealed: Bool, insideFence: Bool
    ) -> Bool {
        let typography = styling.typography
        let textColor = UIColor(styling.textColor)
        let mutedColor = UIColor(styling.mutedColor)
        let accentColor = UIColor(styling.accentColor)
        let bodyFont = UIFont.variable(family: typography.preset.fontFamily, size: typography.bodySize)
        let monoFont = UIFont.variable(family: "Source Code Pro", size: typography.bodySize - 2)

        let baseParagraph = NSMutableParagraphStyle()
        baseParagraph.lineHeightMultiple = typography.lineHeightMultiple * 0.92
        baseParagraph.paragraphSpacing = typography.paragraphSpacing

        // Reset the line to base attributes first.
        storage.setAttributes([
            .font: bodyFont,
            .foregroundColor: textColor,
            .paragraphStyle: baseParagraph,
        ], range: lineRange)

        let lineNSRange = NSRange(location: 0, length: (line as NSString).length)

        func mapped(_ range: NSRange) -> NSRange {
            NSRange(location: lineRange.location + range.location, length: range.length)
        }

        func concealOrGhost(_ range: NSRange) {
            guard range.length > 0 else { return }
            if revealed {
                storage.addAttribute(.foregroundColor, value: mutedColor.withAlphaComponent(0.4), range: mapped(range))
            } else {
                storage.addAttributes([
                    .font: UIFont.systemFont(ofSize: 0.001),
                    .foregroundColor: UIColor.clear,
                ], range: mapped(range))
            }
        }

        // Fences are raw zones: mono, visible markers.
        if line.trimmingCharacters(in: .whitespaces).hasPrefix("```") {
            storage.addAttributes([
                .font: monoFont,
                .foregroundColor: mutedColor,
            ], range: lineRange)
            return !insideFence
        }
        if insideFence {
            storage.addAttribute(.font, value: monoFont, range: lineRange)
            return true
        }

        // Headings
        if let match = headingRegex.firstMatch(in: line, range: lineNSRange) {
            let level = match.range(at: 1).length
            let size = level == 1 ? typography.h1Size : (level == 2 ? typography.h2Size : typography.h3Size)
            let font = UIFont.variable(family: typography.preset.fontFamily, size: size, weight: .semibold)
            storage.addAttribute(.font, value: font, range: lineRange)
            let headingParagraph = NSMutableParagraphStyle()
            headingParagraph.lineHeightMultiple = 1.18
            headingParagraph.paragraphSpacingBefore = typography.bodySize * (level <= 2 ? 1.0 : 0.7)
            headingParagraph.paragraphSpacing = typography.paragraphSpacing * 0.7
            storage.addAttribute(.paragraphStyle, value: headingParagraph, range: lineRange)
            concealOrGhost(match.range)
            return false
        }

        // List markers
        if let match = checkboxRegex.firstMatch(in: line, range: lineNSRange) {
            storage.addAttribute(.foregroundColor, value: accentColor, range: mapped(match.range))
            let state = (line as NSString).substring(with: match.range(at: 3))
            if state.lowercased() == "x" {
                let rest = NSRange(location: match.range.length, length: lineNSRange.length - match.range.length)
                if rest.length > 0 {
                    storage.addAttribute(.foregroundColor, value: mutedColor, range: mapped(rest))
                    storage.addAttribute(.strikethroughStyle, value: NSUnderlineStyle.single.rawValue, range: mapped(rest))
                }
            }
        } else if let match = bulletRegex.firstMatch(in: line, range: lineNSRange) {
            storage.addAttribute(.foregroundColor, value: accentColor, range: mapped(match.range(at: 2)))
        } else if let match = numberRegex.firstMatch(in: line, range: lineNSRange) {
            storage.addAttribute(.foregroundColor, value: accentColor, range: mapped(match.range))
        } else if line.hasPrefix(">") {
            storage.addAttribute(.foregroundColor, value: mutedColor, range: lineRange)
        }

        // Inline spans
        for match in boldRegex.matches(in: line, range: lineNSRange) {
            let current = storage.attribute(.font, at: mapped(match.range).location, effectiveRange: nil) as? UIFont ?? bodyFont
            let bold = UIFont.variable(family: typography.preset.fontFamily, size: current.pointSize, weight: .semibold)
            storage.addAttribute(.font, value: bold, range: mapped(match.range))
            concealOrGhost(NSRange(location: match.range.location, length: 2))
            concealOrGhost(NSRange(location: match.range.location + match.range.length - 2, length: 2))
        }
        for match in italicRegex.matches(in: line, range: lineNSRange) {
            let range = mapped(match.range)
            let current = storage.attribute(.font, at: range.location, effectiveRange: nil) as? UIFont ?? bodyFont
            if let italicDescriptor = current.fontDescriptor.withSymbolicTraits(.traitItalic) {
                storage.addAttribute(.font, value: UIFont(descriptor: italicDescriptor, size: current.pointSize), range: range)
            }
            concealOrGhost(NSRange(location: match.range.location, length: 1))
            concealOrGhost(NSRange(location: match.range.location + match.range.length - 1, length: 1))
        }
        for match in codeSpanRegex.matches(in: line, range: lineNSRange) {
            storage.addAttribute(.font, value: monoFont, range: mapped(match.range))
            storage.addAttribute(.backgroundColor, value: mutedColor.withAlphaComponent(0.13), range: mapped(match.range))
            concealOrGhost(NSRange(location: match.range.location, length: 1))
            concealOrGhost(NSRange(location: match.range.location + match.range.length - 1, length: 1))
        }
        for match in strikeRegex.matches(in: line, range: lineNSRange) {
            storage.addAttribute(.strikethroughStyle, value: NSUnderlineStyle.single.rawValue, range: mapped(match.range(at: 1)))
            storage.addAttribute(.foregroundColor, value: mutedColor, range: mapped(match.range(at: 1)))
            concealOrGhost(NSRange(location: match.range.location, length: 2))
            concealOrGhost(NSRange(location: match.range.location + match.range.length - 2, length: 2))
        }
        for match in linkRegex.matches(in: line, range: lineNSRange) {
            storage.addAttribute(.foregroundColor, value: UIColor(Theme.link), range: mapped(match.range(at: 1)))
            // Conceal "[", then "](url)" — rendered view shows just the words.
            concealOrGhost(NSRange(location: match.range.location, length: 1))
            let tailStart = match.range(at: 1).location + match.range(at: 1).length
            concealOrGhost(NSRange(location: tailStart, length: match.range.location + match.range.length - tailStart))
        }
        for match in wikiRegex.matches(in: line, range: lineNSRange) {
            storage.addAttribute(.foregroundColor, value: accentColor, range: mapped(match.range(at: 1)))
            concealOrGhost(NSRange(location: match.range.location, length: 2))
            concealOrGhost(NSRange(location: match.range.location + match.range.length - 2, length: 2))
        }
        return false
    }
}
