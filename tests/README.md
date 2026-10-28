# galactus-db-node-driver tests

[Galactus DB website](https://galactusdb.com) · [Driver Quickstart](../README.md)

## Quickstart

Run these commands from the repository root:

```sh
node --test test.mjs
```

The fixtures are included in `tests/fixtures`; no sibling repository is needed.
The tests use standard runtime/test facilities, with no test framework packages.
The wire fixtures cover integer boundaries, UTF-8, temporal values, graph values,
points, malformed inputs and unknown structures. `values.tsv` round-trips in
Bolt 4.4 mode and `bolt5.tsv` (graph values with element ids, `I`/`i` datetimes)
in Bolt 5 mode. Each `datetime_pairs.tsv` row holds the same instant as a Bolt 4.4
`F` and a Bolt 5 `I` datetime: both decode to equal values, and the encoder writes
the first column in 4.4 mode and the second in Bolt 5 mode. The spatial fixture contains
57 geometry/geography cases, including XY/XYZ, empties, holes, multipart shapes,
nested collections, and antimeridian geography.

### Live database tests

Without `GDB_TEST_URI`, live tests are skipped. To include them, start a **fresh,
disposable** Galactus database and set these environment variables before running
the same test command:

```sh
export GDB_TEST_URI='bolt://127.0.0.1:7687'
export GDB_TEST_PASSWORD='your-disposable-database-password'
```

```powershell
$env:GDB_TEST_URI = 'bolt://127.0.0.1:7687'
$env:GDB_TEST_PASSWORD = 'your-disposable-database-password'
```

Optional variables:

- `GDB_TEST_EXPECT_BOLT`: the protocol the server should agree (`5.4`, or `4.4`
  for a server started with `GDB_BOLT_MAX_VERSION=4.4`).
- `GDB_TEST_CA_FILE`: a PEM CA file for a `bolt+s://` URI. The tests pass it as
  `trustedCertificates`, check that connecting without it fails certificate
  verification, and check that setting it on a `bolt://` URI is rejected.

The shared runner in the `galactus-db-drivers` workspace
(`python tests/run_live.py --languages node`) starts disposable servers and runs
this suite three times: Bolt 5.4, Bolt 4.4 and TLS.

Tests use username `gdb`, the server's default database, create nodes with
Node-specific labels (`NodeDriver*`) and exercise commit/rollback, the agreed
protocol, element ids, offset and named-zone datetimes, decimals, recovery after
a failing query (in and out of a transaction), a unique constraint violation and
rejected authentication. Do not point them at valuable
data. Reset the disposable database between runs because commit tests leave nodes.
See [implementation scope](../docs/OVERVIEW.md#scope-of-02).

Database information: [Galactus DB website](https://galactusdb.com).
