// Self-test of scripts/check-conformance.mjs against throw-away repositories built from templates/.
// Run: node --test 'scripts/*.test.mjs'
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, describe, it } from 'node:test';

const ROOT = join(dirname(new URL(import.meta.url).pathname), '..');
const SCRIPT = join(ROOT, 'scripts/check-conformance.mjs');
const T = (p) => join(ROOT, 'templates', p);
const dirs = [];
after(() => dirs.forEach((d) => rmSync(d, { recursive: true, force: true })));

const tmp = () => {
  const d = mkdtempSync(join(tmpdir(), 'swarm-conf-'));
  dirs.push(d);
  return d;
};
const put = (repo, path, content = '') => {
  mkdirSync(dirname(join(repo, path)), { recursive: true });
  writeFileSync(join(repo, path), content);
};
const copy = (repo, from, to) => {
  mkdirSync(dirname(join(repo, to)), { recursive: true });
  cpSync(T(from), join(repo, to));
};
const has = (repo, p) => existsSync(join(repo, p));
const run = (repo, ...args) => spawnSync(process.execPath, [SCRIPT, '--repo', repo, ...args], { encoding: 'utf8' });
/** The line for an id, e.g. line(out, 'L0.3') → "✗ L0.3 Secrets  …". */
const line = (out, id) => out.split('\n').find((l) => new RegExp(`^[✓✗?] ${id.replace('.', '\\.')}\\s`).test(l));

/** A repository that satisfies level 0, built from the templates; extra files only to make `enforced:` paths exist. */
function level0() {
  const repo = tmp();
  const swarm = JSON.parse(readFileSync(T('swarm.json'), 'utf8'));
  put(repo, 'swarm.json', JSON.stringify(swarm, null, 2));
  copy(repo, 'CLAUDE.md', 'CLAUDE.md');
  copy(repo, 'claude/settings.json', '.claude/settings.json');
  put(repo, '.gitignore', 'node_modules\nCLAUDE.local.md\n.claude/settings.local.json\n.claude/worktrees/\n');
  copy(repo, 'adr/0000-template.md', 'docs/adr/0000-template.md');
  put(repo, 'docs/adr/README.md', '# ADRs\n\n<!-- generated:adr-index -->\n<!-- /generated:adr-index -->\n');
  put(repo, 'docs/adr/draft-adopt-agentic-coding-swarm-protocol.md', '# Adopt the protocol\n');
  const enforced = new Set([...readFileSync(T('CLAUDE.md'), 'utf8').matchAll(/\(enforced: ([^()]+)\)/g)].flatMap((m) => m[1].split(',').map((s) => s.trim())));
  copy(repo, 'quality-ratchets.json', 'quality-ratchets.json');
  for (const p of enforced) if (!has(repo, p)) put(repo, p, '// stub\n');
  return repo;
}

