import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import tls from 'node:tls';

const MAX = 64 * 1024 * 1024;
function integer(value) {
  if (typeof value === 'number' && !Number.isSafeInteger(value))
    throw new RangeError(
        'Use bigint for integers outside the safe number range');
  return BigInt(value);
}
export class Spatial {
  constructor(domain, srid, layout, model, wkb) {
    if (!['geometry', 'geography'].includes(domain) ||
        !['XY', 'XYZ'].includes(layout) ||
        model !== (domain === 'geometry' ? 'planar' : 'greatCircle'))
      throw new TypeError('Unsupported spatial metadata');
    this.domain = domain;
    this.srid = integer(srid);
    this.layout = layout;
    this.model = model;
    this.wkb = Buffer.from(wkb);
  }
  toMap() {
    return {
      $gdbType : 'spatial',
      version : 1n,
      domain : this.domain,
      srid : this.srid,
      layout : this.layout,
      model : this.model,
      wkb : this.wkb
    };
  }
  static fromMap(m) {
    const payload = Object.hasOwn(m, 'wkbHex') ? 'wkbHex' : 'wkb';
    if (m.$gdbType !== 'spatial' || m.version !== 1n ||
        Object.keys(m).sort().join(',') !== [
          '$gdbType', 'version', 'domain', 'srid', 'layout', 'model', payload
        ].sort().join(','))
      throw new TypeError('Invalid spatial envelope');
    if (payload === 'wkbHex' && (typeof m.wkbHex !== 'string' ||
                                 !/^(?:[0-9a-fA-F]{2})*$/.test(m.wkbHex)))
      throw new TypeError('Invalid WKB hex');
    return new Spatial(m.domain, m.srid, m.layout, m.model,
                       payload === 'wkbHex' ? Buffer.from(m.wkbHex, 'hex')
                                            : m.wkb);
  }
}
export class Structure {
  constructor(tag, fields) {
    this.tag = tag;
    this.fields = fields;
  }
}
const types = new Map();
function valueType(tag, names) {
  class Value extends Structure {
    constructor(...fields) {
      if (fields.length !== names.length)
        throw new TypeError('Invalid field count');
      fields = fields.map(
          (v, i) => ['seconds', 'nanoseconds', 'offsetSeconds', 'days',
                     'months', 'srid', 'id', 'startId', 'endId']
                            .includes(names[i])
                        ? integer(v)
                        : v);
      super(tag, fields);
      names.forEach((name, i) => { this[name] = fields[i]; });
      Object.freeze(this.fields);
      Object.freeze(this);
    }
  }
  types.set(tag, f => new Value(...f));
  return Value;
}
function elementId(value, fallback) {
  if (value === undefined)
    return String(fallback);
  if (typeof value !== 'string')
    throw new TypeError('Element ids must be strings');
  return value;
}
// Graph values keep their Bolt 4.4 fields in `fields`; element ids are extra
// properties, filled from the integer ids when the server did not send them.
export class Node extends Structure {
  constructor(id, labels, properties, elementIdValue) {
    id = integer(id);
    super(0x4e, [ id, labels, properties ]);
    this.id = id;
    this.labels = labels;
    this.properties = properties;
    this.elementId = elementId(elementIdValue, id);
    Object.freeze(this.fields);
    Object.freeze(this);
  }
}
export class Relationship extends Structure {
  constructor(id, startId, endId, type, properties, elementIdValue,
              startElementId, endElementId) {
    id = integer(id);
    startId = integer(startId);
    endId = integer(endId);
    super(0x52, [ id, startId, endId, type, properties ]);
    this.id = id;
    this.startId = startId;
    this.endId = endId;
    this.type = type;
    this.properties = properties;
    this.elementId = elementId(elementIdValue, id);
    this.startElementId = elementId(startElementId, startId);
    this.endElementId = elementId(endElementId, endId);
    Object.freeze(this.fields);
    Object.freeze(this);
  }
}
export class UnboundRelationship extends Structure {
  constructor(id, type, properties, elementIdValue) {
    id = integer(id);
    super(0x72, [ id, type, properties ]);
    this.id = id;
    this.type = type;
    this.properties = properties;
    this.elementId = elementId(elementIdValue, id);
    Object.freeze(this.fields);
    Object.freeze(this);
  }
}
const sized = (make, ...counts) => f => {
  if (!counts.includes(f.length))
    throw new TypeError('Invalid field count');
  return make(...f);
};
types.set(0x4e, sized((...f) => new Node(...f), 3, 4));
types.set(0x52, sized((...f) => new Relationship(...f), 5, 8));
types.set(0x72, sized((...f) => new UnboundRelationship(...f), 3, 4));
export const Path = valueType(0x50, [ 'nodes', 'relationships', 'sequence' ]);
export const LocalDate = valueType(0x44, [ 'days' ]);
export const LocalTime = valueType(0x74, [ 'nanoseconds' ]);
export const Time = valueType(0x54, [ 'nanoseconds', 'offsetSeconds' ]);
export const LocalDateTime = valueType(0x64, [ 'seconds', 'nanoseconds' ]);
// `seconds` is local epoch seconds (the Bolt 4.4 `F` meaning, as in 0.1);
// `utcSeconds` is `seconds - offsetSeconds` (the Bolt 5 `I` meaning).
export const DateTime =
    valueType(0x46, [ 'seconds', 'nanoseconds', 'offsetSeconds' ]);
