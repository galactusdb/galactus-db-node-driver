# Changelog

## 0.2.0 - 28/10/2026

### Added

- Bolt 5.0 to 5.4, with a Bolt 4.4 fallback when the server offers only 4.4.
  From 5.1 the driver sends `bolt_agent` with HELLO and authenticates with LOGON.
- `driver.protocolVersion`, `driver.serverAgent`, `driver.connectionId` and
  `driver.lastBookmark`.
- `trustedCertificates` connection option: a PEM file that replaces the platform
  trust store for `bolt+s://`, for a private CA or a self-signed development
  server. Setting it on `bolt://` is a configuration error.
- `elementId` on `Node`, `Relationship` and `UnboundRelationship`, plus
  `startElementId` and `endElementId` on `Relationship`. On Bolt 4.4 they are the
  decimal text of the integer id.
- Bolt 5 datetimes (`I`, `i`). `DateTime.utcSeconds` and `DateTime.fromUtc(...)`;
  `ZonedDateTime` records a `basis` of `'local'` or `'utc'`, with
  `ZonedDateTime.local(...)` and `ZonedDateTime.utc(...)`.
- `encode(value, {protocol})` writes the form of the given protocol; the default
  is `'4.4'`, as in 0.1.
- `DatabaseError` classification: `classification`, `category`, `title`,
  `isClientError`, `isTransient`, `isDatabaseError` and `isRetryable`.
- `ErrorCodes`, a frozen object of the published server codes.
- `VERSION` export.

### Changed

- After a database error the driver sends RESET and stays usable; an open
  transaction is closed (the server rolls it back). Transport, protocol, TLS and
  authentication failures still close the driver.
- A parameter that cannot be encoded is rejected before anything is written and
  no longer closes the connection.
- `user_agent` is now `galactus-db-node-driver/0.2.0`.
- Documentation describes the server's own TLS listener; a terminating proxy is
  no longer needed.

### Notes

- `DECIMAL` values are returned as strings. Send decimals as strings and convert
  them in Cypher with `decimal($param)`.
