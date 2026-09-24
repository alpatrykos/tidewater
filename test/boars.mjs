import assert from 'node:assert/strict';
import { Vector3 } from '../src/engine/index.js';
import { Colliders } from '../src/world/Colliders.js';

// A missing simulation, unsafe route, or lost response to the walker must fail here.
const module = await import( '../src/world/wildlife/Boars.js' ).catch( () => null );
assert.ok( module?.Boars, 'ambient boars have a CPU simulation' );
const { Boars } = module;
const flat = { heightAt: () => 6 };
const camera = { position: { x: 30, y: 8, z: - 110 } };
const batch = { rows: [], write( row ) { this.rows.push( structuredClone( row ) ); } };
const step = ( boars, dt = 1 / 30, viewer = null, cam = camera ) => {

	batch.rows.length = 0;
	boars.update( dt, viewer, batch, cam );
	return batch.rows;

};
const snapshot = ( boars ) => boars.agents.map( a => [ a.x, a.y, a.z, a.phase, a.state ] );

const seeded = new Boars( { terrain: flat, seed: 903 } );
assert.ok( seeded.agents.length >= 10 && seeded.agents.length <= 12, 'suitable habitat has a small visible population' );
assert.deepEqual( snapshot( seeded ), snapshot( new Boars( { terrain: flat, seed: 903 } ) ), 'revisiting an island keeps the same population' );
assert.notDeepEqual( snapshot( seeded ), snapshot( new Boars( { terrain: flat, seed: 904 } ) ), 'the world seed changes the population' );

// Removing herd clearance used to let a wandering adult pass through a rooting neighbour.
const neighbours = new Boars( { terrain: flat } );
for ( let frame = 0; frame < 1200; frame ++ ) {

	step( neighbours, 1 / 60 );
	for ( let i = 0; i < neighbours.agents.length; i ++ ) for ( let j = i + 1; j < neighbours.agents.length; j ++ ) {

		const a = neighbours.agents[ i ], b = neighbours.agents[ j ];
		assert.ok( Math.hypot( a.x - b.x, a.z - b.z ) >= 1.6, 'adults cannot wander through one another' );

	}

}
const rooting = new Boars( { terrain: flat } );
const rooter = rooting.agents[ 0 ];
Object.assign( rooter, { state: 'root', t: 20, speed: 0, tx: rooter.x, tz: rooter.z } );
const rootStart = [ rooter.x, rooter.z, rooter.phase ];
for ( let i = 0; i < 60; i ++ ) step( rooting, 1 / 60 );
assert.deepEqual( [ rooter.x, rooter.z ], rootStart.slice( 0, 2 ), 'rooting stays planted' );
assert.ok( rooter.phase > rootStart[ 2 ] + 0.1, 'stationary rooting keeps its snout animation alive' );
for ( const terrain of [ { heightAt: () => - 2 }, { heightAt: ( x ) => 100 + x * 2 }, { heightAt: () => NaN } ] ) {

	assert.equal( new Boars( { terrain } ).agents.length, 0, 'no water, steep, or missing habitat fallback may place unsafe boars' );

}

// The first population provides real initial sites; adding obstructions there must displace them.
const blocked = new Colliders();
const footprints = [];
const trees = [], palms = [];
seeded.agents.forEach( ( a, i ) => {

	if ( i % 4 === 0 ) blocked.addBox( new Vector3( a.x, 6.5, a.z ), new Vector3( 3, 1, 2 ), Math.PI / 4, { walkable: true } );
	if ( i % 4 === 1 ) blocked.addCylinder( a.x, a.z, 2, 5, 9 );
	if ( i % 4 === 2 ) footprints.push( { x: a.x, z: a.z, r: 3 } );
	if ( i % 4 === 3 ) trees.push( { x: a.x, y: 6, z: a.z, s: 2, sy: 1, yaw: 0, la: 0, l: 1, H: 25, seed: 0.4 } );

} );
palms.push( { x: 10, y: 6, z: - 110, s: 2, sy: 1, yaw: 0, seed: 0.3 } );
const displaced = new Boars( { terrain: flat, seed: 903, colliders: blocked, village: { getFootprints: () => footprints }, vegetation: { records: { trees, palms } } } );
assert.ok( displaced.agents.length > 0, 'safe sites remain available around obstacles' );
for ( const a of displaced.agents ) {

	const p = new Vector3( a.x, a.y, a.z );
	assert.equal( blocked.resolveCapsule( p, 0.8, 1.1, 0 ), false, 'bodies start outside boxes and cylinders' );
	for ( const f of footprints ) assert.ok( Math.hypot( a.x - f.x, a.z - f.z ) > f.r + 0.8 );
	for ( const t of trees.concat( palms ) ) assert.ok( Math.hypot( a.x - t.x, a.z - t.z ) > 1.1, 'bodies start outside trunks' );

}

