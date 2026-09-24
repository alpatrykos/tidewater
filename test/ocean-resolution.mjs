import assert from 'node:assert/strict';
import './headless.mjs';
import { GPU } from '../src/engine/gpu/GPU.js';
import { G } from '../src/engine/render/Frame.js';
import { OceanFFT } from '../src/ocean/OceanFFT.js';
import { readFloatTexture, stats } from './ocean-util.mjs';

await GPU.init( { headless: true } );
const errors = [];
GPU.device.addEventListener( 'uncapturederror', ( e ) => errors.push( e.error.message ) );
G.dt.value = 1 / 60;
for ( const size of [ 64, 128, 256 ] ) {

	const fft = new OceanFFT( null, { size } );
	assert.equal( fft.displacementTexture.width, size );
	// A reference mip must filter the same physical wavelength at every grid size.
	assert.equal( 2 ** fft.mipLevel( 3 ) / size, 2 ** 3 / 256 );
	assert.equal( fft.mipLevel( 0 ), 0 );
	const tick = async () => {
		GPU.beginFrame(); fft.update( 1 / 60 ); GPU.submit();
		await GPU.queue.onSubmittedWorkDone();
	};
	await tick();
	const before = await readFloatTexture( fft.displacementTexture );
	await tick();
	for ( const tex of [ fft.displacementTexture, fft.derivativeTexture ] ) {
		for ( let layer = 0; layer < 4; layer ++ ) {
			const base = await readFloatTexture( tex, { layer } );
			assert.ok( base.data.every( Number.isFinite ), `finite ${ size } layer ${ layer }` );
			assert.ok( stats( base, 1 ).std > 0.00001, 'waves must not be flat' );
			let prev = base;
			for ( let mip = 1; mip <= Math.log2( size ); mip ++ ) {
				const next = await readFloatTexture( tex, { layer, mip } );
				for ( let y = 0; y < next.height; y ++ ) for ( let x = 0; x < next.width; x ++ ) {
					for ( let c = 0; c < 4; c ++ ) {
						const i = ( y * 2 * prev.width + x * 2 ) * 4 + c;
						const expected = ( prev.data[ i ] + prev.data[ i + 4 ] + prev.data[ i + prev.width * 4 ] + prev.data[ i + prev.width * 4 + 4 ] ) / 4;
						const actual = next.data[ ( y * next.width + x ) * 4 + c ];
						// Fused reductions retain float32 intermediates rather than rereading rounded half floats.
						const magnitude = ( Math.abs( prev.data[ i ] ) + Math.abs( prev.data[ i + 4 ] ) + Math.abs( prev.data[ i + prev.width * 4 ] ) + Math.abs( prev.data[ i + prev.width * 4 + 4 ] ) ) / 4;
						assert.ok( Math.abs( expected - actual ) < 0.003 * magnitude + 0.00002, `mip average ${ size }/${ layer }/${ mip }` );
					}
				}
				prev = next;
			}
		}
	}
	const after = await readFloatTexture( fft.displacementTexture );
	assert.ok( after.data.some( ( v, i ) => Math.abs( v - before.data[ i ] ) > 0.00001 ), 'waves must animate' );
	// A single conjugate frequency pair must reconstruct the analytic 2D cosine.
	// This catches bit-reversal, stage-count, axis, sign and amplitude errors.
	const h0 = new Float32Array( size * size * 4 * 4 );
	const wave = new Float32Array( h0.length );
	for ( const sign of [ - 1, 1 ] ) {
		const i = ( ( size / 2 + sign * 2 ) * size + size / 2 + sign * 3 ) * 4;
		h0[ i ] = h0[ i + 2 ] = 0.5;
		wave[ i ] = sign * 3; wave[ i + 1 ] = sign * 2; wave[ i + 2 ] = 1 / Math.sqrt( 13 );
	}
	fft.h0.write( h0 ); fft.waveData.write( wave );
	await tick();
	const harmonic = await readFloatTexture( fft.displacementTexture );
	for ( let y = 0; y < size; y ++ ) for ( let x = 0; x < size; x ++ ) {
		const expected = 2 * Math.cos( 2 * Math.PI * ( 3 * x + 2 * y ) / size );
		assert.ok( Math.abs( harmonic.data[ ( y * size + x ) * 4 + 1 ] - expected ) < 0.002, `analytic IFFT ${ size } at ${ x },${ y }` );
	}
	console.log( `Ocean ${ size }: animated finite waves, mip chains and analytic IFFT passed` );
}
assert.throws( () => new OceanFFT( null, { size: 96 } ), /size/ );
assert.deepEqual( errors, [] );
process.exit( 0 );
