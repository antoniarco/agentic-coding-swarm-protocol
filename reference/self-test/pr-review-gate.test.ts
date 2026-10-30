/**
 * The PR review gate: a pull request merges only when every requested reviewer answered and no thread is open, a bot
 * gets a deadline and a person does not, and nothing waits on the clock. The CLI runs as a real subprocess on a saved
 * GraphQL answer (`--input`) with `--now` pinning the clock, so no network and no `gh` are needed.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, test } from 'node:test';
import { DEFAULT_CONFIG, type PrGateConfig, evaluate, fromGraphql, loadPrConfig } from '../scripts/pr-review-gate.ts';
import { SCRIPTS } from './helpers.ts';

const REQUESTED = '2026-10-30T10:00:00Z';
const COPILOT = { __typename: 'Bot', login: 'copilot-pull-request-reviewer' };
const ANA = { __typename: 'User', login: 'ana' };

interface Shape {
  draft?: boolean;
  requests?: object[];
  requested?: { at: string; who: object }[];
  reviews?: { state: string; author: object }[];
  threads?: { isResolved: boolean; author?: string; path?: string; line?: number }[];
}

/** A GraphQL answer shaped like the one `gh api graphql` returns for QUERY. */
function answer(s: Shape = {}): object {
  const requested = s.requested ?? [];
  return {
    data: {
      repository: {
        pullRequest: {
          number: 7,
          isDraft: s.draft ?? false,
          headRefOid: 'abc123',
          reviewRequests: { nodes: (s.requests ?? []).map((r) => ({ requestedReviewer: r })) },
          reviews: { nodes: s.reviews ?? [] },
          reviewThreads: {
            nodes: (s.threads ?? []).map((t) => ({ isResolved: t.isResolved, path: t.path, line: t.line, comments: { nodes: [{ url: 'https://x/1', author: { login: t.author ?? 'ana' } }] } })),
          },
          timelineItems: { filteredCount: requested.length, nodes: requested.map((r) => ({ createdAt: r.at, requestedReviewer: r.who })) },
        },
      },
    },
  };
}

function verdict(s: Shape, now: string, cfg: PrGateConfig = DEFAULT_CONFIG) {
  return evaluate(fromGraphql(answer(s), cfg), cfg, new Date(now));
}

describe('pr review gate', () => {
  test('a requested bot holds the gate until it answers or its deadline passes, then the gate says it did not answer', () => {
    const asked: Shape = { requests: [COPILOT], requested: [{ at: REQUESTED, who: COPILOT }] };
    const early = verdict(asked, '2026-10-30T11:00:00Z');
    assert.equal(early.state, 'pending');
    assert.match(early.description, /waiting for copilot-pull-request-reviewer until 12:00Z/);

    const late = verdict(asked, '2026-10-30T12:00:01Z');
    assert.equal(late.state, 'success');
    assert.match(late.description, /copilot-pull-request-reviewer did not answer within 2h/);

    const answered = verdict({ requested: asked.requested, reviews: [{ state: 'COMMENTED', author: COPILOT }] }, '2026-10-30T10:30:00Z');
    assert.equal(answered.state, 'success');
  });

  test('a requested person blocks with no deadline', () => {
    const v = verdict({ requests: [ANA], requested: [{ at: REQUESTED, who: ANA }] }, '2026-11-15T00:00:00Z');
    assert.equal(v.state, 'pending');
    assert.match(v.description, /waiting for ana$/);
  });

  test('an unresolved thread fails, outdated or not, even before every reviewer answered; resolving it passes', () => {
    const base: Shape = { requested: [{ at: REQUESTED, who: COPILOT }], reviews: [{ state: 'COMMENTED', author: COPILOT }] };
    const open = verdict({ ...base, threads: [{ isResolved: false, author: 'copilot-pull-request-reviewer', path: 'src/a.ts', line: 3 }, { isResolved: true }] }, '2026-10-30T11:00:00Z');
    assert.equal(open.state, 'failure');
    assert.match(open.description, /^1 unresolved review thread\(s\): fix or reply, then resolve$/);
    assert.ok(open.details.some((d) => d.includes('src/a.ts:3')));

    const withPending = verdict({ ...base, requests: [ANA], threads: [{ isResolved: false }] }, '2026-10-30T11:00:00Z');
    assert.equal(withPending.state, 'failure', 'red as soon as there is something to fix, not after everyone answered');

    assert.equal(verdict({ ...base, threads: [{ isResolved: true }] }, '2026-10-30T11:00:00Z').state, 'success');
  });

  test('the latest non-comment review decides: changes requested fails until the same reviewer approves', () => {
    const changes = verdict({ requested: [{ at: REQUESTED, who: ANA }], reviews: [{ state: 'CHANGES_REQUESTED', author: ANA }, { state: 'COMMENTED', author: ANA }] }, '2026-10-30T11:00:00Z');
    assert.equal(changes.state, 'failure');
    assert.match(changes.description, /changes requested by ana/);
    const approved = verdict({ requested: [{ at: REQUESTED, who: ANA }], reviews: [{ state: 'CHANGES_REQUESTED', author: ANA }, { state: 'APPROVED', author: ANA }] }, '2026-10-30T11:00:00Z');
    assert.equal(approved.state, 'success');
  });

  test('no reviewer ever requested stays pending, unless requireReviewer is off; drafts stay pending', () => {
    const none = verdict({}, '2026-10-30T11:00:00Z');
    assert.equal(none.state, 'pending');
    assert.match(none.description, /no reviewer requested/);
    assert.equal(verdict({}, '2026-10-30T11:00:00Z', { ...DEFAULT_CONFIG, requireReviewer: false }).state, 'success');
    assert.match(verdict({ draft: true }, '2026-10-30T11:00:00Z').description, /^draft/);
  });

  test('bots: any [bot] login and the configured list get a deadline; a team request blocks like a person', () => {
    const cfg: PrGateConfig = { ...DEFAULT_CONFIG, bots: ['review-robot'] };
    const robot = { __typename: 'User', login: 'review-robot' };
    const other = { __typename: 'User', login: 'linter[bot]' };
    const team = { __typename: 'Team', slug: 'core' };
    const pr = fromGraphql(answer({ requests: [robot, other, team], requested: [{ at: REQUESTED, who: robot }, { at: REQUESTED, who: other }, { at: REQUESTED, who: team }] }), cfg);
    assert.deepEqual(pr.pending.map((p) => [p.login, p.bot]), [['review-robot', true], ['linter[bot]', true], ['team:core', false]]);
    const v = evaluate(pr, cfg, new Date('2026-10-31T00:00:00Z'));
    assert.equal(v.state, 'pending');
    assert.equal(v.description, 'waiting for team:core');
  });

  test('ever-requested counts review requests only, not the whole timeline (totalCount ignores itemTypes)', () => {
    const raw = answer() as { data: { repository: { pullRequest: { timelineItems: object } } } };
    raw.data.repository.pullRequest.timelineItems = { totalCount: 10, nodes: [] };
    assert.equal(evaluate(fromGraphql(raw, DEFAULT_CONFIG), DEFAULT_CONFIG).state, 'pending');
  });

  test('a bot request whose time is unknown gets no deadline', () => {
    const v = verdict({ requests: [COPILOT] }, '2026-12-01T00:00:00Z');
    assert.equal(v.state, 'pending');
  });

  test('a list that fills a page fails instead of guessing about what was not read', () => {
    const threads = Array.from({ length: 100 }, () => ({ isResolved: true }));
    assert.equal(verdict({ requested: [{ at: REQUESTED, who: ANA }], threads }, '2026-10-30T11:00:00Z').state, 'failure');
  });
});

