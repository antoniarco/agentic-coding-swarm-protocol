# 17 · Architecture of an LLM-agent production system

**Rule:** the agent thinks; code acts. The model observes, decides and plans through typed tools. Scoring,
permitting, writing, evaluating, rolling back, spending and measuring are deterministic code, and every one of those
boundaries is an invariant with an ID, a reason and a test.

This chapter carries the architecture knowledge of the reference project (PLINNG), a multi-tenant system in
production in which an LLM agent plans work for small businesses and the system executes it against their public
surfaces (websites, business listings, social accounts). The patterns are written generically. Chapters 00–16 are
about how humans and coding agents build software; this one is about what to build when the product itself is an
agent.

The full invariant list (each rule with its why) and a short summary of the execution-safety patterns are in
[chapter 05](05-architecture-and-docs.md) ("The reference project's invariants, generalized" and "Execution-safety
patterns for agent products"); this chapter does not repeat that list. It gives each pattern's reasoning, the
incident or failure mode behind it, how it is enforced, and how to adopt it. Chapter 16 §9 covers the LLM
integration in token terms. Chapter 19 covers what surrounds this design: the architecture style of each piece, the
agent pattern for each need, multi-agent communication, judges, autonomy levels, container images and encryption.

## The shape of the system

```text
 interfaces      CLI · worker/queue · scheduler · dashboards        (compose; never touch storage or the outside world)
                        │
 runtime         run lifecycle · agent loop · policy · approvals · executor
                        │
 capabilities    typed operations, declared in a registry           (read · draft · write · publish · build)
                        │ ctx.connectors : ConnectorGateway          (an interface defined in core)
 integrations    one runtime: modes, cache, cost, retries, budget   (implements the gateway; core never imports it)
                        │
                 external APIs

 storage         repositories over files or Postgres + object store (the only module that touches persistence)
```

Dependencies only point down. The core package defines the gateway interface; the integrations package implements it
structurally; only the apps compose the two.

A run of one recurring responsibility over one tenant goes through fixed steps, each recorded in a timeline
artifact: `lock → replan → analyze → context → agent → ledgers → execute → close`. Each run stores its context
manifest (what was included or trimmed, with sizes), the full transcript, the validated plan, a per-turn log
(provider, model, stop reason, tokens including cache reads and writes, cost, tools called, duration), and a cost
breakdown. Every run records the catalog version, the harness version (package version plus commit) and the model;
with those three, any difference between two runs can be attributed.

---

## 1. Kernel and domain, with a boundary that only shrinks

**Rule.** The core is split into a generic **kernel** (storage, LLM, clock, evidence, ids, logging, tool registry
and context, cost meter, agent loop, policy, resource locks, event-log service, approvals, executor, run artifacts)
and the **domain**. The kernel imports only kernel files and the shared `schemas/` contract.

**Why.** The reusable part of an agent product is the harness: loop, policy, budget, effects, logs. If domain
imports leak into it, the harness can never be reused for another vertical, and every domain change risks the
safety machinery. Making the split explicit also surfaced imports that already crossed the boundary unnoticed.

**How it's enforced.** The kernel is a **list of files** in the architecture test, not a folder (moving it into a
`kernel/` folder was postponed: it touches many imports and mixes a decision with a refactor). The test fails if a
kernel file imports a domain file not in the exceptions table, if an exception no longer exists (stale entry), and
if a new file in the runtime folder or the root of the capabilities folder is not classified as kernel or domain.
The exceptions table has columns *kernel file / imports / reason* and started with six entries (the executor
marking an opportunity done, detecting stale page versions and recording outcome baselines; run artifacts typing
the context and prompt; the mock agent reading the domain prompt).

**How to adopt it.** Write the kernel list on day one, even if it is three files. Where the kernel needs domain
behavior, inject it (the executor receives an `acceptance` function from the workflow instead of importing the
evaluators). Accept existing violations into the exceptions table with a reason, and let the stale-entry check
ratchet it down.

## 2. One SDK, one module, one canonical format

**Rule.** The vendor LLM SDK is imported in exactly one folder. Everything else uses local type aliases of one
canonical message format and talks to an `LLMProvider` interface.

