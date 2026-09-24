import assert from 'node:assert/strict';
import * as THREE from '../src/engine/index.js';
import { VegType } from '../src/world/vegetation/InstanceLOD.js';

const geometry = () => new THREE.BufferGeometry().setAttribute( 'position', new THREE.Float32BufferAttribute( [ - 1, 0, 0, 1, 0, 0, 0, 2, 0 ], 3 ) );
const part = ( castShadow = false ) => ( { geometry: geometry(), material: {}, castShadow } );
const record = ( x, z, seed ) => ( { x, y: 0, z, s: 1, yaw: 0, H: 1, seed } );
const camera = new THREE.PerspectiveCamera( 60, 1, 0.1, 1000 );
const records = [ record( 0, - 30, 1 ), record( 17.7, - 30, 2 ), record( 0, 30, 3 ) ];
const type = new VegType( 'non-casters', records, { near: [ part() ], fade: [ 90, 100 ], cull: true } );
const seeds = ( level ) => Array.from( { length: level.count }, ( _, i ) => level.iBuffer.array[ i * 8 + 7 ] );

type.update( camera.position, true );
type.cull( camera );
assert.deepEqual( seeds( type.near ), [ 1, 2 ], 'a crown intersecting the side plane stays; a fully hidden plant is not submitted' );
const firstVersion = type.near.iBuffer.version;
type.cull( camera );
assert.equal( type.near.iBuffer.version, firstVersion, 'stationary frames do not re-upload the same selection' );

// A pure camera rotation must reveal new instances without a distance-query refresh.
camera.rotation.y = Math.PI;
type.cull( camera );
assert.deepEqual( seeds( type.near ), [ 3 ] );
camera.position.z = 60;
camera.rotation.y = 0;
type.update( camera.position, true );
type.cull( camera );
assert.deepEqual( seeds( type.near ), [ 1, 2, 3 ], 'teleports rebuild candidates before culling' );

// The mobile camera list may never prune the offscreen trees casting visible shadows.
const caster = new VegType( 'casters', records, { near: [ part( true ) ], fade: [ 90, 100 ], cull: true } );
camera.position.set( 0, 0, 0 );
caster.update( camera.position, true );
const casterBuffer = caster.near.iBuffer.array.slice();
caster.cull( camera );
assert.equal( caster.near.count, records.length );
assert.deepEqual( caster.near.iBuffer.array, casterBuffer, 'shadow data remains unchanged across all passes' );

const desktop = new VegType( 'desktop', records, { near: [ part() ], fade: [ 90, 100 ] } );
desktop.update( camera.position, true );
desktop.cull( camera );
assert.equal( desktop.near.count, records.length, 'culling is opt-in so reflection cameras retain their instances' );

const far = new VegType( 'non-caster-far', [ record( 0, - 100, 1 ), record( 0, 100, 2 ) ], {
	near: [ part( true ) ], far: { parts: [ part() ], fade: [ 900, 1000 ] }, nearRange: 30, sortFar: true, cull: true,
} );
far.update( camera.position, true );
far.cull( camera );
assert.deepEqual( seeds( far.far ), [ 1 ] );
camera.rotation.y = Math.PI;
far.cull( camera );
assert.deepEqual( seeds( far.far ), [ 2 ], 'far compaction does not overwrite its full sorted candidate list' );
camera.rotation.y = 0;

const wide = new VegType( 'fov-change', [ record( 35, - 30, 1 ) ], { near: [ part() ], fade: [ 90, 100 ], cull: true } );
wide.update( camera.position, true );
wide.cull( camera );
assert.equal( wide.near.count, 0 );
camera.fov = 100;
camera.updateProjectionMatrix();
wide.cull( camera );
assert.equal( wide.near.count, 1, 'projection changes update visibility without a camera move' );

// At a 70m handover, a palm at 61.9m must already exist in the far buffer: the camera
// can travel 6m before a refill, crossing the far cross-fade start at 65.8m.
const boundary = new VegType( 'palm-overlap', [ record( 0, - 61.9, 1 ) ], {
	near: [ part( true ) ], far: { parts: [ part() ], fade: [ 900, 1000 ] }, nearRange: 70, refreshDistance: 6, farExcludeNear: true,
} );
boundary.update( camera.position, true );
assert.equal( boundary.far.count, 1, 'CPU exclusion preserves the shader cross-fade while the camera moves' );

// The scheduler can defer a type until the movement margin, beyond its nominal refresh
// distance. Both sides of a hard LOD transition must exist for that whole interval.
const delayed = new VegType( 'delayed-refill', [ record( 0, - 41, 1 ), record( 0, - 20, 2 ) ], {
	near: [ part( true ) ], far: { parts: [ part( true ) ], fade: [ 85, 105 ] },
	nearRange: 30, margin: 10, refreshDistance: 6, farExcludeNear: true, farDistanceLimit: 105,
} );
delayed.update( camera.position, true );
assert.ok( seeds( delayed.near ).includes( 1 ), '41m plant can enter the 31.8m near blend during a deferred 9.5m movement' );
assert.ok( seeds( delayed.far ).includes( 2 ), '20m plant can enter the 28.2m far blend during a deferred 9m movement' );

// A medium leaf mesh has a short far fade, unlike forest impostors. Its candidate query must
// not inherit the much shorter per-instance near query radius.
const leaves = new VegType( 'leaf-medium', [
	{ ...record( 0, - 25, 1 ), qr: 40 }, { ...record( 0, - 100, 2 ), qr: 40 }, { ...record( 0, - 116, 3 ), qr: 40 },
], {
	near: [ part( true ) ], far: { parts: [ part( true ) ], fade: [ 85, 105 ] },
	nearRange: 30, margin: 10, refreshDistance: 6, farExcludeNear: true, farDistanceLimit: 105, cull: true,
} );
leaves.update( camera.position, true );
leaves.cull( camera );
assert.deepEqual( seeds( leaves.far ), [ 1, 2 ], 'short far LOD keeps overlap and distant leaves independently of near qr' );
camera.position.z = - 50;
leaves.update( camera.position, true );
leaves.cull( camera );
assert.deepEqual( seeds( leaves.far ), [ 1, 2, 3 ], 'moving toward a far plant refreshes the bounded shadow-caster list' );
camera.position.z = 300;
leaves.update( camera.position, true );
leaves.cull( camera );
assert.equal( leaves.far.count, 0, 'teleporting out of range removes collapsed far instances' );

console.log( 'Vegetation culling passed: edge crowns, rotation, teleport, upload cache, offscreen shadows and LOD overlap' );
