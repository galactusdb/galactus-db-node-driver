# Galactus DB Node / TypeScript Driver

[Galactus DB](https://galactusdb.com) · [Driver catalogue](https://galactusdb.com/product/drivers) · [Type mapping](docs/BLUEPRINT.md) · [Spatial guide](docs/SPATIAL.md) · [Issues](https://github.com/galactusdb/galactus-db-node-driver/issues)

Connect Node / TypeScript applications to Galactus DB with parameterised Cypher,
native values, and explicit transactions. The driver speaks Bolt 5.4 directly,
falls back to Bolt 4.4 when the server asks for it, connects over the server's
own TLS listener, and has **zero third-party runtime package dependencies**.

**Status: 0.2 / early access.** Source is available on `main`. This is a tested
baseline with one connection per driver and eager results. Install from source
as shown below and read the [current scope](#current-scope) to see how it fits
your application.

## Contents

- [Quickstart](#quickstart)
- [Connection configuration](#connection-configuration)
- [Queries and results](#queries-and-results)
- [Transactions](#transactions)
- [Native type mapping](#native-type-mapping)
- [Spatial values](#spatial-values)
- [Errors and connection lifecycle](#errors-and-connection-lifecycle)
- [Testing](#testing)
- [Current scope](#current-scope)

## Quickstart

### 1. Get the source

Requirements: **Node 18+ (ESM)**, Git, and a reachable Galactus DB instance.

```sh
git clone --branch main https://github.com/galactusdb/galactus-db-node-driver.git
cd galactus-db-node-driver
```

Run this in your application directory.

```sh
npm install github:galactusdb/galactus-db-node-driver#main
```

TypeScript resolves the included declarations automatically. Use `import`, or dynamic `import()` from CommonJS.

Git-based installs follow `main`; pin a reviewed commit in your application for
reproducible builds. No npm, NuGet, PyPI, Maven Central or crates.io availability
is implied by the package names.

### 2. Configure your database credentials

Start Galactus DB on your infrastructure using the setup available from
[galactusdb.com](https://galactusdb.com). The examples use
`bolt://127.0.0.1:7687` and username `gdb`; replace them with your server settings.
Set your configured password in the application environment:

```sh
# Bash / zsh
export GDB_PASSWORD='your-database-password'
```

```powershell
# PowerShell
$env:GDB_PASSWORD = 'your-database-password'
```

`GDB_PASSWORD` is read by these examples; the driver does not automatically load
environment variables or change the server password. Keep credentials out of
source control and connection URIs.

### 3. Run your first query

```js
import { Driver, Point2D } from 'galactus-db-node-driver';

const driver = await Driver.connect('bolt://127.0.0.1:7687', {
  username: 'gdb', password: process.env.GDB_PASSWORD,
});
try {
  const result = await driver.executeQuery(
    'RETURN $name AS name, $age AS age, $point AS point',
    { name: 'Ada', age: 37n, point: new Point2D(7203, 1, 2) },
  );
  console.log(result.records[0].name, result.records[0].age); // Ada, 37n
} finally {
  driver.close();
}
```

The following examples reuse an open `driver` within the same resource scope.
Adapt error handling to your application.

## Connection configuration

`Driver.connect(uri, {username, password, database: "", timeout: 30000, trustedCertificates})`; timeout is milliseconds. Close with `driver.close()` in `finally`.

| Setting | Behaviour |
|---|---|
| URI | `bolt://host:port` (plaintext) or `bolt+s://host:port` (verified TLS); omitted port is 7687 |
| Authentication | Required username and password; no credentials in the URI |
| Database | Empty/omitted database delegates selection to the server’s configured default |
| Named database | Supply an existing database name explicitly, for example `app` |
| Timeout | Default examples use 30 seconds; see the language-specific units above |
| Result handling | Records are buffered in memory until the query completes |
| Trusted certificates | Optional path to a PEM file with one or more certificates; replaces the platform trust store for `bolt+s://` |

### TLS

Galactus serves TLS itself when it is started with `GDB_TLS_CERT` and
`GDB_TLS_KEY`, on the same port as plaintext. Connect with `bolt+s://`. The
driver uses `node:tls`, checks the certificate chain and checks that the
certificate matches the host name in the URI.

Certificates from a public CA verify against the platform trust store with no
extra settings. For a private CA or a self-signed development server, pass the
CA certificate file:

```js
const driver = await Driver.connect('bolt+s://db.internal:7687', {
  username: 'gdb',
  password: process.env.GDB_PASSWORD,
  trustedCertificates: '/etc/galactus/ca.pem',
});
```

`trustedCertificates` on a `bolt://` URI is a configuration error, and the
driver never falls back from `bolt+s://` to plaintext. Verification is always
on; there is no setting that skips it. `bolt+ssc://` and routing URIs
(`neo4j://`, `neo4j+s://`) are rejected.

### Connection details

After connecting, the driver reports what it agreed with the server:

```js
console.log(driver.protocolVersion); // "5.4", or "4.4" on a server capped at 4.4
console.log(driver.serverAgent);     // the server's agent string
console.log(driver.connectionId);    // the server's id for this connection
console.log(driver.lastBookmark);    // latest bookmark from an autocommit query or commit, or null
```

On Bolt 5.1 and newer the driver identifies itself with a `bolt_agent`
(`galactus-db-node-driver/0.2.0` on `Node/<version>`) and authenticates in a
separate LOGON step. Credentials and query parameters are never logged.

Timeouts bound socket waits, not necessarily total query duration or DNS lookup;
Go uses a deadline for the complete operation. The asynchronous API rejects overlapping operations on one driver. Use another connection for concurrent work. This package uses Node sockets and does not run in a browser.

## Queries and results

Bind data as parameters, never interpolate user input into Cypher:

```js
const result = await driver.executeQuery(
  'CREATE (p:Person {name:$name, age:$age}) RETURN p.name AS name, p.age AS age',
  { name: 'Ada', age: 37n },
);
console.log(result.records[0].name, result.records[0].age);
console.log(result.summary);
```

Results expose column keys, records indexed by column name, and server summary
metadata. Read a column with `result.records[0].name`. Use unique column aliases because
records are maps. Summary fields can include the database, query classification,
timings, bookmark and update statistics; only fields supplied by the server are
present. A query without rows still returns its summary.

Lists and maps can be nested. Values are recursively encoded and hydrated,
including graph properties and spatial envelopes. Use Cypher `LIMIT` or
application-level pagination for large result sets: this release is eager,
not a lazy streaming cursor.

## Transactions

Queries outside an explicit transaction autocommit. Group related writes with
begin/commit; explicitly roll back when abandoning work:

```js
await driver.begin();
await driver.executeQuery('CREATE (:Person {name:$name})', { name: 'Ada' });
await driver.executeQuery('CREATE (:Person {name:$name})', { name: 'Grace' });
await driver.commit();
// To deliberately abandon an open transaction: await driver.rollback();
```

The transaction belongs to the connection. Keep both statements on the same
driver and finish the transaction before reusing it for unrelated work. Closing
or disposing a connection rolls back an unfinished transaction; it never
implicitly commits. The read-only argument requests a read transaction.

If the database rejects a statement inside a transaction, the driver resets the
connection and the server rolls the transaction back. `driver.transaction` is
then `false`, so there is nothing left to roll back, and the next query runs as
an autocommit query on the same driver.

A transport failure discards the connection. A lost connection during COMMIT
means the commit outcome is unknown; reconcile the result before retrying a
write. A database error answering COMMIT means the transaction did not commit.

## Native type mapping

Native `bigint` for integers; `number` for floating point; `boolean`, `string`, `Buffer`/`Uint8Array`, arrays, and string-keyed objects. Native `Date` inputs work; returned datetimes retain nanoseconds in named wrappers. `DECIMAL` values arrive as strings with their exact digits. TypeScript declarations are included with the package.

- Database integers are signed 64-bit; out-of-range integer inputs fail.
- Bytes stay binary; values do not pass through JSON.
- Temporal wrappers preserve nanoseconds, offsets and named zones when the
  runtime’s native types cannot represent the full value.
- Calendar duration keeps months, days, seconds and nanoseconds separately.
- Graph nodes, relationships and paths have named result types. Each node and
  relationship has an `elementId` string, and a relationship also has
  `startElementId` and `endElementId`. They match Cypher's `elementId()`, which in
  Galactus is the decimal text of the integer id, on Bolt 5.4 and Bolt 4.4 alike.
  Bind IDs or properties as parameters; the graph entities themselves are
  result-only.
- Unknown wire structures remain explicit structures and cannot be used as
  generic application-object serialization.

No ORM or automatic arbitrary-object mapping is included. Convert application
models and UUIDs explicitly to your chosen supported format.
See the [complete type mapping](docs/BLUEPRINT.md) for precision and range details.

### Decimals

JavaScript has no standard decimal type, so exact decimals travel as strings in
both directions. Send the digits as a string and turn them into a `DECIMAL` in
Cypher:

```js
const { records } = await driver.executeQuery(
  'RETURN decimal($price) AS price', { price: '12.30' });
console.log(records[0].price); // "12.30"
```

### Datetimes

`DateTime` holds an offset datetime with nanoseconds. Its `seconds` are local
epoch seconds, as in 0.1, and `utcSeconds` gives the UTC instant. Build one from
a UTC instant with `DateTime.fromUtc(utcSeconds, nanoseconds, offsetSeconds)`.
The driver writes it in the form the agreed protocol expects, so the same value
works on Bolt 5.4 and 4.4.

`ZonedDateTime` keeps an IANA zone name and records whether its seconds are
local or UTC (`basis`). Create one with `ZonedDateTime.local(...)` or
`ZonedDateTime.utc(...)`; the server accepts both. A Bolt 5 server returns
UTC-based values and a Bolt 4.4 server local-based ones. Two values are equal
only when basis, seconds, nanoseconds and zone all match.

Use `37n` for an INTEGER and `37` for a FLOAT. Large integers should be constructed from bigint literals or decimal strings, not already-rounded numbers. `JSON.stringify` needs an explicit bigint conversion policy. Decoded maps have no prototype; use `Object.keys` and `Object.hasOwn`.

## Spatial values

The driver supports `Point2D`, `Point3D`, and a native `Spatial` value covering
every shape family currently supported by Galactus DB:

| Shape family | Geometry | Geography |
|---|---|---|
| Point / LineString / Polygon, including holes | Yes | Yes |
| MultiPoint / MultiLineString / MultiPolygon | Yes | Yes |
| GeometryCollection, including nested collections | Yes | Yes |
| XY, XYZ, and typed empty shapes | Yes | Yes |

`Spatial` preserves WKB bytes together with domain, SRID, coordinate layout and
model. Geometry uses `planar`; geography uses `greatCircle`. Neither domain nor
SRID is inferred by converting through GeoJSON.

```js
const { records } = await driver.executeQuery(
  'RETURN spatial.fromWKT($wkt, {domain:$domain}) AS shape',
  { wkt: 'POLYGON((0 0,4 0,4 4,0 4,0 0))', domain: 'geometry' },
);
const shape = records[0].shape;
await driver.executeQuery(
  'CREATE (:Region {name:$name, shape:spatial.fromMap($shape)})',
  { name: 'Square', shape },
);
console.log(shape.domain, shape.srid, shape.layout, shape.wkb.length);
```

Binding `Spatial` sends a lossless envelope. Use `spatial.fromMap($shape)` to
promote it into a database spatial value. `RETURN $shape` alone echoes the map;
it does not change the server’s value type. To import external bytes or text,
use `spatial.fromWKB`, `spatial.fromWKT`, or `spatial.fromGeoJSON` with parameters.
The server performs geometry/topology validation. M/ZM, curves, surfaces and
solids are outside the current database scope. See the [spatial guide](docs/SPATIAL.md).

## Errors and connection lifecycle

Server errors are `DatabaseError` instances with the server's `code`, `message`
and `metadata`, plus the parts of the code: `classification` (`ClientError`,
`TransientError` or `DatabaseError`), `category` and `title`. The flags
`isClientError`, `isTransient`, `isDatabaseError` and `isRetryable` save string
parsing. `isRetryable` is true for transient errors only; the driver never
retries by itself.

Compare codes against the frozen `ErrorCodes` object:

```js
import { DatabaseError, ErrorCodes } from 'galactus-db-node-driver';

try {
  await driver.executeQuery('CREATE (:Account {email:$email})', { email });
} catch (e) {
  if (e instanceof DatabaseError && e.code === ErrorCodes.ConstraintValidationFailed) {
    // the email is already registered
  } else {
    throw e;
  }
}
// The same driver is ready for the next query.
```

After a database error the driver resets the connection and stays usable.
Protocol, connection, TLS and authentication failures, timeouts and
unsupported-value errors are ordinary `Error`s; after a connection, TLS,
protocol or authentication failure the driver is closed. A parameter the driver
cannot encode is rejected before anything is sent, and the connection stays
open.

| Symptom | Check |
|---|---|
| Connection refused | Host, port, listener and network reachability |
| Authentication rejected | Database username and configured password |
| Database not found | Explicit database name; omit it to use the server default |
| TLS negotiation fails | Server started with `GDB_TLS_CERT`/`GDB_TLS_KEY`, `trustedCertificates` for a private CA, and a certificate that names the URI host |
| Plaintext connection closed by a TLS server | Use `bolt+s://`; a server with a certificate requires TLS |
| Unsupported parameter | Convert the object to a supported scalar/container or named value |
| Driver is closed after an error | A connection, TLS or protocol failure closed it; open a new driver |

Credentials and parameters are not logged by the driver. Avoid writing them to
application logs when reporting errors. The driver performs no automatic write
retries and has no background connection pool to recover failed connections.

## Testing

Run from the repository root:

```sh
node --test test.mjs
```

Fixtures and tests are self-contained. The codec tests check every golden value
in Bolt 4.4 form, the Bolt 5 forms with element ids and UTC datetimes, and that
both datetime forms decode to the same value. Without `GDB_TEST_URI`, live
database tests are skipped. For integration tests, use a fresh disposable server
and set `GDB_TEST_URI` and `GDB_TEST_PASSWORD` (plus `GDB_TEST_EXPECT_BOLT` and,
for `bolt+s://`, `GDB_TEST_CA_FILE`); tests create data and exercise
transactions. The configured default database is used. Reset the disposable
database before repeating the suite.

See [test instructions](tests/README.md) for platform prerequisites and environment
examples. The shared live suite runs on Bolt 5.4, on Bolt 4.4 and over TLS. It
covers 57 spatial cases per language, integer boundaries, native values, large
chunked payloads, element ids, datetimes, decimals, transactions, recovery after
database errors, constraint errors and certificate checks.

## Current scope

This release provides direct connections over Bolt 5.4 or 4.4, verified TLS,
basic authentication, parameterised queries, eager records and summaries,
explicit transactions, recovery after database errors, classified errors,
native type mapping, and full supported spatial interchange. Each driver owns
one connection; open one driver per concurrent unit of work. Messages are
capped at 64 MiB and nesting at 64 levels; aggregate result memory can exceed a
single message.

Real-server interoperability has been tested on Windows over plaintext Bolt
5.4, Bolt 4.4 and TLS. See [the shared blueprint](docs/BLUEPRINT.md) and the
[implementation overview](docs/OVERVIEW.md) for the precise contract, including
pooling, routing and the other follow-on work.

## Feedback and contribution

Use [GitHub issues](https://github.com/galactusdb/galactus-db-node-driver/issues) for reproducible
bugs and focused feature requests. Include runtime/OS versions, driver commit,
expected behaviour and a small reproduction with credentials and sensitive
data removed. Keep changes dependency-light and run the relevant tests before
opening a pull request against `main`.

Visit [galactusdb.com](https://galactusdb.com) for Galactus DB, or browse the
[other language drivers](https://galactusdb.com/product/drivers).