Object.defineProperty(DateTime.prototype, 'utcSeconds', {
  get() { return this.seconds - this.offsetSeconds; }
});
DateTime.fromUtc = (utcSeconds, nanoseconds, offsetSeconds) =>
    new DateTime(integer(utcSeconds) + integer(offsetSeconds), nanoseconds,
                 offsetSeconds);
types.set(0x49, sized(DateTime.fromUtc, 3));
// A named-zone datetime records whether its seconds are local ('f') or UTC
// ('i'); converting needs a time zone database, so the basis travels with it.
export class ZonedDateTime extends Structure {
  constructor(seconds, nanoseconds, zoneId, basis = 'local') {
    if (basis !== 'local' && basis !== 'utc')
      throw new TypeError("ZonedDateTime basis must be 'local' or 'utc'");
    if (typeof zoneId !== 'string')
      throw new TypeError('Zone id must be a string');
    seconds = integer(seconds);
    nanoseconds = integer(nanoseconds);
    super(basis === 'utc' ? 0x69 : 0x66, [ seconds, nanoseconds, zoneId ]);
    this.seconds = seconds;
    this.nanoseconds = nanoseconds;
    this.zoneId = zoneId;
    this.basis = basis;
    Object.freeze(this.fields);
    Object.freeze(this);
  }
  static local(seconds, nanoseconds, zoneId) {
    return new ZonedDateTime(seconds, nanoseconds, zoneId, 'local');
  }
  static utc(seconds, nanoseconds, zoneId) {
    return new ZonedDateTime(seconds, nanoseconds, zoneId, 'utc');
  }
}
types.set(0x66, sized(ZonedDateTime.local, 3));
types.set(0x69, sized(ZonedDateTime.utc, 3));
export const Duration =
    valueType(0x45, [ 'months', 'days', 'seconds', 'nanoseconds' ]);
export const Point2D = valueType(0x58, [ 'srid', 'x', 'y' ]);
export const Point3D = valueType(0x59, [ 'srid', 'x', 'y', 'z' ]);

const PROTOCOLS = [ '4.4', '5.0', '5.1', '5.2', '5.3', '5.4' ];
function isBolt5(options) {
  const protocol = String(options?.protocol ?? '4.4');
  if (!PROTOCOLS.includes(protocol))
    throw new RangeError(`Unsupported Bolt protocol ${protocol}`);
  return protocol !== '4.4';
}

