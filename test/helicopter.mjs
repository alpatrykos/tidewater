import assert from 'node:assert/strict';
import { Vector3, PerspectiveCamera } from '../src/engine/index.js';
import { HeliModel, HELI } from '../src/world/HeliModel.js';
import { HeliController } from '../src/player/HeliController.js';
import { Player } from '../src/player/Player.js';

// flat beach at y = 1.5 for x < 40, sea (bed at -6) beyond; a solid box at z = -60
const terrain = { heightAt: ( x ) => x < 40 ? 1.5 : - 6, normalAt: ( x, z, out ) => out.set( 0, 1, 0 ) };
const wall = { solid: true, walkable: false, bottom: 0, top: 30, center: new Vector3( 0, 0, - 60 ), half: new Vector3( 10, 15, 1 ), radius: 11 };
const colliders = {
	boxes: [ wall ], cylinders: [],
	groundHeightAt: () => - Infinity,
	resolveCapsule( p, r ) {

		// the wall spans x -10..10, z -61..-59
		if ( Math.abs( p.x ) < 10 + r && p.z < - 59 + r && p.z > - 61 - r && p.y < 30 ) { p.z = - 59 + r; return true; }
		return false;

	},
};

const model = new HeliModel();
assert.ok( model.group.children.length >= 3, 'frame, main rotor and tail rotor' );
for ( const o of [ model.rotor, model.tailRotor ] ) assert.ok( o.children[ 0 ].geometry.attributes.position.count > 0 );

const heli = new HeliController( { model, terrain, colliders, position: new Vector3( 0, 0, 0 ), yaw: 0 } );
assert.equal( heli.position.y, 1.5, 'parked on the ground' );
assert.ok( heli.grounded );

const step = ( s, dt = 1 / 60 ) => { for ( let t = 0; t < s; t += dt ) heli.update( dt, 0 ); };

// unoccupied: stays put, rotor still
step( 2 );
assert.equal( heli.position.y, 1.5 );
assert.equal( heli.spool, 0 );

// aboard, collective up before the rotor is at speed: cannot lift off yet
heli.occupied = true;
heli.controls.climb = 1;
step( 2 );
assert.ok( heli.spool > 0.45 && heli.spool < 0.55 );
assert.equal( heli.position.y, 1.5, 'no lift-off at half rotor speed' );
step( 4 );
assert.equal( heli.spool, 1 );
assert.ok( heli.position.y > 5, `climbs once spooled (y ${ heli.position.y })` );
assert.ok( ! heli.grounded );

// hover: holds altitude
heli.controls.climb = 0;
step( 3 );
const y0 = heli.position.y;
step( 3 );
assert.ok( Math.abs( heli.position.y - y0 ) < 0.2, 'hovers with the collective centred' );

// forward flight (nose along -Z at yaw 0)
heli.controls.fwd = 1;
step( 5.5 );
assert.ok( heli.position.z > - 58, `not at the wall yet (${ heli.position.z })` );
assert.ok( heli.tilt > 0.2, 'nose down' );
assert.ok( heli.velocity.z < - 9 && heli.speed < 18, `cruise speed ${ heli.speed }` );
assert.ok( Math.abs( heli.velocity.x ) < 0.1 );
// the wall at z = -60 stops it
step( 8 );
assert.ok( heli.position.z >= - 59.01, 'pushed back out of solid colliders' );
heli.controls.fwd = 0;

// turn right 90° and strafe right
heli.yaw = - Math.PI / 2; // nose along +X
heli.controls.fwd = 1;
heli.controls.boost = true;
step( 12 );
assert.ok( heli.velocity.x > 15, `boosted along +X (${ heli.velocity.x })` );
assert.ok( heli.position.x > 40, 'out over the sea' );
heli.controls.fwd = 0;
heli.controls.boost = false;
step( 8 );
assert.ok( heli.speed < 3, 'slows down with the stick centred' );

// descend onto the water
heli.controls.climb = - 1;
step( 15 );
assert.ok( heli.grounded, 'settled on the sea' );
assert.ok( Math.abs( heli.position.y - 0 ) < 1e-6, 'skids at the water surface' );
assert.ok( [ heli.position.x, heli.position.y, heli.position.z, heli.velocity.x, heli.velocity.y, heli.velocity.z ].every( Number.isFinite ) );

// ---- the player: board, fly, get out
const keys = new Set(), hits = new Set();
const input = {
	down: ( k ) => keys.has( k ), hit: ( k ) => hits.has( k ),
	consumeLook: () => ( { x: 0, y: 0 } ), consumeWheel: () => 0,
};
const query = { allocate: () => 0, setPoint() {}, cpuValid: true, cpu: new Float32Array( 64 * 4 ) };
const camera = new PerspectiveCamera( 60, 1, 0.1, 1000 );
const heli2 = new HeliController( { model: new HeliModel(), terrain, colliders, position: new Vector3( 5, 0, 5 ), yaw: 0 } );
const player = new Player( { camera, input, terrain, colliders, query, boat: null, heli: heli2 } );
player.position.set( 6.2, 1.5, 5 );
player.mode = 'walk';
const frame = ( s, dt = 1 / 60 ) => {

	for ( let t = 0; t < s; t += dt ) {

		heli2.update( dt, player.waterH );
		player.update( dt );
		hits.clear();

	}

};

frame( 0.1 );
assert.equal( player.prompt && player.prompt.text, 'Fly helicopter' );
hits.add( 'KeyE' );
frame( 1 / 60 );
assert.equal( player.mode, 'heli' );
assert.ok( heli2.occupied );
keys.add( 'Space' );
frame( 6 );
assert.ok( heli2.position.y > 4, 'the pilot takes off' );
assert.ok( camera.position.distanceTo( heli2.position ) > 4, 'chase camera behind' );
hits.add( 'KeyE' );
frame( 1 / 60 );
assert.equal( player.mode, 'heli', 'cannot get out in the air' );
keys.delete( 'Space' );
keys.add( 'KeyC' );
frame( 6 );
assert.ok( heli2.grounded );
keys.delete( 'KeyC' );
hits.add( 'KeyV' );
frame( 1 / 60 );
assert.ok( camera.position.distanceTo( heli2.toWorld( HELI.eye, new Vector3() ) ) < 1e-4, 'seat camera' );
hits.add( 'KeyE' );
frame( 1 / 60 );
assert.equal( player.mode, 'walk' );
assert.ok( ! heli2.occupied );
assert.ok( Math.hypot( player.position.x - heli2.position.x, player.position.z - heli2.position.z ) > 1, 'steps out beside it' );
frame( 8 );
assert.equal( heli2.spool, 0, 'rotor winds down' );

console.log( 'helicopter ok' );
