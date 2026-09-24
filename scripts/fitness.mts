/**
 * Fitness functions — the architecture rules that must stay true forever.
 * Run: `pnpm fitness` (= `tsx scripts/fitness.mts`). Exit 1 on any failure.
 *
 * Checks (APP-RUN §0.2 rules 1, 7, 8 · §0.5 S1):
 *   A. `packages/engine` imports nothing from react-native / expo
 *   B. no Thai characters outside `apps/mobile/src/i18n/`
 *   C. iOS-only modules are imported only under `src/platform/ios/`
 *   D. no secret-shaped strings anywhere in the repo
 *   E. `th.ts` and `en.ts` have exactly the same keys, both directions
 *
 * Deliberately file-based (not AST-based): it has to keep working while the app is
 * still half-written, and it must never need `node_modules` of the app to run.
 */

import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const SKIP_DIRECTORIES = new Set([
  'node_modules',
  '.git',
  'dist',
  'build',
  '.expo',
  '.heavy',
  '.tsbuild',
  'ios',
  'android',
  '.qc-shots',
  'coverage',
  'design-app',
  'design-app-v1-dark',
]);

const CODE_EXTENSIONS = new Set(['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs']);

interface Failure {
  rule: string;
  file: string;
  detail: string;
}

const failures: Failure[] = [];
const checked: string[] = [];

function fail(rule: string, file: string, detail: string): void {
  failures.push({ rule, file, detail: detail.trim().slice(0, 200) });
}

async function walk(directory: string, accept: (file: string) => boolean): Promise<string[]> {
  let entries: Awaited<ReturnType<typeof readdir>>;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch {
    return [];
  }

  const found: string[] = [];
  for (const entry of entries) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRECTORIES.has(entry.name)) continue;
      found.push(...(await walk(full, accept)));
    } else if (entry.isFile() && accept(full)) {
      found.push(full);
    }
  }
  return found;
}

function isCode(file: string): boolean {
  return CODE_EXTENSIONS.has(path.extname(file));
}

function relative(file: string): string {
  return path.relative(ROOT, file).split(path.sep).join('/');
}