// Encode for the agreed protocol: `{protocol: '4.4'}` (the default) or
// `{protocol: '5.4'}` (any 5.x). Bolt 5 writes offset datetimes as `I` and
// graph values with element ids.
export function encode(value, options = {}) {
  return pack(value, 0, isBolt5(options));
}
function pack(value, depth, bolt5) {
  if (depth >= 64)
    throw new RangeError('Nesting exceeds 64 levels');
  if (value instanceof Spatial)
    value = value.toMap();
  const child = v => pack(v, depth + 1, bolt5);
  const header = (n, tiny, base) => {
    if (tiny && n < 16)
      return Buffer.from([ tiny | n ]);
    const size = n < 256 ? 1 : n < 65536 ? 2 : 4;
    const b = Buffer.alloc(size + 1);
    b[0] = base + (size === 4 ? 2 : size - 1);
    b.writeUIntBE(n, 1, size);
    return b;
  };
  if (value === null)
    return Buffer.from([ 0xc0 ]);
  if (typeof value === 'boolean')
    return Buffer.from([ value ? 0xc3 : 0xc2 ]);
  if (typeof value === 'number') {
    const b = Buffer.alloc(9);
    b[0] = 0xc1;
    b.writeDoubleBE(value, 1);
    return b;
  }
  if (typeof value === 'bigint') {
    if (value < -(1n << 63n) || value >= (1n << 63n))
      throw new RangeError('Integer outside signed 64-bit range');
    if (value >= -16n && value <= 127n)
      return Buffer.from([ Number(value & 255n) ]);
    for (const [bits, marker] of [[ 8, 0xc8 ], [ 16, 0xc9 ], [ 32, 0xca ],
                                  [ 64, 0xcb ]]) {
      if (value >= -(1n << BigInt(bits - 1)) &&
          value < (1n << BigInt(bits - 1))) {
        const b = Buffer.alloc(1 + bits / 8);
        b[0] = marker;
        if (bits === 64)
          b.writeBigInt64BE(value, 1);
        else
          b.writeIntBE(Number(value), 1, bits / 8);
        return b;
      }
    }
  }
  if (value instanceof Date) {
    const ms = value.getTime();
    if (!Number.isFinite(ms))
      throw new RangeError('Invalid Date');
    const seconds = Math.floor(ms / 1000),
          nanos = (ms - seconds * 1000) * 1000000;
    return child(new DateTime(BigInt(seconds), BigInt(nanos), 0n));
  }
  if (typeof value === 'string') {
    const b = Buffer.from(value, 'utf8');
    if (b.toString('utf8') !== value) throw new TypeError('Invalid Unicode string');
    return Buffer.concat([ header(b.length, 0x80, 0xd0), b ]);
  }
  if (value instanceof Uint8Array) {
    const b = Buffer.from(value);
    return Buffer.concat([ header(b.length, 0, 0xcc), b ]);
  }
  if (value instanceof Structure) {
    if (value.fields.length > 15 || !Number.isInteger(value.tag) ||
        value.tag < 0 || value.tag > 255)
      throw new TypeError('Invalid structure');
    let tag = value.tag, raw = value.fields;
    if (bolt5) {
      if (value instanceof Node || value instanceof UnboundRelationship)
        raw = [...raw, value.elementId ];
      else if (value instanceof Relationship)
        raw = [
          ...raw, value.elementId, value.startElementId, value.endElementId
        ];
      else if (value instanceof DateTime) {
        tag = 0x49;
        raw = [ value.utcSeconds, value.nanoseconds, value.offsetSeconds ];
      }
    }
    // Point coordinates must be FLOAT on the wire, including integral
    // coordinates.
    const fields = raw.map((v, i) => {
      if ((tag === 0x58 || tag === 0x59) && i > 0) {
        const b = Buffer.alloc(9);
        b[0] = 0xc1;
        b.writeDoubleBE(Number(v), 1);
        return b;
      }
      return child(v);
    });
    return Buffer.concat(
        [ Buffer.from([ 0xb0 | fields.length, tag ]), ...fields ]);
  }
  if (Array.isArray(value))
    return Buffer.concat(
        [ header(value.length, 0x90, 0xd4), ...value.map(child) ]);
  if (value instanceof Map ||
      (value && (Object.getPrototypeOf(value) === Object.prototype ||
                 Object.getPrototypeOf(value) === null))) {
    const entries = value instanceof Map ? [...value ] : Object.entries(value);
    if (entries.some(([ k ]) => typeof k !== 'string'))
      throw new TypeError('Map keys must be strings');
    return Buffer.concat([
      header(entries.length, 0xa0, 0xd8),
      ...entries.flatMap(([ k, v ]) => [child(k), child(v)])
    ]);
  }
  throw new TypeError(`Unsupported parameter type: ${typeof value}`);
}

