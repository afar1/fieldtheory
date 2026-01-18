# The Shape of Confidence

In 1960, a control systems engineer named Homer Sarasohn arrived in Japan to help rebuild its telecommunications industry. He taught Japanese managers a counterintuitive idea: inspect less, test more systematically. Rather than examining every component, build processes that made defects impossible to hide.

Toyota later called this *jidoka*—automation with a human touch. The system would stop itself when it detected something wrong. The tests were built into the process, not bolted on afterward.

Fifty years later, Mike Cohn drew a triangle and called it the test pyramid. Unit tests at the base—fast, numerous, cheap. Integration tests in the middle. End-to-end tests at the peak—slow, few, expensive. The shape was a heuristic: invert it and your feedback loops collapse.

Today's session was about foundation-laying. We added 18 tests for a 50-line merge function. Overkill? Maybe. But those tests document behavior that would otherwise live only in someone's head: that remote wins ties, that missing timestamps fall back to creation time, that duplicates resolve predictably.

The ClipboardHistory component sits at 7,154 lines with 50 state variables. We looked at extracting it and stopped. Not because extraction is wrong, but because extraction without tests is archaeology with dynamite. You might find something interesting. You might also destroy what you came to preserve.

The principle Sarasohn taught wasn't about testing—it was about *knowing*. The factory floor should tell you what's happening without you having to ask. The codebase should tell you what's broken without you having to guess.

The tests we wrote today aren't about coverage percentages. They're about having something concrete to point at when the next developer asks: "What happens if two devices edit the same todo?"

The answer is in `syncUtils.test.ts`, line 111: remote wins.