**Why.** Before the rule, the provider interface existed but its types were aliases of the SDK's beta types and
nothing stopped another module from importing the SDK. Changing SDK version or provider would have touched the loop.
The canonical format chosen is the main provider's **native** format, not a neutral one: a neutral format forces
translation in every provider (including the only real one) and loses features such as preserved thinking, effort
levels, prompt caching and server-side fallbacks. Multi-provider SDKs were rejected for the same loss plus a large
dependency.

**How it's enforced.** An architecture test scans core, integrations and apps for the SDK import outside the LLM
folder. A provider from another model family is an adapter into the canonical format, written from the "add an LLM
provider" extension guide. Providers in the reference project: the real one (tool use, adaptive thinking, effort,
automatic cache control, server-side fallbacks, no forced `tool_choice`), a replay provider, a recording wrapper and
a deterministic mock agent, all speaking the same protocol.

**How to adopt it.** Create `llm/` with `types.ts` (aliases), the provider interface, and the providers. Add the
import test before the second file imports the SDK. Keep model ids per task in a versioned configuration file, not
in code (pattern 13).

## 3. Read-only tools in the loop; everything else is planned and goes through policy

**Rule.** Inside the agent loop the model can call only capabilities whose effect is `read`. Writes exist only as
actions of a validated plan, which the executor runs after policy and approvals. A tenant can tighten approval
levels, never relax them.

**Why.** A model with write tools has no policy, no approvals and no audit trail between its decision and the
effect. Separating "decide" from "do" also makes a failed run safe: if the loop ends without a valid plan, nothing is
executed.

**How it's enforced.**

- The loop exposes only read capabilities as tools, plus three phase tools in a fixed order: `submit_observations` →
  `submit_decisions` → `submit_plan`. Calling a non-read or non-allowed capability returns an error to the model.
  Each phase is parsed with a schema plus business validators, with one retry per phase; a second failure fails the
  run. Out-of-order calls are errors. Caps: 20 iterations, two reminders when the model stops calling tools, tool
  results truncated to 20,000 characters; `refusal` or `max_tokens` fail the run.
- The plan validator checks that every action hangs from an accepted decision, uses an allowed capability, has an
  input that **matches the capability's schema**, and that write actions stay within the activity's `max_actions`.
- **Effective approval level** = the most restrictive of the registry's level and the tenant's autonomy setting,
  ordered `auto < propose < require_approval`. An architecture test checks, for every capability and every
  configuration, that the effective level is never below the registry's. Publishing always requires an approved
  approval; a demo auto-approve flag converts only `propose`, never `require_approval`. Pending approvals expire
  after 14 days and their action becomes rejected.
- **Sensitivity by content.** Some actions must reach the owner whatever the autonomy level (a public reply to a
  one-star review that mentions an employee or a health incident cannot be withdrawn). A `sensitivity` field is
  computed at planning time from the **input data** (the review's rating and conflict markers), never from the text
  the system wants to publish. An `owner_required` action always waits for approval; approval by a `system` actor
  is rejected. The detector is a versioned lexicon; an LLM classifier may only **add** markers.
- **Delegated autonomy, not relaxed policy.** When the owner chooses "announce then do" for a channel, the action
  still creates its approval. The system notifies the owner, opens a veto window in business hours (two by
  default), and only if the notification actually reached the owner's inbox. When the window expires, a scheduled
  job re-checks everything (approval still pending, level still allowed, owner still owner) and approves **as the
  owner, by delegation**, with an explicit reason. Sensitive classes have a `manual` ceiling taken from one shared
  list. Relaxing the tenant's level to `auto` was rejected: it breaks the invariant and forces exceptions inside
  the policy.
- **A conversational assistant executes nothing.** In the chat path, the model has read tools without integrations
  and a `propose_change` tool that only records a proposal; proposals become approvals in the owner's inbox (never
  `auto`) after the same checks that will run at apply time, so the model can rewrite a claim before it is
  proposed.
- **Strategy data only tightens.** A tenant's strategy file (cadence, enabled playbooks) can narrow what the catalog
  allows but never widen it; changing it is itself a proposal that goes through approval.

