import net from 'node:net';
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
  types.set(tag, Value);
  return Value;
}
export const Node = valueType(0x4e, [ 'id', 'labels', 'properties' ]);
export const Relationship =
    valueType(0x52, [ 'id', 'startId', 'endId', 'type', 'properties' ]);
export const UnboundRelationship =
    valueType(0x72, [ 'id', 'type', 'properties' ]);
export const Path = valueType(0x50, [ 'nodes', 'relationships', 'sequence' ]);
export const LocalDate = valueType(0x44, [ 'days' ]);
export const LocalTime = valueType(0x74, [ 'nanoseconds' ]);
export const Time = valueType(0x54, [ 'nanoseconds', 'offsetSeconds' ]);
export const LocalDateTime = valueType(0x64, [ 'seconds', 'nanoseconds' ]);
export const DateTime =
    valueType(0x46, [ 'seconds', 'nanoseconds', 'offsetSeconds' ]);
export const ZonedDateTime =
    valueType(0x66, [ 'seconds', 'nanoseconds', 'zoneId' ]);
export const Duration =
    valueType(0x45, [ 'months', 'days', 'seconds', 'nanoseconds' ]);
export const Point2D = valueType(0x58, [ 'srid', 'x', 'y' ]);
export const Point3D = valueType(0x59, [ 'srid', 'x', 'y', 'z' ]);

export function encode(value, depth = 0) {
  if (depth >= 64)
    throw new RangeError('Nesting exceeds 64 levels');
  if (value instanceof Spatial)
    value = value.toMap();
  const child = v => encode(v, depth + 1);
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
    // Point coordinates must be FLOAT on the wire, including integral
    // coordinates.
    const fields = value.fields.map((v, i) => {
      if ((value.tag === 0x58 || value.tag === 0x59) && i > 0) {
        const b = Buffer.alloc(9);
        b[0] = 0xc1;
        b.writeDoubleBE(Number(v), 1);
        return b;
      }
      return child(v);
    });
    return Buffer.concat(
        [ Buffer.from([ 0xb0 | fields.length, value.tag ]), ...fields ]);
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
      const Type = types.get(tag);
      return Type ? new Type(...f) : new Structure(tag, f);
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
    if (![0x44, 0x74, 0x54, 0x64, 0x46, 0x66, 0x45, 0x58, 0x59].includes(v.tag))
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
export class DatabaseError extends Error {
  constructor(metadata) {
    super(metadata.message ?? 'Database failure');
    this.code = metadata.code;
    this.metadata = metadata;
  }
}
export class Driver {
  static async connect(
      uri, {username, password, database = '', timeout = 30000} = {}) {
    const u = new URL(uri);
    if (!['bolt:', 'bolt+s:'].includes(u.protocol) || !u.hostname ||
        u.username || u.password || !['', '/'].includes(u.pathname) ||
        u.search || u.hash)
      throw new Error('Expected bolt://host:port or bolt+s://host:port');
    if (typeof username !== 'string' || typeof password !== 'string')
      throw new TypeError('Username and password are required');
    const host = u.hostname.replace(/^\[|\]$/g, ''),
          options = {host, port : Number(u.port || 7687)};
    const socket =
        u.protocol === 'bolt+s:'
            ? tls.connect(
                  {...options, servername : net.isIP(host) ? undefined : host})
            : net.connect(options);
    const d = new Driver(socket, database);
    socket.setNoDelay(true);
    socket.setTimeout(timeout,
                      () => socket.destroy(new Error('Connection timed out')));
    try {
      await new Promise((resolve, reject) => {
        socket.once(u.protocol === 'bolt+s:' ? 'secureConnect' : 'connect',
                    resolve);
        socket.once('error', reject);
      });
      await d._write(
          Buffer.from('6060b01700000404000000000000000000000000', 'hex'));
      if (!(await d._read(4)).equals(Buffer.from([ 0, 0, 4, 4 ])))
        throw new Error('Server did not select Bolt 4.4');
      await d._send(1, {
        user_agent : 'galactus-node/0.1',
        scheme : 'basic',
        principal : username,
        credentials : password
      });
      await d._success();
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
    const b = encode(new Structure(tag, fields));
    if (b.length > MAX)
      throw new Error('Message exceeds 64 MiB');
    const chunks = [];
    for (let p = 0; p < b.length; p += 65535) {
      const c = b.subarray(p, p + 65535), h = Buffer.alloc(2);
      h.writeUInt16BE(c.length);
      chunks.push(h, c);
    }
    chunks.push(Buffer.from([ 0, 0 ]));
    await this._write(Buffer.concat(chunks));
  }
  async _receive() {
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
    if (m.tag === 0x7f)
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
  async _exclusive(fn) {
    if (this.busy)
      throw new Error('Concurrent use: use another driver');
    this.busy = true;
    try {
      return await fn();
    } catch (e) {
      this.close();
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
      await this._send(0x10, query, parameters,
                       this.transaction ? {} : {db : this.database});
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
