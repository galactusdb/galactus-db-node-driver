export type Value = null | boolean | bigint | number | string | Uint8Array | Value[] | { [key: string]: Value } | Structure | Spatial;
export type Parameter = Value | Date | Map<string, Parameter> | Parameter[] | { [key: string]: Parameter };
export type Parameters = { [key: string]: Parameter } | Map<string, Parameter>;
export class Structure { constructor(tag: number, fields: Value[]); readonly tag: number; readonly fields: Value[]; }
export class Node extends Structure { constructor(id: bigint, labels: string[], properties: {[key:string]:Value}, elementId?: string); readonly id: bigint; readonly labels: string[]; readonly properties: {[key:string]:Value}; readonly elementId: string; }
export class Relationship extends Structure { constructor(id:bigint,startId:bigint,endId:bigint,type:string,properties:{[key:string]:Value},elementId?:string,startElementId?:string,endElementId?:string); readonly id:bigint; readonly startId:bigint; readonly endId:bigint; readonly type:string; readonly properties:{[key:string]:Value}; readonly elementId:string; readonly startElementId:string; readonly endElementId:string; }
export class UnboundRelationship extends Structure { constructor(id:bigint,type:string,properties:{[key:string]:Value},elementId?:string); readonly id:bigint; readonly type:string; readonly properties:{[key:string]:Value}; readonly elementId:string; }
export class Path extends Structure { constructor(nodes:Node[],relationships:UnboundRelationship[],sequence:bigint[]); readonly nodes:Node[]; readonly relationships:UnboundRelationship[]; readonly sequence:bigint[]; }
export class LocalDate extends Structure { constructor(days:bigint|number); readonly days:bigint; }
export class LocalTime extends Structure { constructor(nanoseconds:bigint|number); readonly nanoseconds:bigint; }
export class Time extends Structure { constructor(nanoseconds:bigint|number,offsetSeconds:bigint|number); readonly nanoseconds:bigint; readonly offsetSeconds:bigint; }
export class LocalDateTime extends Structure { constructor(seconds:bigint|number,nanoseconds:bigint|number); readonly seconds:bigint; readonly nanoseconds:bigint; }
/** Offset datetime. `seconds` are local epoch seconds; `utcSeconds` is `seconds - offsetSeconds`. */
export class DateTime extends Structure { constructor(seconds:bigint|number,nanoseconds:bigint|number,offsetSeconds:bigint|number); readonly seconds:bigint; readonly nanoseconds:bigint; readonly offsetSeconds:bigint; readonly utcSeconds:bigint; static fromUtc(utcSeconds:bigint|number,nanoseconds:bigint|number,offsetSeconds:bigint|number):DateTime; }
/** Named-zone datetime whose `seconds` are local (`f`) or UTC (`i`) according to `basis`. */
export class ZonedDateTime extends Structure { constructor(seconds:bigint|number,nanoseconds:bigint|number,zoneId:string,basis?:'local'|'utc'); readonly seconds:bigint; readonly nanoseconds:bigint; readonly zoneId:string; readonly basis:'local'|'utc'; static local(seconds:bigint|number,nanoseconds:bigint|number,zoneId:string):ZonedDateTime; static utc(seconds:bigint|number,nanoseconds:bigint|number,zoneId:string):ZonedDateTime; }
export class Duration extends Structure { constructor(months:bigint|number,days:bigint|number,seconds:bigint|number,nanoseconds:bigint|number); readonly months:bigint; readonly days:bigint; readonly seconds:bigint; readonly nanoseconds:bigint; }
export class Point2D extends Structure { constructor(srid:bigint|number,x:number,y:number); readonly srid:bigint; readonly x:number; readonly y:number; }
export class Point3D extends Structure { constructor(srid:bigint|number,x:number,y:number,z:number); readonly srid:bigint; readonly x:number; readonly y:number; readonly z:number; }
export class Spatial {
 constructor(domain:'geometry'|'geography',srid:bigint|number,layout:'XY'|'XYZ',model:'planar'|'greatCircle',wkb:Uint8Array);
 readonly domain:'geometry'|'geography'; readonly srid:bigint; readonly layout:'XY'|'XYZ'; readonly model:'planar'|'greatCircle'; readonly wkb:Uint8Array;
 toMap(): {[key:string]:Value}; static fromMap(map:{[key:string]:Value}):Spatial;
}
export class DatabaseError extends Error {
 constructor(metadata:{[key:string]:Value});
 readonly code:string; readonly metadata:{[key:string]:Value};
 readonly classification:string|null; readonly category:string|null; readonly title:string|null;
 readonly isClientError:boolean; readonly isTransient:boolean; readonly isDatabaseError:boolean; readonly isRetryable:boolean;
}
export const VERSION:'0.2.0';
export const ErrorCodes: Readonly<{
 ConstraintValidationFailed:'Galactus.ClientError.Schema.ConstraintValidationFailed';
 TypeError:'Galactus.ClientError.Statement.TypeError';
 ArgumentError:'Galactus.ClientError.Statement.ArgumentError';
 SqlTooManyRows:'Galactus.ClientError.Statement.SqlTooManyRows';
 SqlCastFailed:'Galactus.ClientError.Statement.SqlCastFailed';
 TableTooLarge:'Galactus.ClientError.Statement.TableTooLarge';
 UnsupportedFeature:'Galactus.DatabaseError.Storage.UnsupportedFeature';
 ProcedureNotFound:'Galactus.ClientError.Procedure.ProcedureNotFound';
 LicenseRestricted:'Galactus.ClientError.License.Restricted';
 ReadOnlyReplica:'Galactus.ClientError.Database.ReadOnlyReplica';
 TransactionTimedOut:'Galactus.ClientError.Transaction.TimedOut';
 TransactionTerminated:'Galactus.ClientError.Transaction.Terminated';
 SnapshotTooOld:'Galactus.TransientError.Transaction.SnapshotTooOld';
 Forbidden:'Galactus.ClientError.Security.Forbidden';
 SyntaxError:'Neo.ClientError.Statement.SyntaxError';
 SemanticError:'Neo.ClientError.Statement.SemanticError';
 Unauthorized:'Neo.ClientError.Security.Unauthorized';
 DatabaseNotFound:'Neo.ClientError.Database.DatabaseNotFound';
}>;
export type BoltProtocol = '4.4'|'5.0'|'5.1'|'5.2'|'5.3'|'5.4';
export interface Result { keys:string[]; records:{[key:string]:Value}[]; summary:{[key:string]:Value}; }
export class Driver {
 private constructor();
 static connect(uri:string,options:{username:string;password:string;database?:string;timeout?:number;trustedCertificates?:string}):Promise<Driver>;
 readonly protocolVersion:BoltProtocol; readonly serverAgent:string|null; readonly connectionId:string|null; readonly lastBookmark:string|null;
 readonly transaction:boolean;
 executeQuery(query:string,parameters?:Parameters):Promise<Result>;
 begin(options?:{readOnly?:boolean}):Promise<Driver>;
 commit():Promise<{[key:string]:Value}>; rollback():Promise<void>; close():void;
}
export function encode(value:Parameter,options?:{protocol?:BoltProtocol}):Uint8Array;
export function decode(bytes:Uint8Array):Value;
