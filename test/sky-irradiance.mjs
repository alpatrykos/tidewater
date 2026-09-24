// Preserve the sky integrals while caching unchanged LUTs and handling readback backpressure.
import assert from 'node:assert/strict';
import './headless.mjs';
import '../src/engine/render/Frame.js';
import { GPU } from '../src/engine/gpu/GPU.js';
import { ComputeKernel } from '../src/engine/gpu/Compute.js';
import { StorageBuffer } from '../src/engine/gpu/Texture.js';
import { readBuffer } from '../src/engine/gpu/Readback.js';
import { Atmosphere } from '../src/sky/Atmosphere.js';

await GPU.init( { headless: true } );
const errors = [];
GPU.device.addEventListener( 'uncapturederror', ( e ) => errors.push( e.error.message ) );

// Count actual dispatches; emulate delayed/declined asynchronous readbacks without timing races.
const cached = new Atmosphere();
let dispatches = 0, acceptsReadback = true;
const dispatch = cached.irradianceKernel.dispatch.bind( cached.irradianceKernel );
cached.irradianceKernel.dispatch = ( ...args ) => { dispatches ++; return dispatch( ...args ); };
cached.readback.request = () => acceptsReadback;
const complete = () => cached._onIrradiance( new Float32Array( 12 ).buffer );
const tick = async ( dt = 0.3, height = 2 ) => {

	GPU.beginFrame(); cached.update( dt, height ); GPU.submit();
	await GPU.queue.onSubmittedWorkDone();

};
await tick();
assert.equal( dispatches, 1, 'initial irradiance must be produced' );
complete();
await tick();
assert.equal( dispatches, 1, 'unchanged sky LUT must reuse its irradiance' );
cached.sunDir.value.set( 0.2, 0.4, 0.8 ).normalize();
await tick();
assert.equal( dispatches, 2, 'sun movement must refresh irradiance' );
cached.sunDir.value.set( 0.1, 0.6, 0.8 ).normalize();
await tick();
assert.equal( dispatches, 2, 'keep a changed sky dirty while readback is in flight' );
complete();
await tick();
assert.equal( dispatches, 3, 'do not lose a sky change made during readback' );
complete();
acceptsReadback = false;
cached.invalidate();
await tick();
assert.equal( dispatches, 4, 'explicit atmosphere invalidation must refresh irradiance' );
acceptsReadback = true;
await tick();
assert.equal( dispatches, 5, 'declined readback must be retried' );
complete();
await tick( 0.3, 2.1 );
assert.equal( dispatches, 5, 'sub-quantum camera bob should keep cached lighting' );
await tick( 0.3, 10 );
assert.equal( dispatches, 6, 'changed quantized camera height must refresh lighting' );
complete();

// Independent serial oracle: all 256 hemisphere and 16 horizon sample positions are retained.
const atmosphere = new Atmosphere();
atmosphere.readback.request = () => false;
const reference = new StorageBuffer( { label: 'irradiance reference', count: 3, type: 'vec4f' } );
const serial = new ComputeKernel( {
	label: 'Irradiance serial reference', modules: [ atmosphere.module ],
	bindings: { referenceOut: { storage: reference, access: 'read_write' } }, workgroupSize: [ 1, 1, 1 ],
	code: /* wgsl */`
@compute @workgroup_size( 1 ) fn main() {
	var sky = vec3f( 0.0 );
	for ( var elevation = 0; elevation < 16; elevation ++ ) {
		let b = ( f32( elevation ) + 0.5 ) / 16.0;
		for ( var azimuth = 0; azimuth < 16; azimuth ++ ) {
			let phi = ( f32( azimuth ) + 0.5 ) * ( 2.0 * PI / 16.0 );
			sky += atmosphereSkyLuminance( vec3f( sqrt( b ) * cos( phi ), sqrt( 1.0 - b ), sqrt( b ) * sin( phi ) ) );
		}
	}
	referenceOut[ 0 ] = vec4f( sky / 256.0, 1.0 );
	referenceOut[ 1 ] = vec4f( atmosphereSampleTransmittance( ATMO_RG + 0.001, atmosphereParams.sunDir.y ), 1.0 );
	var horizon = vec3f( 0.0 );
	for ( var i = 0; i < 16; i ++ ) {
		let phi = f32( i ) * ( 2.0 * PI / 16.0 );
		horizon += atmosphereSkyLuminance( normalize( vec3f( cos( phi ), 0.03, sin( phi ) ) ) );
	}
	referenceOut[ 2 ] = vec4f( horizon / 16.0, 1.0 );
}`,
} );
for ( const elevation of [ - 0.2, 0.02, 0.4, 0.9 ] ) {

	atmosphere.sunDir.value.set( Math.sqrt( 1 - elevation ** 2 ), elevation, 0 );
	GPU.beginFrame();
	atmosphere.update( 0.3, 2 );
	serial.dispatch( 1 );
	GPU.submit();
	const actual = new Float32Array( await readBuffer( atmosphere.irrBuffer, 48 ) );
	const expected = new Float32Array( await readBuffer( reference, 48 ) );
	for ( let i = 0; i < actual.length; i ++ ) {

		assert.ok( Number.isFinite( actual[ i ] ), 'finite irradiance' );
		assert.ok( Math.abs( actual[ i ] - expected[ i ] ) <= Math.abs( expected[ i ] ) * 0.00001 + 0.000001,
			`integral matches serial samples at elevation ${ elevation }, channel ${ i }: ${ actual[ i ] } vs ${ expected[ i ] }` );

	}

}
assert.deepEqual( errors, [] );
console.log( 'Atmosphere irradiance: unchanged-LUT caching, deferred invalidation, readback retry and GPU serial equivalence passed' );
process.exit( 0 );
