#!/usr/bin/env node
import { main } from '../lib/cli/index.js';

const code = await main(process.argv.slice(2));
process.exitCode = code;
