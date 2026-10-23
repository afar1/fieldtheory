# Field Theory iOS 1.0 (85)

Action-button/Lock Screen startup now resets and reacquires the audio session
between bounded transient-start retries, including transient recorder errors
after activation. Permission, cancellation, unrelated route and file errors
remain terminal. The successful attempt alone owns the recording's file.

Retained Action-button startup-failure diagnostics now include failures before
microphone startup (storage, permission, Live Activity). A successful later tap
does not overwrite that failure file. Diagnostics contain no recorded audio or
transcript content.

36 focused audio-owner, background-recording and sign-out tests passed. Signed
physical-device build passed. The reported first-attempt failure was not present
in retained phone diagnostics; the latest capture was successful. This hardens
known retry gaps without claiming the original idle failure was reproduced.