**How to adopt it.** Give every tool an `effect` in its declaration and filter the loop's tool list by it. Write
`resolveApproval(capability, tenant)` as a `max` over an ordered enum and test it exhaustively. Model "autonomy" as
who approves and when, never as a lower level.

## 4. Every decision cites evidence

**Rule.** A decision is recorded only with at least one evidence ref that resolves to a stored datum.

**Why.** Explainability ("why did the system do this?") and protection against invented data: an LLM can cite a
number that does not exist.

**How it's enforced.** Capabilities record evidence through a **buffered** evidence store: the registry validates the
input, runs the capability, validates the output, and only then commits the evidence; on failure or exception it
discards it. Evidence is deduplicated by a hash of source, type, key and value within the same clock day, and
carries its `source_mode`. The `submit_observations` and `submit_decisions` validators reject unknown refs, and the
decision ledger's `create` rejects them again. Decisions also carry the ids of the goals they serve; if the tenant
has active goals, at least one is required.

**Memory follows the same rule.** Learnings and failures are written only when an experiment closes or an action's
outcome is measured, always with evidence; a writer that accepts free text from the model would fill the context
with opinions and open a prompt-injection path into a file that is read back later. The memory writer normalizes
every Unicode line terminator, forces one-line titles, strips lines that look like headings or metadata, and the
parser requires a strict heading format.

**How to adopt it.** Make evidence a first-class record with an id, and make "record evidence" part of the
capability contract, committed only on valid output. Validate refs in two places: where the model submits, and where
the ledger writes.

## 5. Budget check before spend

**Rule.** Every cost (LLM turn, integration call, content generation) is checked against the budget **before** it
is incurred.

**Why.** Spend without a ceiling is the most expensive failure of an agent: a loop that retries looks like diligence.
An audit of the reference project also found background jobs that spent with no run and no budget at all.

**How it's enforced.** A budget guard per run holds the run cap, the tenant's monthly cap and the month's spend so
far. The loop estimates each request from prompt size and `max_tokens` before calling; the integration runtime calls
`canSpend(estimate)` before any live call and fails with `budget_exceeded`; generation does the same. Actual cost is
recorded afterwards in a cost meter (with child meters per invocation so parallel work is attributed correctly).
Detached jobs that spend run inside a job-run wrapper that opens a run with its own guard. Activities declare
defaults (in the reference project: 5 € and 5 actions per run). An assistant turn has its own small cap, and applying
a proposal has another; a monthly per-tenant cap for the conversational assistant is checked before every turn.

**Cheapest call is the one not made.** If the deterministic analysis leaves nothing actionable (the backlog minus
work already in flight is empty), the run closes as completed with zero cost and no model call. If the owner's
review queue is already full, the run closes without producing more.

**How to adopt it.** One guard type, consulted at every spend site, with estimates; a test per site that a zero
budget blocks the call. Run caps and monthly caps from day one.

## 6. A single write pipeline: snapshot, evaluate, roll back

**Rule.** Every write to a published surface goes through one pipeline: snapshot of the previous version → write →
diff → evaluate → roll back if it fails. Nothing deletes published content.

**Why.** The agent edits real public surfaces. Each change must be versioned, checked and reversible, and must not
introduce false data. Letting each capability validate on its own is inconsistent and easy to forget.

**How it's enforced.**

- An architecture test checks that every capability with a write, draft or publish effect in the website domain uses
  the pipeline function (or its variants for site configuration and translations; social content has its own
  pipeline under the same rule). No capability can delete published pages, and the registry schema forbids a
  production-delete effect.
- Content capabilities only return text; only website capabilities write.
- The evaluator **always blocks** on factuality (prices, percentages, phones, years, certifications, testimonials or
  figures not present in the tenant's facts), brand rules (forbidden phrases, expired offers, vetoed topics,
  entities that may not be named), rendering and valid HTML. Other checks block **only on regression**: a check that
  passed before and fails now. Pre-existing defects never block an improvement. New pages fail on anything except
  the SEO checklist. Checks run on the **added text** only.
