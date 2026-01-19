# The Flexbox Overflow Problem

The CSS flexbox specification, finalized in 2017 after years of iteration, introduced a deceptively simple property: `overflow: hidden`. When combined with `height: auto`, it creates what engineers at Google's Chrome team internally called the "content trust problem"—the browser must calculate how much space content needs before it can clip what exceeds that space.

In 1968, Douglas Engelbart demonstrated the first working hypertext system at what became known as "The Mother of All Demos." His system had no such concerns; each element had fixed dimensions, carved into memory like stone tablets. The fluidity we now take for granted—elements that breathe and resize—came at the cost of predictability. When a button's border adds two pixels of height, the container must choose: trust the content it measured, or trust the constraints we gave it. Today's fix—an explicit minimum height—is less a solution than a treaty between competing truths.
