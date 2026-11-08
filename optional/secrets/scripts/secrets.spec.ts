import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, copyFileSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// Integration tests for scripts/secrets.sh — the SOPS + age tooling that keeps
// dev and prod secrets under SEPARATE keys. The whole point of two keys is an
// access boundary, so the load-bearing test is the isolation one: the dev key
// must NOT decrypt the prod file, and vice versa. We exercise the real script
// against real sops/age binaries in a throwaway repo, never touching a real
// project's secrets.
//
// Requires the `sops` and `age` binaries. Where they are absent (a machine that
// never provisioned them), the suite skips rather than fails; CI installs them
// so it actually runs there.

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(HERE, 'secrets.sh');

// A fixed slug so key filenames are deterministic regardless of the throwaway
// repo's random directory name (the script would otherwise derive it from the
// basename). This is the same knob a real project pins via .secretsrc.
const SLUG = 'testapp';

function have(bin: string): boolean {
  return spawnSync(bin, ['--version'], { encoding: 'utf8' }).status === 0;
}
const toolsPresent = have('sops') && have('age');

// A scratch "repo": scripts/secrets.sh derives its ROOT from its own location,
// so copying it into <tmp>/scripts makes <tmp> the working root. Keys live in a
// per-repo dir via SOPS_AGE_KEY_DIR so nothing lands in ~/.config.
let repo: string;
let keyDir: string;

function run(args: string[], opts: { input?: string; keyDir?: string; env?: Record<string, string> } = {}) {
  return spawnSync('bash', [join(repo, 'scripts', 'secrets.sh'), ...args], {
    cwd: repo,
    encoding: 'utf8',
    input: opts.input,
    env: {
      ...process.env,
      SOPS_AGE_KEY_DIR: opts.keyDir ?? keyDir,
      SECRETS_PROJECT_NAME: SLUG,
      EDITOR: 'true',
      ...opts.env,
    },
  });
}

function sopsDecrypt(file: string, keyFile: string) {
  return spawnSync('sops', ['-d', join(repo, file)], {
    encoding: 'utf8',
    env: { ...process.env, SOPS_AGE_KEY_FILE: keyFile },
  });
}

