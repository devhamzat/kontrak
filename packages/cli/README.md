# `@kontrak/cli`

Local and CI API contract validation using the same Kontrak engine and official
plugins as the Chrome extension.

```sh
kontrak import openapi.yaml
kontrak validate traffic.json --config kontrak.config.json
kontrak validate traffic.json --output sarif
kontrak diff openapi-old.yaml openapi-new.yaml --format openapi
```

Exit codes are stable: `0` for success, `1` for a contract violation or breaking
change, and `2` for usage, import, configuration, or system errors. Unmatched
traffic is reported but does not fail by default; pass `--fail-on-unmatched` to
enforce complete coverage.

Recordings use the versioned `kontrak-recording` JSON format. Redaction metadata
records removed headers and redacted JSON keys. Raw traffic never leaves the local
CLI. Optional cloud sync sends a structurally sanitized report that excludes
bodies, headers, query strings, and diagnostic prose.

```sh
KONTRAK_API_KEY=ktrk_... kontrak validate traffic.json \
  --config kontrak.config.json \
  --sync-url http://localhost:3000 \
  --project 00000000-0000-0000-0000-000000000000
```

On PowerShell, set `$env:KONTRAK_API_KEY = 'ktrk_...'` first. The URL and project
may alternatively come from `KONTRAK_SYNC_URL` and `KONTRAK_PROJECT_ID`. Sync is
disabled unless all three values are configured.
