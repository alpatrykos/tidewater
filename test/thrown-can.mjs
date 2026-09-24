import assert from 'node:assert/strict';
import { Scene, Vector3, Quaternion, Euler } from '../src/engine/index.js';
import { ThrownCan } from '../src/game/ThrownCan.js';
import { createCanGround } from '../src/game/CanGround.js';
import { BoatController } from '../src/player/BoatController.js';
import { Player } from '../src/player/Player.js';
import { HullLines } from '../src/world/boat/HullLines.js';

const scene = new Scene();
const impacts = [];
const terrain = { heightAt: () => 0 };
const can = new ThrownCan( { scene, terrain, audio: { canImpact: strength => impacts.push( strength ) } } );
await can.ready;
const position = new Vector3( 0, 1.6, 0 );
const rotation = new Quaternion();
const velocity = new Vector3( 0.7, 0.65, - 2.5 );

assert.equal( can.visible, false, 'the empty can does not appear before release' );
can.update( 1 );
assert.equal( can.visible, false );
assert.equal( can.throw( position, rotation, velocity ), true );
assert.equal( can.visible, true );
assert.equal( can.settled, false );
assert.ok( can.model.position.distanceTo( position ) < 1e-8, 'release begins at the actual hand position' );
assert.equal( can.throw( position, rotation, velocity ), false, 'a single can cannot be thrown twice' );
can.update( 0.15 );
assert.ok( can.model.position.z < - 0.25, 'the can travels with the release velocity' );
assert.ok( can.model.quaternion.angleTo( rotation ) > 0.2, 'the airborne can tumbles' );
assert.ok( position.equals( new Vector3( 0, 1.6, 0 ) ), 'simulation owns copies of release inputs' );

// Ground collision must prevent tunnelling and leave a persistent side-resting can.
for ( let i = 0; i < 900 && ! can.settled; i ++ ) {

	can.update( 1 / 120 );

}
assert.equal( can.settled, true );
assert.equal( can.visible, true );
assert.ok( can.model.position.y >= 0.032 && can.model.position.y < 0.04, 'a resting cylinder sits on its side, above the ground' );
const axis = new Vector3( 0, 1, 0 ).applyQuaternion( can.model.quaternion );
assert.ok( Math.abs( axis.y ) < 0.02, 'the long axis lies on the surface' );
assert.ok( impacts.length > 0 && impacts.length < 8, 'impacts make discrete sounds without ground-contact chatter' );
assert.ok( impacts.every( x => x >= 0.1 && x <= 1 ) );
const restPosition = can.model.position.clone(), restRotation = can.model.quaternion.clone();
can.update( 10 );
assert.ok( can.model.position.equals( restPosition ) );
assert.ok( can.model.quaternion.angleTo( restRotation ) < 1e-7 );

// A fresh game hides the old can, and a throw onto a slope uses that surface's height.
can.reset();
assert.equal( can.visible, false );
assert.equal( can.settled, false );
terrain.heightAt = ( x, z ) => 2 + 0.12 * x - 0.08 * z;
can.throw( new Vector3( 0, 3.3, 0 ), rotation, new Vector3( 0.3, 0.3, - 1.3 ) );
for ( let i = 0; i < 900 && ! can.settled; i ++ ) can.update( 1 / 120 );
assert.equal( can.settled, true );
const normal = new Vector3( - 0.12, 1, 0.08 ).normalize();
axis.set( 0, 1, 0 ).applyQuaternion( can.model.quaternion );
assert.ok( Math.abs( axis.dot( normal ) ) < 0.02, 'the resting can follows the terrain slope' );
assert.ok( can.model.position.y > terrain.heightAt( can.model.position.x, can.model.position.z ) );
assert.ok( Number.isFinite( can.model.position.length() ) );