- Translations are compared with their original (same multiset of figures, emails and URLs; same heading structure
  and link targets), because the factuality checks are language-specific.
- **External surfaces you do not own** (a business listing behind a third-party API) get the same pipeline plus two
  steps: verify the listing first, and **re-read and compare field by field** after writing. Equal to the request →
  applied. Equal to the snapshot (the platform held the change for review) → `pending_review`, watched for 72 hours,
  then applied or rejected. Different from both → write the snapshot back and fail with the reason. Partial
  updates are merged with the current value, because the API replaces whole blocks.

**How to adopt it.** One function per surface, taking a `produce(current)` callback; capabilities decide content, the
pipeline owns versioning and quality. Start with deterministic checks; the trade-off is a heuristic evaluator with
false positives, which beats an LLM judge on cost and determinism.

## 7. Idempotent external effects and resumable runs

**Rule.** Every capability whose effect leaves the process (publish, build, deploy, buy, send) declares
`external_effect: true` in the registry and wraps the effect in a two-phase idempotency helper keyed by the action
id.

**Why.** Retries and resumes are normal in a queue-driven system. Before the rule, a "Retry" button could publish
the same social post twice, and a paid video generation was ordered several times on retry. Provider-side
idempotency cannot be relied on: not every API offers it.

**How it's enforced.**

- The helper records `started` and `done` (with the result) per key. With `done`, it returns the stored result
  without repeating the effect. With `started` (the process died mid-effect), it reconciles with the real state if
  the capability implements reconciliation, otherwise it fails with `needs_review`: escalate, never repeat.
- When a retry creates a **new** action, the capability fixes its own key from the effect's natural identity (for a
  scheduled post: piece + time) and checkpoints what already exists outside (the created post id) to reconcile.
- Paid asynchronous jobs persist the accepted request id; a retry resumes polling instead of re-ordering, and a
  timeout on an accepted job never fails over to another provider.
- An architecture test checks that publish, build and deploy capabilities declare the flag and, if they produce the
  effect, use the helper.
- **Resumable runs.** A checkpoint artifact is saved after every step and after every action. Decisions are keyed by
  `(run_id, opportunity_id)` and actions by `(run_id, plan_index)`, so repeating the ledger and execute steps creates
  only what is missing. Resuming reopens **the same run** (`failed → running`, attempt + 1, the step it resumed from)
  without calling the model again, and only if a validated plan exists; earlier failures need a new run. Creating a
  new run that points at the old one was rejected because it splits the history.

**How to adopt it.** Add the registry flag and the test first; then the helper with a small key-value store. A
durable workflow engine is not required: what was missing was a resumable run, not an orchestrator.

## 8. Completed = verified

**Rule.** An action that completes without its own evaluation and without acceptance criteria ends with
`evaluation = skipped`, never `pass`.

**Why.** The default evaluator used to return `pass`, so "completed" could not tell checked from unchecked work. When
the rule landed, the verified-success rate dropped: that lower number was the real one.

**How it's enforced.** The plan can declare acceptance criteria per action, chosen from a **catalog of checks with
ids** that is shown to the agent in its constraints and validated in `submit_plan` (unknown or not applicable → error
with retry). After execution the executor runs them; if any fails, the action fails, lists `checks_failed`, and the
page is restored to its previous version. `pass` requires the pipeline's own evaluation or all criteria passing. An
architecture test asserts the default evaluator returns `skipped`. The admin console shows verified versus
unverified actions. A new state such as `completed_unverified` was rejected: the evaluation result already carries
the information.

**How to adopt it.** Make `skipped` the default today, publish the verified rate, and grow the checks catalog. Free-
text criteria judged by an LLM were rejected as non-deterministic; the catalog is where a judge can plug in later.

## 9. Append-only event logs

**Rule.** Decisions, actions, runs, approvals, opportunities, experiments, evidence, memories and metrics are
append-only logs (ledgers). A state change is a new event with the same `id`; the current state is the last event
per id. Every record carries `schema_version`; every new event carries an `actor`, and a `run_id` if it was born in
a run.