export function decode(data) {
  data = Buffer.from(data);
  let pos = 0;
  const take = n => {
    if (n > data.length - pos)
      throw new Error('Truncated PackStream');
    const b = data.subarray(pos, pos + n);
    pos += n;
    return b;
  };
  function read(depth = 0) {
    if (depth >= 64)
      throw new Error('Nesting exceeds 64 levels');
    const m = take(1)[0];
    if (m <= 127)
      return BigInt(m);
    if (m >= 240)
      return BigInt(m - 256);
    if (m === 0xc0)
      return null;
    if (m === 0xc2 || m === 0xc3)
      return m === 0xc3;
    if (m === 0xc1)
      return take(8).readDoubleBE();
    if (m >= 0xc8 && m <= 0xcb) {
      const n = 1 << (m - 0xc8), b = take(n);
      return n === 8 ? b.readBigInt64BE() : BigInt(b.readIntBE(0, n));
    }
    let kind, n;
    if (m >= 0x80 && m <= 0xbf) {
      kind = m & 0xf0;
      n = m & 15;
    } else {
      const base = [ 0xcc, 0xd0, 0xd4, 0xd8 ].find(b => m >= b && m <= b + 2);
      if (base === undefined)
        throw new Error('Unknown PackStream marker');
      kind = new Map([
               [ 0xcc, 0xcc ], [ 0xd0, 0x80 ], [ 0xd4, 0x90 ], [ 0xd8, 0xa0 ]
             ]).get(base);
      const b = take(1 << (m - base));
      n = b.readUIntBE(0, b.length);
    }
    if (kind === 0x80)
      return new TextDecoder('utf-8', {fatal : true, ignoreBOM : true}).decode(take(n));
    if (kind === 0xcc)
      return Buffer.from(take(n));
    if (kind === 0xb0) {
      const tag = take(1)[0],
            f = Array.from({length : n}, () => read(depth + 1));
      const make = types.get(tag);
      return make ? make(f) : new Structure(tag, f);
    }
    if (n > data.length - pos)
      throw new Error('Invalid collection size');
    if (kind === 0x90)
      return Array.from({length : n}, () => read(depth + 1));
    const result = Object.create(null);
    for (let i = 0; i < n; i++) {
      const k = read(depth + 1);
      if (typeof k !== 'string' || Object.hasOwn(result, k))
        throw new Error('Invalid or duplicate map key');
      result[k] = read(depth + 1);
    }
    return result.$gdbType === 'spatial' && result.version === 1n
               ? Spatial.fromMap(result)
               : result;
  }
  const result = read();
  if (pos !== data.length)
    throw new Error('Trailing PackStream bytes');
  return result;
}

function validateParameters(v, depth = 0) {
  if (depth >= 64)
    throw new RangeError('Nesting exceeds 64 levels');
  if (v instanceof Structure) {
    if (![0x44, 0x74, 0x54, 0x64, 0x46, 0x49, 0x66, 0x69, 0x45, 0x58, 0x59]
             .includes(v.tag))
      throw new TypeError(
          'Graph entities and unknown structures are result-only; pass properties or an ID');
    for (const f of v.fields)
      validateParameters(f, depth + 1);
  } else if (Array.isArray(v)) {
    for (const f of v)
      validateParameters(f, depth + 1);
  } else if (v instanceof Map) {
    for (const f of v.values())
      validateParameters(f, depth + 1);
  } else if (v && Object.getPrototypeOf(v) === Object.prototype) {
    for (const f of Object.values(v))
      validateParameters(f, depth + 1);
  }
}
export const VERSION = '0.2.0';
const USER_AGENT = `galactus-db-node-driver/${VERSION}`;

