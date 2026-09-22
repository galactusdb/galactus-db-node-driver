# Galactus Node driver

[Galactus DB website](https://galactusdb.com) · [Source](https://github.com/galactusdb/galactus-db-node-driver) · [Type mapping](docs/BLUEPRINT.md) · [Spatial types](docs/SPATIAL.md)

Native Bolt 4.4 driver for Galactus DB. This experimental 0.1 implementation
has zero third-party runtime package dependencies. Source is available here;
no npm, NuGet, PyPI, Maven Central, or crates.io release is implied.

## How To

### 1. Get the driver

```sh
git clone --branch main https://github.com/galactusdb/galactus-db-node-driver.git
cd galactus-db-node-driver
```

Node 18+; ESM and TypeScript declarations, with no runtime dependencies. In your application directory:

```sh
npm install github:galactusdb/galactus-db-node-driver#main
```

### 2. Configure your connection

Start or obtain a Galactus DB instance; visit [galactusdb.com](https://galactusdb.com)
for database information. Use its Bolt address (locally, `bolt://127.0.0.1:7687`),
username, and configured password. The example reads `GDB_PASSWORD` from your
environment; it is an application variable, not a command to change the server password.

```sh
# Bash / zsh
export GDB_PASSWORD='your-database-password'
```

```powershell
# PowerShell
$env:GDB_PASSWORD = 'your-database-password'
```

### 3. Execute a parameterised query

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

Options also include `database: 'neo4j'` and `timeout: 30000` (milliseconds).
Use verified `bolt+s://` when connecting through a TLS terminator. Overlapping
operations on one driver are rejected; use another driver for concurrent work.

`await driver.begin({readOnly:false})`, `await driver.commit()`, and
`await driver.rollback()` manage explicit transactions. Close never commits.

Database integers are **bigint**, floats are number. Number inputs encode as
FLOAT (including `1.0`); use `1n` for INTEGER.
Use bigint literals or `BigInt("9223372036854775807")` for large integers, never
an already-rounded number. `JSON.stringify` does not support bigint directly;
choose an explicit JSON integer representation in the application.

Bytes decode as Buffer; Uint8Array inputs are supported. Native Date inputs
work, while outputs use nanosecond-preserving DateTime wrappers. Decoded maps
have no prototype; use `Object.keys` / `Object.hasOwn` instead of inherited
methods. Record maps are ordinary objects built with safe own properties.

See [type mapping](docs/BLUEPRINT.md), [spatial values](docs/SPATIAL.md), and
[scope](docs/OVERVIEW.md#scope-of-01). This is a Node TCP driver, not a browser bundle.

### 4. Run the tests

From this repository's root:

```sh
node --test test.mjs
```

See [test instructions](tests/README.md) for prerequisites and opt-in live tests.
Connection failures discard the connection; writes are never automatically retried.
Results are eager and each driver owns one connection; see the documented scope.

Learn more at [Galactus DB website](https://galactusdb.com).