describe('check-conformance', () => {
  it('(a) exits 2 without a manifest', () => {
    const r = run(tmp(), '--level', '0');
    assert.equal(r.status, 2);
    assert.match(r.stderr, /no swarm\.json/);
  });

  it('exits 2 on bad arguments', () => {
    assert.equal(run(level0(), '--level', '9').status, 2);
    assert.equal(run(level0(), '--level', '1', '--transfer').status, 2);
  });

  describe('(b) a level 0 repository', () => {
    const repo = level0();
    it('passes every L0 check and exits 0 for --level 0', () => {
      const r = run(repo, '--level', '0');
      assert.equal(r.status, 0, r.stdout);
      for (const id of ['L0.1', 'L0.2', 'L0.3', 'L0.4', 'L0.5', 'L0.6']) assert.match(line(r.stdout, id) ?? '', /^✓/, `${id}\n${r.stdout}`);
      assert.match(r.stdout, /^version \d+\.\d+\.\d+ = plugin$/m);
      assert.match(r.stdout, /^result: mechanical pass$/m);
    });
    it('exits 1 for --level 1 and lists every L1 id', () => {
      const r = run(repo, '--level', '1');
      assert.equal(r.status, 1);
      for (const id of ['L1.1', 'L1.2', 'L1.3', 'L1.4', 'L1.5', 'L1.6']) assert.ok(line(r.stdout, id), id);
      assert.match(line(r.stdout, 'L1.1'), /^\? L1\.1 .*needs judgement: run "pnpm verify"/);
      assert.match(line(r.stdout, 'L1.3'), /^✗/);
      assert.match(line(r.stdout, 'L1.6'), /^✓/);
    });
    it('defaults to the level in swarm.json', () => {
      const r = run(repo);
      assert.match(r.stdout, /^swarm check · level 0 /);
      assert.equal(line(r.stdout, 'L1.1'), undefined);
    });
  });

  describe('(c) one break per check fails exactly that id', () => {
    const breaks = [
      ['L0.1', (r) => put(r, 'swarm.json', '{ not json')],
      ['L0.2', (r) => put(r, 'CLAUDE.md', '# empty\n')],
      ['L0.3', (r) => put(r, '.claude/settings.json', JSON.stringify({ permissions: { deny: [] } }))],
      ['L0.4', (r) => put(r, '.gitignore', 'node_modules\n')],
      ['L0.5', (r) => rmSync(join(r, 'docs/adr/0000-template.md'))],
      ['L0.6', (r) => put(r, 'CLAUDE.md', `${readFileSync(join(r, 'CLAUDE.md'), 'utf8')}\n- A rule with no marker.\n`)],
      ['L0.6', (r) => put(r, 'CLAUDE.md', readFileSync(join(r, 'CLAUDE.md'), 'utf8').replace('test/docs.test.ts', 'test/gone.test.ts'))],
    ];
    for (const [id, mutate] of breaks) {
      it(`${id} (${mutate.toString().slice(0, 40).replace(/\s+/g, ' ')}…)`, () => {
        const repo = level0();
        mutate(repo);
        const r = run(repo, '--level', '0');
        assert.equal(r.status, 1, r.stdout);
        assert.match(line(r.stdout, id) ?? '', /^✗/, r.stdout);
        const others = r.stdout.split('\n').filter((l) => /^✗ L0\./.test(l) && !l.startsWith(`✗ ${id} `));
        // a broken manifest or CLAUDE.md legitimately takes its dependants with it; nothing else may fail
        if (!['L0.1', 'L0.2'].includes(id)) assert.deepEqual(others, [], r.stdout);
      });
    }
  });

  describe('levels 1-3 structure', () => {
    /** Level 0 plus the structure of levels 1-3, derived from the templates. */
    function full() {
      const repo = level0();
      copy(repo, 'quality-ratchets.json', 'quality-ratchets.json');
      put(repo, 'package.json', JSON.stringify({ scripts: { verify: 'x', 'wt:commit': 'x', 'wt:status': 'x', land: 'x', 'audit:repo': 'x' } }));
      put(repo, '.github/workflows/ci.yml', 'name: ci\non: push\njobs:\n  quality:\n    runs-on: ubuntu-latest\n    steps:\n      - run: pnpm verify\n');
      put(repo, '.github/workflows/weekly.yml', 'on:\n  schedule:\n    - cron: "0 5 * * 1"\njobs:\n  r:\n    steps: []\n');
      copy(repo, 'deps-allowlist.json', 'deps-allowlist.json');
      put(repo, 'scripts/dev/deps-audit.ts', '//');
      put(repo, 'scripts/dev/mutation-smoke.ts', '//');
      put(repo, 'biome.json', JSON.stringify({ formatter: { enabled: true } }));
      put(repo, 'openspec/changes/.keep', '');
      copy(repo, 'AGENTS.md', 'AGENTS.md');
      copy(repo, 'githooks/pre-push', '.githooks/pre-push');
      put(repo, 'test/docs.test.ts', '//');
      put(repo, 'scripts/dev/findings.ts', '//');
      copy(repo, 'docs/audits/findings.jsonl', 'docs/audits/findings.jsonl');
      put(repo, 'openspec/roadmap.yaml', 'changes: []\n');
      put(repo, 'openspec/audits/2026-10-28.md', '# Audit\n');
      return repo;
    }
    const repo = full();
    it('passes the mechanical checks of levels 1-3 and leaves judgement to the agent', () => {
      const r = run(repo, '--level', '3');
      assert.equal(r.status, 0, r.stdout);
      assert.match(line(r.stdout, 'L1.3'), /^✓/);
      assert.match(line(r.stdout, 'L1.6'), /^✓/);
      assert.match(line(r.stdout, 'L2.7'), /^✓/);
      assert.match(line(r.stdout, 'L3.4'), /^✓/);
      assert.match(line(r.stdout, 'L1.2'), /^\?/);
      assert.match(line(r.stdout, 'L3.2'), /^\?/);
    });
    it('L1.3 fails when CI does not run verify or may continue on error', () => {
      const a = full();
      put(a, '.github/workflows/ci.yml', 'jobs:\n  q:\n    steps:\n      - run: pytest\n');
      assert.match(line(run(a, '--level', '1').stdout, 'L1.3'), /^✗/);
      const b = full();
      put(b, '.github/workflows/ci.yml', 'jobs:\n  q:\n    steps:\n      - run: pnpm verify\n        continue-on-error: true\n');
      assert.match(line(run(b, '--level', '1').stdout, 'L1.3'), /^✗.*continue-on-error/);
    });
    it('L1.5 fails when the gate workflow reads a secret', () => {
      const a = full();
      put(a, '.github/workflows/ci.yml', 'jobs:\n  q:\n    steps:\n      - run: pnpm verify\n        env:\n          K: ${{ secrets.API_KEY }}\n');
      assert.match(line(run(a, '--level', '1').stdout, 'L1.5'), /^✗.*API_KEY/);
    });
    it('L1.7 fails on a missing allowlist, an expired entry, or no audit; L1.8 on a disabled formatter; L1.9 without silentErrors', () => {
      const a = full();
      rmSync(join(a, 'deps-allowlist.json'));
      assert.match(line(run(a, '--level', '1').stdout, 'L1.7'), /^✗.*deps-allowlist\.json missing/);
      put(a, 'deps-allowlist.json', JSON.stringify({ 'GHSA-1': { reason: 'r', owner: 'o', expires: '2020-01-01' } }));
      assert.match(line(run(a, '--level', '1').stdout, 'L1.7'), /^✗.*expired.*GHSA-1/);
      put(a, 'deps-allowlist.json', JSON.stringify({ 'GHSA-1': { reason: 'r', owner: 'o', expires: '2999-01-01' } }));
      assert.match(line(run(a, '--level', '1').stdout, 'L1.7'), /^✓.*1 entry, none expired/);
      rmSync(join(a, 'scripts/dev/deps-audit.ts'));
      assert.match(line(run(a, '--level', '1').stdout, 'L1.7'), /^✗.*no dependency audit found/);
      const b = full();
      put(b, 'biome.json', JSON.stringify({ formatter: { enabled: false } }));
      assert.match(line(run(b, '--level', '1').stdout, 'L1.8'), /^✗.*formatter\.enabled: false/);
      rmSync(join(b, 'biome.json'));
      assert.match(line(run(b, '--level', '1').stdout, 'L1.8'), /^✗.*no formatter configured/);
      const c = full();
      const r = JSON.parse(readFileSync(join(c, 'quality-ratchets.json'), 'utf8'));
      delete r.silentErrors;
      put(c, 'quality-ratchets.json', JSON.stringify(r));
      assert.match(line(run(c, '--level', '1').stdout, 'L1.9'), /^✗.*no silentErrors section/);
    });
    it('L3.6 fails above roadmap.maxActive active changes', () => {
      const a = full();
      put(a, 'swarm.json', JSON.stringify({ ...JSON.parse(readFileSync(join(a, 'swarm.json'), 'utf8')), roadmap: { maxActive: 2, staleDays: 14 } }));
      for (const n of ['one', 'two', 'three']) put(a, `openspec/changes/${n}/proposal.md`, '# x\n');
      assert.match(line(run(a, '--level', '3').stdout, 'L3.6'), /^✗.*3 active changes.*limit 2/);
      rmSync(join(a, 'openspec/changes/three'), { recursive: true });
      assert.match(line(run(a, '--level', '3').stdout, 'L3.6'), /^✓.*2 active change\(s\).*limit 2/);
    });
    it('L1.6 fails on a malformed ratchets file', () => {
      const a = full();
      put(a, 'quality-ratchets.json', '{"fileSize":{"max":500}}');
      assert.match(line(run(a, '--level', '1').stdout, 'L1.6'), /^✗.*coverage/);
    });
    it('L2.x fail on their own break', () => {
      const cases = [
        ['L2.2', (r) => put(r, 'package.json', '{"scripts":{}}')],
        ['L2.4', () => {}],
        ['L2.5', (r) => rmSync(join(r, 'test/docs.test.ts'))],
        ['L2.6', (r) => rmSync(join(r, 'AGENTS.md'))],
        ['L2.8', (r) => rmSync(join(r, 'docs/audits/findings.jsonl'))],
        ['L2.10', (r) => rmSync(join(r, 'scripts/dev/mutation-smoke.ts'))],
        ['L2.9', (r) => put(r, 'swarm.json', JSON.stringify({ ...JSON.parse(readFileSync(join(r, 'swarm.json'), 'utf8')), commands: {} }))],
        ['L2.7', (r) => put(r, 'swarm.json', JSON.stringify({ ...JSON.parse(readFileSync(join(r, 'swarm.json'), 'utf8')), review: { mode: 'bogus' } }))],
      ];
      const swarm = (r) => JSON.parse(readFileSync(join(r, 'swarm.json'), 'utf8'));
      cases.push(['L2.7', (r) => { const s = swarm(r); put(r, 'swarm.json', JSON.stringify({ ...s, review: { ...s.review, pr: { botTimeoutHours: 'two' } } })); }]);
      for (const [id, mutate] of cases) {
        const r = full();
        mutate(r);
        const out = run(r, '--level', '2').stdout;
        if (id !== 'L2.4') assert.match(line(out, id) ?? '', /^✗/, `${id}\n${out}`);
        else assert.match(line(out, id) ?? '', /^✓/, out); // test/architecture.test.ts is a stub from the CLAUDE.md enforced paths
      }
    });
    it('L2.8 passes on the template ledger and fails on a malformed line, an unowned open high, or a bad sla block', () => {
      const ok = run(full(), '--level', '2').stdout;
      assert.match(line(ok, 'L2.8'), /^✓.*2 finding\(s\), 0 open/);
      assert.match(line(ok, 'L2.9'), /^✓.*no land log yet/);
      const a = full();
      put(a, 'docs/audits/findings.jsonl', '{"id":"AUD-a","severity":"high"}\n');
      assert.match(line(run(a, '--level', '2').stdout, 'L2.8'), /^✗.*findings\.jsonl:1 has a missing or invalid status, opened, sla_due/);
      const b = full();
      put(b, 'docs/audits/findings.jsonl', `${JSON.stringify({ id: 'AUD-a', severity: 'high', status: 'open', opened: '2026-10-01', sla_due: '2026-10-03' })}\n`);
      assert.match(line(run(b, '--level', '2').stdout, 'L2.8'), /^✗.*without an owner: AUD-a/);
      put(b, 'docs/audits/findings.jsonl', `${JSON.stringify({ id: 'AUD-a', severity: 'high', status: 'open', opened: '2026-10-01', sla_due: '2026-10-03', owner: 'ana' })}\n${JSON.stringify({ id: 'AUD-a', severity: 'high', status: 'closed', opened: '2026-10-01', sla_due: '2026-10-03' })}\n`);
      assert.match(line(run(b, '--level', '2').stdout, 'L2.8'), /^✓/, 'the latest line of an id is its state; a closed high needs no owner');
      const c = full();
      put(c, 'swarm.json', JSON.stringify({ ...JSON.parse(readFileSync(join(c, 'swarm.json'), 'utf8')), findings: { sla: { high: 2 } } }));
      assert.match(line(run(c, '--level', '2').stdout, 'L2.8'), /^✗.*findings\.sla/);
    });
    it('L2.9 needs commands.findings to resolve, and a land log (if any) whose latest land records `closes`', () => {
      const a = full();
      rmSync(join(a, 'scripts/dev/findings.ts'));
      assert.match(line(run(a, '--level', '2').stdout, 'L2.9'), /^✗.*does not resolve/);
      const b = full();
      spawnSync('git', ['init', '-q', b]);
      const log = join(b, '.git/myproject-land-log.jsonl');
      writeFileSync(log, `${JSON.stringify({ result: 'landed', head: 'abc' })}\n`);
      assert.match(line(run(b, '--level', '2').stdout, 'L2.9'), /^✗.*no `closes` field/);
      writeFileSync(log, `${JSON.stringify({ result: 'landed', head: 'abc' })}\n${JSON.stringify({ result: 'landed', head: 'def', closes: [], refactor: false })}\n`);
      assert.match(line(run(b, '--level', '2').stdout, 'L2.9'), /^✓.*records closes/);
    });
    it('the headline prints the closure stats line, also in --json', () => {
      const r = full();
      const today = new Date().toISOString().slice(0, 10);
      const ago = (n) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);
      const rows = [
        { id: 'AUD-a', severity: 'high', status: 'open', owner: 'ana', opened: ago(10), sla_due: ago(8) },
        { id: 'AUD-b', severity: 'low', status: 'open', opened: ago(2), sla_due: ago(-58) },
        { id: 'AUD-c', severity: 'low', status: 'closed', opened: ago(3), sla_due: ago(-57), closed: today },
      ];
      put(r, 'docs/audits/findings.jsonl', `${rows.map((x) => JSON.stringify(x)).join('\n')}\n`);
      const out = run(r, '--level', '2').stdout;
      assert.match(out, /^closure: open 2 · overdue 1 · median age 6d · closure 0\.33$/m);
      assert.equal(JSON.parse(run(r, '--level', '2', '--json').stdout).closure.overdue, 1);
    });
    it('L3.1 and L3.5 fail without roadmap or draft ADRs', () => {
      const r = full();
      rmSync(join(r, 'openspec/roadmap.yaml'));
      put(r, 'swarm.json', JSON.stringify({ ...JSON.parse(readFileSync(join(r, 'swarm.json'), 'utf8')), commands: { newAdr: 'docs/adr/new.md' } }));
      const out = run(r, '--level', '3').stdout;
      assert.match(line(out, 'L3.1'), /^✗/);
      assert.match(line(out, 'L3.5'), /^✗/);
    });
  });

  describe('(d) --json', () => {
    it('has the documented shape', () => {
      const r = run(level0(), '--level', '1', '--json');
      const o = JSON.parse(r.stdout);
      assert.equal(o.level, 1);
      assert.equal(typeof o.mechanicalPass, 'boolean');
      assert.equal(o.mechanicalPass, false);
      assert.deepEqual(Object.keys(o.checks[0]).sort(), ['evidence', 'id', 'name', 'status']);
      assert.ok(o.checks.every((c) => ['pass', 'fail', 'judge'].includes(c.status)));
      assert.equal(o.checks.find((c) => c.id === 'L1.1').status, 'judge');
      assert.equal(o.checks.filter((c) => c.id.startsWith('L0')).length, 6);
      assert.equal(o.version.relation, 'equal');
    });
  });

  describe('(e) transfer track', () => {
    function transfer() {
      const repo = level0();
      const manifest = JSON.parse(readFileSync(join(repo, 'swarm.json'), 'utf8'));
      manifest.commands.setup = 'pnpm install --frozen-lockfile';
      put(repo, 'swarm.json', JSON.stringify(manifest));
      put(repo, '.github/workflows/fresh-clone.yml', `on:\n  schedule:\n    - cron: "0 5 * * 1"\njobs:\n  f:\n    steps:\n      - run: ${manifest.commands.setup}\n      - run: ${manifest.commands.verify}\n`);
      put(repo, '.github/workflows/new-agent-test.yml', 'on: workflow_dispatch\njobs: {}\n');
      put(repo, '.github/CODEOWNERS', '*  @acme/project-team\n/docs/  @acme/docs\n');
      const sections = ['Deploy', 'Rollback', 'Secrets rotation', 'Alerts', 'On-call', 'Scheduled jobs', 'Known failure modes'];
      put(repo, 'docs/runbook.md', `# Runbook\n\n${sections.map((s) => `## ${s}\n\nSee the pipeline.\n`).join('\n')}`);
      put(repo, 'docs/dependencies.md', '# Dependencies\n\n| Service | Owner |\n|---|---|\n| Stripe | @acme/payments |\n');
      put(repo, 'docs/handover/checklist.md', '# Handover\n\nOwning team: @acme/project-team\n');
      put(repo, 'docs/handover/reference-task.md', '# Task\n\n<!-- acceptance: pnpm vitest run src/orders.test.ts -->\n');
      return repo;
    }
    it('X1, X2, X3, X5 pass, X4 needs judgement, exit 0', () => {
      const r = run(transfer(), '--transfer');
      assert.equal(r.status, 0, r.stdout);
      for (const id of ['X1', 'X2', 'X3', 'X5']) assert.match(line(r.stdout, id) ?? '', /^✓/, `${id}\n${r.stdout}`);
      assert.match(line(r.stdout, 'X4'), /^\? X4 .*needs judgement/);
      assert.equal(line(r.stdout, 'L0.1'), undefined);
      assert.match(r.stdout, /needs judgement: X4$/m);
    });
    it('template placeholders fail X3 and X5; a missing acceptance comment fails X2', () => {
      const a = transfer();
      copy(a, 'CODEOWNERS', '.github/CODEOWNERS');
      assert.match(line(run(a, '--transfer').stdout, 'X3'), /^✗.*your-org/);
      const b = transfer();
      copy(b, 'handover/reference-task.md', 'docs/handover/reference-task.md');
      assert.match(line(run(b, '--transfer').stdout, 'X2'), /^✗.*placeholder/);
      const c = transfer();
      put(c, 'docs/handover/checklist.md', '# Handover\n\nOwning team: <team>\n');
      assert.match(line(run(c, '--transfer').stdout, 'X5'), /^✗/);
      const d = transfer();
      put(d, 'docs/runbook.md', '# Runbook\n\n## Deploy\n');
      assert.match(line(run(d, '--transfer').stdout, 'X3'), /^✗.*rollback/);
    });
  });

  it('reports version drift against the plugin', () => {
    const repo = level0();
    const m = JSON.parse(readFileSync(join(repo, 'swarm.json'), 'utf8'));
    put(repo, 'swarm.json', JSON.stringify({ ...m, version: '0.1.0' }));
    assert.match(run(repo, '--level', '0').stdout, /^version 0\.1\.0 behind plugin /m);
    put(repo, 'swarm.json', JSON.stringify({ ...m, version: '9.0.0' }));
    assert.match(run(repo, '--level', '0').stdout, /^version 9\.0\.0 ahead plugin /m);
  });
});