**Why.** The system must always answer what it did, why, with which data, what changed, what it cost and what
happened next. Mutable state files lose that. Full event sourcing with projections was judged excessive at the start;
append-only logs migrate one to one into an event store or append-only tables.

**How it's enforced.**

- The ledger interface exposes `append`, `all`, `current`, `get`, `query`, and no update or delete; `append`
  validates with the schema before writing. A test checks the interface and that every ledger schema requires
  `schema_version`, `id`, tenant id and `created_at`.
- Valid transitions are tables per entity (for example, action: `planned → executing | awaiting_approval | rejected |
  failed`; `executing → completed | failed | rolled_back`); an unlisted transition throws.
- In Postgres, a trigger rejects `UPDATE`, `DELETE` and `TRUNCATE` on the events table even for the schema owner,
  and the app role has only `SELECT` and `INSERT`. The current-state view is derived and rebuildable. Tests check the
  migration SQL and run against Postgres with the app role.
- `actor` is `{ type: agent | user | system, id, via: cli | dashboard | chat | scheduler | api }`. It is optional in
  the schema so old events still validate, but every new event sets it; a transition without one keeps the previous
  actor. Capabilities receive it in their context, so they never set it themselves.
- Ids are `<prefix>_<YYYYMMDD>_<NNN>` from a per-tenant, per-prefix, per-day sequence reserved under an exclusive
  lock (a database sequence in Postgres); `create` rejects an existing id. Read-modify-write sequence files produced
  duplicate ids once several processes ran per tenant.
- Every timestamp comes from one clock that can be real or simulated.
- Domain events (a new review, an approved piece) are written to an events ledger, idempotent by type and payload,
  and dispatched later. A crashed worker loses no triggers, the console shows what each event launched, an event
  with no listener is marked `ignored` with its reason, and tests emit events without webhooks.

**How to adopt it.** Start with JSONL files behind a ledger interface; add `schema_version` and `actor` to the base
schema on day one, because back-filling them is painful.

## 10. An agent-blind simulator for evaluation

**Rule.** The agent never sees the model that evaluates it. Simulator seeds, state and world script live in a
storage area that is never part of the tenant's data or the agent's context; the agent sees only the outputs of
ordinary read tools (rankings, metrics).

**Why.** Without real performance data there is no "did it work?" and no learning. A simulator fills the gap, but if
the agent could read the model it would learn to please the model, and the system would "agree with itself".

**How it's enforced.** Only the simulator, the mock integrations that read it and the simulation engine may name the
simulation storage or the world script; an architecture test with an allowlist checks it, and a context test checks
it never reaches the prompt. World events (a new review, a provider outage as a retryable 503) enter through the
**real ingestion path** (sync, webhook), never by writing into the tenant's data or ledgers. Everything derives from
a seed: no `Math.random`, no wall-clock time. Owner profiles (fast, slow, absent, demanding, intermittent) drive
approvals. Pure judges run over ledger snapshots and assert that the system did what it should; the CI demo uses the
same judges. In production the simulator is replaced by real analytics behind the same read operations, without
touching the agent.

**Closing the loop.** When an action completes, a baseline is recorded; after 28 days the outcome is measured
(`improved / neutral / worsened`, threshold ±max(1, 10 %)). A decision with a hypothesis opens an experiment with an
expected value and a window; success or failure writes a learning or failure memory with evidence, which adjusts the
confidence factor of that opportunity type by ±1 per result, bounded at ±2. A cross-tenant effectiveness report is
computed deterministically; with fewer than 5 measurements it says "insufficient sample". The harness improvement
loop **proposes, never modifies itself**: catalog and prompts change only through human review.

**How to adopt it.** Put the evaluation model behind the same interface as the real data source, store its state
where the agent's context builder cannot reach, and write the allowlist test before the first scenario.

## 11. Mock, replay and live modes

**Rule.** Integrations and the LLM share four modes (`live`, `cache`, `replay`, `mock`) resolved in a fixed order,
and every datum records the mode it came from.

**Why.** APIs cost money and need keys; tests and demos must be reproducible and free. Mocks only in tests would
force keys and spend for local development and demos.