describe.skipIf(!toolsPresent)('secrets.sh — separate dev/prod keys', () => {
  beforeAll(() => {
    repo = mkdtempSync(join(tmpdir(), 'secrets-'));
    keyDir = join(repo, 'keys');
    mkdirSync(join(repo, 'scripts'), { recursive: true });
    mkdirSync(keyDir, { recursive: true });
    copyFileSync(SCRIPT, join(repo, 'scripts', 'secrets.sh'));
    writeFileSync(join(repo, '.env.example'), 'ALPHA=a\nBETA=b\nGAMMA=c\n');

    // init generates both keys and .sops.yaml; edit seeds each file from
    // .env.example (EDITOR=true makes the interactive edit a no-op).
    expect(run(['init']).status).toBe(0);
    run(['edit', 'dev']);
    run(['edit', 'prod']);
  });

  afterAll(() => {
    if (repo) rmSync(repo, { recursive: true, force: true });
  });

  it('generates two distinct keys and a two-rule .sops.yaml', () => {
    const devKey = join(keyDir, `${SLUG}-dev.txt`);
    const prodKey = join(keyDir, `${SLUG}-prod.txt`);
    expect(existsSync(devKey)).toBe(true);
    expect(existsSync(prodKey)).toBe(true);
    expect(readFileSync(devKey, 'utf8')).not.toEqual(readFileSync(prodKey, 'utf8'));

    const cfg = readFileSync(join(repo, '.sops.yaml'), 'utf8');
    expect(cfg).toContain('secrets/prod\\.enc\\.env$');
    expect(cfg).toContain('secrets/dev\\.enc\\.env$');
    // The two rules must name different recipients — a shared recipient would
    // silently re-merge the environments.
    const recipients = [...cfg.matchAll(/age: "(age1[0-9a-z]+)"/g)].map((m) => m[1]);
    expect(recipients).toHaveLength(2);
    expect(recipients[0]).not.toEqual(recipients[1]);
  });

  it('enforces the key boundary: dev key cannot read prod, prod key cannot read dev', () => {
    const devKey = join(keyDir, `${SLUG}-dev.txt`);
    const prodKey = join(keyDir, `${SLUG}-prod.txt`);

    expect(sopsDecrypt('secrets/dev.enc.env', devKey).status).toBe(0);
    expect(sopsDecrypt('secrets/prod.enc.env', devKey).status).not.toBe(0);
    expect(sopsDecrypt('secrets/prod.enc.env', prodKey).status).toBe(0);
    expect(sopsDecrypt('secrets/dev.enc.env', prodKey).status).not.toBe(0);
  });

  it('set upserts a value that round-trips through decrypt', () => {
    expect(run(['set', 'dev', 'ALPHA'], { input: 'dev-alpha-1\n' }).status).toBe(0);
    const dec = sopsDecrypt('secrets/dev.enc.env', join(keyDir, `${SLUG}-dev.txt`));
    expect(dec.status).toBe(0);
    expect(dec.stdout).toContain('ALPHA=dev-alpha-1');
    // Overwriting the same name replaces rather than duplicates it.
    expect(run(['set', 'dev', 'ALPHA'], { input: 'dev-alpha-2\n' }).status).toBe(0);
    const dec2 = sopsDecrypt('secrets/dev.enc.env', join(keyDir, `${SLUG}-dev.txt`));
    const alphaLines = dec2.stdout.split('\n').filter((l) => l.startsWith('ALPHA='));
    expect(alphaLines).toEqual(['ALPHA=dev-alpha-2']);
  });

  it('exec injects the decrypted secrets into the process env', () => {
    run(['set', 'dev', 'BETA'], { input: 'beta-val\n' });
    const res = run(['exec', 'dev', '--', 'printenv BETA']);
    expect(res.status).toBe(0);
    expect(res.stdout.trim()).toBe('beta-val');
  });

  it('exec refuses to run while a decrypted *.dec.env is on disk', () => {
    // The server injects from the ENCRYPTED file, so a stray plaintext copy would
    // be silently ignored. Refuse rather than run against a misleading edit.
    expect(run(['decrypt', 'dev']).status).toBe(0);
    const res = run(['exec', 'dev', '--', 'printenv BETA']);
    expect(res.status).toBe(1);
    expect(res.stderr).toContain('decrypted secrets on disk');
    expect(res.stderr).toContain('secrets.sh encrypt');
    // encrypt saves + removes the plaintext, unblocking exec again.
    expect(run(['encrypt', 'dev']).status).toBe(0);
    expect(run(['exec', 'dev', '--', 'printenv BETA']).status).toBe(0);
  });

  it('exec refuses to run while a plaintext .dev.vars exists', () => {
    writeFileSync(join(repo, '.dev.vars'), 'ALPHA=plainvalue\n');
    const res = run(['exec', 'dev', '--', 'printenv BETA']);
    expect(res.status).toBe(1);
    expect(res.stderr).toContain('.dev.vars');
    expect(res.stderr).toContain('secrets.sh import');
    rmSync(join(repo, '.dev.vars'));
    expect(run(['exec', 'dev', '--', 'printenv BETA']).status).toBe(0);
  });

  it('validate passes when names match and needs no key to run', () => {
    // Move the keys entirely out of reach: validate must still work, proving it
    // reads only the cleartext variable names, never decrypts.
    const noKeys = join(repo, 'no-keys');
    mkdirSync(noKeys, { recursive: true });
    const res = run(['validate'], { keyDir: noKeys });
    expect(res.status).toBe(0);
    expect(res.stdout).toContain('secrets/dev.enc.env declares all expected variables');
  });

  it('validate fails (keyless) when a file is missing a required variable', () => {
    const noKeys = join(repo, 'no-keys');
    writeFileSync(join(repo, '.env.example'), 'ALPHA=a\nBETA=b\nGAMMA=c\nDELTA=d\n');
    const res = run(['validate'], { keyDir: noKeys });
    expect(res.status).not.toBe(0);
    expect(res.stdout).toContain('missing: DELTA');
    writeFileSync(join(repo, '.env.example'), 'ALPHA=a\nBETA=b\nGAMMA=c\n'); // restore
  });

  it('decrypt then encrypt round-trips and leaves no plaintext behind', () => {
    expect(run(['decrypt', 'prod']).status).toBe(0);
    const plain = join(repo, 'secrets', 'prod.dec.env');
    expect(existsSync(plain)).toBe(true);

    expect(run(['encrypt', 'prod']).status).toBe(0);
    expect(existsSync(plain)).toBe(false); // cleanup happened

    // Data survived the round-trip and the file is still prod-key-only.
    expect(sopsDecrypt('secrets/prod.enc.env', join(keyDir, `${SLUG}-prod.txt`)).status).toBe(0);
    expect(sopsDecrypt('secrets/prod.enc.env', join(keyDir, `${SLUG}-dev.txt`)).status).not.toBe(0);
  });

  it('clean removes stray decrypted files', () => {
    run(['decrypt', 'dev']);
    expect(existsSync(join(repo, 'secrets', 'dev.dec.env'))).toBe(true);
    expect(run(['clean']).status).toBe(0);
    expect(existsSync(join(repo, 'secrets', 'dev.dec.env'))).toBe(false);
  });

  it('push pipes the decrypted secrets to the host sync command (and errors when unset)', () => {
    run(['set', 'prod', 'ALPHA'], { input: 'push-me\n' });

    // Unset SECRETS_DEPLOY_SYNC → refuse with guidance, sync nothing.
    const unset = run(['push', 'prod'], { env: { SECRETS_DEPLOY_SYNC: '' } });
    expect(unset.status).not.toBe(0);
    expect(unset.stderr).toContain('SECRETS_DEPLOY_SYNC');

    // With a stand-in sync command (echo stdin), the JSON payload reaches the
    // host command with the real value.
    const res = run(['push', 'prod'], { env: { SECRETS_DEPLOY_SYNC: 'cat' } });
    expect(res.status).toBe(0);
    expect(res.stdout).toContain('"ALPHA": "push-me"');
  });
});

