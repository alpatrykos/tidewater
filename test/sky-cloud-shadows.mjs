import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import './headless.mjs';
import { GPU } from '../src/engine/gpu/GPU.js';
import { ComputeKernel } from '../src/engine/gpu/Compute.js';
import { StorageBuffer } from '../src/engine/gpu/Texture.js';
import { G } from '../src/engine/render/Frame.js';
import { readBuffer, readTexture } from '../src/engine/gpu/Readback.js';
import { PerspectiveCamera } from '../src/engine/index.js';
import { Atmosphere } from '../src/sky/Atmosphere.js';
import { SkyProClouds } from '../src/sky/SkyProClouds.js';

// Load the shipped noise assets locally; all kernels and shadow rendering remain real.
globalThis.fetch = async ( url ) => new Response( await readFile( new URL( '../public' + url, import.meta.url ) ) );
await GPU.init( { headless: true } );
const errors = [];
GPU.device.addEventListener( 'uncapturederror', ( e ) => errors.push( e.error.message ) );
const atmosphere = new Atmosphere();
const mobile = new SkyProClouds( null, atmosphere, { shadowResolution: 128, shadowUpdateHz: 15 } );
await mobile.ready;
assert.equal( mobile.shadowMap.width, 128, 'mobile shadows should render a smaller surrounding region' );
assert.equal( mobile.shadowSize.value / mobile.shadowMap.width, 46.875, 'retain world-space shadow detail' );
const desktop = new SkyProClouds( null, atmosphere );
await desktop.ready;
for ( const clouds of [ mobile, desktop ] ) clouds.shadowMap.usageList.push( 'copySrc' );
const camera = new PerspectiveCamera();
G.sunDir.value.set( 0.2, 0.8, 0.3 ).normalize();
const renders = [];
const dispatch = mobile.shadowKernel.dispatch.bind( mobile.shadowKernel );
mobile.shadowKernel.dispatch = ( counts ) => {

	renders.push( { counts, map: mobile.F.shadow.value.slice() } );
	return dispatch( counts );

};
GPU.beginFrame();
for ( const clouds of [ mobile, desktop ] ) {

	clouds.weatherKernel.dispatch( [ 128, 128, 1 ] );
	clouds.boundsKernel.dispatch( [ 8, 8, 1 ] );
	clouds._updateShadow( 0, camera );

}
GPU.submit();
assert.equal( renders.length, 1, 'first shadow map must render immediately' );
assert.equal( renders[ 0 ].map[ 3 ], - 1, 'first shadow map must cover every row' );
const small = new Float32Array( ( await readTexture( mobile.shadowMap ) ).data );
const large = new Float32Array( ( await readTexture( desktop.shadowMap ) ).data );
let shadowed = false;
for ( let y = 0; y < 128; y ++ ) for ( let x = 0; x < 128; x ++ ) {

	const a = small[ y * 128 + x ], b = large[ ( y + 64 ) * 256 + x + 64 ];
	assert.ok( Number.isFinite( a ) && a >= 0 && a <= 1, 'shadow transmittance must be finite and physical' );
	assert.ok( Math.abs( a - b ) < 0.00001, 'mobile map must match the same world samples in desktop map' );
	if ( a < 0.9 ) shadowed = true;

}
assert.ok( shadowed, 'fixture must exercise actual cloud shadows' );
const sample = new StorageBuffer( { label: 'shadow sample', count: 1, type: 'vec4f' } );
const lookup = new ComputeKernel( {
	label: 'Cloud shadow lookup', modules: [ mobile.shadowModule ],
	bindings: { sampled: { storage: sample, access: 'read_write' } }, workgroupSize: [ 1, 1, 1 ],
	code: '@compute @workgroup_size( 1 ) fn main() { sampled[ 0 ] = vec4f( cloudsShadow( vec2f( 0.0 ) ) ); }',
} );
GPU.beginFrame(); lookup.dispatch( 1 ); desktop._updateShadow( 0, camera ); GPU.submit();
assert.equal( desktop.F.shadow.value[ 3 ], 0, 'default cadence must update each frame' );
const center = ( small[ 63 * 128 + 63 ] + small[ 63 * 128 + 64 ] + small[ 64 * 128 + 63 ] + small[ 64 * 128 + 64 ] ) / 4;
const sampled = new Float32Array( await readBuffer( sample, 16 ) );
assert.ok( Math.abs( sampled[ 0 ] - ( 0.15 + center * 0.85 ) ) < 0.00001, 'material lookup must use the resized map coordinates' );
const tick = async ( dt ) => {

	GPU.beginFrame(); mobile._updateShadow( dt, camera ); GPU.submit();
	await GPU.queue.onSubmittedWorkDone();

};
await tick( 0.02 ); await tick( 0.02 );
assert.equal( renders.length, 1, 'reuse shadows between timed updates' );
await tick( 0.03 );
assert.equal( renders.at( - 1 ).map[ 3 ], 0, 'first timed update starts row phase zero' );
assert.deepEqual( renders.at( - 1 ).counts, [ 16, 4, 1 ], 'timed update renders only a quarter of the map' );
await tick( 0.02 );
assert.equal( renders.length, 2, 'skipped frames must not dispatch shadow work' );
await tick( 0.05 );
assert.equal( renders.at( - 1 ).map[ 3 ], 1, 'skipped frames must not skip row phases' );
await tick( 0.07 ); await tick( 0.07 );
assert.deepEqual( renders.slice( 1 ).map( ( r ) => r.map[ 3 ] ), [ 0, 1, 2, 3 ], 'every row phase must eventually refresh' );
camera.position.x = 200;
await tick( 0 );
assert.equal( renders.at( - 1 ).map[ 0 ], 187.5, 'shadow origin follows the snapped camera position' );
assert.equal( renders.at( - 1 ).map[ 3 ], - 1, 'moving the shadow origin must rebuild all rows' );
mobile.shadowSize.value = 7000;
await tick( 0 );
assert.equal( renders.at( - 1 ).map[ 2 ], 7000 );
assert.equal( renders.at( - 1 ).map[ 3 ], - 1, 'changing map extent must rebuild all rows' );
const beforeChanges = renders.length;
mobile.S.shell.value[ 3 ] += 0.1;
await tick( 0 );
G.sunDir.value.set( - 0.5, 0.3, 0.2 ).normalize();
await tick( 0 );
mobile.invalidate();
await tick( 0 );
assert.equal( renders.length, beforeChanges + 3, 'settings, light jumps and invalidation must override cadence' );
assert.ok( renders.slice( - 3 ).every( ( r ) => r.map[ 3 ] === - 1 ), 'invalidations must replace the complete map' );
assert.deepEqual( errors, [] );
console.log( 'Cloud shadows: unchanged world detail, GPU crop equivalence, bounded cadence, complete row phases and full invalidation passed' );
process.exit( 0 );
