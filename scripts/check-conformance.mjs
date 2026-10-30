#!/usr/bin/env node
// Deterministic conformance checker for the Swarm Protocol (INTEGRATION.md §6). Every check id gets one line:
// `✓ id name evidence` (mechanically proven), `✗ id name what is missing`, or `? id name needs judgement: …`
// (what only an agent can verify: running commands, timings, CI history, reviewer judgement). It writes nothing.
//
// Usage: node check-conformance.mjs [--repo <path>] [--level N | --transfer | --all] [--json]
// Exit: 0 every mechanical check of the requested scope passes · 1 at least one fails · 2 usage / no manifest.
//
// Where §6 is ambiguous the stricter mechanical reading is taken (marked "stricter" below). A `✓` whose evidence
// says "structure only" proves the file or key exists, not what it does: the agent never gets a `?` for it, so
// L1.1's instruction asks it to confirm in the verify output that the architecture and docs tests ran.
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, isAbsolute, join } from 'node:path';

const SELF = dirname(new URL(import.meta.url).pathname);
const USAGE = 'usage: check-conformance.mjs [--repo <path>] [--level 0-3 | --transfer | --all] [--json]';
const usage = (msg) => {
  console.error(`${msg}\n${USAGE}`);
  process.exit(2);
};

// ---- arguments
const argv = process.argv.slice(2);
const opts = { repo: process.cwd(), level: undefined, transfer: false, all: false, json: false };
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === '--repo') opts.repo = argv[++i] ?? usage('--repo needs a path');
  else if (a === '--level') {
    const n = Number(argv[++i]);
    if (!Number.isInteger(n) || n < 0 || n > 3) usage('--level takes 0, 1, 2 or 3');
    opts.level = n;
  } else if (a === '--transfer') opts.transfer = true;
  else if (a === '--all') opts.all = true;
  else if (a === '--json') opts.json = true;
  else usage(`unknown argument ${a}`);
}
if ([opts.level !== undefined, opts.transfer, opts.all].filter(Boolean).length > 1) usage('--level, --transfer and --all are exclusive');

const repo = opts.repo;
const abs = (p) => join(repo, p);
const has = (p) => existsSync(abs(p));
const read = (p) => (has(p) && statSync(abs(p)).isFile() ? readFileSync(abs(p), 'utf8') : '');
const json = (p) => {
  try {
    return JSON.parse(read(p));
  } catch {
    return undefined;
  }
};
const walk = (dir, depth = 4) => {
  if (depth < 0 || !has(dir)) return [];
  return readdirSync(abs(dir)).flatMap((n) => {
    if (n === 'node_modules' || n === '.git') return [];
    const p = dir === '.' ? n : `${dir}/${n}`;
    return statSync(abs(p)).isDirectory() ? walk(p, depth - 1) : [p];
  });
};
/** Fenced code and HTML comments are examples, not content. */
const prose = (s) => s.replace(/```[\s\S]*?```/g, '').replace(/<!--[\s\S]*?-->/g, '');

// ---- manifest
if (!has('swarm.json')) usage(`no swarm.json in ${repo}: the repository has not adopted the protocol (/swarm:adopt)`);
const manifest = json('swarm.json');
const m = manifest ?? {};
const cmd = m.commands ?? {};
const requested = opts.all
  ? [0, 1, 2, 3]
  : opts.transfer
    ? []
    : Array.from({ length: (opts.level ?? (Number.isInteger(m.level) ? m.level : 0)) + 1 }, (_, i) => i);
const scope = opts.all ? 'all' : opts.transfer ? 'transfer' : requested.length - 1;

// ---- helpers
const pass = (evidence) => ({ status: 'pass', evidence });
const fail = (evidence) => ({ status: 'fail', evidence });
const judge = (evidence) => ({ status: 'judge', evidence });
const need = (keys) => keys.filter((k) => typeof cmd[k] !== 'string' || !cmd[k].trim());

