# `@kontrak/sync`

Public, versioned client types for optional Kontrak Cloud synchronization.

The normal sync protocol cannot represent request/response bodies or headers.
URLs are reduced to origin and pathname before a report is created, so query
values and fragments never cross the cloud boundary. A recursive runtime guard
also rejects sensitive field names before invoking the configured transport.

Authentication and HTTP are supplied by the host application. The package does
not depend on Clerk, Supabase, Bachs, or a browser/Node networking implementation.
