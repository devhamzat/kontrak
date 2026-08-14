# Kontrak implementation roadmap

Status: proposed

Each milestone must leave the repository buildable and preserve the last working
user flow. A milestone is complete only when its acceptance criteria are verified.

## M0 — Baseline recovery

Goal: establish trustworthy development and release checks before restructuring.

Completed 2026-08-11. Automated install, check, audit, and build gates pass. The
owner explicitly waived the unpacked Chrome smoke test after the Windows-control
helper could not complete it.

- Complete a clean dependency installation.
- Reproduce and fix current build errors, if any.
- Add test runner, linting, formatting, and type-check scripts.
- Add smoke tests for the existing matcher and response validator.
- Replace automatic releases-on-main with build/test CI; release only from an
  explicit versioned workflow.
- Add a useful root README and development instructions.

Acceptance criteria:

- Clean checkout passes install, type-check, test, lint, and production build.
- The packaged extension loads in Chrome and its existing validation loop works.
- CI performs the same gates and does not publish on an ordinary push.

## M1 — Public monorepo and normalized core

Goal: separate runtime-neutral behavior from Chrome without changing the product
experience.

Completed 2026-08-11. The extension moved to `apps/extension`; runtime-neutral
`@kontrak/core` and versioned `@kontrak/protocol` packages were introduced. The
extension now uses normalized exchanges and per-tab panel routing. Automated
checks and the production extension build pass; the manual smoke criterion was
waived with M0.

- Introduce npm workspaces and package boundaries.
- Define normalized exchange, contract, diagnostic, and validation report types.
- Extract matching and validation orchestration into `packages/core`.
- Introduce a versioned extension-context protocol.
- Adapt the extension to the packages while preserving behavior.

Acceptance criteria:

- Core has no Chrome, DOM, Node, React, or concrete schema-library imports.
- Falsey JSON bodies have regression tests and validate correctly.
- Multiple DevTools sessions are isolated by automated protocol tests.
- Existing manual extension workflow still passes.

## M2 — Plugin SDK and JSON Schema plugin

Goal: prove the plugin architecture by moving all format-specific behavior out of
the core.

Completed 2026-08-11. `@kontrak/plugin-sdk` defines the versioned import and
validation contract plus a runtime-neutral conformance harness. The extension now
uses `@kontrak/plugin-json-schema`; its previous embedded validator and dependency
were removed. The engine reports ambiguity, isolates failures, and bounds
asynchronous plugin execution with cancellation and stable diagnostics.

- Publish SDK interfaces, helpers, diagnostics, and a conformance test harness.
- Implement the official JSON Schema plugin.
- Add explicit pattern syntax and ambiguity diagnostics.
- Validate contract documents at import time.
- Add plugin timeout/cancellation and failure isolation.

Acceptance criteria:

- Removing the JSON Schema plugin leaves the core compiling and functional.
- A fixture-only example plugin passes the conformance suite.
- Invalid contracts and overlapping matches produce actionable diagnostics.
- Supported JSON Schema dialects and limitations are documented and tested.

## M3 — OpenAPI plugin

Goal: make OpenAPI the first full API-description workflow.

Completed 2026-08-12. The official plugin imports OpenAPI 3.0/3.1
JSON or YAML, blocks remote references, resolves guarded local references, matches
templated paths, and validates parameters plus request/response bodies by status
and media type. The extension contract editor and local storage support both
OpenAPI and JSON Schema, including migration of MVP schemas. The extension and
CLI now use the same engine and official plugin implementations, with CLI parity
covered by automated validation tests.

- Import OpenAPI 3.0 and 3.1.
- Match methods and templated paths.
- Validate path/query/header parameters and request bodies.
- Select and validate responses by exact/range/default status and media type.
- Resolve local references with cycle and depth protection.
- Produce contract source locations in diagnostics.

Acceptance criteria:

- Official fixtures cover parameters, request bodies, status selection, content
  types, local `$ref`, cycles, malformed documents, and ambiguous operations.
- Extension and CLI return equivalent normalized results for the same fixtures.
- Remote references are never fetched unless a future explicit policy enables it.

## M4 — Polished local-first extension

Goal: deliver a valuable standalone product before requiring cloud accounts.

