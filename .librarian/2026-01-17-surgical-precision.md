# Surgical Precision

In 1961, Edsger Dijkstra gave a lecture titled "The Humble Programmer" where he argued that the art of programming is the art of organizing complexity. But he added a caveat that's often forgotten: the goal isn't to eliminate complexity, but to master it one slice at a time.

Fred Brooks called this "surgical team" programming in *The Mythical Man-Month*. The metaphor isn't about cutting—it's about knowing what *not* to cut. A surgeon doesn't open up more than necessary. The incision is precisely placed to expose what needs work while leaving healthy tissue intact.

Today's refactoring followed this principle. ClipboardHistory.tsx sits at 7,000+ lines, a monolith that does everything. The temptation is to decompose it into a dozen smaller files. But decomposition without tests is archaeology with dynamite—you might find something interesting, you might also destroy what you came to preserve.

Instead: surgical extraction. Four utility modules totaling 200 lines, removing 300 lines from the original. The functions extracted (`formatRelativeTime`, `smartTruncateText`, `detectColor`) were pure—no side effects, no dependencies on component state. They could be lifted out without risk.

The ClipboardItemRow extraction was deferred. Not because it's impossible, but because it's *premature*. The component rendering logic references 30+ state variables. Extracting it now would mean either:
- Passing 30 props (making the interface worse than the original)
- Refactoring state management first (changing two things at once)
- Introducing React context (adding complexity to reduce complexity)

None of these improve the situation. The wiser path: wait for patterns to emerge, extract when the cost-benefit ratio tips.

The principle Dijkstra taught wasn't about simplicity—it was about *humility*. The humble programmer knows that the code will outlive their understanding of it. Every extraction that succeeds makes the next one easier. Every extraction attempted too early makes the codebase harder to reason about.

The surgeon's creed: first, do no harm.
