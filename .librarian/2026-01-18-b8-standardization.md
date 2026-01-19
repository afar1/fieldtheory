# The Weight of Variants

In 1908, Henry Ford declared that customers could have the Model T "in any color so long as it's black." What appeared to be limitation was actually liberation—the standardization of paint (Japan black, which dried fastest) allowed Ford to perfect the production line and deliver more cars at lower cost. The elimination of choice paradoxically created more value.

The B8 layout's elevation from variant to standard follows this same industrial logic. The experiment has run its course: eight permutations of metadata display, icon placement, and temporal formatting competed for attention in an A/B testing framework. But software, unlike laboratory science, suffers under perpetual optionality. Each conditional branch—`layoutVariant === 'B3'`, `layoutVariant === 'B6'`—represented not just code complexity but cognitive load, a tax paid by every future developer who would need to understand why timestamps might appear on the left or right, why word counts might precede or follow source attribution.

The B8 pattern—icons in a 2x2 quad, human-readable time like "3 hours ago," metadata indented to align with content—survived because it communicated the most with the least visual noise. Now, with the variant selector removed and the conditionals collapsed, the codebase breathes easier: 160 fewer lines of branching logic, one clear path through the rendering tree.
