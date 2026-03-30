#!/usr/bin/env npx tsx
import { buildCli } from '../src/cli.js';
await buildCli().parseAsync(process.argv);