**How it's enforced.** Resolution: explicit flag > environment variable > `cache` if credentials exist > `mock`.
`replay` fails on a miss instead of going live. Cache keys are a hash of the operation plus canonical JSON of the
input. Live calls require credentials (`missing_credentials`) and budget, retry rate limits, timeouts and 5xx twice
with exponential backoff, and record cost. Integrations receive their configuration injected; none reads the
environment. Provider fallback moves to the next route on missing credentials, auth errors, replay misses and
transient outages, but **never on a content rejection**, so one provider's safety filter is not routed around with
another. A per-call log records mode, latency, attempts and error type, so a provider that fails over silently stops
being invisible. CI runs with no secrets in mock mode: if a gate needs credentials to pass, the test is wrong.

**How to adopt it.** Build the mode switch into the single integration runtime (pattern 12), add `--record` to turn
real calls into fixtures, and make `source_mode` visible in the UI.

## 12. A capability registry as the source of truth

**Rule.** A registry file lists every capability with name, domain, effect, approval level, backend, whether it is
implemented, and its description. Code that disagrees with the registry does not start. Capabilities reach the
outside world only through the integration gateway.

**Why.** The agent must not call APIs; permissions, cost, caching and interchangeable providers need one point of
control. The original product spec also had inconsistent capability names. A registry in code was rejected because
the catalog could not be validated without compiling.

**How it's enforced.** The registry class rejects implementations missing from the file or with a different domain
or effect, and entries marked implemented without code; unimplemented entries are `unavailable` and the executor
leaves their actions planned. An architecture test repeats the check both ways and requires a description (it
reaches the model as the tool definition). The catalog validator checks that skills, playbooks and activities
reference only registry names. Further tests forbid capabilities from importing the filesystem or the integrations
package, or calling `fetch`; the core package does not depend on integrations, and the dashboards do not use
integrations at runtime (they read through core and launch the CLI for anything that spends).

**Outbound URL safety.** The one integration that fetches third-party URLs (typed by an anonymous visitor) uses a
single safe-fetch: it follows redirects **manually** (at most 5), validates every hop **before** requesting it
(scheme, public hostname, and DNS resolution with rejection if *any* resolved IP is private, loopback, link-local,
CGNAT, multicast, ULA or an IPv4-mapped form), and injects the resolver instead of disabling it by environment
variable. Checking the final URL after following redirects was the original bug.

**How to adopt it.** YAML registry plus a constructor check plus the import tests. Add new data sources as alternate
routes of an existing operation, without new capabilities.

## 13. Global knowledge comes from the code; configuration is separate

**Rule.** The catalog (registry, skills, playbooks, activities, scoring tables) and templates are always read from the
code's root, never from a data copy. Provider configuration (model ids per task, prices, caps) lives in its own
versioned file, outside the catalog. Quality fixtures (benches) live outside both.

**Why.** Each data copy (live copy, demo, test copies) used to carry its own catalog. When code added a capability,
old copies failed on every run with `unknown_capability`; it happened twice in one day, and the sync function that
fixed it worked only if someone remembered to call it. Separately, the catalog fingerprint recorded on each run
changed when a bench case or a font was edited, so comparing runs by fingerprint stopped working, and model ids
lived in three places.

**How it's enforced.** A global-root function resolves catalog and templates (only tests may override it, with a
dedicated variable); the data-root variable covers only tenant data and operational stores. The catalog validator
rejects unknown file types. Each run records the catalog version and, separately, a models-config version, so a diff
between two runs separates "the agent knows something new" from "the model changed".

**How to adopt it.** Two roots from day one: code-global and data. Fingerprint what changes the agent's knowledge and
nothing else.

## 14. Storage behind repositories, with swappable backends

**Rule.** Only the storage module touches persistence (filesystem, database driver, object-store SDK). Everyone else
uses repositories, ledgers, a key-value store and an id generator, all asynchronous. A backend variable selects
`files` or `postgres`.

**Why.** The first version had to be local, human-readable and versionable in git (and readable by coding agents),
while production needed a database, an object store and multiple replicas. Direct file access from every module
would have made the migration a rewrite.

