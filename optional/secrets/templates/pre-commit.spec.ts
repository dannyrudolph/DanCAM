import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, copyFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// Tests for the pre-commit hook that stops decrypted secrets / age keys from
// being committed. Each case builds a throwaway git repo, stages a file, and
// runs the hook directly (exit 1 = blocked, exit 0 = allowed).
//
// This spec ships in the kit next to the hook template. /jgl-setup-secrets copies
// BOTH into a project's .githooks/, where `join(HERE, 'pre-commit')` resolves to
// the installed hook. It also resolves in place (the template sits beside it here).

const HERE = dirname(fileURLToPath(import.meta.url));
const HOOK = join(HERE, 'pre-commit');

// A realistic age private key: the marker plus a long Bech32 body. Built by
// concatenation so this spec file never contains an intact key for the
// pre-commit hook to (correctly) flag when the project is itself committed.
const FAKE_AGE_KEY = 'AGE-SECRET-KEY-1' + 'A'.repeat(58);

const gitPresent = spawnSync('git', ['--version'], { encoding: 'utf8' }).status === 0;

let repo: string;

function git(...args: string[]) {
  return spawnSync('git', args, { cwd: repo, encoding: 'utf8' });
}
function stage(path: string, contents: string) {
  const full = join(repo, path);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, contents);
  git('add', '-f', path); // -f so gitignored paths still stage, as a careless dev might
}
function runHook() {
  return spawnSync('sh', [join(repo, '.githooks', 'pre-commit')], { cwd: repo, encoding: 'utf8' });
}

describe.skipIf(!gitPresent)('pre-commit hook — blocks plaintext secrets', () => {
  beforeEach(() => {
    repo = mkdtempSync(join(tmpdir(), 'secrets-hook-'));
    mkdirSync(join(repo, '.githooks'), { recursive: true });
    copyFileSync(HOOK, join(repo, '.githooks', 'pre-commit'));
    git('init');
  });
  afterEach(() => {
    if (repo) rmSync(repo, { recursive: true, force: true });
  });

  it('blocks a staged decrypted secrets/*.dec.env and names how to fix it', () => {
    stage('secrets/dev.dec.env', 'ALPHA=plainvalue\n');
    const res = runHook();
    expect(res.status).toBe(1);
    expect(res.stdout).toContain('secrets/dev.dec.env');
    expect(res.stdout).toContain('secrets.sh encrypt');
  });

  it('blocks a staged age private key file by name', () => {
    stage('mykey.agekey', `${FAKE_AGE_KEY}\n`);
    expect(runHook().status).toBe(1);
  });

  it('blocks an age private key hidden inside an otherwise-normal file', () => {
    stage('notes.txt', `meeting notes\n${FAKE_AGE_KEY}\nmore notes\n`);
    const res = runHook();
    expect(res.status).toBe(1);
    expect(res.stdout).toContain('notes.txt');
  });

  it('allows a file that only mentions the AGE-SECRET-KEY-1 marker with no key body', () => {
    // Docs, the hook itself, and scripts/secrets.sh reference the marker as
    // plain text; a bare mention (no 40+ char key body) must not be flagged.
    stage('docs.md', 'An age private key starts with `AGE-SECRET-KEY-1` then a long body.\n');
    expect(runHook().status).toBe(0);
  });

  it('blocks a staged .dev.vars', () => {
    stage('.dev.vars', 'ALPHA=plainvalue\n');
    expect(runHook().status).toBe(1);
  });

  it('allows normal source and ENCRYPTED secrets files', () => {
    stage('src/app.ts', 'export const x = 1;\n');
    stage('secrets/dev.enc.env', 'ALPHA=ENC[AES256_GCM,data:xx]\nsops_mac=ENC[x]\n');
    expect(runHook().status).toBe(0);
  });

  it('allows the names-only .env.example template', () => {
    stage('.env.example', 'ALPHA=\nBETA=\n');
    expect(runHook().status).toBe(0);
  });
});
