# 19 · Architecture styles, agent patterns and multi-agent systems

**Rule:** the agent is not the architecture. The model is one more adapter behind a port; the core is deterministic
software and the model only proposes. Choose the architecture style per piece, the agent pattern per need, and the
least autonomy that does the job.

Chapter 17 describes one agent product from the inside (kernel, read-only loop, policy, write pipeline, ledgers).
This chapter answers the questions that come before and around it: which architecture style each piece of the
system should follow, which agent pattern fits which need, how several agents talk without losing the safety of a
single loop, how judges and autonomy levels are made trustworthy, and how the product is packaged and its data
protected. The patterns come from a second agent platform built on this protocol (several tenants, many agents per
tenant, Python core) and are written generically.

---

## 1. Pick the architecture style per piece, not per product

**Rule.** Every piece of the system names its style. Styles are not competitors: a modular monolith whose packages
are hexagonal, whose runtime is a persistent state machine and whose modules talk through events is one coherent
design.

| Style | Idea | Use it when |
| --- | --- | --- |
| Layered (n-tier) | Presentation → business → data | Simple CRUD with few external integrations |
| Hexagonal (ports and adapters) | A core without I/O; the outside (database, APIs, LLM) enters through ports with swappable adapters | Many external integrations that change or must be faked in tests |
| Clean / onion | Hexagonal plus explicit use cases and entities at the centre; dependencies point inwards | Rich business rules that must survive technical changes |
| Modular monolith | One deployable, modules with checked boundaries | A small team and a domain still being discovered |
| Microservices | One service per capability, deployed separately | Independent teams and very different scaling per part; expensive to operate |
| Event-driven | Modules notify each other with events, not calls | Long, asynchronous, decoupled flows |
| CQRS / event sourcing | Separate write and read models, or state as a history of events | Strong audit needs and read views that differ from the write model |
| Saga / process manager / durable execution | A persistent state machine coordinates steps with deadlines and compensations | Processes that last days or weeks and must not lose state |
| Microkernel (plugins) | A small core plus extensions loaded through a contract | Third parties or other teams extend the product |

**How it maps onto an agent product.**

| Piece | Style |
| --- | --- |
| Each package or module | Hexagonal / clean: `domain` (no I/O) ← `ports` ← `application` ← `adapters`. The LLM, the database, the connectors and the plugins are adapters |
| The whole system | Modular monolith with numbered levels that only import downwards (contracts → primitives → configuration → platform → capabilities → authority → orchestration → composition). One deployment per tenant or per environment; no microservice per agent |
| The agent runtime | Persistent state machine (durable execution) with checkpoints. The model is a node, never the controller of the flow |
| The decision point | One component outside the model that recomputes, permits and executes (§5) |
| Checks and confidence | Rules as data (§5) |
| Communication between modules and agents | Event-driven: transactional outbox, versioned contracts, atomic consumption (§6) |
| Known long processes | Saga / process manager with deadlines and compensations (§4) |
| Published read views | Light CQRS: reads never touch the write model |
| Effects and traces | Append-only ledgers (chapter 17 §9) |
| Plugins and external repos | Microkernel: out-of-process adapters through MCP; A2A only at the boundary (§7) |

**Why.** Picking one style for the whole product forces bad fits: microservices per agent multiply operations for a
small team; a plain layered app has nowhere to put the model except in the middle of the business logic.

**How it's enforced.** The level map and the hexagonal layers are import contracts (import-linter in Python,
dependency-cruiser or the architecture test of chapter 04 in TypeScript). The core may not name any tenant or
customer: a test greps the core packages for tenant names and fails.

**How to adopt it.** Write the style table above into `docs/architecture.md` with your own pieces, add the import
contracts before the second package exists, and record any deviation as an ADR.

## 2. The model is an adapter: SOLID applied to agents

**Rule.** The domain never imports an LLM SDK, a database driver or the clock. It depends on small ports; only the
composition root (`apps/*/main`) knows the concrete adapters.

