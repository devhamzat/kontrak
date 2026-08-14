# Kontrak target architecture

Status: approved 2026-08-11

## Product constraints

- Development and CI only; no production monitoring.
- Local-first validation. Raw request and response bodies remain on the user's
  device by default.
- Contract formats are plugins. OpenAPI and JSON Schema are the first official
  plugins, not special cases embedded in applications.
- The extension, CLI, core, SDK, and official plugins form the open-source core.
- Hosted collaboration is proprietary and consumes only stable public packages
  and a privacy-safe synchronization protocol.
- Individuals must be able to use the extension and CLI without an account.

## Recommended repository boundary

The recommended long-term boundary is two repositories:

1. **`kontrak` (public, Apache-2.0):** extension, CLI, core, plugin SDK, official
   plugins, protocol types, fixtures, documentation, and examples.
2. **`kontrak-cloud` (private):** web application, database, authentication,
   billing, hosted reports, team administration, and deployment configuration.

The private repository depends on published packages from the public repository.
It must not import source files through relative paths. This keeps the license and
security boundary reviewable and lets local tooling remain useful without cloud
code. Until the private repository exists, cloud API shapes can be designed in a
public `protocol` package without implementing proprietary services here.

The owner approved this boundary on 2026-08-11. Public-core work proceeds in this
repository; proprietary SaaS code will be created separately when that milestone
begins.

## Proposed public monorepo

```text
apps/
  extension/              Chrome DevTools extension
  playground/             local demo and plugin-development harness
packages/
  core/                    runtime-independent orchestration and normalized model
  plugin-sdk/              public plugin types, helpers, compatibility contract
  plugin-json-schema/      official raw JSON Schema importer/validator
  plugin-openapi/          official OpenAPI importer/matcher/validator
  protocol/                versioned local and privacy-safe cloud message types
  sync/                    cloud-safe DTOs, runtime guard, and transport client
  cli/                     `kontrak` executable and report formatters
examples/
  openapi/
  json-schema/
  custom-plugin/
docs/
```

Use npm workspaces initially. Add task orchestration only when build volume proves
it necessary. Avoid a framework-specific core.

## Layering

### Normalized capture model

The core receives an immutable, runtime-neutral exchange:

- stable local session and exchange identifiers;
- method and parsed URL;
- status code;
- media type and a typed body representation (`json`, `text`, `binary`, `empty`,
  or `unavailable`);
- sanitized metadata needed for matching;
- optional raw request/response values held only by the local caller.

Opaque secrets and browser-specific request objects never enter shared reports.
The model must distinguish missing, empty, `null`, and falsey JSON values.

### Plugin SDK

A plugin is an explicit object loaded by trusted application code. Version one
does not execute remotely downloaded JavaScript. Community plugins are installed
as normal packages and run with the permissions of the CLI or extension bundle.

Conceptual interface:

```ts
interface ContractPlugin<TSource = unknown, TCompiled = unknown> {
  readonly manifest: PluginManifest;
  canImport(input: ContractInput): Promise<Confidence>;
  import(
    input: ContractInput,
    context: ImportContext,
  ): Promise<ImportResult<TCompiled>>;
  match(exchange: ExchangeSummary, contract: TCompiled): Promise<MatchResult>;
  validate(exchange: LocalExchange, match: Match): Promise<ValidationResult>;
}
```

The final type design must include:

- SDK compatibility version and plugin identity;
- deterministic import and match diagnostics;
- request and response validation phases;
- multiple candidates and explicit ambiguity handling;
- cancellation and execution budgets;
- stable diagnostic codes plus human-readable messages;
- source locations for contract errors;
- serializable compiled metadata when a plugin supports it;
- no application UI types or Chrome types.

### Core engine

The core owns plugin registration, import orchestration, candidate ranking,
validation execution, normalized diagnostics, redaction boundaries, and report
creation. It does not parse OpenAPI or JSON Schema directly and has no filesystem,
network, browser, database, or React dependency.