const herd = new Boars( { terrain: flat, seed: 9 } );
const a = herd.agents[ 0 ];
const closeCam = { position: { x: a.x, y: a.y + 10, z: a.z } };
const walker = { x: a.x - 3, y: a.y, z: a.z, speed: 0, mode: 'walk' };
const originalDistance = Math.hypot( a.x - walker.x, a.z - walker.z );
for ( let i = 0; i < 90; i ++ ) step( herd, 1 / 30, walker, closeCam );
assert.ok( Math.hypot( a.x - walker.x, a.z - walker.z ) > originalDistance + 4, 'approaching on foot makes boars retreat' );
const calmStates = new Set();
for ( let i = 0; i < 1500; i ++ ) {

	step( herd, 1 / 30, null, closeCam );
	if ( i > 300 ) calmStates.add( a.state );

}
assert.ok( ! calmStates.has( 'flee' ), 'boars recover when the threat leaves' );
assert.ok( calmStates.has( 'root' ) && calmStates.has( 'wander' ), 'calm boars forage and roam' );

for ( const viewer of [ { mode: 'boat', y: 6 }, { mode: 'fly', y: 100 } ] ) {

	const control = new Boars( { terrain: flat, seed: 40 } );
	const watched = new Boars( { terrain: flat, seed: 40 } );
	const a = watched.agents[ 0 ];
	const v = { x: a.x, z: a.z, speed: 3, ...viewer };
	for ( let i = 0; i < 60; i ++ ) { step( control ); step( watched, 1 / 30, v ); }
	assert.deepEqual( snapshot( watched ), snapshot( control ), 'boats and high cameras do not scare boars' );

}

// These barriers separate safe endpoints: testing the target alone would tunnel through them.
const routeCase = ( terrain, colliders = null, vegetation = null, check ) => {

	const boars = new Boars( { terrain, colliders, vegetation } );
	const a = boars.agents[ 0 ];
	assert.ok( a, 'the route fixture has safe spawning ground' );
	boars.agents = [ a ];
	Object.assign( a, { x: 0, y: 6, z: 0, tx: 12, tz: 0, state: 'wander', t: 60, speed: 1, home: { x: 0, z: 0 } } );
	const cam = { position: { x: 0, y: 8, z: 0 } };
	for ( let i = 0; i < 500; i ++ ) {

		const before = { x: a.x, z: a.z };
		step( boars, i === 20 ? 10 : 1 / 30, null, cam );
		assert.ok( Math.hypot( a.x - before.x, a.z - before.z ) < 0.5, 'a delayed frame cannot teleport a boar' );
		check( a, before );

	}

};
routeCase( { heightAt: ( x ) => x > 4 && x < 6 ? - 2 : 6 }, null, null, a => assert.ok( a.x < 4, 'boars cannot cross a water channel to a safe endpoint' ) );
routeCase( { heightAt: ( x ) => x > 4 && x < 6 ? 12 : 6 }, null, null, a => assert.ok( a.x < 4, 'boars cannot cross a cliff to a safe endpoint' ) );
const wall = new Colliders();
wall.addBox( new Vector3( 5, 7, 0 ), new Vector3( 0.4, 2, 100 ), Math.PI / 4 );
routeCase( flat, wall, null, a => assert.ok( a.x - a.z < 5, 'a rotated wall remains impassable' ) );
const rock = new Colliders();
rock.addCylinder( 5, 0, 2, 5, 10 );
routeCase( flat, rock, null, a => assert.ok( Math.hypot( a.x - 5, a.z ) >= 2.8, 'movement keeps the whole body outside a rock' ) );
routeCase( flat, null, { records: { trees: [ { x: 5, y: 6, z: 0, s: 2, H: 25 } ], palms: [] } }, a => assert.ok( Math.hypot( a.x - 5, a.z ) > 1.1, 'movement avoids tree trunks' ) );

const frozen = snapshot( herd );
for ( let i = 0; i < 60; i ++ ) assert.equal( step( herd, 1 / 30, null, { position: { x: 5000, y: 50, z: 5000 } } ).length, 0 );
assert.deepEqual( snapshot( herd ), frozen, 'distant wildlife spends no time moving or animating' );
const resumed = step( herd, 1 / 30, null, closeCam );
assert.ok( resumed.length > 0 );
for ( const r of resumed ) {

	assert.deepEqual( [ r.px, r.py, r.pz, r.pScale, r.pPhase, r.pStride, r.pRoot, ...r.pq ], [ r.x, r.y, r.z, r.scale, r.phase, r.stride, r.root, ...r.q ], 'reactivation cannot smear stale poses into motion vectors' );

}
for ( const dt of [ 0, - 1, NaN, Infinity, 1 / 60 ] ) for ( const r of step( herd, dt, null, closeCam ) ) {

	for ( const value of Object.values( r ).flat() ) if ( typeof value === 'number' ) assert.ok( Number.isFinite( value ), 'all render record values remain finite' );
	assert.ok( r.stride >= 0 && r.stride <= 1 && r.root >= 0 && r.root <= 1 );
	assert.ok( Math.abs( Math.hypot( ...r.q ) - 1 ) < 1e-5, 'ground orientation stays normalized' );

}
console.log( 'Boars: safe seeded habitat, ground traversal, flight and recovery, culling and pose continuity passed' );