```python
class RegisterEffect: ...                                          # S: one use case per command
WRITES = frozenset(a for a, v in ACTIONS.items() if v.write)       # O: the catalog is data; adding an action edits data
@pytest.mark.parametrize("ledger", [InMemoryLedger(), PgLedger(pool)])  # L: one contract suite, every adapter
class Clock(Protocol):                                             # I: small ports
    def now(self) -> datetime: ...
# D: application depends on the Protocol; only apps/*/main.py builds PgLedger
```

**Why.** Swapping the provider, replaying a run, or testing without keys (chapter 17 §11) is only cheap when the
model sits behind a port like any other dependency.

**How it's enforced.** The domain layer bans `datetime.now`, `uuid4`, `random` and environment reads (Ruff
`banned-api` or an AST test); the contract suite runs against every adapter (chapter 17 §14). Tactical DDD: one
aggregate per transaction, references between aggregates by id, append-only states, domain events to the outbox,
nothing external while a transaction is open. Errors are typed (`DomainError` with a catalog code) and mapped once to
RFC 9457 problem details: 400 for syntax, 422 for validation.

## 3. Least autonomy: the pattern ladder

**Rule.** Use the lowest rung that solves the problem: rule → one augmented call → fixed chain → routing →
parallelization → orchestrator-workers → evaluator-optimizer → autonomous agent → multi-agent. Climbing a rung needs
a reason written in the agent's declaration (`why_not_process`) and an ablation against the rung below on the golden
set.

| Need | Pattern |
| --- | --- |
| Classify, extract or draft with data | One augmented call as a `worker`, with declarative checks |
| A known process with deadlines or irreversible effects | A process (state machine, §4); agents only at the judgment steps |
| Several kinds of case | Routing by rules in data, not an LLM deciding alone |
| Subtasks unknown in advance | An `orchestrator` limited to queries and task requests, with no effects of its own |
| Review the quality of an agent's work | A `judge` from another provider as a signal (§8) |
| Collaborate with another organization's agent | A2A at the gateway, with a low ceiling (§7) |

**Roles only restrict.** `worker` proposes; `orchestrator` coordinates (query and task request only, no effects);
`judge` only reads. There are no supervisor agents with authority.

**Rejected, on purpose.**

- Supervisor agents with authority: published failure taxonomies of multi-agent systems (MAST) attribute most
  failures to poor specification, coordination and missing verification; adding verification helps more than tuning
  roles.
- Agents that talk freely to each other: only the four typed interactions of §6.
- The LLM as the controller of the flow: the flow belongs to the runtime.
- Personas in the prompt as a quality lever, and filtering the tool list as a security control (a filtered list is
  convenience; permission lives in the decision point).

**Why.** Each rung adds cost (an orchestrated multi-agent run can spend an order of magnitude more tokens than a
single agent) and new failure modes. The rung below is cheaper, deterministic and testable.

## 4. Known processes are state machines, not orchestrators

**Rule.** A process whose steps are known (an onboarding, a claim, a legal deadline) is declared as a process: states,
transitions, deadlines and compensations, persisted. Agents run only at the steps that need judgment.

**Why.** An orchestrator agent re-derives a known flow every run, can skip a legal step, and loses its place when the
process lasts weeks. A persistent state machine survives restarts, enforces deadlines with the clock, and is
auditable step by step.

**How it's enforced.** A process declaration (`kind: Process`) is validated like any other catalog entry; every
transition goes through compare-and-swap (chapter 17 §16); deadlines are timers emitted by the single scheduler;
every step that leaves the process has a compensation or is marked irreversible and needs approval.

## 5. One decision point outside the model; checks as data

**Rule.** The model proposes; one component outside the model decides. It recomputes everything that matters
(checks, confidence, band, permissions, approvals) from the proposal and the data, executes, and records the effect.
It never calls the model.

**Why.** A model under prompt injection, or simply wrong, can claim a permissive band. If the decision point trusts
the proposal, the barrier is only as strong as the prompt. A single external barrier with provenance on every call
(the idea behind CaMeL-style designs) holds whatever the model says.

**How it's enforced.**

- Fixed order in the decision point: restrictions → capability → policy → level and band → approvals → effect
  ledger → signed execution assertion → verify (an effect that cannot be verified ends `unverified`) → outbox.
