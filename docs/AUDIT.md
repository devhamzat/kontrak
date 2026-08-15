# Kontrak MVP audit

Status: completed 2026-08-11

## Executive summary

Kontrak is a small Chrome Manifest V3 DevTools extension that captures completed
network requests, matches each request against a user-configured URL and method,
and validates the response body with the `jsonschema` package. The result is sent
to a React DevTools panel. Contracts are stored in `chrome.storage.local`.

The current implementation proves the interaction loop, but it is not yet a safe
foundation for the intended product. Chrome APIs, contract matching, JSON Schema
validation, persistence, and UI message types are coupled together. There is no
request validation, OpenAPI support, plugin boundary, CLI, test suite, or useful
documentation.

No production monitoring exists, and none is proposed.

## Current data flow

1. `src/devtools.ts` creates the Kontrak panel and registers a network listener.
2. `src/core/network.ts` reads each completed response body and sends the full
   captured value to the extension service worker.
3. `src/background.ts` loads schemas, chooses the first match, validates the
   response, and forwards matched results to one connected panel.
4. `src/panel/App.tsx` keeps up to 100 results in React memory and manages raw
   JSON Schema documents stored in `chrome.storage.local`.

Raw payloads do not leave the extension, but they cross extension contexts. They
are not persisted and are lost when the panel closes.

## What already works

- Manifest V3 DevTools extension scaffold.
- Capture of response URL, method, status, body, and timestamp.
- Method and URL-pattern matching.
- JSON Schema response validation.
- Local schema create, edit, delete, and persistence.
- Basic pass/fail result list and validation messages.
- Vite/TypeScript production build configuration.
- Automated extension packaging workflow.

## Correctness defects

| Severity | Finding | Evidence and impact |
| -------- | ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- | --- | ---------------------------------------------------------------------------------------- |
| High | Valid JSON falsey values are corrupted | `parsedBody                                                                                                                     |     | body`replaces valid`false`, `0`, empty string, and `null` values with the original text. |
| High | Only one panel connection is supported | A single global `panelPort` is overwritten by the latest DevTools window, so results can be routed to the wrong window or lost. |
| High | Captures are not scoped to a tab or session | Messages carry no inspected tab/session identity. Multiple DevTools instances cannot be isolated. |
| Medium | Response decoding metadata is ignored | `getContent` can report encoded content, but the callback only accepts the body. Binary/non-JSON content is treated as text. |
| Medium | The first matching schema silently wins | Overlapping patterns have no precedence, ambiguity diagnostic, or deterministic specificity rule beyond array order. |
| Medium | Invalid regex changes matching semantics | A malformed regex silently falls back to substring matching, hiding configuration errors. |
| Medium | Schema persistence errors are swallowed | Storage operations never inspect `chrome.runtime.lastError`, so quota and write failures appear successful. |
| Medium | Schema validity is not checked at save time | The UI checks only that the document is JSON; invalid or unsupported JSON Schemas are accepted. |
| Low | Empty response handling is ambiguous | Empty bodies become an empty string, while JSON `null` is mishandled by the falsey-value bug. |

## Architecture limitations

- `NetworkRequest` combines capture transport and validation input and uses `any`.
- The contract model is JSON-Schema-specific and represents only responses.
- Matching is part of the JSON Schema validator rather than a format plugin.
- The core imports a concrete validation library and is not runtime-independent.
- Chrome globals are accessed throughout capture, background, storage, and UI.
- There is no versioned message protocol between extension contexts.
- There is no distinction between contract import diagnostics, match diagnostics,
  and payload validation diagnostics.
- There is no cancellation, size limit, body truncation, or bounded capture policy
  before a response enters the service worker.
- There is no extensibility mechanism or plugin compatibility/version negotiation.

## Security and privacy findings

- The extension requests `<all_urls>` host access. This is a high-trust permission
  and must be justified or reduced before release.
- Full response bodies are moved into the service worker even when no contract
  matches. Matching should occur before payload transfer where practical.
- There is no maximum payload size; a large response can consume excessive memory.
- User-provided regular expressions can cause expensive matching. Pattern syntax
  and execution need guardrails.
- No request headers are captured today, which avoids leaking tokens. Future
  capture must default to an allowlist and redact secrets before storage or sync.
- Cloud synchronization has not been implemented. Its protocol must make it
  impossible to upload raw bodies accidentally through the normal result API.
- Imported documents have no size, reference-depth, or external-reference policy.
  Remote `$ref` fetching should be disabled by default.

## Product and UX gaps

- No OpenAPI import, operation selection, request validation, or response selection
  by status code and content type.
- No request inspector, payload preview, unmatched-request view, filters, search,
  session summary, or export.
- No explanation for why a contract did or did not match.
- No onboarding, examples, or sample contract.
- No contract versioning or import-source metadata.
- No accessibility review; icon-only buttons lack accessible labels.
- Destructive schema deletion has no confirmation or undo.
- The UI uses blocking `alert` for parsing errors.

## Engineering and release gaps

- `README.md` was empty at the time of audit.
- There are no automated tests, test script, linting, or formatting checks.
- CI releases on every push to `main` with write access, but runs no tests and uses
  a generated tag unrelated to package/manifest versions.
- The package is named `api-contract-validator`, while the product is Kontrak.
- The repository has no license or explicit open-core boundary.
- The original Desktop checkout contained an uncommitted `tsconfig.json` change;
  it was preserved when the files were copied to this workspace.

## Verification evidence

- Repository and every source/configuration file were inspected.
- The writable workspace initially contained an empty Git repository, so the MVP
  files were copied from `C:\Users\USER\OneDrive\Desktop\kontrak\kontrak` without
  changing the original.
- The initial `npm.cmd ci` attempts timed out on the OneDrive workspace and the
  first build ran before installation had finished. The installed tree later
  completed and `npm ls --depth=0` confirmed every direct dependency.
- After baseline tooling changes, `npm.cmd run check` passed type-checking, 12
  tests, ESLint, and Prettier checks on 2026-08-11.
- `npm.cmd run build` passed with Vite 8.2.1 and produced the required DevTools,
  panel, background, and manifest artifacts. The panel bundle has a non-blocking
  size warning (about 564 kB) to address during the extension milestone.
- `npm audit` reported zero known vulnerabilities after the baseline toolchain
  upgrade. Runtime dependencies also reported zero vulnerabilities before it.
- Vite/esbuild commands require execution outside this session's filesystem
  sandbox because its config loader is denied parent-directory reads from the
  OneDrive path. This restriction is not present in normal development or CI.

## Audit exit criteria

This audit is complete because current behavior, risks, limitations, and missing
verification are recorded. It does not approve the MVP for release. The roadmap
defines the gates required to replace these weaknesses incrementally.
