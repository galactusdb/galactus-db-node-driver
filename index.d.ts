export type Value = null | boolean | bigint | number | string | Uint8Array | Value[] | { [key: string]: Value } | Structure | Spatial;
export type Parameter = Value | Date | Map<string, Parameter> | Parameter[] | { [key: string]: Parameter };
export type Parameters = { [key: string]: Parameter } | Map<string, Parameter>;
export class Structure { constructor(tag: number, fields: Value[]); readonly tag: number; readonly fields: Value[]; }
export class Node extends Structure { constructor(id: bigint, labels: string[], properties: {[key:string]:Value}); readonly id: bigint; readonly labels: string[]; readonly properties: {[key:string]:Value}; }
export class Relationship extends Structure { constructor(id:bigint,startId:bigint,endId:bigint,type:string,properties:{[key:string]:Value}); readonly id:bigint; readonly startId:bigint; readonly endId:bigint; readonly type:string; readonly properties:{[key:string]:Value}; }
export class UnboundRelationship extends Structure { constructor(id:bigint,type:string,properties:{[key:string]:Value}); readonly id:bigint; readonly type:string; readonly properties:{[key:string]:Value}; }
export class Path extends Structure { constructor(nodes:Node[],relationships:UnboundRelationship[],sequence:bigint[]); readonly nodes:Node[]; readonly relationships:UnboundRelationship[]; readonly sequence:bigint[]; }
export class LocalDate extends Structure { constructor(days:bigint|number); readonly days:bigint; }
export class LocalTime extends Structure { constructor(nanoseconds:bigint|number); readonly nanoseconds:bigint; }
export class Time extends Structure { constructor(nanoseconds:bigint|number,offsetSeconds:bigint|number); readonly nanoseconds:bigint; readonly offsetSeconds:bigint; }
export class LocalDateTime extends Structure { constructor(seconds:bigint|number,nanoseconds:bigint|number); readonly seconds:bigint; readonly nanoseconds:bigint; }
export class DateTime extends Structure { constructor(seconds:bigint|number,nanoseconds:bigint|number,offsetSeconds:bigint|number); readonly seconds:bigint; readonly nanoseconds:bigint; readonly offsetSeconds:bigint; }
export class ZonedDateTime extends Structure { constructor(seconds:bigint|number,nanoseconds:bigint|number,zoneId:string); readonly seconds:bigint; readonly nanoseconds:bigint; readonly zoneId:string; }
export class Duration extends Structure { constructor(months:bigint|number,days:bigint|number,seconds:bigint|number,nanoseconds:bigint|number); readonly months:bigint; readonly days:bigint; readonly seconds:bigint; readonly nanoseconds:bigint; }
export class Point2D extends Structure { constructor(srid:bigint|number,x:number,y:number); readonly srid:bigint; readonly x:number; readonly y:number; }
export class Point3D extends Structure { constructor(srid:bigint|number,x:number,y:number,z:number); readonly srid:bigint; readonly x:number; readonly y:number; readonly z:number; }
export class Spatial {
 constructor(domain:'geometry'|'geography',srid:bigint|number,layout:'XY'|'XYZ',model:'planar'|'greatCircle',wkb:Uint8Array);
 readonly domain:'geometry'|'geography'; readonly srid:bigint; readonly layout:'XY'|'XYZ'; readonly model:'planar'|'greatCircle'; readonly wkb:Uint8Array;
 toMap(): {[key:string]:Value}; static fromMap(map:{[key:string]:Value}):Spatial;
}
export class DatabaseError extends Error { readonly code:string; readonly metadata:{[key:string]:Value}; }
export interface Result { keys:string[]; records:{[key:string]:Value}[]; summary:{[key:string]:Value}; }
export class Driver {
 private constructor();
 static connect(uri:string,options:{username:string;password:string;database?:string;timeout?:number}):Promise<Driver>;
 executeQuery(query:string,parameters?:Parameters):Promise<Result>;
 begin(options?:{readOnly?:boolean}):Promise<Driver>;
 commit():Promise<{[key:string]:Value}>; rollback():Promise<void>; close():void;
}
export function encode(value:Parameter):Uint8Array;
export function decode(bytes:Uint8Array):Value;
