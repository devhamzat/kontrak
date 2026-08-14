# `@kontrak/plugin-openapi`

Official OpenAPI contract plugin for Kontrak.

Initial capabilities:

- OpenAPI 3.0.x and 3.1.x documents in JSON or YAML
- local component references with guarded resolution
- HTTP method and templated-path matching
- path, query, header, and cookie parameter validation
- request-body validation by media type
- response selection by exact status, `2XX`-style range, or `default`
- response-body validation by media type
- normalized diagnostics with contract URI and JSON-pointer locations

Remote references are disabled by default. Validation is local and deterministic;
importing an OpenAPI document never fetches network resources.
