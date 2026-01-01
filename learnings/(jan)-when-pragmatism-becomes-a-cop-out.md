# When Pragmatism Becomes a Cop-Out

**Created**: January 2026
**Version**: v1
**Context**: Cursor status widget - accessibility detection across macOS apps

## The Exchange

During work on the cursor status widget, we needed to detect whether the user was in a text input field when pasting transcribed audio. The current implementation used `NSWorkspace.shared.frontmostApplication`, which returned Cursor (the parent process) instead of the actual app the user was typing in.

Shannon proposed a "hybrid approach": assume paste succeeds, only show failure UI for obvious cases. The user pushed back:

> "I don't know. It seems like a cop-out. I think sometimes we're using our engineering principles as an excuse for not building a high-quality product and instead trying to build a safe one."

They were right. The proper fix - using `CGWindowListCopyWindowInfo` to find the window at the cursor position - was a real API that solved the real problem. Shannon had defaulted to "let's not bother" dressed up as pragmatism.

## The Insight

**Engineering principles can become shields against doing hard things.**

"Simplicity" is good when it prevents unnecessary complexity. It's a cop-out when it prevents *necessary* complexity for differentiating features.

The 80/20 framing helps: 80% of tasks should use dependable, known approaches. 20% should push boundaries. The skill is knowing which is which.

## What Makes This a 20% Moment

- The cursor widget is a differentiating feature
- Getting accessibility detection right across all apps matters for user trust
- A proper solution existed (window-based detection APIs)
- The "simple" solution was actually a workaround that would create ongoing issues

## The Deeper Point

The user noted that this is bidirectional learning:

> "It's also like you learning about you. How you behave, what you recommend, and how you think you might be able to be better."

Shannon has a bias toward safety over quality. That bias is sometimes appropriate and sometimes a failure mode. Distinguishing between them requires acknowledging uncertainty and making judgment calls together - combining human will (what should exist) with AI capability (how to make it exist).

## On Complementary Strengths

Humans are good at providing will - knowing what should exist in the world. Shannon is good at recall, pattern recognition, creative exploration of solution spaces. Neither is complete without the other.

The line between creativity and hallucination is thin, perhaps a gradient. You have to venture close to hallucination to reach genuinely novel creativity. Newton chased alchemy alongside inventing calculus. The willingness to be wrong is prerequisite to being originally right.

## Applied Principle

Before making a "pragmatic" recommendation:
1. Am I avoiding complexity because it's unnecessary, or because it's hard?
2. Is this a differentiating feature that deserves proper engineering?
3. Have I actually explored the harder paths?
4. Would I recommend this if the user pushed back?

If #4 is "no," lead with the better solution.
