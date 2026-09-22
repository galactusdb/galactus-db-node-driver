import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Driver,Spatial,DatabaseError,encode,decode,DateTime} from './index.js';
const lines=name=>readFileSync(new URL('./tests/fixtures/'+name,import.meta.url),'utf8').trimEnd().split(/\r?\n/);
test('golden PackStream and malformed inputs',()=>{
 for(const line of lines('values.tsv')){const [name,h]=line.split('\t');assert.equal(encode(decode(Buffer.from(h,'hex'))).toString('hex'),h,name);}
 for(const h of lines('malformed.tsv'))assert.throws(()=>decode(Buffer.from(h,'hex')));
 for(const v of [1n<<63n,undefined,new Map([[1,2]]),'\ud800'])assert.throws(()=>encode(v));
 const d=new Date(-1234567890123);const t=decode(encode(d));assert(t instanceof DateTime);assert.equal(t.seconds*1000n+t.nanoseconds/1000000n,BigInt(d.getTime()));
});
test('real database: types, every spatial family, transactions and failure',{skip:!process.env.GDB_TEST_URI},async()=>{
 const options={username:'gdb',password:process.env.GDB_TEST_PASSWORD};const d=await Driver.connect(process.env.GDB_TEST_URI,options);
 try{
  const values={n:(1n<<63n)-1n,b:Buffer.from([0,255]),s:'x'.repeat(70000)};const row=(await d.executeQuery('RETURN $v AS v',{v:values})).records[0].v;assert.equal(row.n,values.n);assert.deepEqual(row.b,values.b);assert.equal(row.s,values.s);
  for(const line of lines('spatial.tsv')){const [domain,wkt]=line.split('\t');const s=(await d.executeQuery('RETURN spatial.fromWKT($wkt,{domain:$domain}) AS shape',{wkt,domain})).records[0].shape;assert(s instanceof Spatial);const r=(await d.executeQuery('RETURN spatial.fromMap($s) AS shape, $nested AS nested',{s,nested:[{shape:s}]})).records[0];assert.deepEqual(r.shape,s);assert.deepEqual(r.nested[0].shape,s);}
  await d.begin();await d.executeQuery('CREATE (:DriverNode {n:1})');await d.rollback();assert.equal((await d.executeQuery('MATCH (n:DriverNode) RETURN count(n) AS n')).records[0].n,0n);
  await d.begin();await d.executeQuery('CREATE (:DriverNode {n:2})');await d.commit();assert.equal((await d.executeQuery('MATCH (n:DriverNode) RETURN n')).records[0].n.properties.n,2n);
  await assert.rejects(d.executeQuery('INVALID QUERY'),DatabaseError);await assert.rejects(d.executeQuery('RETURN 1'));
 }finally{d.close();}
 await assert.rejects(Driver.connect(process.env.GDB_TEST_URI,{...options,password:'wrong-password'}),DatabaseError);
});