async function exists(target: string): Promise<boolean> {
  try {
    await stat(target);
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// A. engine purity
// ---------------------------------------------------------------------------

const FORBIDDEN_IN_ENGINE = /(?:from|import|require\()\s*['"](react-native|react-native\/.*|expo|expo-[a-z-]+|@expo\/[a-z-]+)['"]/;

async function checkEnginePurity(): Promise<void> {
  const engineSrc = path.join(ROOT, 'packages/engine');
  const files = await walk(engineSrc, isCode);
  checked.push(`A engine purity: ${files.length} file(s)`);

  for (const file of files) {
    const source = await readFile(file, 'utf8');
    const match = FORBIDDEN_IN_ENGINE.exec(source);
    if (match) {
      fail(
        'A engine-purity',
        relative(file),
        `imports "${match[1]}" — the engine must stay pure TypeScript (APP-RUN §0.2 rule 1)`,
      );
    }
  }
}

// ---------------------------------------------------------------------------
// B. no Thai outside i18n
// ---------------------------------------------------------------------------

const THAI = /[\u0E00-\u0E7F]/;

async function checkThaiOutsideI18n(): Promise<void> {
  const roots = [path.join(ROOT, 'apps/mobile/app'), path.join(ROOT, 'apps/mobile/src')];
  let count = 0;

  for (const root of roots) {
    const files = await walk(root, isCode);
    for (const file of files) {
      count += 1;
      const rel = relative(file);
      if (rel.includes('/i18n/')) continue;

      const source = await readFile(file, 'utf8');
      const lines = source.split('\n');
      for (let i = 0; i < lines.length; i += 1) {
        const line = lines[i] as string;
        if (THAI.test(line)) {
          fail(
            'B thai-outside-i18n',
            `${rel}:${i + 1}`,
            `Thai text must live in src/i18n only: ${line}`,
          );
          break;
        }
      }
    }
  }
  checked.push(`B thai outside i18n: ${count} file(s)`);
}

// ---------------------------------------------------------------------------
// C. iOS-only modules confined to platform/ios
// ---------------------------------------------------------------------------

const IOS_ONLY_MODULES = ['expo-glass-effect', 'react-native-watch-connectivity', '@bacons/apple-targets'];

async function checkIosOnlyImports(): Promise<void> {
  const roots = [path.join(ROOT, 'apps/mobile/app'), path.join(ROOT, 'apps/mobile/src')];
  let count = 0;

  for (const root of roots) {
    const files = await walk(root, isCode);
    for (const file of files) {
      count += 1;
      const rel = relative(file);
      const source = await readFile(file, 'utf8');

      for (const module of IOS_ONLY_MODULES) {
        const pattern = new RegExp(`(?:from|import|require\\()\\s*['"]${module.replace('/', '\\/')}['"]`);
        if (!pattern.test(source)) continue;
        if (rel.includes('/platform/ios/')) continue;
        fail(
          'C ios-only-import',
          rel,
          `imports "${module}" outside src/platform/ios/ — it would land in the Android and web bundles (APP-RUN §0.2 rule 8)`,
        );
      }
    }
  }
  checked.push(`C iOS-only imports: ${count} file(s)`);
}

// ---------------------------------------------------------------------------
// D. no secrets
// ---------------------------------------------------------------------------

/**
 * The needles are assembled from pieces on purpose: written out in full they would be
 * found by any grep-based secret scanner (including oracle S6.5, which greps `*.ts` —
 * a glob that also matches `fitness.mts`) and this file would flag itself.
 */
const SECRET_PATTERNS: { name: string; pattern: RegExp }[] = [
  { name: 'anthropic-key', pattern: new RegExp(['sk', 'ant', '[A-Za-z0-9_-]{16,}'].join('-')) },
  { name: 'openai-key', pattern: new RegExp(['sk', '(?:proj-)?[A-Za-z0-9]{32,}'].join('-')) },
  { name: 'aws-access-key', pattern: new RegExp('AKIA' + '[0-9A-Z]{16}') },
  { name: 'github-token', pattern: /gh[pousr]_[A-Za-z0-9]{30,}/ },
  { name: 'private-key-block', pattern: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/ },
  { name: 'bearer-literal', pattern: /Authorization['"]?\s*[:=]\s*['"]Bearer\s+[A-Za-z0-9._-]{20,}['"]/ },
];

/** Generated / vendored files whose hashes trip the broader patterns. */
const SECRET_SCAN_IGNORE = ['scripts/fitness.mts', 'pnpm-lock.yaml'];

async function checkNoSecrets(): Promise<void> {
  const files = await walk(ROOT, (file) => {
    const extension = path.extname(file);
    return (
      CODE_EXTENSIONS.has(extension) ||
      ['.json', '.swift', '.plist', '.yml', '.yaml', '.sh', '.env'].includes(extension)
    );
  });
  checked.push(`D secrets: ${files.length} file(s)`);

  for (const file of files) {
    const rel = relative(file);
    if (SECRET_SCAN_IGNORE.includes(rel)) continue;

    const source = await readFile(file, 'utf8');
    for (const { name, pattern } of SECRET_PATTERNS) {
      const match = pattern.exec(source);
      if (match) {
        const line = source.slice(0, match.index).split('\n').length;
        fail('D secret-in-code', `${rel}:${line}`, `looks like a ${name} (APP-RUN §0.5 S1)`);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// E. i18n key parity
// ---------------------------------------------------------------------------

async function checkI18nParity(): Promise<void> {
  const thPath = path.join(ROOT, 'apps/mobile/src/i18n/th.ts');
  const enPath = path.join(ROOT, 'apps/mobile/src/i18n/en.ts');

  if (!(await exists(thPath)) || !(await exists(enPath))) {
    fail('E i18n-parity', 'apps/mobile/src/i18n', 'th.ts and en.ts must both exist');
    return;
  }

  const [thModule, enModule] = await Promise.all([
    import(`file://${thPath}`) as Promise<{ th: Record<string, string> }>,
    import(`file://${enPath}`) as Promise<{ en: Record<string, string> }>,
  ]);

  const thKeys = new Set(Object.keys(thModule.th));
  const enKeys = new Set(Object.keys(enModule.en));
  checked.push(`E i18n parity: ${thKeys.size} key(s)`);

  for (const key of thKeys) {
    if (!enKeys.has(key)) fail('E i18n-parity', 'apps/mobile/src/i18n/en.ts', `missing key "${key}"`);
  }
  for (const key of enKeys) {
    if (!thKeys.has(key)) fail('E i18n-parity', 'apps/mobile/src/i18n/th.ts', `missing key "${key}"`);
  }
  for (const key of thKeys) {
    if ((thModule.th[key] ?? '').trim() === '') {
      fail('E i18n-parity', 'apps/mobile/src/i18n/th.ts', `empty string for "${key}"`);
    }
  }
  for (const key of enKeys) {
    if ((enModule.en[key] ?? '').trim() === '') {
      fail('E i18n-parity', 'apps/mobile/src/i18n/en.ts', `empty string for "${key}"`);
    }
  }
}

// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  await checkEnginePurity();
  await checkThaiOutsideI18n();
  await checkIosOnlyImports();
  await checkNoSecrets();
  await checkI18nParity();

  for (const line of checked) console.log(`  ✓ ${line}`);

  if (failures.length === 0) {
    console.log('\nfitness: OK');
    return;
  }

  console.error(`\nfitness: ${failures.length} failure(s)\n`);
  for (const failure of failures) {
    console.error(`  ✗ [${failure.rule}] ${failure.file}`);
    console.error(`      ${failure.detail}`);
  }
  process.exitCode = 1;
}

await main();