// Rotation gets its own throwaway repo: it deliberately swaps the live keys, so
// it must not run against the isolation suite's shared key set. The load-bearing
// properties are (1) values survive the swap, (2) the OLD key is locked out
// afterward, (3) the other environment is untouched, and (4) the pre-rotation
// key is preserved as a working fallback.
describe.skipIf(!toolsPresent)('secrets.sh — rotate', () => {
  const devKeyPath = () => join(keyDir, `${SLUG}-dev.txt`);
  const prodKeyPath = () => join(keyDir, `${SLUG}-prod.txt`);
  const recipientsInConfig = () =>
    [...readFileSync(join(repo, '.sops.yaml'), 'utf8').matchAll(/age: "(age1[0-9a-z]+)"/g)].map(
      (m) => m[1],
    );

  beforeAll(() => {
    repo = mkdtempSync(join(tmpdir(), 'secrets-rotate-'));
    keyDir = join(repo, 'keys');
    mkdirSync(join(repo, 'scripts'), { recursive: true });
    mkdirSync(keyDir, { recursive: true });
    copyFileSync(SCRIPT, join(repo, 'scripts', 'secrets.sh'));
    writeFileSync(join(repo, '.env.example'), 'ALPHA=a\nBETA=b\nGAMMA=c\n');
    expect(run(['init']).status).toBe(0);
    run(['edit', 'dev']);
    run(['edit', 'prod']);
    run(['set', 'dev', 'ALPHA'], { input: 'dev-secret\n' });
    run(['set', 'prod', 'ALPHA'], { input: 'prod-secret\n' });
  });

  afterAll(() => {
    if (repo) rmSync(repo, { recursive: true, force: true });
  });

  it('rotates dev: new key decrypts, old key is locked out, values survive, prod untouched', () => {
    // Snapshot the pre-rotation dev key + both ciphertexts.
    const oldDevKey = join(repo, 'keys', 'old-dev.snapshot');
    copyFileSync(devKeyPath(), oldDevKey);
    const oldProdEnc = readFileSync(join(repo, 'secrets', 'prod.enc.env'), 'utf8');
    const [oldProdRecipient, oldDevRecipient] = recipientsInConfig();

    expect(run(['rotate', 'dev']).status).toBe(0);

    // The live key actually changed.
    expect(readFileSync(devKeyPath(), 'utf8')).not.toEqual(readFileSync(oldDevKey, 'utf8'));

    // The OLD dev key can no longer read the re-encrypted file; the NEW one can,
    // and the value is intact.
    expect(sopsDecrypt('secrets/dev.enc.env', oldDevKey).status).not.toBe(0);
    const dec = sopsDecrypt('secrets/dev.enc.env', devKeyPath());
    expect(dec.status).toBe(0);
    expect(dec.stdout).toContain('ALPHA=dev-secret');

    // prod ciphertext is byte-for-byte unchanged, and only the dev recipient
    // moved in .sops.yaml.
    expect(readFileSync(join(repo, 'secrets', 'prod.enc.env'), 'utf8')).toEqual(oldProdEnc);
    const [newProdRecipient, newDevRecipient] = recipientsInConfig();
    expect(newProdRecipient).toEqual(oldProdRecipient);
    expect(newDevRecipient).not.toEqual(oldDevRecipient);
  });

  it('preserves the previous key as a working fallback (.prev decrypts the pre-rotation ciphertext)', () => {
    // Take a fresh pre-rotation snapshot of the current (already once-rotated)
    // state, rotate again, then prove the backed-up .prev key reads the OLD
    // ciphertext — the whole point of the backup.
    copyFileSync(join(repo, 'secrets', 'dev.enc.env'), join(repo, 'secrets', 'dev.pre.enc.env'));
    const beforeKey = readFileSync(devKeyPath(), 'utf8');

    expect(run(['rotate', 'dev']).status).toBe(0);

    const prev = `${devKeyPath()}.prev`;
    expect(existsSync(prev)).toBe(true);
    // .prev is exactly the key that was live before this rotation...
    expect(readFileSync(prev, 'utf8')).toEqual(beforeKey);
    // ...and it still decrypts the ciphertext that was current before this rotation.
    const dec = sopsDecrypt('secrets/dev.pre.enc.env', prev);
    expect(dec.status).toBe(0);
    expect(dec.stdout).toContain('ALPHA=dev-secret');
  });

  it('prunes key backups to the 3 newest', () => {
    // Rotate several more times; regardless of prior rotations the count of
    // timestamped .bak.* files must settle at exactly 3.
    for (let i = 0; i < 4; i++) expect(run(['rotate', 'dev']).status).toBe(0);
    const baks = spawnSync('bash', ['-c', `ls -1 "${devKeyPath()}".bak.* | wc -l`], {
      encoding: 'utf8',
    });
    expect(Number(baks.stdout.trim())).toBe(3);
  });

  it('rolls back to the previous key', () => {
    const prev = readFileSync(`${devKeyPath()}.prev`, 'utf8');
    expect(run(['rotate', 'dev', '--rollback']).status).toBe(0);
    expect(readFileSync(devKeyPath(), 'utf8')).toEqual(prev);
  });

  it('rotates prod independently of dev', () => {
    const oldProdKey = join(repo, 'keys', 'old-prod.snapshot');
    copyFileSync(prodKeyPath(), oldProdKey);
    const oldDevEnc = readFileSync(join(repo, 'secrets', 'dev.enc.env'), 'utf8');

    expect(run(['rotate', 'prod']).status).toBe(0);

    // New prod key reads prod values; old prod key is locked out; dev file is untouched.
    expect(sopsDecrypt('secrets/prod.enc.env', oldProdKey).status).not.toBe(0);
    const dec = sopsDecrypt('secrets/prod.enc.env', prodKeyPath());
    expect(dec.status).toBe(0);
    expect(dec.stdout).toContain('ALPHA=prod-secret');
    expect(readFileSync(join(repo, 'secrets', 'dev.enc.env'), 'utf8')).toEqual(oldDevEnc);
  });

  it('refuses to rotate when the current key cannot decrypt the file', () => {
    // Replace the dev key with an unrelated one: rotation must abort and leave
    // the ciphertext readable by the real (restored) key afterward.
    const good = readFileSync(devKeyPath(), 'utf8');
    const stranger = spawnSync('age-keygen', { encoding: 'utf8' }).stdout;
    writeFileSync(devKeyPath(), stranger, { mode: 0o600 });
    const res = run(['rotate', 'dev']);
    expect(res.status).not.toBe(0);
    expect(res.stderr).toContain('refusing to rotate');
    writeFileSync(devKeyPath(), good, { mode: 0o600 }); // restore for hygiene
  });
});
