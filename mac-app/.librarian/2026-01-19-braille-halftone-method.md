# Braille Halftone Method

## The Technique

Unicode braille characters (U+2800 to U+28FF) form a 2×4 dot matrix per character:

```
Position:    Dots:
┌───┬───┐    ⠁ ⠈
│ 1 │ 4 │    ⠂ ⠐
│ 2 │ 5 │    ⠄ ⠠
│ 3 │ 6 │    ⡀ ⢀
│ 7 │ 8 │
└───┴───┘
```

**Density levels** (dots filled → visual weight):
```
⠀ = 0 dots (white/empty)
⠁⠈⠂⠐ = 1 dot (very light ~12%)
⠃⠉⠘⠰ = 2 dots (light ~25%)
⠇⠋⠙⠸⠴ = 3 dots (light-mid ~37%)
⠏⠛⠹⠼⠶ = 4 dots (mid ~50%)
⠟⠻⠽⠾⠷ = 5 dots (mid-dark ~62%)
⠿⡿⣟⣻⣽ = 6 dots (dark ~75%)
⣷⣾⣯⣟ = 7 dots (very dark ~87%)
⣿ = 8 dots (black/full)
```

## The Process

### Step 1: Establish Light Source
Decide where light comes from. For the bell: **top-left**
- Left side = highlight (sparse dots)
- Right side = shadow (dense dots)
- Top = lit (sparse)
- Bottom rim = shadow (dense)

### Step 2: Build Density Zones
Map your subject into 4-5 tonal zones:
1. **Highlight**: ⠀⠁⠈ (0-1 dots)
2. **Light**: ⠃⠉⠑⠘ (2 dots)
3. **Midtone**: ⠇⠋⠏⠛⠹ (3-4 dots)
4. **Shadow**: ⠟⠻⠿⡿ (5-6 dots)
5. **Deep shadow**: ⣷⣾⣿ (7-8 dots)

### Step 3: Gradient Transitions
Never jump directly from light to dark. Create smooth transitions:
```
⠀ → ⠁ → ⠃ → ⠇ → ⠏ → ⠟ → ⠿ → ⣿
```

### Step 4: Edge Definition
Use partial fills to suggest curved edges:
- Vertical edge: ⡇⢸ (left/right columns filled)
- Horizontal edge: ⣀⣤⣶ (bottom rows filled)
- Diagonal: ⠑⠢⠔⡠ (diagonal dot patterns)

---

## The Bell (Light from top-left)

```
                                        ⣀⣀⣀
                                    ⢀⣤⣾⣿⣿⣿⣷⣤⡀
                                  ⢀⣾⣿⣿⣿⣿⣿⣿⣿⣿⣷⡀
                                 ⣼⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣧
                                ⣼⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣧
                               ⣼⣿⣿⣿⠟⠉⠀⠀⠀⠀⠀⠉⠻⣿⣿⣿⣧
                              ⣼⣿⣿⠏⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠹⣿⣿⣧
                             ⢸⣿⣿⠃⠀⠀⠀⢀⣀⣀⣀⡀⠀⠀⠀⠘⣿⣿⡇
                             ⢸⣿⣿⠀⠀⠀⢀⣿⣿⣿⣿⣿⡀⠀⠀⠀⣿⣿⡇
                             ⢸⣿⣿⠀⠀⠀⢸⣿⣿⣿⣿⣿⡇⠀⠀⠀⣿⣿⡇
                             ⢸⣿⣿⠀⠀⠀⢸⣿⣿██⣿⣿⡇⠀⠀⠀⣿⣿⡇
                             ⢸⣿⣿⡀⠀⠀⢸⣿⣿██⣿⣿⡇⠀⠀⢀⣿⣿⡇
                             ⠘⣿⣿⣇⠀⠀⠀⢿⣿⣿⣿⣿⡿⠀⠀⣸⣿⣿⠃
                              ⢻⣿⣿⣆⠀⠀⠀⠙⠿⠿⠟⠁⠀⠀⣰⣿⣿⡟
                               ⠹⣿⣿⣷⣄⠀⠀⠀⠀⠀⠀⣠⣾⣿⣿⠏
                                ⠙⣿⣿⣿⣷⣦⣤⣤⣴⣾⣿⣿⣿⠋
                                 ⠈⠻⣿⣿⣿⣿⣿⣿⣿⣿⠟⠁
                                    ⠉⠛⠻⠿⠿⠟⠛⠉
                                        ⢸⣿⡇
                                        ⢸⣿⡇
                                        ⢸⣿⡇
                                        ⢸⣿⡇
                                        ⠸⣿⠇
                                         ⠻⠃
                                          ⠀
```

---

## Prompt Template for Replication

Use this prompt structure for consistent results:

```
Create a braille halftone illustration of [SUBJECT].

Technical constraints:
- Use only Unicode braille characters (U+2800 to U+28FF)
- Light source: [top-left / top-right / etc.]
- Canvas: approximately [WIDTH] characters × [HEIGHT] lines

Shading approach:
- Highlight areas: ⠀⠁⠈⠂⠐ (0-1 dots, ~12% density)
- Light areas: ⠃⠉⠑⠘⠰ (2 dots, ~25% density)
- Midtone areas: ⠇⠋⠏⠛⠹⠼ (3-4 dots, ~50% density)
- Shadow areas: ⠟⠻⠽⠾⠿⡿ (5-6 dots, ~75% density)
- Deep shadow: ⣷⣾⣯⣿ (7-8 dots, ~90-100% density)

Composition:
- [Describe the pose/arrangement]
- [Note any important details to include]
- Create smooth gradients between tonal zones
- Use edge-defining patterns for contours

Style reference: Newspaper halftone screen printing -
the effect where images are rendered as patterns of
dots of varying size/density to simulate continuous tone.
```

---

## Example Prompts

**Portrait:**
```
Create a braille halftone portrait of a human face in 3/4 view.
Light source: top-left (Rembrandt lighting)
Canvas: 40 characters × 50 lines
Focus on: strong cheekbone shadow, subtle nose shadow,
catchlight suggestion in the eye area using ⠀ empty cells
```

**Object:**
```
Create a braille halftone illustration of a vintage telephone.
Light source: top-right
Canvas: 35 characters × 30 lines
Include: cord with coiled texture using repeating ⠿⠿⠿ patterns,
reflective highlight on handset using sparse ⠁⠈ patterns
```

**Scene:**
```
Create a braille halftone landscape with a lighthouse.
Light source: left (setting sun)
Canvas: 60 characters × 35 lines
Atmospheric perspective: foreground uses full density range,
background uses only ⠀⠁⠃⠇ (compressed tonal range for distance)
```

---

## Quick Reference: Useful Braille Characters by Function

**Solid fills (for deep shadow):**
⣿⣾⣷⣶⣴⣦⣤⣠⡿⢿⣻⣽

**Vertical lines:**
⡇⢸⠇⠸⡆⢰⠆⠰

**Horizontal lines:**
⠉⠛⠒⠤⣀⣤⠶⠴

**Diagonal patterns:**
⠑⠢⡠⢄⠔⠊⡐⢂

**Gradient sets (light → dark):**
Row-based: ⠀→⣀→⣤→⣶→⣿
Column-based: ⠀→⡀→⡄→⡆→⡇→⣇→⣧→⣷→⣿
Scattered: ⠀→⠁→⠃→⠇→⠏→⠟→⠿→⣿
