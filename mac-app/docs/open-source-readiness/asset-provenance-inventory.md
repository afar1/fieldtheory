# Asset Provenance Inventory

Date: May 31, 2026

This inventory records bundled Mac app assets that need provenance and license confirmation before public release. It does not claim that unknown assets are safe to redistribute. Unknown means the file is tracked and packaged or public, but this pass did not find a source/license record in the repository.

## Release Rule

Do not publish a public release until every bundled non-code asset is classified as one of:

- project-owned and approved for the chosen public license;
- third-party with recorded source, license, attribution, and redistribution permission;
- generated with recorded prompt/tool/source rights and approved for redistribution;
- removed from public source and release artifacts.

## Exposure Reduced in This Pass

This pass removed unused legacy tray icons, unused onboarding images, unknown-provenance sound files, and tracked reference voice audio files with unknown consent/provenance. It also stopped packaging `resources/chatterbox` as an app `extraResources` entry.

The remaining sound files are generated replacement WAV files created in this readiness pass with Python's standard `wave` module from simple sine tones. They are project-owned generated assets and can be covered by the chosen project asset license.

Removed files:

- `mac-app/electron/assets/littleone-activeTemplate.png`
- `mac-app/electron/assets/littleone-activeTemplate@2x.png`
- `mac-app/electron/assets/littleone-connectedTemplate.png`
- `mac-app/electron/assets/littleone-connectedTemplate@2x.png`
- `mac-app/electron/assets/littleone-disconnectedTemplate.png`
- `mac-app/electron/assets/littleone-disconnectedTemplate@2x.png`
- `mac-app/public/onboarding-art-1.jpg`
- `mac-app/public/onboarding-art-2.jpg`
- `mac-app/public/sounds/AlertBonk.mp3`
- `mac-app/public/sounds/AlertIndigo.mp3`
- `mac-app/public/sounds/AlertQuack.mp3`
- `mac-app/public/sounds/AlertSosumi.mp3`
- `mac-app/public/sounds/ArtifactDiscovery.wav`
- `mac-app/public/sounds/Beep.mp3`
- `mac-app/public/sounds/ButtonClickDown.mp3`
- `mac-app/public/sounds/ButtonClickUp.mp3`
- `mac-app/public/sounds/Click.mp3`
- `mac-app/public/sounds/EmailMailSent.mp3`
- `mac-app/public/sounds/MenuClose.mp3`
- `mac-app/public/sounds/MenuOpen.mp3`
- `mac-app/public/sounds/PhotoShutter.mp3`
- `mac-app/public/sounds/Thump.mp3`
- `mac-app/public/sounds/WindowClose.mp3`
- `mac-app/public/sounds/WindowOpen.mp3`
- `mac-app/public/sounds/click.wav`
- `mac-app/public/sounds/error.wav`
- `mac-app/public/sounds/librarian-error.wav`
- `mac-app/public/sounds/tab.wav`
- `mac-app/resources/chatterbox/reference-voice.m4a`
- `mac-app/resources/chatterbox/reference-voice.wav`

## Remaining Inventory

| Path | Type | SHA-256 | Current status | Required action |
| --- | --- | --- | --- | --- |
| `mac-app/electron/assets/fieldtheory-iconTemplate.png` | PNG icon, 16x16 | `6fb59ae616f12f68cded28d4d949e81920ca07fedaefaf1c983d61207b523476` | Unknown provenance | Confirm project ownership or replace |
| `mac-app/electron/assets/fieldtheory-iconTemplate@2x.png` | PNG icon, 32x32 | `4c0c8abdc5eb7735096e74f58e8e4de3bdf54e07ec5e966f13c598331f7199f4` | Unknown provenance | Confirm project ownership or replace |
| `mac-app/electron/assets/icon.icns` | macOS icon | `527900ebbc9a67a48465d3fddc40ead05fa1830272a1b20b9663253a9ee291e6` | Unknown provenance | Confirm project ownership or replace |
| `mac-app/public/field-theory-icon-black.png` | PNG icon, 738x738 | `322f69e470af4fa1c1d6c4dd13318a15479189ba7a109cf07d1cdb41b805777c` | Unknown provenance | Confirm project ownership or replace |
| `mac-app/public/fieldtheory-icon.png` | PNG icon, 212x240 | `d47f88740293b5f06e0f724c52a48ac9ab01003e6f072a4b2f1194305e55adef` | Unknown provenance | Confirm project ownership or replace |
| `mac-app/public/fieldtheory-logo-black.png` | PNG logo, 3542x654 | `d99975026d606b925ac8d704a7c70958e2a0f148ff19f7af9a8eb8b95f760033` | Unknown provenance | Confirm project ownership or replace |
| `mac-app/public/fieldtheory-logo-white.png` | PNG logo, 3542x654 | `2bade61eaaf28b87d2533ef9f368dddbe0937daa2cee73aa5a5aad6f7f4716dd` | Unknown provenance | Confirm project ownership or replace |
| `mac-app/public/sounds/artifact-discovery.wav` | Generated WAV sound | `55b04bed278b4101d8e1b7a191270be23c72402dcfc60ccc68381fc48e4519ea` | Project-generated in this readiness pass | Cover under chosen asset license |
| `mac-app/public/sounds/click.wav` | Generated WAV sound | `739ace1f4f3686fe6236365b191ff3f952f0c5bf1be8c1bba71cc4c69ca68e87` | Project-generated in this readiness pass | Cover under chosen asset license |
| `mac-app/public/sounds/menu-close.wav` | Generated WAV sound | `04643445faabe1e766a7a94d2b36ca9ab5a145ddc149603bfa9ac3dfc7e52b82` | Project-generated in this readiness pass | Cover under chosen asset license |
| `mac-app/public/sounds/recording-cancel.wav` | Generated WAV sound | `1a0bc033aed9da2e9dd4c25f7e95a330f1d59c7cc49d2187ab6557bf5eb94ffe` | Project-generated in this readiness pass | Cover under chosen asset license |
| `mac-app/public/sounds/recording-start.wav` | Generated WAV sound | `fc14b1596e5cf598f3ac4bffa95f40998b8a19bcd7d9578ef7c37662ba778877` | Project-generated in this readiness pass | Cover under chosen asset license |
| `mac-app/public/sounds/recording-stop.wav` | Generated WAV sound | `32d8741bd6d72d8f84e1929534ccb086983b88f332e2e7f048ddcafadb51db15` | Project-generated in this readiness pass | Cover under chosen asset license |
| `mac-app/public/sounds/window-close.wav` | Generated WAV sound | `8bbcda5d62bd8303cd6d393a18578e27a9ade471259fb4917192b16df161e274` | Project-generated in this readiness pass | Cover under chosen asset license |
| `mac-app/public/sounds/window-open.wav` | Generated WAV sound | `7d1e546cba226834c24436090af9644978b0cac348b7fa5cc75d73cfd3667ce6` | Project-generated in this readiness pass | Cover under chosen asset license |

## Code-like Public Files

These files are source or public HTML rather than media assets. They still need normal source-license coverage:

- `mac-app/public/changelog.html`
- `mac-app/public/reset-password.html`
- `mac-app/resources/chatterbox/server.py`
- `mac-app/resources/models/README.md`
- `mac-app/resources/models/.gitignore`
- `mac-app/electron/assets/README.md`

## Current Conclusion

The high-risk reference voice assets and unknown onboarding/sound assets have been removed. The remaining unknowns are brand/icon assets. They still need owner confirmation, replacement, or removal before public release.
