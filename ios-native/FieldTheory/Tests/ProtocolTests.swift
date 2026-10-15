import XCTest
@testable import FieldTheory

/// Tests for the pure functions that must agree byte-for-byte with the Mac's
/// librarySyncService.ts and the previous mobile app's sync code.
final class ProtocolTests: XCTestCase {

    // MARK: client_id derivation

    func testLibraryClientIdMatchesMacDerivation() {
        // library-${sha256(sourcePath).slice(0, 32)}
        XCTAssertEqual(
            Hashing.libraryClientId(sourcePath: "scratchpad/note.md"),
            "library-e21d3474f5e9c774c236240ed40d839c"
        )
    }

    func testSha256HexMatchesNode() {
        // echo -n "hello" | shasum -a 256
        XCTAssertEqual(
            Hashing.sha256Hex("hello"),
            "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824"
        )
    }

    // MARK: source path normalization (port of normalizeLibrarySourcePath)

    func testNormalizeAddsMarkdownExtension() {
        XCTAssertEqual(LibraryPaths.normalize("folder/note", title: "x"), "folder/note.md")
    }

    func testNormalizeRejectsAbsolutePaths() {
        XCTAssertNil(LibraryPaths.normalize("/etc/passwd.md", title: "x"))
    }

    func testNormalizeRejectsTraversal() {
        XCTAssertNil(LibraryPaths.normalize("a/../b.md", title: "x"))
        XCTAssertNil(LibraryPaths.normalize("./a.md", title: "x"))
    }

    func testNormalizeFallsBackToScratchpad() {
        XCTAssertEqual(LibraryPaths.normalize(nil, title: "My Note"), "scratchpad/My Note.md")
        XCTAssertEqual(LibraryPaths.normalize("  ", title: "My Note"), "scratchpad/My Note.md")
    }

    func testNormalizeConvertsBackslashes() {
        XCTAssertEqual(LibraryPaths.normalize("folder\\note.md", title: "x"), "folder/note.md")
    }

    func testSafeFileNameStripsHostileCharacters() {
        XCTAssertEqual(LibraryPaths.safeFileName("a/b:c*d"), "a-b-c-d")
        XCTAssertEqual(LibraryPaths.safeFileName("   "), "Untitled")
    }

    // MARK: timestamps

    func testISOTimestampParsing() {
        XCTAssertEqual(Timestamps.ms(fromISO: "1970-01-01T00:00:01.000+00:00"), 1000)
        XCTAssertEqual(Timestamps.ms(fromISO: "1970-01-01T00:00:01Z"), 1000)
        XCTAssertEqual(Timestamps.ms(fromISO: nil), 0)
        XCTAssertEqual(Timestamps.ms(fromISO: "garbage"), 0)
    }

    // MARK: stack segments wire format (camelCase, like the old RN app)

    func testTranscriptSegmentJSONUsesCamelCase() throws {
        let segment = TranscriptSegment(id: "abc", text: "hi", createdAt: 5, updatedAt: 9)
        let data = try JSONEncoder().encode([segment])
        let json = String(data: data, encoding: .utf8)!
        XCTAssertTrue(json.contains("\"createdAt\":5"))
        XCTAssertTrue(json.contains("\"updatedAt\":9"))

        let decoded = try JSONDecoder().decode([TranscriptSegment].self, from: data)
        XCTAssertEqual(decoded, [segment])
    }

    // MARK: editor list mechanics

    func testListContinuationForCheckboxes() {
        let match = MarkdownEditorStyler.listPrefix(of: "- [x] done thing")
        XCTAssertEqual(match?.nextMarker, "- [ ] ")
    }

    func testListContinuationIncrementsNumbers() {
        let match = MarkdownEditorStyler.listPrefix(of: "  3. third")
        XCTAssertEqual(match?.nextMarker, "  4. ")
    }

    func testListContinuationKeepsBulletStyle() {
        XCTAssertEqual(MarkdownEditorStyler.listPrefix(of: "* item")?.nextMarker, "* ")
        XCTAssertNil(MarkdownEditorStyler.listPrefix(of: "plain text"))
    }

    func testCheckboxRangeFindsBracketCell() {
        let range = MarkdownEditorStyler.checkboxRange(in: "- [ ] task")
        XCTAssertEqual(range, NSRange(location: 2, length: 3))
        XCTAssertNil(MarkdownEditorStyler.checkboxRange(in: "- not a task"))
    }
}
