import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const packageName = '@ellucian/experience-extension-extras';
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const consumerRoot = mkdtempSync(join(tmpdir(), 'experience-extension-extras-consumer-'));
const npmCli = process.env.npm_execpath;

if (!npmCli) {
    throw new Error('npm_execpath is required; run this check through npm run test:consumer');
}

function runNode(args, cwd = consumerRoot, capture = false) {
    const result = spawnSync(process.execPath, args, {
        cwd,
        encoding: 'utf8',
        stdio: capture ? 'pipe' : 'inherit'
    });

    if (result.status !== 0) {
        if (capture) {
            process.stderr.write(result.stdout ?? '');
            process.stderr.write(result.stderr ?? '');
        }
        throw new Error(`${basename(args[0])} exited with status ${result.status}`);
    }

    return result.stdout;
}

try {
    const packOutput = runNode([
        npmCli,
        'pack',
        '--ignore-scripts',
        '--json',
        '--pack-destination',
        consumerRoot
    ], repositoryRoot, true);
    const [{ filename }] = JSON.parse(packOutput);
    const tarballPath = join(consumerRoot, filename);

    writeFileSync(join(consumerRoot, 'package.json'), `${JSON.stringify({
        name: 'experience-extension-extras-consumer-check',
        private: true,
        type: 'module'
    }, null, 2)}\n`);

    runNode([
        npmCli,
        'install',
        '--ignore-scripts',
        '--save-exact',
        tarballPath,
        'typescript@5.9.3',
        '@types/react@19.2.14'
    ]);

    writeFileSync(join(consumerRoot, 'consumer.cjs'), `
global.React = require('react');
const api = require('${packageName}');
if (typeof api.experienceTokenQuery !== 'function') {
    throw new Error('CommonJS entry point did not expose experienceTokenQuery');
}
`);
    runNode(['consumer.cjs']);

    writeFileSync(join(consumerRoot, 'consumer.mjs'), `
import React from 'react';
globalThis.React = React;
const api = await import('${packageName}');
if (typeof api.experienceTokenQuery !== 'function') {
    throw new Error('ESM entry point did not expose experienceTokenQuery');
}
`);
    runNode(['consumer.mjs']);

    writeFileSync(join(consumerRoot, 'consumer.ts'), `
import { experienceTokenQuery } from '${packageName}';
const query: typeof experienceTokenQuery = experienceTokenQuery;
void query;
`);
    writeFileSync(join(consumerRoot, 'tsconfig.json'), `${JSON.stringify({
        compilerOptions: {
            module: 'NodeNext',
            moduleResolution: 'NodeNext',
            noEmit: true,
            skipLibCheck: true,
            strict: true,
            target: 'ES2022'
        },
        files: ['consumer.ts']
    }, null, 2)}\n`);
    runNode([join(consumerRoot, 'node_modules', 'typescript', 'bin', 'tsc'), '--project', 'tsconfig.json']);

    process.stdout.write('Packed consumer checks passed for CommonJS, ESM, and TypeScript declarations.\n');
} finally {
    rmSync(consumerRoot, { force: true, recursive: true });
}
