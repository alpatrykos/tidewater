// Explicit terrain-normal gradients must preserve implicit sampling even inside divergent branches.
import assert from 'node:assert/strict';
import './headless.mjs';
import '../src/engine/render/Frame.js';
import { GPU } from '../src/engine/gpu/GPU.js';
import { RenderTarget } from '../src/engine/gpu/Texture.js';
import { FullscreenPass } from '../src/engine/render/FullscreenPass.js';
import { TerrainGPU } from '../src/world/TerrainGPU.js';
import { readFloatTexture } from './ocean-util.mjs';

await GPU.init( { headless: true } );
const errors = [];
GPU.device.addEventListener( 'uncapturederror', ( e ) => errors.push( e.error.message ) );
const res = 64, count = res * res;
const data = { res, size: 128, texel: 2, origin: - 64, heights: new Float32Array( count ), rock: new Float32Array( count ),
	sand: new Uint8Array( count ), path: new Uint8Array( count ), gully: new Uint8Array( count ) };
for ( let z = 0; z < res; z ++ ) for ( let x = 0; x < res; x ++ ) data.heights[ z * res + x ] = 4 * Math.sin( x * 0.7 ) + 3 * Math.cos( z * 0.9 );
GPU.beginFrame();
const terrain = new TerrainGPU( data );
const target = new RenderTarget( 128, 128, { colors: [ 'rgba16float' ], label: 'terrain normal gradient comparison' } );
const pass = new FullscreenPass( {
	label: 'terrain normal gradient comparison', colorFormats: [ 'rgba16float' ], modules: [ terrain.module ],
	code: /* wgsl */`
fn fragment( in: FSIn ) -> vec4f {
	// Vary the footprint across mip levels, including fractional LODs and clamped UV edges.
	let xz = ( in.uv * 2.0 - 1.0 ) * ( 4.0 * exp2( in.uv.y * 7.0 ) );
	let uv = terrainUvOf( xz );
	let dx = dpdx( uv ); let dy = dpdy( uv );
	let normalView = normalize( vec3f( 0.12, 1.0, 0.08 ) );
	let edge = select( 0.0, 0.65, ( u32( in.pos.x ) + u32( in.pos.y ) ) % 3u != 0u );
	let original = terrainNormalRock( xz );
	let upOriginal = normalize( -original.xy + vec2f( 1e-5, 0.0 ) );
	let reference = normalize( normalView + vec3f( upOriginal.x, 0.0, upOriginal.y ) * ( edge * edge * 0.7 ) );
	var bend = vec3f( 0.0 );
	var sampled = original;
	if ( edge > 0.0 ) {
		sampled = terrainNormalRockGrad( xz, dx, dy );
		let uphill = normalize( -sampled.xy + vec2f( 1e-5, 0.0 ) );
		bend = vec3f( uphill.x, 0.0, uphill.y ) * ( edge * edge * 0.7 );
	}
	let optimized = normalize( normalView + bend );
	return vec4f( abs( sampled.xy - original.xy ), length( optimized - reference ), length( -original.xy + vec2f( 1e-5, 0.0 ) ) );
}`,
} );
pass.render( { colorViews: [ target.texture ], clear: [ 0, 0, 0, 0 ] } );
GPU.submit();
const result = await readFloatTexture( target.texture );
assert.deepEqual( errors, [], 'terrain gradient helper must compile and render without GPU errors' );
let maximumSample = 0, maximumNormal = 0, detailed = false;
for ( let i = 0; i < result.data.length; i += 4 ) {

	const [ dx, dy, normalError, length ] = result.data.subarray( i, i + 4 );
	assert.ok( [ dx, dy, normalError, length ].every( Number.isFinite ), 'finite gradient comparison' );
	detailed ||= length > 0.3;
	maximumSample = Math.max( maximumSample, dx, dy );
	maximumNormal = Math.max( maximumNormal, normalError );
	// Implicit/explicit hardware filtering may round a UNORM8 result differently by
	// one encoded code (decoded normals span -1..1). Wrong gradients exceed this.
	assert.ok( Math.max( dx, dy ) <= 2 / 255 + 0.00001, 'conditional filtering must preserve terrain mip selection' );
	// Normalization amplifies tiny sample rounding when the original slope is almost
	// flat: |normalize(a)-normalize(b)| <= 2 |a-b| / |a|. Apply that bound twice,
	// first to uphill, then to the view normal plus a bend of length <= 0.65² * 0.7.
	const bend = 0.65 ** 2 * 0.7;
	const upBound = Math.min( 2, 2 * Math.hypot( dx, dy ) / Math.max( length, 0.000001 ) );
	const normalBound = 2 * bend * upBound / ( 1 - bend );
	assert.ok( normalError <= normalBound + 0.0002, 'meniscus branch must differ only by bounded texture rounding' );

}
assert.ok( detailed, 'fixture must contain significant terrain-normal variation' );
console.log( `Terrain gradients preserve conditional meniscus shading across mip levels (max sample error ${ maximumSample }, normal error ${ maximumNormal })` );
process.exit( 0 );