Completed 2026-08-12. The extension supports OpenAPI/JSON Schema onboarding,
format-tagged storage and MVP migration, unmatched requests, summaries, search,
filters, expandable sanitized request/response inspection, detailed diagnostics,
deletion undo, bounded session retention, one-million-character body limits, and
binary/unavailable-body states. Common credential headers are removed before the
capture enters the validation model, broad host permissions were removed, and the
contract editor is lazy-loaded. The owner waived interactive Chrome smoke testing;
automated checks and the production extension build pass.

- Add onboarding and OpenAPI/JSON Schema import.
- Add session summary, search, filters, unmatched requests, match explanation,
  request/response inspector, and detailed diagnostics.
- Add accessible loading, empty, error, confirmation, and undo states.
- Add per-session retention, payload size limits, and local redaction controls.
- Audit and minimize extension permissions.
- Add extension integration tests and a repeatable Chrome smoke-test checklist.

Acceptance criteria:

- A new user can import an example contract and see a first validation without
  external documentation.
- Raw bodies never leave the local extension in default operation.
- Large/binary/unavailable bodies degrade safely with clear diagnostics.
- Keyboard navigation and accessible names cover primary flows.

## M5 — CLI and GitHub Actions

Goal: apply the identical engine in local scripts and CI.

Completed 2026-08-12. `@kontrak/cli` provides contract import, recording
validation, and plugin-owned contract diffing with stable success, violation, and
usage/system exit codes. Human, JSON, and SARIF output are supported. The
versioned recording package removes credential headers by default, records
redaction metadata, and supports configured JSON-key redaction. Runnable CLI and
GitHub Actions examples are included; the built executable was verified on
Windows in addition to automated tests covering portable command behavior.

- Add contract import/validation commands and stable exit codes.
- Define a versioned recording format with redaction rules.
- Add human, JSON, and CI-friendly report output.
- Add contract-diff capability with format-plugin participation.
- Publish a GitHub Actions example/action wrapper around the CLI.

Acceptance criteria:

- CLI and extension pass shared conformance fixtures.
- CI can fail on violations and attach a useful report without uploading bodies.
- Commands are documented on Windows, macOS, and Linux.

## M6 — SaaS boundary and privacy-safe sync

Goal: introduce paid collaboration without weakening the local-first promise.

Repository/license boundary approved 2026-08-11. Product defaults approved
2026-08-12: Clerk identity, Supabase Postgres in the EU, Bachs billing, Free/Pro/
Team plans, and sanitized-report retention of 30/90/365 days respectively. The
public privacy-safe sync package is in progress; creation of the separate private
cloud repository remains outside this public workspace.

- Create the private cloud repository after boundary approval.
- Implement authentication, workspaces, projects, membership, contract metadata,
  contract versions, API keys, and sanitized validation sessions.
- Implement a versioned sync client in the public repository.
- Add authorization, tenancy, audit, and privacy tests.
- Add extension/CLI connection flows that remain optional.

Acceptance criteria:

- Local use requires no account.
- The normal sync schema cannot represent a raw body or secret header.
- Cross-workspace access tests cover every tenant-owned resource.
- Disconnecting cloud leaves local contracts and validation operational.

## M7 — Individual and small-team commercial release

Goal: make cloud collaboration purchasable and understandable.

- Add Free, Pro, and Team entitlements with centralized checks.
- Add checkout, billing portal, usage accounting, and plan-change handling.
- Add invitations, roles, shared reports, contract history, and onboarding.
- Publish privacy, security, licensing, support, and contribution documentation.
- Complete end-to-end release, rollback, and recovery exercises.

Acceptance criteria:

- Individual and team purchase/onboarding paths pass end-to-end tests.
- Billing-provider outages do not break local validation.
- Public packages and private SaaS artifacts have unambiguous licenses.
- Release checklist has no unresolved security, privacy, or data-loss blocker.

## Deferred formats

After M3 proves the SDK, prioritize additional plugins from user evidence. Likely
candidates are GraphQL, AsyncAPI, Protobuf/gRPC, Zod, Valibot, and TypeBox. Their
presence is not required for the initial release; SDK stability and two genuinely
different initial plugins are required first.
