# The Weight of Names

In 1952, a young programmer named Grace Hopper was working on the A-0 System for the Remington Rand corporation when she encountered a peculiar problem. The compiler she was building needed a name, but every name they tried seemed to constrain what people thought it could do. They called it a "compiler" instead of a "translator" because the latter implied mere conversion, while compilation suggested something being assembled from disparate parts into a coherent whole.

Names accumulate gravity. They pull expectations toward them, shaping not just how users perceive software, but how the software itself evolves. When you name something "Little AI," you've drawn a boundary around it—cute, modest, perhaps temporary. Change the name to "Field Theory" and you've expanded the possibility space. The same code now suggests interconnection, fundamental forces, the unified framework that physicists chase.

The UNIX philosophy contains a hidden lesson about naming: small tools with clear names compose better than large tools with vague ones. `grep` tells you exactly what it does (Global Regular Expression Print). `cat` concatenates. But these precise names only work because UNIX itself was a blank canvas—named as a playful pun on MULTICS, it carried no baggage.

Today's rename wasn't cosmetic. It was topological—restructuring the paths through which the code identifies itself. Bundle IDs, helper binaries, data directories: these are the gravitational constants of the application's universe. Change them carelessly and you tear spacetime. Change them thoughtfully and you merely redefine the coordinate system.

The most elegant detail: the migration code that checks for "littleai-mac" and "Oscar" directories. Software, unlike physics, can remember its former names. It can gently guide old users into the new coordinate system, preserving their data while the application's identity transforms around them.

Some things are harder to rename than code. The directory on a developer's machine, the repository on GitHub—these exist outside the application's jurisdiction. They require a different kind of migration: human intention, deliberate choice, and the understanding that even the path `/Users/afar/dev/littleai` carries its own small gravity.

---
*On the occasion of renaming the application codebase from Little AI to Field Theory.*
