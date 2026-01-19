# The Ship of Theseus in Code

```
    ╔═══════════════════════════════════════╗
    ║  shared_readings     →    artifacts   ║
    ║  ┌─────────────┐      ┌─────────────┐ ║
    ║  │ id          │      │ id          │ ║
    ║  │ slug        │  ══► │ slug        │ ║
    ║  │ content     │      │ content     │ ║
    ║  │ title       │      │ title       │ ║
    ║  └─────────────┘      └─────────────┘ ║
    ║                                       ║
    ║     same data, different name         ║
    ╚═══════════════════════════════════════╝
```

The ancient Greeks puzzled over the Ship of Theseus: if you replace every plank, is it still the same ship? In software, we perform this ritual constantly—renaming `readings` to `artifacts` changes nothing about the bytes stored in PostgreSQL, yet everything about how developers and users conceptualize the system. The philosopher Saul Kripke argued in 1972 that names are "rigid designators"—they pick out the same thing across all possible worlds. But in code, names are more like spells: they shape what the thing *becomes*.

The callsign system (`AMB-MAC`) embodies this tension beautifully. It's a name that deliberately obscures identity while creating a new one—a mask that becomes a face. When someone hovers to reveal "Andrew F." beneath the callsign, they're witnessing the same duality: the artifact and the author, the rigid designator and the human it points to, coexisting in the same span of pixels.
