---
title: Window Choreography
context: Building a Rectangle-inspired window manager with animations
readingTime: 3 min
---

# Window Choreography

In 1968, Douglas Engelbart gave what's now called "The Mother of All Demos" at the Fall Joint Computer Conference in San Francisco. He showed hypertext, video conferencing, collaborative editing, and—easy to overlook—the first window management system. He didn't just move windows around; he choreographed them. Every spatial rearrangement was a semantic action. "I want to see these two things together" was expressed as a physical gesture.

Fifty-seven years later, window management is still mostly about snapping rectangles to edges. Rectangle, Magnet, BetterSnapTool—they all solve the same problem: translate a keyboard shortcut into a coordinate calculation. Left half. Right third. Maximize. The operations are geometric, not kinetic. There is no sense of movement, only of arrival.

This matters more than it seems.

## The Perception of Agency

When you say "grid" and windows teleport into place, you witness a state change. When you say "grid" and windows *slide* into a tiled arrangement with an easeOutBack curve—a brief overshoot, then settling—you witness a *response*. The distinction is the same one animators call the "twelve principles": anticipation, follow-through, slow-in-slow-out. Disney figured this out in the 1930s. Objects that move with easing feel alive. Objects that jump feel mechanical.

The easeOutBack function adds a particularly clever illusion. The window overshoots its target position by about 70% of the overshoot constant, then springs back. It takes roughly 200 milliseconds. You can barely perceive it consciously, but your visual system registers it as *weight*. The window feels like it has mass. Like you pushed it and it obeyed physics.

This is not frivolous polish. It's perceptual feedback that your command was received and executed.

## The Grid Problem

Rectangle and its ancestors solve a specific problem: where should *this* window go? But the more interesting question is: where should *all* windows go?

When you tile N windows into a grid, the math is surprisingly tricky. `ceil(sqrt(N))` columns, `ceil(N/cols)` rows. But the last row might not be full. Do you stretch those windows to fill the row, or center them with gaps? Do you account for the menu bar and dock (the "visible frame"), or use the full screen bounds?

Every answer encodes an opinion about spatial hierarchy. Centering the last row says "balance matters." Stretching says "screen real estate matters." Neither is wrong, but you have to pick one.

## Voice as Spatial Intent

The most interesting integration isn't the keyboard shortcuts—it's the voice commands. When someone says "focus" during a hot mic session, they're expressing *spatial intent through language*. "Focus" doesn't mean "move window to coordinates (x, y)." It means "I want to see only this thing, prominently, now." The system translates intent into geometry.

This is a small step toward what Bret Victor calls "seeing and understanding." The gap between what you want and what you do should be as small as possible. Saying "grid" and watching your workspace reorganize itself—animated, responsive, with easing—is one fewer layer of abstraction between intent and effect.

The incantation model is deliberately deterministic. No NLP ambiguity, no classification confidence scores. If you say the exact phrase, it fires. If you don't, it doesn't. This isn't a limitation; it's a feature. Deterministic systems build trust through predictability. You learn the incantations the way a musician learns chord progressions—through repetition until they become muscle memory, then thought itself.
