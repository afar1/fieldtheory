# Drawesome drawing preview

The default Mac drawing surface uses Benji Taylor's Drawesome 0.1.1, pinned to upstream commit `8fb08e93433e2cda32e265280371a0551b3c13a7`. Source and MIT notice are in `mac-app/src/vendor/drawesome`; upstream changes are a React 18 tooltip ref type compatibility patch and one whitespace cleanup. The package includes the MIT notice in `Contents/Resources/licenses/Drawesome-LICENSE.txt`.

## Behavior

- Existing create, save, save-and-copy, Library relative PNG/Markdown insertion, transcript overlay and close flows remain in place.
- Drawesome offers seven freehand pens and an eraser, undo/redo, colour, size and opacity. It does not offer Excalidraw's shapes, text, selection, resizing or object manipulation.
- Saved PNGs reopen as raster backgrounds. The eraser affects new ink, not the background. Ink and image share a fixed board coordinate system and letterbox together on resize.
- Export preserves highlighter blending and eraser masks, crops actual alpha bounds, adds 48 logical pixels of paper on each edge, and exports at device pixel ratio.
- New drafts use `pendingSketch.drawesome.v1`, retain image/board/paper/strokes, debounce storage and flush on exit. Eraser-only activity is not treated as new content. Saving failures keep the live drawing and do not intentionally remove its draft.
- An existing `pendingSketch` is kept. “Recover previous drawing” lazy-loads the old editor to recover it, regardless of age. It is removed only by an explicit discard or successful recovery save. New drawing saves do not delete it.

## Validation

Focused engine/component tests cover same-count edits, erasing, undo/redo/clear, save failure, copy intent, legacy preservation and Escape cancellation. Library inline drawing tests exercise relative Markdown insertion in rendered/edit/focus modes.

The built browser harness verified real pointer drawing, erase, undo/redo, PNG save, annotation/re-export, resize alignment, reload recovery, dark mode, and an old rectangle draft recovered and exported through Excalidraw. Its browser-native pixel checks assert 1×/2× PNG dimensions, exact 48px padding, eraser preservation of a red background, paper colour, highlighter multiply blending, and rejection of a fully erased empty drawing.

Run the isolated harness (no Electron or application data required):

```sh
cd mac-app
npx vite build --config drawing-prototype.config.ts
python3 -m http.server 5189 --bind 127.0.0.1 --directory /tmp/fieldtheory-drawesome-preview
```

Open `http://127.0.0.1:5189/drawing-prototype.html`. After Save or Cancel, “Run PNG checks” runs pixel assertions. `?theme=dark` and `?theme=light` set only this localhost preview's theme. “Load legacy recovery fixture” creates a sample old draft on this localhost origin. The harness reports the copy flag; it does not claim an actual system clipboard write.

## Acceptance still required

The user should test the signed combined DMG in the actual Mac app: Library create/reopen/save and save-and-copy from drawing history, transcript overlay/unstack, window resize, accidental-close recovery, preferred pens and toolbar ergonomics. Browser and mocked integration evidence does not replace native-app acceptance or physical phone-to-Inbox verification.

No installed application replacement, candidate launch, DMG mounting, public distribution, or merge to main is part of this preview handoff.
