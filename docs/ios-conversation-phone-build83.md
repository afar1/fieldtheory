# Field Theory phone build 83

Device source is an isolated snapshot of `/Users/afar/dev/fieldtheory-ios-local`
HEAD `1905a711d` plus its existing working changes. That checkout produced the
installed Focus build 82 (`1905a711d-audio-startup-diagnostics-local`).

The conversation sources and store regression tests come from `4258f5eeb`.
Integration preserves the current Voice-only product surface and adds Agent
as a second native tab. Existing recording, privacy and Reviewer Demo behavior
remain from the device baseline; Reviewer Demo does not expose Agent. Selected
Voice text can be reviewed in Agent before sending. Existing legacy transcript
Send to Agent routing is preserved.

Relay schema/Mac runner dependency remains `7eef1438b` from the companion
orchestration task. No hosted migration or Mac deployment is part of this
phone installation. Until the relay is provisioned, Agent shows its explicit
unavailable state.
