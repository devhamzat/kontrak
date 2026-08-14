# `@kontrak/plugin-json-schema`

Official JSON Schema contract plugin for Kontrak.

Supported dialects:

- JSON Schema draft-07
- JSON Schema 2019-09
- JSON Schema 2020-12

Raw JSON Schema does not contain HTTP endpoint metadata, so imports require a URL
pattern and may specify an HTTP method, request/response target, and matching mode.
Literal matching is the default. Regular expressions must be selected explicitly,
are validated during import, and are limited to 256 characters.

Local `$ref` values are supported. Remote HTTP references are disabled by default
to keep browser and CI validation private, deterministic, and offline-capable.
