// Execute Spray's actual vertex hook on the GPU. Inactive ring slots must return finite,
// collapsed vertices with zero varyings before billboard and lighting work. Live particles
// of all five kinds must retain their visible geometry and opacity.
import './headless.mjs';
import assert from 'node:assert/strict';
import { GPU, ShaderModule, ComputeKernel, StorageBuffer, RenderTarget, readBuffer } from '../src/engine/webgpu.js';
import { G, setFrameCamera } from '../src/engine/render/Frame.js';
import { PerspectiveCamera } from '../src/engine/index.js';
import { Spray } from '../src/fx/Spray.js';

await GPU.init( { headless: true } );
const camera = new PerspectiveCamera( 50, 1, 0.1, 1000 );
camera.position.set( 0, 2, 9 );
camera.lookAt( 0, 2, 0 );
G.sunDir.value.set( 0.2, 0.25, - 1 ).normalize();
G.sunColor.value.setRGB( 6, 5.5, 4.8 );
G.skyIrradiance.value.setRGB( 0.35, 0.45, 0.6 );
const module = new ShaderModule( { name: 'sprayProbeWorld', code: `
fn waterQueryHeightAtXZ( xz: vec2f ) -> f32 { return 0.0; }
fn terrainHeightAt( xz: vec2f ) -> f32 { return -6.0; }
` } );
const target = new RenderTarget( 16, 16, { depth: 'depth32float' } );
const spray = new Spray( null, { query: { module }, terrain: { module }, sceneCopy: target, gpuCapacity: 16, cpuCapacity: 0 } );
const mat = spray.mesh.material;
mat.pipelineKey(); // install the real optional-hook defaults

// First five slots are visible particles, then empty / expired slots and exact distance limits.
const fixtures = [
	...[ 0, 1, 2, 3, 4 ].map( ( kind ) => ( { kind, life: 2, age: 0.5, z: 0 } ) ),
	{ kind: 0, life: 0, age: 0, z: 0 },
	{ kind: 1, life: 2, age: 2, z: 0 },
	{ kind: 2, life: 2, age: 3, z: 0 },
	{ kind: 3, life: 2, age: 0.5, z: - 311 }, // exactly 320 m from the camera
	{ kind: 4, life: 2, age: 0.5, z: - 312 },
];
const pos = new Float32Array( spray.N * 4 ), vel = pos.slice(), info = pos.slice();
fixtures.forEach( ( f, i ) => {
	pos.set( [ 0, 2, f.z, f.age ], i * 4 );
	vel.set( [ 1, 3, 0.5, 0.4 ], i * 4 );
	info.set( [ f.kind, f.life, 0, 0.37 ], i * 4 );
} );
spray.pos.write( pos ); spray.vel.write( vel ); spray.info.write( info );
const vertices = fixtures.length * 4;
const output = new StorageBuffer( { count: vertices * 6, type: 'vec4f', label: 'spray vertex probe' } );
const kernel = new ComputeKernel( {
	label: 'spray vertex culling regression', modules: mat.modules,
	bindings: {
		mat: { uniform: mat.uniformBlock }, sprayPosR: { storage: spray.pos, access: 'read' },
		sprayVelR: { storage: spray.vel, access: 'read' }, sprayInfoR: { storage: spray.info, access: 'read' },
		result: { storage: output, access: 'read_write' },
	},
	code: `
struct ProbeVertex { instance: u32, position: vec3f, useWorld: bool, worldPos: vec3f, worldNormal: vec3f };
struct ProbeVaryings { vUV: vec2f, vCol: vec4f, vMisc: vec4f, vFwd: vec4f };
fn actualVertex( v: ptr<function, ProbeVertex>, o: ptr<function, ProbeVaryings> ) {
${ mat.vertex }
}
@compute @workgroup_size( 64 ) fn main( @builtin( global_invocation_id ) id: vec3u ) {
	if ( id.x >= ${ vertices }u ) { return; }
	var v: ProbeVertex; var o: ProbeVaryings;
	v.instance = id.x / 4u;
	let corners = array<vec3f, 4>( vec3f( -1.0, -1.0, 0.0 ), vec3f( 1.0, -1.0, 0.0 ), vec3f( 1.0, 1.0, 0.0 ), vec3f( -1.0, 1.0, 0.0 ) );
	v.position = corners[ id.x % 4u ];
	actualVertex( &v, &o );
	let i = id.x * 6u;
	result[ i ] = vec4f( v.worldPos, select( 0.0, 1.0, v.useWorld ) );
	result[ i + 1u ] = vec4f( v.worldNormal, 0.0 );
	result[ i + 2u ] = vec4f( o.vUV, 0.0, 0.0 );
	result[ i + 3u ] = o.vCol;
	result[ i + 4u ] = o.vMisc;
	result[ i + 5u ] = o.vFwd;
}`,
} );

async function probe( intensity ) {
	mat.uniforms.intensity.value = intensity;
	GPU.beginFrame(); setFrameCamera( camera, 512, 512 ); kernel.dispatch( 1 ); GPU.submit();
	return new Float32Array( await readBuffer( output.getGPU(), vertices * 24 * 4 ) );
}
function assertInactive( data, first = 5 ) {
	for ( let slot = first; slot < fixtures.length; slot ++ ) for ( let corner = 0; corner < 4; corner ++ ) {
		const o = ( slot * 4 + corner ) * 24;
		assert.deepEqual( Array.from( data.subarray( o, o + 4 ) ), [ 0, - 1e5, 0, 1 ], `inactive slot ${ slot } must collapse` );
		assert.ok( data.subarray( o + 4, o + 7 ).every( Number.isFinite ) && Math.abs( Math.hypot( ...data.subarray( o + 4, o + 7 ) ) - 1 ) < 1e-5, `inactive slot ${ slot } must have a finite unit normal` );
		assert.ok( data.subarray( o + 8, o + 24 ).every( ( v ) => v === 0 ), `inactive slot ${ slot } must have zero varyings` );
	}
}
const visible = await probe( 1 );
assert.ok( visible.every( Number.isFinite ), 'all vertex outputs must be finite' );
for ( let slot = 0; slot < 5; slot ++ ) for ( let corner = 0; corner < 4; corner ++ ) {
	const o = ( slot * 4 + corner ) * 24;
	assert.ok( Math.abs( visible[ o ] ) < 5 && Math.abs( visible[ o + 1 ] - 2 ) < 5 && Math.abs( visible[ o + 2 ] ) < 5, `live kind ${ slot } must remain near its particle` );
	assert.ok( visible[ o + 15 ] > 0, `live kind ${ slot } must retain opacity` );
}
assertInactive( visible );
assertInactive( await probe( 0 ), 0 );
assertInactive( await probe( - 1 ), 0 );
console.log( 'Spray GPU culling passed: live kinds, dead and expired slots, distance boundary, zero/negative intensity' );
process.exit( 0 );
