# Reset Onboarding

Reset the app's onboarding state for testing.

## Important

The app checks **both microphone AND accessibility** permissions to determine if you're a new user. You must revoke **BOTH** for onboarding to show.

## Instructions for Claude

Run this bash command to delete preferences and open System Settings:

```bash
rm ~/Library/Application\ Support/Field\ Theory/preferences.json && open "x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone" && open "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility" && open "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture"
```

Then tell the user to do these steps **before restarting the app**:

1. **Microphone**: Toggle "Field Theory" **OFF**
2. **Accessibility**: Click minus (-) to **remove** "Field Theory"
3. **Screen Recording**: Click minus (-) to **remove** "Field Theory"

After making those changes, restart the app with `npm run dev`.

The terminal will now show permission status at startup:
```
[Main] Permission check at startup:
  - Microphone: not-determined (or denied)
  - Accessibility: false
  - Screen Recording: not-determined (or denied)
  - onboardingComplete: undefined
  - hasCorePermissions: false
```

If `hasCorePermissions: true`, onboarding will be skipped - go back and revoke permissions.
