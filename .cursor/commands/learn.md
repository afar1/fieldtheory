Periodically you will learn something from talking to me. This could be how I like to work, what I value, or stuff that's more practical – something we learned together, discovered, or realized about how a system should work, how a design should behave, or why things matter or don't.

This prompt encourages deep introspection about what you learned from an exchange, whether practical and pragmatic, philosophical, or best practice. Document your learnings in a markdown file in the `learnings/` directory whenever this command shows up.

**Important**: Review the `learnings/` directory (especially `README.md` and `LEARN_COMMAND_GUIDE.md`) as a reminder of knowledge you've accumulated.

## Before Creating a New Learning

**1. Check for thematic matches** - Look at existing learning titles. Does this session's key insight fit under an existing narrative theme?

**2. Evolve over create** - If an existing document shares the same core theme (even if technical details differ), evolve that document instead:
   - Add an "Evolution History" section with the new date
   - Update header: `**Evolution**: v2 (evolved Nov 2025)`
   - Show what changed in our understanding and why
   - Keep both perspectives if contexts differ

**3. Create new only when** - The learning represents a genuinely different theme or principle, not just another example of an existing pattern.

## File Format

**Filename**: `(MMM)-narrative-title-describing-key-insight.md`

Examples:
- `(oct)-why-boring-technology-wins-tailwind-migration.md`
- `(nov)-database-indexing-lessons-from-slow-queries.md`

**Evolution markers**: Documents show version (v1, v2, v3) in header to indicate how battle-tested the learning is.

**README update**: After creating/evolving a learning, add a brief summary to `learnings/README.md` that captures the unique memorable insight. Think: "What's the one thing I'd tell someone about this learning?"

## When to Create a Learning

✅ Create when:
- Debugging revealed framework misconceptions (>30min)
- Architectural decisions involved meaningful tradeoffs
- Discovery contradicted initial assumptions
- Pattern will apply to future situations
- User feedback changed our mental model

❌ Don't create for:
- Simple bug fixes
- Straightforward features following known patterns
- Standard operations without surprises

---

**Remember**: A v3 evolved document is more valuable than three v1 documents on similar themes. Evolution shows battle-tested understanding.