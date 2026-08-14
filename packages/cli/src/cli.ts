#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { runCli } from './run';

async function main(): Promise<void> {
  process.exitCode = await runCli(process.argv.slice(2), {
    cwd: process.cwd(),
    readFile: (path) => readFile(path, 'utf8'),
    stdout: (value) => process.stdout.write(`${value}\n`),
    stderr: (value) => process.stderr.write(`${value}\n`),
    env: process.env,
    fetch: (input, init) => fetch(input, init),
  });
}

void main();
