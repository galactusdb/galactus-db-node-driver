import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Driver,Spatial,DatabaseError,ErrorCodes,encode,decode,DateTime,ZonedDateTime,Node,Relationship} from './index.js';
const lines=name=>readFileSync(new URL('./tests/fixtures/'+name,import.meta.url),'utf8').trimEnd().split(/\r?\n/);
const hex=h=>Buffer.from(h,'hex');
test('golden PackStream and malformed inputs',()=>{
 for(const line of lines('values.tsv')){const [name,h]=line.split('\t');assert.equal(encode(decode(hex(h))).toString('hex'),h,name);assert.equal(encode(decode(hex(h)),{protocol:'4.4'}).toString('hex'),h,name);}
 for(const h of lines('malformed.tsv'))assert.throws(()=>decode(hex(h)));
 for(const v of [1n<<63n,undefined,new Map([[1,2]]),'\ud800'])assert.throws(()=>encode(v));
 const d=new Date(-1234567890123);const t=decode(encode(d));assert(t instanceof DateTime);assert.equal(t.seconds*1000n+t.nanoseconds/1000000n,BigInt(d.getTime()));
 assert.throws(()=>encode(null,{protocol:'3.0'}),RangeError);
});
test('Bolt 5 golden values round-trip in Bolt 5 mode',()=>{
 for(const line of lines('bolt5.tsv')){const [name,h]=line.split('\t');assert.equal(encode(decode(hex(h)),{protocol:'5.4'}).toString('hex'),h,name);}
 const [node,rel]=['node','relationship'].map(n=>decode(hex(lines('bolt5.tsv').find(l=>l.startsWith(n+'\t')).split('\t')[1])));
 assert(node instanceof Node);assert.equal(node.elementId,'1');
 assert(rel instanceof Relationship);assert.deepEqual([rel.elementId,rel.startElementId,rel.endElementId],['2','1','3']);
 // Bolt 4.4 graph values get element ids from their integer ids.
 const old=decode(hex(lines('values.tsv').find(l=>l.startsWith('relationship\t')).split('\t')[1]));
 assert.deepEqual([old.elementId,old.startElementId,old.endElementId],['2','1','3']);
 const zoned=decode(hex(lines('bolt5.tsv').find(l=>l.startsWith('named_zone_utc\t')).split('\t')[1]));
 assert.equal(zoned.basis,'utc');assert.notDeepEqual(zoned,ZonedDateTime.local(0n,0n,'Europe/London'));
});
test('F and I datetimes decode equal; each protocol encodes its own tag',()=>{
 for(const line of lines('datetime_pairs.tsv')){
  const [f,i]=line.split('\t');const a=decode(hex(f)),b=decode(hex(i));
  assert(a instanceof DateTime);assert.deepEqual(a,b);
  assert.equal(encode(a,{protocol:'4.4'}).toString('hex'),f);assert.equal(encode(b,{protocol:'4.4'}).toString('hex'),f);
  assert.equal(encode(a,{protocol:'5.0'}).toString('hex'),i);assert.equal(encode(b,{protocol:'5.4'}).toString('hex'),i);
 }
 assert.deepEqual(DateTime.fromUtc(0n,0n,3600n),new DateTime(3600n,0n,3600n));
});
test('error classification and published codes',()=>{
 assert(Object.isFrozen(ErrorCodes));assert.equal(ErrorCodes.ConstraintValidationFailed,'Galactus.ClientError.Schema.ConstraintValidationFailed');assert.equal(ErrorCodes.TypeError,'Galactus.ClientError.Statement.TypeError');
 const e=new DatabaseError({code:ErrorCodes.SnapshotTooOld,message:'m'});
 assert.deepEqual([e.code,e.message,e.classification,e.category,e.title,e.isTransient,e.isRetryable,e.isClientError,e.isDatabaseError],[ErrorCodes.SnapshotTooOld,'m','TransientError','Transaction','SnapshotTooOld',true,true,false,false]);
 const odd=new DatabaseError({code:'Weird',message:'m'});assert.deepEqual([odd.classification,odd.category,odd.title,odd.isRetryable],[null,null,null,false]);
});
test('connection options are validated before connecting',async()=>{
 const options={username:'gdb',password:'x'};
 await assert.rejects(Driver.connect('bolt://127.0.0.1:1',{...options,trustedCertificates:'ca.pem'}),/trustedCertificates/);
 for(const uri of ['bolt+ssc://h:1','neo4j://h:1','neo4j+s://h:1','bolt://h:1?tls=1'])await assert.rejects(Driver.connect(uri,options));
});
test('real database: types, every spatial family, transactions and failure',{skip:!process.env.GDB_TEST_URI},async()=>{
 const uri=process.env.GDB_TEST_URI,ca=process.env.GDB_TEST_CA_FILE;
 const options={username:'gdb',password:process.env.GDB_TEST_PASSWORD,...(ca?{trustedCertificates:ca}:{})};const d=await Driver.connect(uri,options);
 try{
  assert.equal(d.protocolVersion,process.env.GDB_TEST_EXPECT_BOLT??d.protocolVersion);assert.equal(typeof d.serverAgent,'string');assert.equal(typeof d.connectionId,'string');
  const values={n:(1n<<63n)-1n,b:Buffer.from([0,255]),s:'x'.repeat(70000)};const row=(await d.executeQuery('RETURN $v AS v',{v:values})).records[0].v;assert.equal(row.n,values.n);assert.deepEqual(row.b,values.b);assert.equal(row.s,values.s);
  for(const line of lines('spatial.tsv')){const [domain,wkt]=line.split('\t');const s=(await d.executeQuery('RETURN spatial.fromWKT($wkt,{domain:$domain}) AS shape',{wkt,domain})).records[0].shape;assert(s instanceof Spatial);const r=(await d.executeQuery('RETURN spatial.fromMap($s) AS shape, $nested AS nested',{s,nested:[{shape:s}]})).records[0];assert.deepEqual(r.shape,s);assert.deepEqual(r.nested[0].shape,s);}
  await d.begin();await d.executeQuery('CREATE (:NodeDriverNode {n:1})');await d.rollback();assert.equal((await d.executeQuery('MATCH (n:NodeDriverNode) RETURN count(n) AS n')).records[0].n,0n);
  await d.begin();await d.executeQuery('CREATE (:NodeDriverNode {n:2})');await d.commit();assert.equal((await d.executeQuery('MATCH (n:NodeDriverNode) RETURN n')).records[0].n.properties.n,2n);
  // Element ids are the decimal id text on every protocol.
  const g=(await d.executeQuery('CREATE (a:NodeDriverEl)-[r:NODE_DRIVER_REL]->(b:NodeDriverEl) RETURN a, r, b, id(a) AS ai, id(r) AS ri, id(b) AS bi')).records[0];
  assert.equal(g.a.elementId,String(g.ai));assert.equal(g.b.elementId,String(g.bi));assert.equal(g.r.elementId,String(g.ri));assert.equal(g.r.startElementId,String(g.ai));assert.equal(g.r.endElementId,String(g.bi));
  // Offset and named-zone datetimes. 1720000000 is in British Summer Time (+01:00).
  const offset=DateTime.fromUtc(1720000000n,123456789n,-18000n);assert.deepEqual((await d.executeQuery('RETURN $v AS v',{v:offset})).records[0].v,offset);
  const local=ZonedDateTime.local(1720003600n,5n,'Europe/London'),utc=ZonedDateTime.utc(1720000000n,5n,'Europe/London');
  const expected=d.protocolVersion==='4.4'?local:utc;
  for(const v of [local,utc])assert.deepEqual((await d.executeQuery('RETURN $v AS v',{v})).records[0].v,expected);
  // A database error leaves the driver usable.
  const syntax=await d.executeQuery('INVALID QUERY').then(()=>null,e=>e);
  assert(syntax instanceof DatabaseError);assert.equal(typeof syntax.code,'string');assert.equal(syntax.classification,'ClientError');assert(syntax.isClientError);assert.equal(syntax.isRetryable,false);assert.equal(typeof syntax.category,'string');assert.equal(typeof syntax.title,'string');
  assert.equal((await d.executeQuery('RETURN 1 AS one')).records[0].one,1n);
  // A failure inside a transaction closes it; the server rolls it back.
  await d.begin();await d.executeQuery('CREATE (:NodeDriverTx {n:1})');
  await assert.rejects(d.executeQuery('INVALID QUERY'),DatabaseError);assert.equal(d.transaction,false);await assert.rejects(d.rollback(),/No transaction/);
  assert.equal((await d.executeQuery('MATCH (n:NodeDriverTx) RETURN count(n) AS n')).records[0].n,0n);
  // Unique constraint violation carries the published code.
  await d.executeQuery('CREATE CONSTRAINT FOR (n:NodeDriverKey) REQUIRE n.key IS UNIQUE');await d.executeQuery('CREATE (:NodeDriverKey {key:1})');
  const dup=await d.executeQuery('CREATE (:NodeDriverKey {key:1})').then(()=>null,e=>e);
  assert(dup instanceof DatabaseError);assert.equal(dup.code,ErrorCodes.ConstraintValidationFailed);assert.equal(dup.category,'Schema');assert.equal(dup.title,'ConstraintValidationFailed');
  assert.equal((await d.executeQuery('RETURN decimal($d) AS d',{d:'12.30'})).records[0].d,'12.30');
  assert.equal(typeof d.lastBookmark,d.lastBookmark===null?'object':'string');
 }finally{d.close();}
 await assert.rejects(Driver.connect(uri,{...options,password:'wrong-password'}),DatabaseError);
 if(ca){
  const tlsError=await Driver.connect(uri,{username:'gdb',password:process.env.GDB_TEST_PASSWORD}).then(x=>{x.close();return null;},e=>e);
  assert(tlsError&&!(tlsError instanceof DatabaseError));assert.match(`${tlsError.code} ${tlsError.message}`,/CERT|certificate|SIGNATURE|ISSUER/i);
  await assert.rejects(Driver.connect(uri.replace('bolt+s:','bolt:'),{...options}),/trustedCertificates/);
 }
});
