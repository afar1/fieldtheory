# Notices

This repository contains Field Theory source code and selected third-party source, dependency, model, and asset integrations.

The root `LICENSE` file controls Field Theory-owned code unless a file or directory carries its own license notice.

## Public History Attribution

The public-candidate history intentionally collapses the inherited upstream `whisper.cpp` commit graph into one credited import commit:

```text
Import whisper.cpp foundation
```

This avoids presenting thousands of upstream commits as Field Theory-authored project history while still preserving attribution for the foundation that was imported.

The private `fieldtheory-labs` archive preserves the full private historical graph.

## whisper.cpp And ggml

Portions of this repository are derived from or include source from `whisper.cpp` and related `ggml` code by Georgi Gerganov and contributors.

Upstream project:

```text
https://github.com/ggerganov/whisper.cpp
```

License notice:

```text
MIT License

Copyright (c) 2022-2025 Georgi Gerganov

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## Other Third-Party Notices

See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) for dependency, model, native helper, and asset notice tracking.