**How it's enforced.**

- Import tests with an explicit allowlist: no `fs` outside storage (two app exceptions with reasons: the preview
  server and the isolated simulation engine), no database driver or object-store SDK outside storage, nobody
  constructs a concrete ledger or store (they ask the repository), nobody reads a ledger file as text, and nobody
  outside storage builds the queue, rate limits or locks for a concrete backend.
- All paths are confined against traversal and written atomically.
- **The ports are asynchronous**, and floating promises are a lint error across the repo; an un-awaited write is no
  longer a silent failure. Sequential async work uses a sequential map, not `Promise.all`, because execution order
  would be non-deterministic in a database. Synchronous ports over Postgres (worker thread with `Atomics.wait`, a
  native driver) were rejected because they block the server's event loop; loading state in memory and flushing at
  the end was rejected because it breaks coordination between replicas. The conversion touched about 200 files and
  was done bottom-up, module by module, integrating daily.
- **The same contract suites run against both backends**; CI starts Postgres and an S3-compatible store in
  containers and compares the demo on both. There is no in-memory backend.
- Coordination without session state in Postgres: long locks as leases with expiry in a table (pids stop being a
  criterion), queue claims with `FOR UPDATE SKIP LOCKED` and partial unique indexes, advisory locks only inside a
  transaction, sequences with `INSERT … ON CONFLICT … RETURNING`, effects and single-use links with conditional
  writes. It works behind a transaction-mode pooler. Migrations are plain SQL, forward-only, checksummed, run as a
  deploy step by an owner role different from the app's role, using expand-and-contract.
- Resource locks per tenant and resource (not per tenant): several resources are taken all or none, in a stable
  order; scheduled runs wait and retry (every 5 s, up to 10 min) while human-launched runs fail fast with a readable
  reason. A job queue with a global concurrency cap, one job per resource, heartbeats and a reaper that marks a job
  failed after 60 s without a heartbeat and closes its side effects; it never retries on its own.

**How to adopt it.** Start with files behind ports; write the contract suite as an exported function that each
backend runs. Make the ports async from the beginning even if the file backend does not need it.

## 15. Destructive operations are versioned, reversible and attributed

**Rule.** No destructive operation on customer data without a saved version. Every change or deletion stores the
previous content and an event with who, when and why. Restoring is a normal write. None of this is visible to, or
callable by, the agent.

**Why.** Customer data must always be reversible and explainable. Pages and the business profile were already
versioned, but the rest of the tenant's files were overwritten or deleted without a copy, and an "Undo" feature
needed to revert any file and say who changed it.

**How it's enforced.**

- Previous content is stored content-addressed (path plus a short SHA-256), deduplicated, with a `file_changes`
  event (`path`, `before_hash`, `after_hash`, `actor`, `run_id`, `reason`). Writing identical content produces
  nothing.
- **Metadata comes from the context, not from callers:** the capability context binds the repository to
  `{ actor, run_id }`, and the executor adds `reason: <capability> · <action_id>`. Capabilities keep calling the
  ordinary write function; neither they nor the model know versioning exists. A write without context is recorded
  as `system/unknown`, which the audit can count.
- Restoring writes the old version with `reason: restore <hash>`. A unified history merges file changes, profile
  changes and page versions. Restore and permanent purge are CLI commands for people; architecture tests forbid the
  agent runtime, capabilities, chat and LLM modules from using them, and allow file deletion only inside the
  repository.
- In Postgres, documents and their versions are written in the same transaction as their history event; binaries go
  to an object store addressed by hash.
- Out of scope by design: ledgers (already append-only), derived files, pages (their pipeline versions them) and
  operational stores. There is no purge yet; growth is bounded by deduplication and measured.

**How to adopt it.** Put versioning inside the repository's write and delete methods, bind metadata in the context
factory, and add the "only the repository deletes" test.

---

## 16. State transitions need compare-and-swap

**Rule.** A state transition on a shared record is one atomic step that says "from this state to that one", never a
read, a check and a write. A budget reservation lives in the store every worker shares, not in a process. Recovery
closes work by the run that owns it, not by a list of job types.

