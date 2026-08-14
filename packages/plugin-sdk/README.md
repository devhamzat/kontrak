# `@kontrak/plugin-sdk`

Public SDK for trusted Kontrak contract-format plugins.

A plugin declares a versioned manifest, detects and imports contract sources,
matches normalized HTTP exchanges, and returns normalized validation results. The
SDK contains no Chrome, Node.js, React, or schema-library dependency.

Use `definePlugin` to validate manifest compatibility and `diagnostic` to create
stable diagnostics. The `@kontrak/plugin-sdk/testing` export provides a
runtime-neutral conformance harness that plugin authors can call from their own
test runner.

Kontrak v1 loads plugins installed as normal trusted packages. It does not execute
JavaScript downloaded at runtime. The core can cancel or time out asynchronous
plugin operations. JavaScript cannot preempt a plugin that blocks synchronously,
so plugins must keep synchronous work bounded and periodically yield for expensive
operations.
