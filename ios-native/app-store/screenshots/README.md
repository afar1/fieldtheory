# Voice-only listing screenshots

Fresh Voice-only simulator captures are checked in as
`iphone-6.9/voice.jpg` and `ipad-13/voice.jpg`. They show the actual Voice
workspace with fictional sample notes. The retired multi-surface captures live
in `../retired-listing-screenshots/` for historical reference and must not be
uploaded for this release.

- iPhone 17 Pro Max: 1320 × 2868, Apple 6.9-inch set.
- iPad Pro 13-inch (M5): 2064 × 2752 portrait or 2752 × 2064 landscape.
- JPEG files must have no alpha channel.

Launch the isolated simulator fixture, then capture the Voice screen and any
Voice editing/stacking state selected for the listing:

```sh
xcrun simctl launch <simulator-id> com.afar1.fieldtheory ft-preview
xcrun simctl io <simulator-id> screenshot --type=jpeg <output.jpg>
```

Review all fixture text and selected screenshots before upload. Simulator images
are listing drafts, not physical-device acceptance evidence.