### Official plugins

`plugin-json-schema` validates explicitly mapped bodies against supported JSON
Schema dialects and reports the dialect. It must not silently reinterpret invalid
patterns or unsupported keywords.

`plugin-openapi` imports OpenAPI 3.0 and 3.1 documents, resolves local references,
matches operations by method and templated path, selects request/response schemas
by media type and status, and delegates schema evaluation through a documented
adapter. Remote references are disabled by default.

### Extension

The extension owns Chrome capture, session isolation, size limits, local contract
storage, local validation, and rendering. Each inspected tab gets an independent
session. A versioned protocol connects DevTools, service worker, and panel.

The preferred flow performs cheap metadata matching before transferring a body.
Where Chrome API constraints require body reading in the DevTools page, the body
must remain there or move only to a session-specific local validation context.
Cloud sync receives a `SanitizedValidationReport`, a different type that cannot
contain raw body or secret-header fields.

### CLI

The CLI owns filesystem/stdin adapters, configuration discovery, exit codes, and
human/JSON/SARIF-style output. It invokes the same core and plugins as the
extension. CI is a documented invocation of the CLI, not a separate validator.

### Cloud boundary

The hosted product accepts contract metadata, versions, memberships, projects,
and sanitized validation reports. Raw body upload is not part of the default API.
If an explicit payload-sharing feature is ever considered, it requires a separate
product/security decision, consent flow, encryption design, and retention policy.

## Initial technical decisions

| Decision                             | Status   | Rationale                                                       |
| ------------------------------------ | -------- | --------------------------------------------------------------- |
| TypeScript across public packages    | Accepted | Matches the MVP and browser/Node targets.                       |
| npm workspaces                       | Accepted | Minimal migration cost and no extra orchestrator initially.     |
| Runtime-independent core             | Accepted | Required for extension and CLI parity.                          |
| Trusted package plugins only in v1   | Accepted | A sandboxed third-party runtime is a separate security product. |
| Local `$ref` only by default         | Accepted | Prevents hidden network access and non-reproducible CI.         |
| Separate public/private repositories | Accepted | Keeps the open-core license and security boundary explicit.     |
| Apache-2.0 for public core           | Accepted | Permissive adoption with explicit patent terms.                 |
| Clerk for cloud identity             | Accepted | Managed authentication for individual and team accounts.        |
| Supabase Postgres in the EU          | Accepted | Relational tenancy model with EU data residency.                |
| Bachs for billing and payments       | Accepted | SaaS billing behind a provider-neutral entitlement boundary.    |

## Approved cloud defaults

- Plans: Free, Pro for individuals, and Team.
- Sanitized validation retention: 30 days on Free, 90 days on Pro, and one year
  on Team.
- Raw request/response bodies and secret headers are not representable in the
  normal synchronization protocol.
- Billing code in the private application will depend on a Kontrak-owned billing
  interface. The first adapter targets Bachs, preventing provider-specific
  objects from becoming entitlement or tenancy state.

## Quality attributes

- **Privacy:** impossible-by-type normal sync path for raw payloads.
- **Determinism:** the same fixture, contract, plugin versions, and configuration
  produce the same diagnostics in the extension and CLI.
- **Extensibility:** adding a contract format does not change core or application
  matching/validation logic.
- **Resilience:** one plugin failure becomes a scoped diagnostic, not an app crash.
- **Performance:** bounded payloads and cancellation; validation remains responsive.
- **Compatibility:** SDK and report schemas are explicitly versioned.
- **Testability:** conformance fixtures test every official and community plugin.

## Explicit non-goals for the first release

- Production traffic agents, gateways, or monitoring.
- Arbitrary remote plugin execution.
- Remote reference fetching by default.
- Uploading raw payloads by default.
- GraphQL, AsyncAPI, Protobuf, or gRPC before the SDK is proven by both initial
  plugins.
- Enterprise SSO, on-premise deployment, or complex organization policy.
