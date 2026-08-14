# Kontrak

Kontrak is evolving into a local-first, pluggable API contract validation toolkit
for individual developers and small teams. It currently exists as an early Chrome
DevTools extension that validates captured JSON responses against locally stored
JSON Schemas.

The intended open-source core will include the browser extension, CLI, validation
engine, plugin SDK, and official OpenAPI and JSON Schema plugins. A separable
hosted product will add collaboration and privacy-safe validation history. Kontrak
is for development and CI; production monitoring is explicitly out of scope.

## Current status

The public local-first product is now usable from both Chrome DevTools and the
command line. The polished extension can store and validate OpenAPI or JSON
Schema contracts locally, inspect sanitized captures, and filter validation
sessions. The CLI imports contracts, validates versioned redacted recordings,
diffs contracts, and emits human, JSON, or SARIF reports for CI. The next product
milestone is the optional privacy-safe SaaS boundary.

- [MVP audit](docs/AUDIT.md)
- [Proposed architecture](docs/ARCHITECTURE.md)
- [Implementation roadmap](docs/ROADMAP.md)
- [Installation guide](docs/INSTALLATION.md)

## Existing MVP

The extension currently:

- creates a Kontrak panel in Chrome DevTools;
- captures completed network responses;
- matches responses by HTTP method and URL pattern;
- validates JSON response bodies against JSON Schema; and
- stores configured schemas in `chrome.storage.local`.

## Workspace structure

```text
apps/extension/       Chrome DevTools extension
packages/core/        Runtime-neutral capture model and validation orchestration
packages/plugin-sdk/  Versioned plugin contract, helpers, and conformance harness
packages/plugin-json-schema/  Official JSON Schema plugin
packages/plugin-openapi/  Official OpenAPI 3.0/3.1 JSON/YAML plugin
packages/protocol/    Versioned extension-context message protocol
packages/recording/   Versioned portable traffic recordings and redaction
packages/cli/         Contract import, validation, diff, and CI reports
packages/sync/        Privacy-safe cloud DTOs, guard, and transport client
examples/cli/         Runnable contract, configuration, and recording examples
examples/github-actions/  CI integration example
docs/                 Audit, architecture, and milestone roadmap
```

The extension and CLI consume the same official format plugins and validation
engine. `@kontrak/core` has no schema-library or application-runtime dependency.

## Development

The existing application uses Node.js 20.19+ (Node.js 24 is used in CI), npm,
TypeScript, React, and Vite.

```sh
npm ci
npm run check
npm run build
```

Useful individual commands are `npm run typecheck`, `npm test`, `npm run lint`,
and `npm run format:check`. The `check` command runs all four quality gates used
by CI.

The CLI is the primary distribution channel. The extension is available as a
GitHub Release ZIP and can be loaded manually in Chrome developer mode. See the
[installation guide](docs/INSTALLATION.md) for both paths.

Build and try the CLI with:

```sh
npm run build --workspace @kontrak/cli
node packages/cli/dist/cli.cjs import examples/cli/openapi.yaml
node packages/cli/dist/cli.cjs validate examples/cli/traffic.json --config examples/cli/kontrak.config.json
node packages/cli/dist/cli.cjs diff old-openapi.yaml new-openapi.yaml --format openapi
```

The same commands work in PowerShell, Command Prompt, and POSIX shells. See the
[CLI guide](packages/cli/README.md) for output modes and exit-code semantics.

## Privacy direction

Validation is local by default. Raw request and response bodies must remain on the
developer's machine unless a separate, explicit payload-sharing feature is ever
designed and approved. Normal cloud synchronization will contain sanitized
validation results only.

## License

The public core is licensed under Apache-2.0. The hosted Kontrak Cloud application
will live in a separate private repository and remain proprietary.