- The model's own estimate weighs at most a fixed fraction (for example 0.3) of the confidence; if the band the
  worker sent is more permissive than the recomputed one, the action is flagged `proposal_unverified`.
- Checks and confidence are declarative: JMESPath to select fields and CEL to evaluate conditions, stored as data
  next to the agent's declaration. No third-party code runs inside the decision point, and every check has an id in a
  catalog (chapter 17 §8).
- The process split makes it physical: a runner creates the run, a worker calls the model with no credentials and
  only proposes, the decision point executes and never calls the model, and one scheduler emits the clock.

## 6. Agent-to-agent communication: four interactions, two keys

**Rule.** Inside the system, agents talk only through four typed interactions, and each needs two keys: the sender
must be allowed to send it (`talksTo`) and the receiver must accept it (`accepts`).

| Interaction | Carries | Effect |
| --- | --- | --- |
| `query` | A versioned read view | None |
| `task_request` | A command without effects | The receiver plans; its own decision point decides |
| `delegated_effect` | A command plus an explicit delegation grant | Executed with the sender's authority, never more |
| `subscribe` | A versioned event | None until the subscriber acts through its own flow |

**How it's enforced.**

- Contracts are named `<pack>.<name>@vN` (event, command or view). No imports and no SQL views across packs.
- Events go through a transactional outbox (same transaction as the state change, validated before commit) in a
  CloudEvents 1.0 envelope; consumption is atomic with a `consumed_event` record and ordered per business key.
- **The output of another agent is untrusted data:** validated with a strict schema (`extra="forbid"` in Pydantic)
  and never treated as instructions.
- **Least authority of the chain:** a receiver acts with the minimum authority along the chain, scoped to what the
  original sender could do. Chains have a maximum depth (3) and a cost cap per chain.
- An architecture test fails if an agent calls another agent's code directly.

## 7. MCP for tools, A2A only at the boundary

**Rule.** Tools and plugins are reached through MCP; other organizations' agents through A2A, and only at the edge.
A2A is never the internal bus.

**Why.** Using A2A internally would duplicate the event bus and the decision point, open a second state machine,
and bypass the effect ledger.

**How it's enforced.**

- MCP: stateless calls; each tool definition is pinned by a hash, and a changed definition is a new version that
  goes through review; `tools/call` is never retried automatically (it may not be idempotent; chapter 17 §7 handles
  retries).
- A2A: its own audience on tokens (for example `aud=<system>:a2a`), an autonomy ceiling for anything arriving from
  outside (proposals only, or one level above for an affiliated party), and an Agent Card **generated from the policy
  and signed**, never hand-written. A remote agent is never registered by reading its own card: registration is a
  human decision with a pinned identity.
- An architecture test forbids importing the A2A client outside the gateway module.

## 8. Judges you can trust

**Rule.** An LLM judge is a signal, not a verdict. It counts towards promoting an agent only if it uses a model from
**another provider** than the agent, and only after it agrees with blind human labels: Cohen's κ ≥ 0.7 and recall on
negatives ≥ 0.8 over at least 100 labels. Without a second provider, only the human audit counts.

**Why.** A judge from the same model family shares the agent's blind spots and tends to approve its style. Recall on
negatives matters more than accuracy: a judge that misses bad outputs is worse than no judge.

**How it's enforced.**

- Nobody judges who gains from the promotion: not the agent's owner, not the recent authors of its pack.
- A random blind audit samples decisions with the band hidden; seeded canaries (at least one per approver per week,
  announced to the people as a practice) measure whether approvers actually read.
- Two kinds of judge are kept apart: judges of agent behavior (probabilistic, at run time) and validation of code
  changes (deterministic: the gate, scenario-to-test traceability, an independent reviewer with a closed brief).

## 9. Autonomy is earned per agent and task, and launching is not promoting

**Rule.** Autonomy levels L0–L3 apply per (agent, task). Every agent starts at L0 and moves up only through the blind
audit, by decision of a person other than its owner. Money and legal tasks have a ceiling of L1. Silence never
promotes.

