// The mapper's shared test (docs/MAPPER.md), and its checks that need no database.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Driver, Node} from './index.js';
import {Mapper, MappingError, defineNode, defineRelationship, propertiesOf, fromNode} from './mapper.js';

class Person {}
defineNode(Person, {key: 'id', properties: {id: 'id', name: 'name', email: 'email_address', age: 'age'}});
class Company {}
defineNode(Company, {key: 'name', properties: ['name']});
class WorksAt {}
defineRelationship(WorksAt, {type: 'WORKS_AT', properties: ['since', 'role']});
class Note {}
defineNode(Note, {properties: ['text']});

const person = values => Object.assign(new Person(), {id: null, name: null, email: null, age: null}, values);
const company = name => Object.assign(new Company(), {name});
const worksAt = (since, role) => Object.assign(new WorksAt(), {since, role});
const note = text => Object.assign(new Note(), {text});

test('mapper: properties, conversion and refused declarations', () => {
  assert.deepEqual(propertiesOf(person({id: 1n, name: 'Ann', email: 'ann@example.com'})),
                   {id: 1n, name: 'Ann', email_address: 'ann@example.com', age: null});
  const ann = fromNode(Person, new Node(7n, ['Person'], {id: 1n, name: 'Ann', email_address: 'a@b', extra: true}, '7'));
  assert(ann instanceof Person);
  assert.deepEqual(ann, person({id: 1n, name: 'Ann', email: 'a@b'}));
  assert.deepEqual(fromNode(Person, new Node(7n, ['Person'], {id: 2n}, '7')), person({id: 2n}));
  assert.throws(() => fromNode(Person, {id: 1n}), MappingError);
  assert.throws(() => defineNode(class Bad {}, {label: 'Bad`Label'}), MappingError);
  assert.throws(() => defineNode(class Bad {}, {properties: {x: 'a`b'}}), MappingError);
  assert.throws(() => defineNode(class Bad {}, {key: 'missing', properties: ['x']}), MappingError);
  assert.throws(() => propertiesOf({}), MappingError);
});

test('mapper: the shared story on a real database', {skip: !process.env.GDB_TEST_URI}, async () => {
  const ca = process.env.GDB_TEST_CA_FILE;
  const driver = await Driver.connect(process.env.GDB_TEST_URI,
      {username: 'gdb', password: process.env.GDB_TEST_PASSWORD, ...(ca ? {trustedCertificates: ca} : {})});
  try {
    await driver.executeQuery('MATCH (n) WHERE n:Person OR n:Company OR n:Note DETACH DELETE n');
    const mapper = new Mapper(driver);
    const ids = list => list.map(p => p.id);
    // 2. create, find, and the stored property name
    const ann = person({id: 1n, name: 'Ann', email: 'ann@example.com'});
    assert.deepEqual(await mapper.create(ann), ann);
    assert.deepEqual(await mapper.find(Person, 1n), ann);
    const raw = (await driver.executeQuery('MATCH (p:Person {id: 1}) RETURN p.email_address AS e, p.email AS none')).records[0];
    assert.deepEqual([raw.e, raw.none], ['ann@example.com', null]);
    // 3. save changes, and creates
    ann.age = 41n;
    assert.equal((await mapper.save(ann)).age, 41n);
    assert.deepEqual(await mapper.save(person({id: 2n, name: 'Bob'})), person({id: 2n, name: 'Bob'}));
    assert.equal((await driver.executeQuery('MATCH (p:Person) RETURN count(p) AS c')).records[0].c, 2n);
    // 4. a missing key
    assert.equal(await mapper.find(Person, 99n), null);
    // 5. find all
    await mapper.save(person({id: 3n, name: 'Bob', age: 41n}));
    assert.deepEqual(ids(await mapper.findAll(Person)), [1n, 2n, 3n]);
    assert.deepEqual(ids(await mapper.findAll(Person, {name: 'Bob'})), [2n, 3n]);
    assert.deepEqual(ids(await mapper.findAll(Person, {name: 'Bob', age: 41n})), [3n]);
    assert.deepEqual(ids(await mapper.findAll(Person, {}, 2)), [1n, 2n]);
    await assert.rejects(mapper.findAll(Person, {height: 1n}), MappingError);
    // 6. relate and related
    const acme = await mapper.save(company('Acme'));
    assert.deepEqual(await mapper.relate(ann, worksAt(2020n, 'engineer'), acme), worksAt(2020n, 'engineer'));
    assert.deepEqual(await mapper.relate(ann, worksAt(2021n, 'lead'), acme), worksAt(2021n, 'lead'));
    assert.deepEqual(await mapper.related(ann, WorksAt, Company), [[worksAt(2021n, 'lead'), company('Acme')]]);
    await assert.rejects(mapper.relate(person({id: 77n, name: 'Nobody'}), worksAt(1n, 'x'), acme), MappingError);
    // 7. a hand-written statement
    const found = await mapper.query(Person, 'MATCH (p:Person) WHERE p.age >= $age RETURN p ORDER BY p.id', {age: 41n});
    assert.deepEqual(ids(found), [1n, 3n]);
    assert.deepEqual(await mapper.query(Company, 'RETURN {name: $n} AS c', {n: 'Made up'}), [company('Made up')]);
    // 8. delete
    assert.equal(await mapper.delete(Person, 3n), true);
    assert.equal(await mapper.delete(Person, 3n), false);
    // 9. no key
    assert.deepEqual(await mapper.create(note('hello')), note('hello'));
    await assert.rejects(mapper.save(note('x')), MappingError);
    await assert.rejects(mapper.find(Note, 'x'), MappingError);
    await assert.rejects(mapper.find(Person, null), MappingError);
    // the operations join an open transaction
    await driver.begin();
    await mapper.save(person({id: 50n, name: 'Temporary'}));
    await driver.rollback();
    assert.equal(await mapper.find(Person, 50n), null);
  } finally {
    driver.close();
  }
});
