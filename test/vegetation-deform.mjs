// Run the real deformations on the GPU. Instrumenting the real gust helper measures whether
// already collapsed vertices bypass its texture work, while live deformation and main-camera
// LOD behavior must remain identical in a shadow view.
import './headless.mjs';
import assert from 'node:assert/strict';
import { GPU, ShaderModule, ComputeKernel, StorageBuffer, readBuffer, G, setFrameCamera } from '../src/engine/webgpu.js';
import { PerspectiveCamera } from '../src/engine/index.js';
import { vegModule, vegParams } from '../src/world/vegetation/VegNodes.js';
import { createCanopyMaterial } from '../src/world/vegetation/VegMaterials.js';

await GPU.init( { headless: true } );
const calls = new StorageBuffer( { label: 'gust calls', count: 8, type: 'u32' } );
const result = new StorageBuffer( { label: 'deformed vertices', count: 16, type: 'vec4f' } );
const instrumented = new ShaderModule( {
	name: 'vegetation-deform-probe', deps: vegModule.deps, bindings: {
		...vegModule.bindings, gustCalls: { storage: calls, access: 'read_write', wgslType: 'array<atomic<u32>>' },
	},
	code: 'var<private> probeIndex: u32;\n' + vegModule.code.replace(
		'fn vegGustAt( xz: vec2f ) -> f32 {',
		'fn vegGustAt( xz: vec2f ) -> f32 { atomicAdd( &gustCalls[ probeIndex ], 1u );',
	),
} );
const canopy = createCanopyMaterial( { module: new ShaderModule( { name: 'unused probe atlas' } ) } );
const kernel = new ComputeKernel( {
	label: 'vegetation deformation regression', modules: [ instrumented ],
	bindings: { result: { storage: result, access: 'read_write' } },
	code: `
struct ProbeVertex {
	position: vec3f, normal: vec3f, model: mat4x4f, iPos: vec4f, iDat: vec4f,
	aVeg: vec4f, aMat: vec4f, aLobe: vec4f, useWorld: bool, worldPos: vec3f, worldNormal: vec3f
};
struct ProbeOut { vMat: vec4f, vIDat: vec4f, vIPos: vec3f, vHf: f32 };
fn actualCanopy( v: ptr<function, ProbeVertex>, o: ptr<function, ProbeOut> ) {
${ canopy.vertex }
}
@compute @workgroup_size( 64 ) fn main( @builtin( global_invocation_id ) id: vec3u ) {
	let i = id.x; if ( i >= 8u ) { return; } probeIndex = i;
	var base = vec3f( 0.0 ); var p = vec3f( 1.0, 3.0, 0.5 );
	let n = vec3f( 0.0, 1.0, 0.0 );
	if ( i < 4u ) {
		var dat = vec4f( 0.3, 0.1, 5.0, 0.25 );
		var lobe = vec4f( 0.0 ); var lod = vec3f( 0.0, 120.0, 140.0 );
		if ( i == 0u ) { dat.w = 1.25; lobe.w = -4.0; } // wrong merged plant kind
		if ( i == 1u ) { base.x = 200.0; } // beyond the complete LOD fade
		if ( i == 2u ) { dat.w = 3.25; base.x = 70.0; lobe.w = -4.0; } // fern faded, other plants still visible
		let out = vegPlantDeform( p + base, n, vec4f( base, 1.0 ), dat, vec4f( 0.8, 0.7, 0.3, 0.4 ), vec4f( 1.0, 0.3, 0.0, 0.0 ), lobe, lod );
		result[ i * 2u ] = vec4f( out.pos, 1.0 ); result[ i * 2u + 1u ] = vec4f( out.normal, 0.0 );
	} else {
		var v: ProbeVertex; var o: ProbeOut;
		if ( i == 5u ) { base.x = 200.0; }
		v.position = p; v.normal = n;
		v.model = mat4x4f( vec4f( 1.0, 0.0, 0.0, 0.0 ), vec4f( 0.0, 1.0, 0.0, 0.0 ), vec4f( 0.0, 0.0, 1.0, 0.0 ), vec4f( base, 1.0 ) );
		v.iPos = vec4f( base, 1.0 ); v.iDat = vec4f( 0.3, 1.0, 5.0, 0.25 );
		v.aVeg = vec4f( 0.8, 0.7, 0.3, 0.4 ); v.aMat = vec4f( 1.0, 0.8, 0.3, 0.2 ); v.aLobe = vec4f( 0.0, 0.0, 0.0, -1.0 );
		if ( i == 4u ) { v.aMat.x = 4.0; } // shrub part of a tree instance
		if ( i == 7u ) { v.aMat.x = 4.0; v.iDat.y = -1.0; } // visible shrub
		actualCanopy( &v, &o );
		result[ i * 2u ] = vec4f( v.worldPos, select( 0.0, 1.0, v.useWorld ) ); result[ i * 2u + 1u ] = vec4f( v.worldNormal, 0.0 );
	}
}`,
} );
vegParams.fields.camPos.value.set( 0, 3, 0 );
G.time.value = 2.3; G.windSpeed.value = 9; G.windDir.value.set( 0.6, 0.8 );
const camera = new PerspectiveCamera();
async function probe() {
	calls.write( new Uint32Array( 8 ) );
	GPU.beginFrame(); setFrameCamera( camera, 512, 512 ); kernel.dispatch( 1 ); GPU.submit();
	return { data: new Float32Array( await readBuffer( result, 256 ) ), calls: new Uint32Array( await readBuffer( calls, 32 ) ) };
}
const main = await probe();
assert.deepEqual( Array.from( main.calls ), [ 0, 0, 0, 1, 0, 0, 1, 1 ], 'only visible plant parts should evaluate gust texture samples' );
assert.ok( main.data.every( Number.isFinite ), 'deformed outputs must remain finite' );
for ( const [ i, base ] of [ [ 0, [ 0, 0, 0 ] ], [ 1, [ 200, 0, 0 ] ], [ 2, [ 70, 0, 0 ] ], [ 4, [ 0, 0, 0 ] ], [ 5, [ 200, 0, 0 ] ] ] ) {
	assert.deepEqual( Array.from( main.data.subarray( i * 8, i * 8 + 3 ) ), base, `hidden slot ${ i } must stay collapsed on the same base` );
}
for ( const i of [ 3, 6, 7 ] ) assert.ok( main.data[ i * 8 + 1 ] > 1, `live slot ${ i } must retain its geometry` );
camera.position.set( 500, 1000, 300 );
const shadow = await probe();
assert.deepEqual( shadow, main, 'a shadow-view camera must not change vegetation LOD or deformation' );
console.log( 'Vegetation GPU deformation passed: hidden-kind, LOD and fern skips; live kinds and shadow-view equivalence' );
process.exit( 0 );
