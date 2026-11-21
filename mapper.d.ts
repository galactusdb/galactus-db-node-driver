import type {Driver, Node, Relationship, UnboundRelationship, Value} from './index.js';

/** A type that cannot be mapped, or a value that does not fit it. */
export class MappingError extends Error {}

type Class<T> = abstract new (...args: any[]) => T;
/** Field names, or a map from field name to the property it is stored as. */
type Properties<T> = Array<keyof T & string> | Partial<Record<keyof T & string, string>>;

/** Declare a class as a node type. `label` defaults to the class name. */
export function defineNode<T>(type: Class<T>, options?: {label?: string; key?: keyof T & string; properties?: Properties<T>}): Class<T>;
/** Declare a class as a relationship type. `type` defaults to the class name in upper case. */
export function defineRelationship<T>(type: Class<T>, options?: {type?: string; properties?: Properties<T>}): Class<T>;

/** Every declared property of an object, by its stored name. */
export function propertiesOf(object: object): {[property: string]: Value};
export function fromNode<T>(type: Class<T>, value: Node): T;
export function fromRelationship<T>(type: Class<T>, value: Relationship | UnboundRelationship): T;

/** Runs the everyday operations on a driver, each as one statement. See docs/MAPPER.md. */
export class Mapper {
  constructor(driver: Driver);
  readonly driver: Driver;
  create<T extends object>(object: T): Promise<T>;
  save<T extends object>(object: T): Promise<T>;
  find<T>(type: Class<T>, key: Value): Promise<T | null>;
  findAll<T>(type: Class<T>, filter?: Partial<Record<keyof T & string, Value>>, limit?: number | bigint | null): Promise<T[]>;
  delete<T>(type: Class<T>, key: Value): Promise<boolean>;
  relate<R extends object>(start: object, link: R, end: object): Promise<R>;
  related<R, B>(start: object, linkType: Class<R>, endType: Class<B>): Promise<Array<[R, B]>>;
  query<T>(type: Class<T>, cypher: string, parameters?: {[name: string]: Value}): Promise<T[]>;
}