/** Does a manifest command point at something that exists? true / false, or null when the stack is not recognised. */
function resolves(command) {
  const first = command.split(/&&|;/)[0].trim().split(/\s+/);
  const pkg = json('package.json');
  const pm = first[0];
  if (['pnpm', 'npm', 'yarn', 'bun'].includes(pm)) {
    const name = first[1] === 'run' ? first[2] : first[1];
    return Boolean(name && pkg?.scripts && name in pkg.scripts);
  }
  if (pm === 'make') return new RegExp(`^${first[1]}:`, 'm').test(read('Makefile'));
  if (pm === 'just') return new RegExp(`^${first[1]}\\b`, 'm').test(read('justfile') || read('Justfile'));
  const file = first.find((t) => /\.(m?[jt]s|py|sh|rb|go)$/.test(t));
  if (file) return has(file);
  if (first[0].startsWith('./')) return has(first[0].slice(2));
  return null;
}
const ciFiles = () => [
  ...walk('.github/workflows', 0).filter((f) => /\.ya?ml$/.test(f)),
  ...['.gitlab-ci.yml', '.circleci/config.yml', 'Jenkinsfile'].filter(has),
];
/** Names from `names` that `.gitignore` does not list (a trailing slash is optional). */
const gitignoreMissing = (...names) => {
  const lines = read('.gitignore').split('\n').map((l) => l.trim().replace(/^\//, '').replace(/\/$/, ''));
  return names.filter((n) => !lines.includes(n.replace(/\/$/, '')));
};
const PLACEHOLDER = /<(?!https?:|mailto:)[^<>\n]{1,300}>/;
const SEMVER = /^\d+\.\d+\.\d+$/;

// CLAUDE.md rule bullets, same grammar as templates/tests/docs.test.ts: bullets under a `## ` section, indented
// continuation lines joined; each must end with (enforced: a, b) or (preference).
function ruleBullets(text) {
  const bullets = [];
  let section = '';
  let current;
  for (const line of prose(text).split('\n')) {
    if (line.startsWith('## ')) {
      section = line.slice(3).trim();
      current = undefined;
    } else if (/^[-*] /.test(line)) {
      current = { section, text: line.slice(2).trim() };
      bullets.push(current);
    } else if (current && /^\s+\S/.test(line)) current.text += ` ${line.trim()}`;
    else current = undefined;
  }
  return bullets.filter((b) => b.section);
}

// ---- findings ledger (INTEGRATION.md §1, L2.8): the same reading as reference/scripts/findings.ts, kept standalone
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const day = (d) => d.toISOString().slice(0, 10);
const daysBetween = (a, b) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
const findingsFile = () => (typeof m.findings?.file === 'string' && m.findings.file) || 'docs/audits/findings.jsonl';
/** The latest line of each id, or `{ error }` naming the first bad line. */
function readLedger() {
  const file = findingsFile();
  if (!has(file)) return { file, error: `${file} missing` };
  const byId = new Map();
  const lines = read(file).split('\n');
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    let o;
    try {
      o = JSON.parse(lines[i]);
    } catch {
      return { file, error: `${file}:${i + 1} is not valid JSON` };
    }
    const bad = [];
    if (typeof o?.id !== 'string' || !o.id) bad.push('id');
    if (!['high', 'medium', 'low'].includes(o?.severity)) bad.push('severity');
    if (!['open', 'closed', 'accepted'].includes(o?.status)) bad.push('status');
    for (const k of ['opened', 'sla_due']) if (!DAY.test(o?.[k] ?? '')) bad.push(k);
    if (bad.length) return { file, error: `${file}:${i + 1} has a missing or invalid ${bad.join(', ')}` };
    byId.set(o.id, { ...byId.get(o.id), ...o });
  }
  return { file, findings: [...byId.values()] };
}
/** `open 12 · overdue 2 · median age 9d · closure 0.6` (closure = closed / opened in the last 14 days), as in `findings stats`. */
function closureStats(findings, today = day(new Date())) {
  const open = findings.filter((f) => f.status === 'open');
  const from = day(new Date(Date.parse(`${today}T00:00:00Z`) - 14 * 86_400_000));
  const opened = findings.filter((f) => f.opened >= from).length;
  const closed = findings.filter((f) => f.status === 'closed' && (f.closed ?? '') >= from).length;
  const ages = open.map((f) => daysBetween(f.opened, today)).sort((a, b) => a - b);
  const mid = Math.floor(ages.length / 2);
  const median = ages.length ? (ages.length % 2 ? ages[mid] : (ages[mid - 1] + ages[mid]) / 2) : undefined;
  const stats = { open: open.length, overdue: open.filter((f) => f.sla_due < today).length, medianAgeDays: median === undefined ? undefined : Math.round(median), closure: opened ? Math.round((closed / opened) * 100) / 100 : undefined };
  return { ...stats, line: `open ${stats.open} · overdue ${stats.overdue} · median age ${stats.medianAgeDays === undefined ? '-' : `${stats.medianAgeDays}d`} · closure ${stats.closure ?? '-'}` };
}
/** `landed` entries of the project's land log (in git's common directory), oldest first; undefined when there is no log. */
function landedEntries() {
  const r = spawnSync('git', ['rev-parse', '--git-common-dir'], { cwd: repo, encoding: 'utf8' });
  if (r.status !== 0) return undefined;
  const dir = isAbsolute(r.stdout.trim()) ? r.stdout.trim() : join(repo, r.stdout.trim());
  const logs = existsSync(dir) ? readdirSync(dir).filter((f) => /-land-log\.jsonl$/.test(f)) : [];
  if (!logs.length) return undefined;
  return logs.flatMap((f) => readFileSync(join(dir, f), 'utf8').split('\n')).flatMap((l) => {
    try {
      const e = JSON.parse(l);
      return e.result === 'landed' ? [e] : [];
    } catch {
      return [];
    }
  });
}

// ---- the checks
const checks = [];
const check = (id, name, fn) => checks.push({ id, name, fn });

check('L0.1', 'Manifest', () => {
  if (!manifest) return fail('swarm.json does not parse as JSON');
  const bad = [];
  if (m.protocol !== 'swarm') bad.push('protocol must be "swarm"');
  if (typeof m.version !== 'string' || !SEMVER.test(m.version)) bad.push('version must be x.y.z');
  if (!Number.isInteger(m.level) || m.level < 0 || m.level > 3) bad.push('level must be an integer 0-3');
  if (typeof m.integrationBranch !== 'string' || !m.integrationBranch) bad.push('integrationBranch missing');
  return bad.length ? fail(bad.join('; ')) : pass(`swarm.json ok (level ${m.level})`);
});
check('L0.2', 'Agent memory', () => {
  if (!has('CLAUDE.md')) return fail('CLAUDE.md missing');
  const text = read('CLAUDE.md');
  const lines = text.split('\n').length - (text.endsWith('\n') ? 1 : 0);
  if (lines >= 200) return fail(`CLAUDE.md has ${lines} lines (limit: under 200)`);
  // stricter: the verify command must appear literally, so it has to be set in the manifest first
  if (!cmd.verify) return fail('commands.verify is not set, so CLAUDE.md cannot name it');
  if (!text.includes(cmd.verify)) return fail(`CLAUDE.md does not name "${cmd.verify}"`);
  return pass(`CLAUDE.md ${lines} lines, names "${cmd.verify}"`);
});
check('L0.3', 'Secrets', () => {
  const s = json('.claude/settings.json');
  if (!s) return fail('.claude/settings.json missing or not JSON');
  const reads = (s.permissions?.deny ?? []).filter((d) => /^Read\(/.test(d));
  if (!(reads.some((d) => /\.env(\)|$)/.test(d)) && reads.some((d) => /\.env\.\*|\.env\*/.test(d)))) return fail('permissions.deny lacks Read(./.env) and Read(./.env.*)');
  // stricter: "secret files" is required as its own rule
  if (!reads.some((d) => /secret/i.test(d))) return fail('permissions.deny lacks a Read rule for secret files (e.g. Read(**/secrets/**))');
  return pass(`${reads.length} Read deny rules incl. .env* and secrets`);
});
check('L0.4', 'Local files ignored', () => {
  const miss = gitignoreMissing('CLAUDE.local.md', '.claude/settings.local.json');
  return miss.length ? fail(`.gitignore lacks ${miss.join(', ')}`) : pass('CLAUDE.local.md and .claude/settings.local.json ignored');
});
check('L0.5', 'Decision log', () => {
  const miss = [];
  if (!has('docs/adr/0000-template.md')) miss.push('docs/adr/0000-template.md');
  if (!read('docs/adr/README.md').includes('<!-- generated:adr-index -->')) miss.push('docs/adr/README.md with <!-- generated:adr-index -->');
  const adopt = walk('docs/adr', 0).filter((f) => /adopt/i.test(f) && /\.md$/.test(f));
  if (!adopt.length) miss.push('an adoption ADR (file name containing "adopt")');
  return miss.length ? fail(`missing ${miss.join('; ')}`) : pass(`ADR template, index and ${adopt[0]}`);
});
check('L0.6', 'Rules have mechanisms', () => {
  if (!has('CLAUDE.md')) return fail('CLAUDE.md missing');
  const marker = /\((?:enforced: ([^()]+)|preference)\)$/;
  const rules = ruleBullets(read('CLAUDE.md'));
  if (!rules.length) return fail('CLAUDE.md has no rule bullets under `## ` sections');
  const unmarked = rules.filter((r) => !marker.test(r.text));
  if (unmarked.length) return fail(`${unmarked.length} rule(s) without (enforced: …) or (preference): ${unmarked.slice(0, 3).map((r) => `"${r.text.slice(0, 50)}"`).join(', ')}`);
  const paths = rules.flatMap((r) => (marker.exec(r.text)?.[1] ?? '').split(',').map((t) => t.trim().replace(/`/g, '').split('#')[0]).filter(Boolean));
  const gone = [...new Set(paths.filter((p) => !has(p)))];
  if (gone.length) return fail(`enforced path(s) do not exist: ${gone.join(', ')}`);
  return pass(`${rules.length} rules marked, ${new Set(paths).size} enforced paths exist`);
});

check('L1.1', 'Full gate', () => {
  if (need(['verify']).length) return fail('commands.verify is not set');
  return judge(`run "${cmd.verify}" on a clean checkout of ${m.integrationBranch ?? 'the integration branch'}: it must exit 0; paste its last lines and confirm its output shows the architecture and docs tests ran (L2.4, L2.5) and the roadmap validator (L3.1) when those levels are in scope`);
});
check('L1.2', 'Quick gate', () => {
  if (need(['verifyQuick']).length) return fail('commands.verifyQuick is not set');
  return judge(`time "${cmd.verifyQuick}" and "${cmd.verify}": the quick one must exit 0 and be faster than the full gate`);
});
check('L1.3', 'CI parity (CI ⊇ verify)', () => {
  const files = ciFiles();
  if (!files.length) return fail('no CI workflow found (.github/workflows/*.yml, .gitlab-ci.yml, .circleci/config.yml, Jenkinsfile)');
  if (need(['verify']).length) return fail('commands.verify is not set');
  // stricter: "or exactly its steps" cannot be proven mechanically, so the verify string must appear literally
  const withVerify = files.filter((f) => read(f).includes(cmd.verify));
  if (!withVerify.length) return fail(`no CI file runs "${cmd.verify}" (${files.join(', ')})`);
  const lax = withVerify.filter((f) => /continue-on-error:\s*true/.test(read(f)));
  if (lax.length) return fail(`${lax.join(', ')} uses continue-on-error: true in a file that runs the gate`);
  const jobs = (/^jobs:\n([\s\S]*)$/m.exec(read(withVerify[0]))?.[1].match(/^ {2}[\w-]+:/gm) ?? []).length;
  if (jobs > 1) return judge(`${withVerify[0]} runs "${cmd.verify}" and has ${jobs} jobs: confirm every job other than the gate is documented with why it is not in local verify (docs/quality.md or a CI comment)`);
  return pass(`${withVerify[0]} runs "${cmd.verify}", no continue-on-error`);
});
check('L1.4', 'Coverage floor', () => {
  const files = ['vitest.config.ts', 'vitest.config.js', 'vitest.config.mts', 'jest.config.js', 'jest.config.ts', 'package.json', 'pyproject.toml', '.coveragerc', 'setup.cfg', 'Makefile', 'codecov.yml', 'quality-ratchets.json', ...ciFiles()];
  const hit = files.find((f) => /thresholds?\b|coverageThreshold|fail_under|fail-under|cov-fail-under|"floor"|floorFrom/.test(read(f)));
  return hit ? pass(`threshold configured in ${hit}`) : judge('no coverage threshold found in the usual config files: find where the floor is configured and show the test step fails below it');
});
check('L1.5', 'No secrets in CI', () => {
  const files = ciFiles();
  if (!files.length) return fail('no CI workflow found');
  const used = files.flatMap((f) => [...read(f).matchAll(/secrets\.([A-Za-z0-9_]+)/g)].map((x) => ({ f, s: x[1] }))).filter((x) => x.s !== 'GITHUB_TOKEN');
  // stricter: any secret in a workflow that runs the gate counts as the quality job reading it
  const bad = used.filter((x) => need(['verify']).length || read(x.f).includes(cmd.verify));
  return bad.length ? fail([...new Set(bad.map((x) => `${x.f} reads secrets.${x.s}`))].join('; ')) : pass('no secrets.* (other than GITHUB_TOKEN) in the gate workflow');
});
check('L1.6', 'Ratchets', () => {
  if (!has('quality-ratchets.json')) return fail('quality-ratchets.json missing');
  const r = json('quality-ratchets.json');
  if (!r) return fail('quality-ratchets.json does not parse');
  const bad = [];
  if (typeof r.fileSize?.max !== 'number') bad.push('fileSize.max');
  if (!r.coverage || !(r.coverage.floor || r.coverage.floorFrom) || typeof r.coverage.maxGap !== 'number') bad.push('coverage.floor|floorFrom and coverage.maxGap');
  if (typeof r.lintWarnings?.command !== 'string' || typeof r.lintWarnings?.budget !== 'number') bad.push('lintWarnings.command and lintWarnings.budget');
  if (bad.length) return fail(`quality-ratchets.json lacks ${bad.join(', ')}`);
  const run = cmd.ratchets ?? 'node scripts/dev/ratchets.ts';
  if (resolves(run) === false) return fail(`commands.ratchets "${run}" does not resolve to an existing script`);
  return pass(`quality-ratchets.json well-formed; ratchets command "${run}"`);
});

check('L1.7', 'Dependency gate', () => {
  if (!has('deps-allowlist.json')) return fail('deps-allowlist.json missing (templates/deps-allowlist.json; an empty allowlist is fine)');
  const a = json('deps-allowlist.json');
  if (!a || typeof a !== 'object') return fail('deps-allowlist.json does not parse');
  const today = new Date().toISOString().slice(0, 10);
  const entries = Object.entries(a).filter(([k]) => k !== '//' && !k.startsWith('_'));
  const bad = entries.filter(([, v]) => !(v && typeof v.reason === 'string' && v.reason.trim() && typeof v.owner === 'string' && v.owner.trim() && /^\d{4}-\d{2}-\d{2}$/.test(v.expires ?? ''))).map(([k]) => k);
  if (bad.length) return fail(`deps-allowlist.json entries without reason, owner and expires (YYYY-MM-DD): ${bad.join(', ')}`);
  const expired = entries.filter(([, v]) => v.expires < today).map(([k, v]) => `${k} (${v.expires})`);
  if (expired.length) return fail(`expired allowlist entries: ${expired.join(', ')}`);
  const script = walk('scripts', 2).find((f) => /(^|\/)deps-audit\.[a-z]+$/.test(f));
  const AUDIT = /\b(npm|pnpm|yarn) audit\b|\bpip-audit\b|\bcargo audit\b|\bgovulncheck\b|\bosv-scanner\b|\bdeps-audit\b/;
  const named = [...ciFiles(), 'package.json', 'Makefile', 'justfile', 'pyproject.toml', 'noxfile.py', 'tox.ini'].filter((f) => AUDIT.test(read(f)));
  if (!script && !named.length) return fail('no dependency audit found: no scripts/**/deps-audit.* and no CI, package.json, Makefile or pyproject naming npm/pnpm audit, pip-audit, cargo audit, govulncheck or osv-scanner');
  return pass(`deps-allowlist.json ${entries.length} entr${entries.length === 1 ? 'y' : 'ies'}, none expired; audit via ${script ?? named[0]} (its run inside verify is confirmed through L1.1)`);
});
check('L1.8', 'Formatter', () => {
  const biome = json('biome.json') ?? json('biome.jsonc');
  if (biome?.formatter?.enabled === false) return fail('biome.json has formatter.enabled: false (manual chapter 07: turn it on in one logic-free commit)');
  const pkg = json('package.json');
  const py = read('pyproject.toml');
  const evidence = biome?.formatter ? 'biome.json formatter' : biome && !('formatter' in biome) ? 'biome.json (formatter on by default)'
    : walk('.', 0).some((f) => /^\.prettierrc(\..+)?$/.test(f)) || pkg?.prettier ? 'prettier config'
    : /\[tool\.ruff/.test(py) || /\[tool\.black\]/.test(py) ? 'pyproject.toml ruff/black'
    : has('rustfmt.toml') || has('.rustfmt.toml') || has('Cargo.toml') ? 'rustfmt'
    : has('go.mod') ? 'gofmt' : '';
  const FORMAT = /\bformat\b|\bprettier\b|\bgofmt\b|\bfmt\b|\bblack\b/;
  const named = [...ciFiles(), 'package.json', 'Makefile', 'justfile', 'pyproject.toml', 'noxfile.py', 'tox.ini'].filter((f) => FORMAT.test(read(f)));
  if (!evidence && !named.length) return fail('no formatter configured (biome.json formatter, prettier, ruff/black, rustfmt, gofmt) and no format step named in CI, package.json, Makefile or pyproject');
  return pass(`${evidence || `format step in ${named[0]}`} (the check running inside verify is confirmed through L1.1)`);
});
check('L1.9', 'Silent errors', () => {
  const r = json('quality-ratchets.json');
  if (!r) return fail('quality-ratchets.json missing or unparsable (L1.6)');
  const se = r.silentErrors;
  if (!se || typeof se !== 'object') return fail('quality-ratchets.json has no silentErrors section (dirs, exceptions, total): a new empty catch is not counted');
  if (!Array.isArray(se.dirs) || !se.dirs.length) return fail('silentErrors.dirs must list at least one directory');
  if (!Number.isInteger(se.total) || se.total < 0) return fail('silentErrors.total must be a non-negative integer (ratchets.ts --init records the current count)');
  return pass(`silentErrors over ${se.dirs.join(', ')}: total ${se.total}, ${Object.keys(se.exceptions ?? {}).length} exception(s)`);
});

check('L2.1', 'Worktrees', () => {
  if (gitignoreMissing('.claude/worktrees/').length && gitignoreMissing('worktrees/').length) return fail('.gitignore does not ignore the worktree directory (.claude/worktrees/)');
  if (!m.hooks?.sessionStart && !/worktree/i.test(read('AGENTS.md'))) return fail('neither hooks.sessionStart nor an AGENTS.md session protocol (§5 step 1) documents the worktree start');
  return pass(`worktree directory ignored; ${m.hooks?.sessionStart ? 'hooks.sessionStart set' : 'AGENTS.md documents it'}`);
});
check('L2.2', 'Session commands', () => {
  const miss = need(['commit', 'status', 'land', 'newAdr']);
  if (miss.length) return fail(`commands.${miss.join(', commands.')} not set`);
  const results = ['commit', 'status', 'land'].map((k) => [k, resolves(cmd[k])]);
  const broken = results.filter(([, r]) => r === false).map(([k]) => `${k} "${cmd[k]}"`);
  if (broken.length) return fail(`does not resolve to an existing script: ${broken.join(', ')}`);
  const unknown = results.filter(([, r]) => r === null).map(([k]) => k);
  if (unknown.length) return judge(`confirm commands.${unknown.join(', commands.')} run an existing script (stack not recognised by the checker)`);
  return pass('commit, status, land resolve to existing scripts; newAdr set');
});
check('L2.3', 'Protected integration', () => {
  const hook = ['.githooks/pre-push', '.husky/pre-push'].find(has);
  if (hook) return pass(`${hook} present (core.hooksPath is a per-clone setting: structure only)`);
  return judge(`no pre-push guard in the repo: confirm branch protection on ${m.integrationBranch} (gh api repos/<owner>/<repo>/branches/${m.integrationBranch}/protection)`);
});
const testFile = (re) => walk('.', 5).filter((f) => re.test(f) && !/(^|\/)(node_modules|templates)\//.test(f));
check('L2.4', 'Invariants as tests', () => {
  const f = testFile(/architecture[._-]?test\.|test_architecture\.|architecture_test\./i);
  return f.length ? pass(`${f[0]} (structure only; its run inside verify is confirmed through L1.1)`) : fail('no architecture test file found (architecture.test.*)');
});
check('L2.5', 'Docs as tests', () => {
  const f = testFile(/docs[._-]?test\.|test_docs\.|docs_test\./i);
  return f.length ? pass(`${f[0]} (structure only; its run inside verify is confirmed through L1.1)`) : fail('no docs test file found (docs.test.*)');
});
check('L2.6', 'Non-Claude agents', () => {
  if (!has('AGENTS.md')) return fail('AGENTS.md missing');
  const t = read('AGENTS.md');
  return /session protocol|worktree/i.test(t) || /CLAUDE\.md/.test(t) ? pass('AGENTS.md states the session protocol or points to CLAUDE.md') : fail('AGENTS.md neither states the §5 session protocol nor points to CLAUDE.md');
});
check('L2.7', 'Review gate', () => {
  const r = m.review;
  if (!r || typeof r !== 'object') return fail('swarm.json has no review block');
  if (!['always', 'sensitive', 'off'].includes(r.mode)) return fail(`review.mode "${r.mode}" is not always|sensitive|off`);
  // stricter: "off" is valid for §1 but cannot satisfy "land requires a receipt"
  if (r.mode === 'off') return fail('review.mode is "off": level 2 needs the gate on');
  if (r.mode === 'sensitive' && !(Array.isArray(r.sensitive) && r.sensitive.length && r.sensitive.every((g) => typeof g === 'string'))) return fail('review.mode is "sensitive" but review.sensitive is not a non-empty array of globs');
  const pr = r.pr;
  if (pr !== undefined) {
    if (!pr || typeof pr !== 'object') return fail('review.pr must be an object');
    if (pr.botTimeoutHours !== undefined && !(typeof pr.botTimeoutHours === 'number' && pr.botTimeoutHours >= 0)) return fail('review.pr.botTimeoutHours must be a number of hours, 0 or more');
    if (pr.requireReviewer !== undefined && typeof pr.requireReviewer !== 'boolean') return fail('review.pr.requireReviewer must be true or false');
    if (pr.bots !== undefined && !(Array.isArray(pr.bots) && pr.bots.every((b) => typeof b === 'string'))) return fail('review.pr.bots must be an array of logins');
  }
  return pass(`review.mode ${r.mode}${r.mode === 'sensitive' ? `, ${r.sensitive.length} sensitive globs` : ''} (structure only)`);
});
check('L2.8', 'Findings ledger', () => {
  const l = readLedger();
  if (l.error) return fail(l.error);
  const sla = m.findings?.sla;
  if (sla !== undefined && !['high', 'medium', 'low'].every((k) => Number.isInteger(sla[k]) && sla[k] > 0)) return fail('swarm.json findings.sla must give positive integer days for high, medium and low');
  const unowned = l.findings.filter((f) => f.status === 'open' && f.severity === 'high' && !(typeof f.owner === 'string' && f.owner.trim()));
  if (unowned.length) return fail(`${unowned.length} open high finding(s) without an owner: ${unowned.map((f) => f.id).join(', ')}`);
  const open = l.findings.filter((f) => f.status === 'open');
  return pass(`${l.file}: ${l.findings.length} finding(s), ${open.length} open (${open.filter((f) => f.severity === 'high').length} high, all with owner and sla_due)`);
});
check('L2.9', 'Closure gate', () => {
  if (need(['findings']).length) return fail('commands.findings is not set');
  if (resolves(cmd.findings) === false) return fail(`commands.findings "${cmd.findings}" does not resolve to an existing script`);
  const every = m.findings?.closureEvery;
  if (every !== undefined && !(Number.isInteger(every) && every > 0)) return fail('swarm.json findings.closureEvery must be a positive integer');
  const landed = landedEntries();
  if (landed?.length && !Array.isArray(landed.at(-1).closes)) return fail('the latest `landed` entry of the land log has no `closes` field: the land in use predates the findings gates (SLA and closure quota)');
  return pass(`commands.findings "${cmd.findings}"${landed?.length ? '; the land log records closes' : '; no land log yet'} (structure only: that land refuses an overdue high and a quiet streak is proven by the reference self-tests)`);
});

check('L2.10', 'Mutation smoke', () => {
  const script = walk('scripts', 2).find((f) => /(^|\/)mutation-smoke\.[a-z]+$/.test(f));
  if (!script) return fail('no scripts/**/mutation-smoke.* (reference/scripts/mutation-smoke.ts): a change whose related tests cannot fail passes the gate unnoticed');
  return pass(`${script} (structure only; its step inside verify is confirmed through L1.1, and that survivors are reported by the reference self-tests)`);
});

check('L3.1', 'Roadmap', () => {
  const f = walk('.', 3).find((p) => /(^|\/)roadmap\.(ya?ml|md|json)$/i.test(p) && !/templates\//.test(p));
  return f ? pass(`${f} (structure only; the validator running inside verify shows in L1.1's output)`) : fail('no roadmap file found (roadmap.yaml|md|json)');
});
check('L3.2', 'Audit', () => (need(['audit']).length ? fail('commands.audit is not set') : judge(`run "${cmd.audit}" with no network: it must exit 0`)));
check('L3.3', 'Fresh audit', () => {
  const dirs = ['openspec/audits', 'docs/audits', 'audits', 'docs/audit'].filter(has);
  if (!dirs.length) return fail('no audit report directory found (openspec/audits, docs/audits, audits)');
  const latest = dirs.flatMap((d) => walk(d, 1)).sort().pop();
  return judge(`latest audit report is ${latest ?? '(none)'}: confirm its date is under 14 days old`);
});
check('L3.4', 'Scheduled review', () => {
  const sched = ciFiles().find((f) => /^\s*schedule:/m.test(read(f)) || /^\s*-\s*cron:/m.test(read(f)));
  if (sched) return pass(`scheduled workflow ${sched}`);
  if (/\/schedule|routine/i.test(read('CLAUDE.md'))) return pass('CLAUDE.md names a /schedule routine (existence of the routine: structure only)');
  return fail('no CI workflow with a schedule: trigger and no /schedule routine named in CLAUDE.md');
});
check('L3.5', 'Conflict-free ADRs', () => (/draft/i.test(cmd.newAdr ?? '') ? pass(`commands.newAdr "${cmd.newAdr}" produces drafts`) : fail('commands.newAdr does not produce a draft (expected docs/adr/draft-<slug>.md or a command that does)')));

check('L3.6', 'WIP limit', () => {
  const limit = m.roadmap?.maxActive ?? 12;
  if (!(Number.isInteger(limit) && limit > 0)) return fail('swarm.json roadmap.maxActive must be a positive integer');
  const dirs = ['openspec/changes', 'changes', 'docs/changes'].filter(has);
  if (!dirs.length) return fail('no changes directory found (openspec/changes): the WIP limit needs the spec-driven layout of L3.1');
  const active = readdirSync(abs(dirs[0])).filter((n) => n !== 'archive' && !n.startsWith('.') && statSync(abs(`${dirs[0]}/${n}`)).isDirectory());
  if (active.length > limit) return fail(`${active.length} active changes in ${dirs[0]}, limit ${limit} (roadmap.maxActive): close or archive before opening more`);
  return pass(`${active.length} active change(s) in ${dirs[0]}, limit ${limit} (staleness, roadmap.staleDays, is checked by the roadmap validator inside verify)`);
});

check('X1', 'Fresh clone', () => {
  if (need(['setup']).length) return fail('commands.setup is not set');
  const wf = ciFiles().find((f) => /^\s*schedule:/m.test(read(f)) && read(f).includes(cmd.setup) && read(f).includes(cmd.verify ?? '\0'));
  if (!wf) return fail(`no scheduled workflow runs both "${cmd.setup}" and "${cmd.verify ?? 'commands.verify'}" (template: templates/github/workflows/fresh-clone.yml)`);
  return pass(`${wf} schedules setup + verify (structure only: the agent reads its latest run, green and under 14 days, with gh run list)`);
});
check('X2', 'New-agent test', () => {
  const t = read('docs/handover/reference-task.md');
  if (!t) return fail('docs/handover/reference-task.md missing');
  const acc = /<!--\s*acceptance:\s*(.+?)\s*-->/.exec(t)?.[1];
  if (!acc) return fail('reference-task.md has no <!-- acceptance: <command> --> comment');
  if (PLACEHOLDER.test(acc)) return fail(`acceptance command is still a placeholder: ${acc.slice(0, 60)}`);
  const wf = ciFiles().find((f) => /new-agent-test/.test(f));
  const reports = walk('docs/handover/reports', 1);
  if (!wf && !reports.length) return fail('no new-agent-test workflow and no report in docs/handover/reports/');
  return pass(`acceptance "${acc}"; ${wf ?? reports[0]} (structure only: the agent reads the latest report, under 30 days with verdict pass)`);
});
check('X3', 'Explicit ownership', () => {
  const co = ['CODEOWNERS', '.github/CODEOWNERS', 'docs/CODEOWNERS'].find(has);
  if (!co) return fail('CODEOWNERS missing (root, .github/ or docs/)');
  const lines = read(co).split('\n').filter((l) => l.trim() && !l.trim().startsWith('#'));
  if (!lines.some((l) => /^\*\s+@\S+/.test(l.trim()))) return fail(`${co} has no catch-all line (* @team)`);
  if (/your-org|<[^>]+>/.test(lines.join('\n'))) return fail(`${co} still has template handles (your-org or <…>)`);
  const rb = prose(read('docs/runbook.md'));
  if (!rb) return fail('docs/runbook.md missing');
  const sections = { deploy: /deploy/i, rollback: /roll ?back/i, 'secrets rotation': /rotat/i, alerts: /alert/i, 'on-call': /on-?call/i, 'scheduled jobs': /scheduled|cron/i, 'known failure modes': /failure/i };
  const headings = rb.split('\n').filter((l) => /^#{1,6} /.test(l)).join('\n');
  const missing = Object.entries(sections).filter(([, re]) => !re.test(headings)).map(([k]) => k);
  if (missing.length) return fail(`docs/runbook.md has no heading for: ${missing.join(', ')}`);
  if (PLACEHOLDER.test(rb)) return fail('docs/runbook.md still has <…> placeholders');
  const dep = prose(read('docs/dependencies.md'));
  if (!dep.trim()) return fail('docs/dependencies.md missing or empty');
  if (PLACEHOLDER.test(dep)) return fail('docs/dependencies.md still has <…> placeholders');
  return pass(`${co} ${lines.length} rules with catch-all · runbook 7/7 sections · dependencies.md filled`);
});
check('X4', 'No hidden knowledge', () => judge('open the latest audit report (under 14 days old) and confirm its hidden-knowledge count is zero, or that every item has an owner and a date; cross-check env vars vs .env.example and external services vs docs/dependencies.md'));
check('X5', 'Handover checklist', () => {
  const t = prose(read('docs/handover/checklist.md'));
  if (!t) return fail('docs/handover/checklist.md missing');
  if (PLACEHOLDER.test(t)) return fail('checklist still has <…> placeholders (owning team not named)');
  const owner = /@[\w-]+(\/[\w-]+)?/.exec(t)?.[0];
  return owner ? pass(`docs/handover/checklist.md · owner ${owner}`) : fail('checklist does not name the owning team (@org/team)');
});

// ---- run the requested scope
const inScope = (id) => (id.startsWith('X') ? opts.transfer || opts.all : requested.includes(Number(id[1])));
const results = checks.filter((c) => inScope(c.id)).map((c) => ({ id: c.id, name: c.name, ...c.fn() }));

// ---- version drift
const pluginRoot = process.env.CLAUDE_PLUGIN_ROOT;
const pluginPath = [pluginRoot && join(pluginRoot, '.claude-plugin/plugin.json'), join(SELF, '../.claude-plugin/plugin.json')].filter(Boolean).find(existsSync);
const pluginVersion = pluginPath ? JSON.parse(readFileSync(pluginPath, 'utf8')).version : undefined;
const cmpv = (a, b) => {
  const [x, y] = [a, b].map((v) => v.split('.').map(Number));
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] < y[i] ? -1 : 1;
  return 0;
};
let relation = 'unknown';
let versionLine = 'version: plugin not found (set CLAUDE_PLUGIN_ROOT)';
if (pluginVersion && typeof m.version === 'string' && SEMVER.test(m.version)) {
  const c = cmpv(m.version, pluginVersion);
  relation = c === 0 ? 'equal' : c < 0 ? 'behind' : 'ahead';
  versionLine = c === 0 ? `version ${m.version} = plugin` : `version ${m.version} ${relation} plugin ${pluginVersion}`;
}

const ledger = readLedger();
const closure = ledger.findings ? closureStats(ledger.findings) : undefined;
const failing = results.filter((r) => r.status === 'fail').map((r) => r.id);
const judging = results.filter((r) => r.status === 'judge').map((r) => r.id);
const mechanicalPass = failing.length === 0;

if (opts.json) {
  const checksOut = results.map(({ id, name, status, evidence }) => ({ id, name, status, evidence }));
  console.log(JSON.stringify({ level: scope, checks: checksOut, ...(closure ? { closure } : {}), version: { project: m.version, plugin: pluginVersion, relation }, mechanicalPass }, null, 2));
} else {
  const mark = { pass: '✓', fail: '✗', judge: '?' };
  console.log(`swarm check · ${typeof scope === 'number' ? `level ${scope}` : scope} · protocol ${m.version ?? 'unknown'}`);
  if (closure) console.log(`closure: ${closure.line}`);
  const w = Math.max(...results.map((r) => r.name.length));
  for (const r of results) console.log(`${mark[r.status]} ${r.id.padEnd(4)} ${r.name.padEnd(w)}  ${r.status === 'judge' ? 'needs judgement: ' : ''}${r.evidence}`);
  console.log(versionLine);
  console.log(`result: mechanical ${mechanicalPass ? 'pass' : `fail (${failing.join(', ')})`}${judging.length ? `; needs judgement: ${judging.join(', ')}` : ''}`);
}
process.exit(mechanicalPass ? 0 : 1);