// Published server codes. Codes the server adds later still arrive as plain
// strings on DatabaseError.code.
export const ErrorCodes = Object.freeze({
  ConstraintValidationFailed :
      'Galactus.ClientError.Schema.ConstraintValidationFailed',
  TypeError : 'Galactus.ClientError.Statement.TypeError',
  ArgumentError : 'Galactus.ClientError.Statement.ArgumentError',
  SqlTooManyRows : 'Galactus.ClientError.Statement.SqlTooManyRows',
  SqlCastFailed : 'Galactus.ClientError.Statement.SqlCastFailed',
  TableTooLarge : 'Galactus.ClientError.Statement.TableTooLarge',
  UnsupportedFeature : 'Galactus.DatabaseError.Storage.UnsupportedFeature',
  ProcedureNotFound : 'Galactus.ClientError.Procedure.ProcedureNotFound',
  LicenseRestricted : 'Galactus.ClientError.License.Restricted',
  ReadOnlyReplica : 'Galactus.ClientError.Database.ReadOnlyReplica',
  TransactionTimedOut : 'Galactus.ClientError.Transaction.TimedOut',
  TransactionTerminated : 'Galactus.ClientError.Transaction.Terminated',
  SnapshotTooOld : 'Galactus.TransientError.Transaction.SnapshotTooOld',
  Forbidden : 'Galactus.ClientError.Security.Forbidden',
  SyntaxError : 'Neo.ClientError.Statement.SyntaxError',
  SemanticError : 'Neo.ClientError.Statement.SemanticError',
  Unauthorized : 'Neo.ClientError.Security.Unauthorized',
  DatabaseNotFound : 'Neo.ClientError.Database.DatabaseNotFound',
});

export class DatabaseError extends Error {
  constructor(metadata) {
    super(metadata?.message ?? 'Database failure');
    this.name = 'DatabaseError';
    this.code = metadata?.code;
    this.metadata = metadata;
    const parts = typeof this.code === 'string' ? this.code.split('.') : [];
    const [, classification = null, category = null, title = null] =
        parts.length === 4 ? parts : [];
    this.classification = classification;
    this.category = category;
    this.title = title;
    this.isClientError = classification === 'ClientError';
    this.isTransient = classification === 'TransientError';
    this.isDatabaseError = classification === 'DatabaseError';
    // The driver never retries by itself; this tells the application it may.
    this.isRetryable = this.isTransient;
  }
}

// Errors raised while encoding a request, before anything was written: the
// connection is untouched and stays usable.
const unsent = new WeakSet();

function boltAgent() {
  const agent = {
    product : USER_AGENT,
    language : `Node/${process.versions.node}`,
    language_details : `V8 ${process.versions.v8}`,
    platform : `${os.type()} ${os.release()}; ${process.arch}`,
  };
  return agent;
}