describe('pr review gate CLI and config', () => {
  function dir(t: { after: (fn: () => void) => void }, swarm?: object): string {
    const d = mkdtempSync(join(tmpdir(), 'pr-gate-'));
    t.after(() => rmSync(d, { recursive: true, force: true }));
    if (swarm) writeFileSync(join(d, 'swarm.json'), JSON.stringify(swarm));
    return d;
  }

  function run(cwd: string, shape: Shape, now: string) {
    const input = join(cwd, 'pr.json');
    writeFileSync(input, JSON.stringify(answer(shape)));
    const r = spawnSync(process.execPath, [join(SCRIPTS, 'pr-review-gate.ts'), 'check', '--pr', '7', '--input', input, '--now', now], { cwd, encoding: 'utf8' });
    return { status: r.status, out: `${r.stdout}${r.stderr}` };
  }

  test('exit codes: 0 success, 1 failure, 3 pending, 2 usage', (t) => {
    const cwd = dir(t);
    const asked = { requested: [{ at: REQUESTED, who: COPILOT }] };
    assert.equal(run(cwd, { ...asked, reviews: [{ state: 'COMMENTED', author: COPILOT }] }, '2026-10-30T11:00:00Z').status, 0);
    assert.equal(run(cwd, { ...asked, threads: [{ isResolved: false }] }, '2026-10-30T11:00:00Z').status, 1);
    const pending = run(cwd, { ...asked, requests: [COPILOT] }, '2026-10-30T11:00:00Z');
    assert.equal(pending.status, 3);
    assert.match(pending.out, /… #7 pending: waiting for copilot-pull-request-reviewer/);
    const usage = spawnSync(process.execPath, [join(SCRIPTS, 'pr-review-gate.ts'), 'nope'], { cwd, encoding: 'utf8' });
    assert.equal(usage.status, 2);
  });

  test('review.pr in swarm.json sets the bot deadline; invalid values fall back to the defaults', (t) => {
    const cwd = dir(t, { review: { mode: 'sensitive', sensitive: ['x'], pr: { botTimeoutHours: 6, requireReviewer: false, bots: ['r'] } } });
    assert.deepEqual(loadPrConfig(cwd), { botTimeoutHours: 6, requireReviewer: false, bots: ['r'] });
    const asked = { requests: [COPILOT], requested: [{ at: REQUESTED, who: COPILOT }] };
    assert.equal(run(cwd, asked, '2026-10-30T15:00:00Z').status, 3, 'still within 6h');
    assert.deepEqual(loadPrConfig(dir(t, { review: { pr: { botTimeoutHours: -1, requireReviewer: 'yes' } } })), DEFAULT_CONFIG);
    assert.deepEqual(loadPrConfig(dir(t)), DEFAULT_CONFIG);
  });
});
