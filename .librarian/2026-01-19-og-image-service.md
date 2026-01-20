# The Rendering Pipeline as Publishing House

In 1440, Gutenberg's printing press didn't just reproduce text—it created a new category of artifact: the mechanically identical copy. Before this, every manuscript was unique, bearing the hand of its scribe. After, books became reliable, predictable, shareable. The OG image service performs a similar transformation for the web: it takes the ephemeral (a page title, a moment of sharing) and renders it into a fixed, portable image that travels across platforms unchanged. Twitter, LinkedIn, iMessage—each receives the same 1200×630 pixel artifact, a tiny publication produced on demand.

The technical detail that makes this work is Satori, Vercel's library that converts JSX directly to SVG without a browser. Traditional approaches used headless Chrome—spinning up an entire browser just to screenshot HTML. Satori skips the browser entirely, parsing the React tree and computing layouts using a subset of CSS Flexbox. It's the difference between running a printing press and hiring a scribe to copy each page by hand: same output, radically different economics.

```
⠀⠀⠀⠀⠀⠀⠀⠀⣀⣤⣤⣤⣤⣀⠀⠀⠀⠀⠀⠀⠀⠀
⠀⠀⠀⠀⠀⠀⣴⣿⣿⣿⣿⣿⣿⣿⣿⣦⠀⠀⠀⠀⠀⠀
⠀⠀⠀⠀⢀⣾⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣷⡀⠀⠀⠀⠀
⠀⠀⠀⠀⣾⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣷⠀⠀⠀⠀
⠀⠀⠀⢸⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⡇⠀⠀⠀
⠀⠀⠀⢸⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⡇⠀⠀⠀
⠀⠀⠀⠀⢿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⡿⠀⠀⠀⠀
⠀⠀⠀⠀⠈⠻⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⠟⠁⠀⠀⠀⠀
⠀⠀⠀⠀⠀⠀⠈⠙⠛⠛⠛⠛⠛⠛⠋⠁⠀⠀⠀⠀⠀⠀
⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀
⠀⣿⣿⣿⣿⠀⣿⣿⣿⣿⠀⣿⣿⣿⣿⠀⣿⣿⣿⣿⠀⠀
```