export class Driver {
  static async connect(uri, {
    username,
    password,
    database = '',
    timeout = 30000,
    trustedCertificates
  } = {}) {
    const u = new URL(uri);
    if (!['bolt:', 'bolt+s:'].includes(u.protocol) || !u.hostname ||
        u.username || u.password || !['', '/'].includes(u.pathname) ||
        u.search || u.hash)
      throw new Error('Expected bolt://host:port or bolt+s://host:port');
    if (typeof username !== 'string' || typeof password !== 'string')
      throw new TypeError('Username and password are required');
    const secure = u.protocol === 'bolt+s:';
    let ca;
    if (trustedCertificates !== undefined && trustedCertificates !== null) {
      if (!secure)
        throw new Error(
            'trustedCertificates applies only to bolt+s:// connections');
      if (typeof trustedCertificates !== 'string' || !trustedCertificates)
        throw new TypeError(
            'trustedCertificates must be a path to a PEM certificate file');
      ca = fs.readFileSync(trustedCertificates);
    }
    const host = u.hostname.replace(/^\[|\]$/g, ''),
          options = {host, port : Number(u.port || 7687)};
    const socket =
        secure ? tls.connect({
          ...options,
          servername : net.isIP(host) ? undefined : host,
          ...(ca ? {ca} : {})
        })
               : net.connect(options);
    const d = new Driver(socket, database);
    socket.setNoDelay(true);
    socket.setTimeout(timeout,
                      () => socket.destroy(new Error('Connection timed out')));
    try {
      await new Promise((resolve, reject) => {
        socket.once(secure ? 'secureConnect' : 'connect', resolve);
        socket.once('error', reject);
      });
      // 5.4 down to 5.0, then 4.4.
      await d._write(
          Buffer.from('6060b01700040405000004040000000000000000', 'hex'));
      const agreed = await d._read(4);
      if (agreed[0] !== 0 || agreed[1] !== 0 ||
          !((agreed[3] === 5 && agreed[2] <= 4) ||
            (agreed[3] === 4 && agreed[2] === 4)))
        throw new Error(
            `Server selected an unsupported Bolt version (${agreed.toString('hex')})`);
      d._protocol = `${agreed[3]}.${agreed[2]}`;
      let hello;
      if (agreed[3] === 5 && agreed[2] >= 1) {
        await d._send(1, {user_agent : USER_AGENT, bolt_agent : boltAgent()});
        hello = await d._success();
        await d._send(0x6a, {
          scheme : 'basic',
          principal : username,
          credentials : password
        });
        await d._success();
      } else {
        await d._send(1, {
          user_agent : USER_AGENT,
          scheme : 'basic',
          principal : username,
          credentials : password
        });
        hello = await d._success();
      }
      if (typeof hello.server === 'string')
        d._serverAgent = hello.server;
      if (typeof hello.connection_id === 'string')
        d._connectionId = hello.connection_id;
      return d;
    } catch (e) {
      d.close();
      throw e;
    }
  }
  constructor(socket, database) {
    this.socket = socket;
    this.database = database;
    this.transaction = false;
    this.busy = false;
    this.buffer = Buffer.alloc(0);
    this.failure = null;
    this.waiter = null;
    this._protocol = null;
    this._serverAgent = null;
    this._connectionId = null;
    this._lastBookmark = null;
    socket.on('data', b => {
      if (this.buffer.length + b.length > MAX + 65536)
        return socket.destroy(new Error('Receive buffer exceeds limit'));
      this.buffer = Buffer.concat([ this.buffer, b ]);
      this.waiter?.();
    });
    socket.on('error', e => {
      this.failure = e;
      this.waiter?.();
    });
    socket.on('close', () => {
      this.failure ??= new Error('Connection closed');
      this.waiter?.();
    });
  }
  /** Agreed Bolt version, for example "5.4" or "4.4". */
  get protocolVersion() { return this._protocol; }
  /** Server agent from the HELLO SUCCESS, for example "GDB/2.1.4". */
  get serverAgent() { return this._serverAgent; }
  /** Server-assigned connection id from the HELLO SUCCESS. */
  get connectionId() { return this._connectionId; }
  /** Most recent bookmark returned by an autocommit query or COMMIT. */
  get lastBookmark() { return this._lastBookmark; }
  async _read(n) {
    while (this.buffer.length < n) {
      if (this.failure)
        throw this.failure;
      await new Promise(resolve => { this.waiter = resolve; });
      this.waiter = null;
    }
    const b = this.buffer.subarray(0, n);
    this.buffer = this.buffer.subarray(n);
    return b;
  }
  async _write(b) {
    if (this.socket.destroyed)
      throw new Error('Driver is closed');
    await new Promise((resolve, reject) =>
                          this.socket.write(b, e => e ? reject(e) : resolve()));
  }
  async _send(tag, ...fields) {
    if (tag === 0x10 || tag === 0x11) {
      const extra = fields[tag === 0x10 ? 2 : 0];
      if (!extra.db) delete extra.db;
    }
    let b;
    try {
      b = encode(new Structure(tag, fields), {protocol : this._protocol});
      if (b.length > MAX)
        throw new Error('Message exceeds 64 MiB');
    } catch (e) {
      if (e && typeof e === 'object')
        unsent.add(e);
      throw e;
    }
    const chunks = [];
    for (let p = 0; p < b.length; p += 65535) {
      const c = b.subarray(p, p + 65535), h = Buffer.alloc(2);
      h.writeUInt16BE(c.length);
      chunks.push(h, c);
    }
    chunks.push(Buffer.from([ 0, 0 ]));
    await this._write(Buffer.concat(chunks));
  }
  async _message() {
    const chunks = [];
    let size = 0;
    for (;;) {
      const n = (await this._read(2)).readUInt16BE();
      if (!n) {
        if (size)
          break;
        continue;
      }
      size += n;
      if (size > MAX)
        throw new Error('Message exceeds 64 MiB');
      chunks.push(await this._read(n));
    }
    const m = decode(Buffer.concat(chunks));
    if (!(m instanceof Structure))
      throw new Error('Invalid Bolt response');
    return m;
  }
  async _receive() {
    const m = await this._message();
    if (m.tag === 0x7f && m.fields.length === 1 && m.fields[0] &&
        typeof m.fields[0] === 'object')
      throw new DatabaseError(m.fields[0]);
    if (![0x70, 0x71].includes(m.tag) || m.fields.length !== 1)
      throw new Error('Unexpected Bolt response');
    return m;
  }
  async _success() {
    const m = await this._receive();
    if (m.tag !== 0x70)
      throw new Error('Expected SUCCESS');
    return m.fields[0];
  }
  // After a FAILURE the connection is healthy: RESET clears the failed state
  // and rolls back any open transaction on the server.
  async _reset() {
    await this._send(0x0f);
    for (;;) {
      const m = await this._message();
      if (m.tag === 0x70)
        return;
      if (m.tag !== 0x7e)
        throw new Error('RESET did not succeed');
    }
  }
  _bookmark(meta) {
    if (typeof meta?.bookmark === 'string')
      this._lastBookmark = meta.bookmark;
  }
  async _exclusive(fn) {
    if (this.busy)
      throw new Error('Concurrent use: use another driver');
    this.busy = true;
    try {
      return await fn();
    } catch (e) {
      if (e instanceof DatabaseError) {
        this.transaction = false;
        try {
          await this._reset();
        } catch {
          this.close();
        }
      } else if (!unsent.has(e)) {
        this.close();
      }
      throw e;
    } finally {
      this.busy = false;
    }
  }
  async executeQuery(query, parameters = {}) {
    if (!(parameters instanceof Map) &&
        (!parameters ||
         (Object.getPrototypeOf(parameters) !== Object.prototype &&
          Object.getPrototypeOf(parameters) !== null)))
      throw new TypeError('Parameters must be a map');
    validateParameters(parameters);
    return this._exclusive(async () => {
      const autocommit = !this.transaction;
      await this._send(0x10, query, parameters,
                       autocommit ? {db : this.database} : {});
      const meta = await this._success(), keys = meta.fields ?? [],
            records = [];
      await this._send(0x3f, {n : -1n});
      for (;;) {
        const m = await this._receive();
        if (m.tag === 0x70) {
          if (m.fields[0].has_more) {
            await this._send(0x3f, {n : -1n});
            continue;
          }
          if (autocommit)
            this._bookmark(m.fields[0]);
          return {keys, records, summary : {...meta, ...m.fields[0]}};
        }
        if (m.fields[0].length !== keys.length)
          throw new Error('Record width mismatch');
        records.push(
            Object.fromEntries(keys.map((k, i) => [k, m.fields[0][i]])));
      }
    });
  }
  async begin({readOnly = false} = {}) {
    if (this.transaction)
      throw new Error('Transaction already open');
    return this._exclusive(async () => {
      await this._send(0x11, {db : this.database, mode : readOnly ? 'r' : 'w'});
      await this._success();
      this.transaction = true;
      return this;
    });
  }
  async commit() {
    if (!this.transaction)
      throw new Error('No transaction');
    return this._exclusive(async () => {
      await this._send(0x12);
      const m = await this._success();
      this.transaction = false;
      this._bookmark(m);
      return m;
    });
  }
  async rollback() {
    if (!this.transaction)
      throw new Error('No transaction');
    return this._exclusive(async () => {
      await this._send(0x13);
      await this._success();
      this.transaction = false;
    });
  }
  close() {
    this.transaction = false;
    this.socket.destroy();
  }
}
