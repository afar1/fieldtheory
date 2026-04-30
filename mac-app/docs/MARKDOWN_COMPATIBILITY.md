# Markdown Compatibility

Field Theory treats Markdown files as user-owned documents.

The app should make plain Markdown easier to read and edit, but it should not require private syntax for normal notes.

## Baseline

Field Theory's compatibility target is CommonMark plus GitHub Flavored Markdown.

That means normal Markdown paragraphs, headings, lists, blockquotes, fenced code blocks, tables, task lists, strikethrough, autolinks, and standard inline links should remain portable across editors.

## Files

Field Theory creates `.md` files by default.

The app may read other Markdown-like extensions where existing code already supports them, but new note creation should prefer `.md`.

Files are expected to be UTF-8 text.

## Frontmatter

YAML frontmatter is allowed at the top of a file.

Field Theory may read user-facing metadata from frontmatter, such as task state, but app-only state should stay outside the Markdown body unless the user can reasonably understand and edit it.

## Links

Standard relative Markdown links are part of the core contract:

```markdown
[Design note](entries/design-note.md)
```

Field Theory also supports wikilinks as an enhancement:

```markdown
[[Design Note]]
[[entries/design-note|Design note]]
```

Wikilinks should not become the only reliable way to connect documents.

## Writes

Opening and saving a document should not rewrite unrelated Markdown.

Field Theory may change Markdown when the user asks for a specific edit, such as toggling a task, renaming a page title, or running an agent against a note.

## Deletes

User documents should go to Trash by default.

Permanent deletion should be explicit.