// The height query's ceiling admits the pier below the can, without snagging an
// overhead floor. An edge beside its centre must not become a near-vertical slope.
for ( const belowEdge of [ 0, - Infinity ] ) {

	can.reset();
	terrain.heightAt = ( x, z, maxY ) => {

		if ( maxY >= 6 ) return 6;
		if ( maxY >= 2 && x < 0.2 ) return 2;
		return belowEdge;

	};
	can.throw( new Vector3( 0.18, 3.1, 0 ), rotation, new Vector3( 0, 0.15, - 0.4 ) );
	for ( let i = 0; i < 900 && ! can.settled; i ++ ) can.update( 1 / 120 );
	assert.equal( can.settled, true, 'can lands on the elevated platform selected beneath its height' );
	assert.ok( can.model.position.y > 2.03 && can.model.position.y < 2.04, 'pier edge sampling must not place the can on the lower ground or overhead floor' );
	assert.ok( Math.abs( can.model.position.x - 0.18 ) < 0.005, 'the platform edge does not invent a sideways collision impulse' );
	axis.set( 0, 1, 0 ).applyQuaternion( can.model.quaternion );
	assert.ok( Math.abs( axis.y ) < 0.02 );

}
// Exercise the real player's deck-floor lookup and the controller's boat transform.
const boat = Object.create( BoatController.prototype );
boat.position = new Vector3( 7, 0.4, - 9 );
boat.quaternion = new Quaternion().setFromEuler( new Euler( 0.08, 0.35, - 0.1 ) );
boat.model = { lines: new HullLines(), colliders: [] };
const player = Object.create( Player.prototype );
player.boat = boat;
player.terrain = { heightAt: () => - 20 };
player.colliders = { groundHeightAt: () => - Infinity };
const ground = createCanGround( player, boat );
const deckPoint = boat.toWorld( new Vector3( 0, boat.model.lines.deckY, - 1.5 ), new Vector3() );
assert.ok( Math.abs( ground.heightAt( deckPoint.x, deckPoint.z, deckPoint.y + 1 ) - deckPoint.y ) < 0.001, 'rolled and pitched deck is sampled in world space' );
assert.equal( ground.heightAt( deckPoint.x, deckPoint.z, deckPoint.y - 0.3 ), - 20, 'deck above the collision ceiling is excluded' );
const outside = boat.toWorld( new Vector3( 3, 0.35, - 1 ), new Vector3() );
assert.equal( ground.heightAt( outside.x, outside.z, 3 ), - 20, 'deck collision does not extend beyond the hull' );
boat.model.colliders.push( { walkable: true, center: new Vector3( 0, 0.7, - 1.5 ), half: new Vector3( 0.4, 0.2, 0.4 ) } );
const raisedDeck = boat.toWorld( new Vector3( 0, 0.9, - 1.5 ), new Vector3() );
assert.ok( Math.abs( ground.heightAt( raisedDeck.x, raisedDeck.z, raisedDeck.y + 0.5 ) - raisedDeck.y ) < 0.001, 'walkable deck equipment uses its actual top surface' );
// At this corner the point projected from the collision ceiling lies outside the
// box, even though the vertical ray intersects the actual top inside its bounds.
assert.ok( Math.abs( ground.heightAt( 6.32090488, - 9.88678986, 1.56943329 ) - 1.40943329 ) < 0.00001,
	'the exact reported rotated-box corner resolves to its 1.40943329m top, not the lower deck' );
const boxCan = new ThrownCan( { scene, terrain: ground, template: can } );
const boxDrop = boat.toWorld( new Vector3( - 0.34, 0.9, - 1.2 ), new Vector3() );
boxCan.throw( boxDrop.add( new Vector3( 0, 0.25, 0 ) ), boat.quaternion, new Vector3() );
for ( let i = 0; i < 1000 && ! boxCan.settled; i ++ ) boxCan.update( 1 / 120 );
assert.equal( boxCan.settled, true );
const boxLocal = boxCan.model.position.clone().sub( boat.position ).applyQuaternion( boat.quaternion.clone().invert() );
assert.ok( boxLocal.y > 0.93 && boxLocal.y < 0.94, 'a can near the raised box corner settles on its top' );
boxCan.reset();
boat.model.colliders.length = 0;

can.reset();
can.terrain = ground;
can.throw( deckPoint.clone().add( new Vector3( 0, 0.9, 0 ) ), boat.quaternion, new Vector3( 0, 0.1, 0 ) );
for ( let i = 0; i < 1000 && ! can.settled; i ++ ) can.update( 1 / 120 );
assert.equal( can.settled, true );
assert.ok( can.model.position.y > - 1, 'discarded can lands on deck rather than seabed' );
const inverse = boat.quaternion.clone().invert();
const localPosition = can.model.position.clone().sub( boat.position ).applyQuaternion( inverse );
const localRotation = inverse.clone().multiply( can.model.quaternion );
boat.position.add( new Vector3( 3, 0.2, - 2 ) );
boat.quaternion.multiply( new Quaternion().setFromEuler( new Euler( 0.02, 0.4, 0.07 ) ) );
can.update( 1 / 60 );
const carriedPosition = boat.toWorld( localPosition, new Vector3() );
const carriedRotation = boat.quaternion.clone().multiply( localRotation );
assert.ok( can.model.position.distanceTo( carriedPosition ) < 1e-6, 'settled can travels with the moving deck' );
assert.ok( can.model.quaternion.angleTo( carriedRotation ) < 1e-6, 'settled can rocks and turns with the boat' );

// Extra litter slots share expensive render resources while owning their transforms.
const clone = new ThrownCan( { scene, terrain: ground, template: can } );
assert.equal( clone.ready, can.ready );
const sourceMeshes = [], cloneMeshes = [];
can.model.traverse( object => { if ( object.isMesh ) sourceMeshes.push( object ); } );
clone.model.traverse( object => { if ( object.isMesh ) cloneMeshes.push( object ); } );
assert.equal( cloneMeshes.length, sourceMeshes.length );
for ( let i = 0; i < sourceMeshes.length; i ++ ) {

	assert.equal( cloneMeshes[ i ].geometry, sourceMeshes[ i ].geometry );
	assert.equal( cloneMeshes[ i ].material, sourceMeshes[ i ].material );

}
assert.equal( clone.visible, false );
assert.equal( can.visible, true );
can.reset();
can.terrain = terrain;
terrain.heightAt = () => 0;
can.throw( new Vector3( 0, 1, 0 ), rotation, new Vector3() );
boat.position.add( new Vector3( 10, 0, 0 ) );
can.update( 1 / 60 );
assert.ok( Math.abs( can.model.position.x ) < 0.01, 'reset releases the old boat anchor' );
console.log( 'Thrown can: release, terrain/deck collision, moving deck anchor, shared pool resources and reset passed' );