**The launch gate.** Every change to an agent's footprint (prompt, tools, model, checks, data) creates a new version
that passes: schema validation → golden set → cross-provider judge → red teaming → human approval. Launching a
version does not raise its level.

**How it's enforced.** Model ids are full ids (`claude-sonnet-5-5`), never aliases; changing the model re-runs the
golden set. The level is part of the decision point's input, so a version at L0 cannot execute on its own whatever
the prompt says.

## 10. Container images in layers

**Rule.** One image per deployable, built in stages, ordered for cache, small and unprivileged.

**How it's enforced.**

- Multi-stage: a `build` stage with toolchain and dependencies, a minimal `runtime` stage.
- Layer order: copy the lockfile, install dependencies without the project (`uv sync --frozen --no-dev
  --no-install-project` or `npm ci`), then copy the code and install the project. A code change never invalidates
  the dependency layer. Use BuildKit cache mounts for the package manager cache.
- Base image pinned by digest (`python:3.13-slim@sha256:…`); a hardened or distroless `nonroot` base in runtime when
  possible (no shell, no package manager).
- Non-root user with a numeric UID; read-only root filesystem with `tmpfs /tmp`; `cap_drop: [ALL]`;
  `no-new-privileges`.
- No secrets in layers, `ARG` or `ENV`; what the build needs enters with `RUN --mount=type=secret`. `.dockerignore`
  excludes `.env*`, `.git`, docs and tests (chapter 10 already checks for `.env` in the image).
- `HEALTHCHECK` against a liveness endpoint, never against readiness. One image can run several processes (runner,
  worker, decision point, scheduler) by command; deploy by digest, never rebuild per environment.

## 11. Data protection: envelope encryption, purpose keys, pseudonyms

**Rule.** Personal data is encrypted in the application, per field, with envelope encryption; keys are separated by
purpose; identifiers leave the system only as keyed pseudonyms.

**How it's enforced.**

- **Envelope encryption.** A key-encryption key (KEK) per purpose lives in a KMS or key ring; it wraps a data key
  (DEK) per data subject and version. AES-256-GCM with a random 96-bit nonce and associated data
  (`subject_id`, `field`, `key_version`). With random nonces, rotate a DEK before 2³² encryptions (NIST SP 800-38D).
  Cache DEKs only in memory, for minutes or a bounded number of uses, never on disk or in logs.
- **One KEK per purpose** with its own policy (destroy by epoch, rotate and keep until retention ends, rotate with
  dual verification) and cryptoperiod (NIST SP 800-57). Each process receives only the purposes it uses. The ciphertext
  carries the key version, so rotation does not require rewriting everything at once.
- **Erasure by crypto-shredding:** destroying a subject's DEKs makes their data unreadable everywhere, including
  backups; record `destroyed_at` in the same transaction.
- **Pseudonyms with HMAC:** business keys and identifiers are exported as HMAC-SHA256 with a versioned key
  (`<name>/e<n>`); lookups try every live version. Request hashes and idempotency keys use HMAC too. Caller tokens are
  stored as HMAC with a pepper and compared in constant time.
- **Not `pgcrypto` for personal data:** the key would travel in the query and in server logs. Encrypt in the
  application.
- **In transit:** TLS 1.2+ everywhere; database connections with `sslmode=verify-full` and the platform CA, and the
  app refuses to start outside local development without it. **At rest:** encrypted volumes and object storage with
  a customer-managed key. Fields that carry no personal data do not need field encryption: the volume is enough, and
  more KMS calls do not reduce the risk.
- Startup fails if the environment is not set, if the key ring is not the declared one, or if a local key ring is
  used in production.

---

## What to copy into your repo

The style table in `docs/architecture.md` with your own pieces, the import contracts for levels and hexagonal
layers, the tenant-name test on the core, the pattern ladder with `why_not_process` in each agent declaration, the
process declaration for known flows, the decision point with its fixed order and declarative checks, the four
two-key interactions with the outbox, the MCP pinning and the A2A gateway test, the judge agreement thresholds and
the launch gate, the layered Dockerfile, and the envelope encryption with purpose keys and HMAC pseudonyms.
