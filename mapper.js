// Object mapping: nodes and relationships as the application's own classes, and
// the Cypher for everyday operations. Standard library only; docs/MAPPER.md is
// the contract every Galactus mapper follows.
//
//   import {Driver} from 'galactus-db-node-driver';
//   import {Mapper, defineNode} from 'galactus-db-node-driver/mapper';
//
//   class Person {}
//   defineNode(Person, {key: 'id', properties: {id: 'id', name: 'name', email: 'email_address'}});
//
//   const people = new Mapper(driver);
//   await people.save(Object.assign(new Person(), {id: 1n, name: 'Ann', email: 'ann@example.com'}));
//   const ann = await people.find(Person, 1n);
import {Node, Relationship, UnboundRelationship} from './index.js';

/** A type that cannot be mapped, or a value that does not fit it. */
export class MappingError extends Error {
  constructor(message) {
    super(message);
    this.name = 'MappingError';
  }
}

const NODES = new WeakMap(), RELATIONSHIPS = new WeakMap();
const quote = name => '`' + name + '`';

function checked(value, what) {
  if (typeof value !== 'string' || value === '' || value.includes('`'))
    throw new MappingError(`${what} must be a name without backticks, got ${String(value)}`);
  return value;
}

function shape(type, name, properties, key) {
  if (typeof type !== 'function')
    throw new MappingError('a mapped type must be a class');
  const fields = new Map();
  const given = Array.isArray(properties) ? properties.map(p => [p, p]) : Object.entries(properties ?? {});
  for (const [field, stored] of given)
    fields.set(checked(field, `${type.name} field`), checked(stored, `${type.name}.${field}`));
  if (key != null && !fields.has(key))
    throw new MappingError(`${type.name} has no field '${key}' to be its key`);
  return {type, name: checked(name, 'a label or relationship type'), fields, key: key ?? null};
}

/** Declare a class as a node type. `properties` is a list of field names, or a map from field to property name. */
export function defineNode(type, {label, key, properties} = {}) {
  NODES.set(type, shape(type, label ?? type?.name, properties, key));
  return type;
}

/** Declare a class as a relationship type. `type` defaults to the class name in upper case. */
export function defineRelationship(type, {type: name, properties} = {}) {
  RELATIONSHIPS.set(type, shape(type, name ?? type?.name?.toUpperCase(), properties, null));
  return type;
}

function shapeOf(type, table = NODES) {
  const found = table.get(type);
  if (!found)
    throw new MappingError(`${type?.name ?? type} is not declared as a ${table === NODES ? 'node' : 'relationship'} type`);
  return found;
}
const anyShape = type => NODES.get(type) ?? RELATIONSHIPS.get(type) ?? shapeOf(type);

/** Every declared property of an object, by its stored name. */
export function propertiesOf(object) {
  const s = anyShape(object?.constructor), out = {};
  for (const [field, stored] of s.fields) out[stored] = object[field] ?? null;
  return out;
}

function build(s, properties) {
  const object = Object.create(s.type.prototype);
  for (const [field, stored] of s.fields)
    object[field] = Object.hasOwn(properties, stored) ? properties[stored] : null;
  return object;
}

/** An object of a declared node type from a `Node`. */
export function fromNode(type, value) {
  if (!(value instanceof Node)) throw new MappingError(`${type?.name}: expected a node`);
  return build(shapeOf(type), value.properties);
}

/** An object of a declared relationship type from a `Relationship`. */
export function fromRelationship(type, value) {
  if (!(value instanceof Relationship) && !(value instanceof UnboundRelationship))
    throw new MappingError(`${type?.name}: expected a relationship`);
  return build(shapeOf(type, RELATIONSHIPS), value.properties);
}

function fromValue(type, value) {
  if (value instanceof Node) return fromNode(type, value);
  if (value instanceof Relationship || value instanceof UnboundRelationship) return fromRelationship(type, value);
  if (value && typeof value === 'object' && [Object.prototype, null].includes(Object.getPrototypeOf(value)))
    return build(anyShape(type), value);
  throw new MappingError(`${type?.name}: expected a node, a relationship or a map`);
}

function keyed(type) {
  const s = shapeOf(type);
  if (s.key === null) throw new MappingError(`${type.name} has no key`);
  return s;
}
function keyValue(s, value) {
  if (value == null) throw new MappingError(`${s.type.name}: the key '${s.key}' has no value`);
  return value;
}
const keyProperty = s => s.fields.get(s.key);