**Why.** An analysis of the reference project (517 test files, none with two concurrent callers) found three shapes of
the same blind spot:

- **Read-check-append on an append-only ledger (section 9).** `approve(id)` read the last event, checked it was
  `awaiting_approval`, then appended `approved`. Nothing was locked, so two reviewers (or a double click, or a retry)
  both passed the check, both appended, and the action's external effect ran twice. Append-only protects the history;
  it does not make the check-then-append atomic. The same shape was in a state machine that read the last event and
  appended the next one.
- **A reservation held in memory.** Budget reservations were kept in a map in the worker process. They died with the
  process (a restart released every hold at once) and two workers each saw the whole budget free, so the tenant
  spent up to twice its cap. The in-process mutex around the map was correct and beside the point.
- **Recovery that enumerates types.** The sweep that closed jobs left running by a dead worker listed the job types
  it knew by name. A type added later was not in the list, so its jobs stayed `running` forever, holding their slot.

**How to enforce it.**

- The ledger port gets a conditional append: `appendIf(id, expectedStatus, event)`. It appends only if the current
  status of `id` is `expectedStatus` and reports whether it did. In SQL that is a single statement,
  `UPDATE … SET status = $new WHERE id = $id AND status = $expected` (or an insert guarded by a unique index on
  `(id, from_status)`), and zero rows affected means somebody else won. A file ledger needs the same guarantee from a
  lock: take the file lock, re-read the current state **inside** it, append, release; the lock lives in the ledger
  method so no caller can forget it. Every transition goes through `appendIf`; the loser gets a typed
  `transition_conflict` and decides (usually: it is already done, return the winner's result).
- Reservations are rows in the shared store (`INSERT … WHERE spent + $amount <= cap`), with an owner run and an
  expiry, so a dead process's holds are visible and releasable and two workers cannot both fit.
- Recovery closes by run: "every job whose run is in `running` with a stale heartbeat", whatever its type. A new job
  type is covered the day it exists. A test registers a type the sweep has never heard of and expects it closed.
- The test for any transition is two callers at once (chapter 04): `Promise.all([approve(id), approve(id)])`, assert
  exactly one wins and exactly one event and one effect exist. It fails on the read-check-append version every time
  the store yields between the read and the write, which is what a test double with an `await` does.

**How to adopt it.** List the transitions of your ledgers (the transition tables of section 9 are the list). Give each
one `appendIf`, then add its two-callers test; the test goes first and is red on the old code. Move any reservation
or counter held in a variable to the shared store. Defect classes `DC-CONC-01`, `DC-CONC-02` and `DC-RUN-06` in
`checklists/defect-classes.md` are the review checklist.

## Cross-cutting lessons

- **Every boundary has a test.** Which invariants transfer as is, and which are domain-specific, is listed in
  [chapter 05](05-architecture-and-docs.md).
- **Prefer code to judgment inside the product.** Analysis, scores, checks, "what happened in this run" summaries
  (computed from artifacts with templates, not generated by an LLM on every visit: free, deterministic, testable)
  and sensitivity detection are deterministic; the model is used where judgment is the product.
- **Team feedback never instructs the runtime directly.** Improvement reports are team memory, read by people and
  turned into bench cases or changes (chapter 15); an architecture test forbids the runtime from importing them.
- **One untrusted inbox for webhooks.** Public webhook endpoints verify the provider's HMAC signature in constant
  time, deduplicate by event id and only store the event; a separate consumer processes it later, with no
  integrations imported at the edge.

## What to copy into your repo

The architecture test pattern (one `describe` per invariant, allowlists with reasons, stale-entry checks), the
capability registry with effect and approval level, the loop with read-only tools and phase tools, the budget guard,
the write pipeline, the two-phase effect helper, the ledger interface with transition tables, the four modes with
`--record`, the storage ports with a contract suite per backend, and the context-bound versioning in the repository.
Write them as invariants in your `docs/architecture.md` (chapter 05) and an extension guide for each kind of piece
(capability, integration, ledger, evaluator check, LLM provider). The workflow tooling that keeps all of this green
is specified in `reference/README.md`.