/** Runs the everyday operations on a driver, each as one statement. */
export class Mapper {
  constructor(driver) {
    this.driver = driver;
  }

  async create(object) {
    const s = shapeOf(object?.constructor);
    const {records} = await this.driver.executeQuery(
        `CREATE (n:${quote(s.name)}) SET n = $properties RETURN n`, {properties: propertiesOf(object)});
    return fromNode(s.type, records[0].n);
  }

  async save(object) {
    const s = keyed(object?.constructor), key = keyValue(s, object[s.key]);
    const {records} = await this.driver.executeQuery(
        `MERGE (n:${quote(s.name)} {${quote(keyProperty(s))}: $key}) SET n += $properties RETURN n`,
        {key, properties: propertiesOf(object)});
    return fromNode(s.type, records[0].n);
  }

  async find(type, key) {
    const s = keyed(type);
    const {records} = await this.driver.executeQuery(
        `MATCH (n:${quote(s.name)} {${quote(keyProperty(s))}: $key}) RETURN n LIMIT 1`, {key: keyValue(s, key)});
    return records.length ? fromNode(type, records[0].n) : null;
  }

  async findAll(type, filter = {}, limit = null) {
    const s = shapeOf(type), parameters = {}, conditions = [];
    Object.entries(filter ?? {}).forEach(([name, value], index) => {
      if (!s.fields.has(name)) throw new MappingError(`${type.name} has no field '${name}' to filter by`);
      parameters['p' + index] = value;
      conditions.push(`n.${quote(s.fields.get(name))} = $p${index}`);
    });
    let query = `MATCH (n:${quote(s.name)})`;
    if (conditions.length) query += ' WHERE ' + conditions.join(' AND ');
    query += ' RETURN n';
    if (s.key !== null) query += ` ORDER BY n.${quote(keyProperty(s))}`;
    if (limit != null) {
      if (!Number.isInteger(Number(limit)) || Number(limit) < 0)
        throw new MappingError('limit must be a whole number, zero or more');
      parameters.limit = BigInt(limit);
      query += ' LIMIT $limit';
    }
    return (await this.driver.executeQuery(query, parameters)).records.map(row => fromNode(type, row.n));
  }

  async delete(type, key) {
    const s = keyed(type);
    const {records} = await this.driver.executeQuery(
        `MATCH (n:${quote(s.name)} {${quote(keyProperty(s))}: $key}) DETACH DELETE n RETURN count(*) AS deleted`,
        {key: keyValue(s, key)});
    return records[0].deleted > 0n;
  }

  async relate(start, link, end) {
    const a = keyed(start?.constructor), b = keyed(end?.constructor), r = shapeOf(link?.constructor, RELATIONSHIPS);
    const {records} = await this.driver.executeQuery(
        `MATCH (a:${quote(a.name)} {${quote(keyProperty(a))}: $a}), (b:${quote(b.name)} {${quote(keyProperty(b))}: $b}) ` +
            `MERGE (a)-[r:${quote(r.name)}]->(b) SET r += $properties RETURN r`,
        {a: keyValue(a, start[a.key]), b: keyValue(b, end[b.key]), properties: propertiesOf(link)});
    if (!records.length) throw new MappingError(`${a.type.name} or ${b.type.name} was not found to relate`);
    return fromRelationship(r.type, records[0].r);
  }

  async related(start, linkType, endType) {
    const a = keyed(start?.constructor), b = shapeOf(endType), r = shapeOf(linkType, RELATIONSHIPS);
    let query = `MATCH (a:${quote(a.name)} {${quote(keyProperty(a))}: $a})-[r:${quote(r.name)}]->(b:${quote(b.name)}) RETURN r, b`;
    if (b.key !== null) query += ` ORDER BY b.${quote(keyProperty(b))}`;
    const {records} = await this.driver.executeQuery(query, {a: keyValue(a, start[a.key])});
    return records.map(row => [fromRelationship(linkType, row.r), fromNode(endType, row.b)]);
  }

  async query(type, cypher, parameters = {}) {
    const {keys, records} = await this.driver.executeQuery(cypher, parameters);
    return keys.length ? records.map(row => fromValue(type, row[keys[0]])) : [];
  }
}
