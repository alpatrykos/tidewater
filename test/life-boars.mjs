// Compile the real material in main + shadow passes and inspect current/previous animated poses
// on WebGPU. Optional argument writes close-up PNGs for visual review.
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { setupLife } from './life-harness.mjs';
import * as E from '../src/engine/index.js';
import { Material } from '../src/engine/render/Material.js';
import { ComputeKernel, StorageBuffer, readBuffer } from '../src/engine/webgpu.js';

const renderer = await import( '../src/world/wildlife/BoarBatch.js' ).catch( () => null );
assert.equal( typeof renderer?.BoarBatch, 'function', 'the boar needs an instanced renderer' );
const L = await setupLife( { W: 1000, H: 720, fov: 39, shadowSplits: [ 12, 60, 180 ] } );
const errors = [];
L.GPU.device.addEventListener( 'uncapturederror', ( e ) => errors.push( e.error.message ) );
L.GPU.device.pushErrorScope( 'validation' );
const batch = new renderer.BoarBatch( { capacity: 2, csm: L.shadows } );
const record = { x: 0, y: 0, z: 0, scale: 1, q: [ 0, 0, 0, 1 ], phase: 0, stride: 0, root: 0, seed: 0.37,
	px: - 2, py: 0, pz: - 1, pScale: 1, pq: [ 0, 0, 0, 1 ], pPhase: 0, pStride: 0, pRoot: 0 };
const write = () => { batch.begin(); batch.write( record ); batch.commit(); };
write();

// Invoke the real material vertex entry with template vertices. A broken record field/previous
// pose or a normal left in the rest pose produces a visible error caught here.
const g = batch.mesh.geometry, positions = g.attributes.position.array, normals = g.attributes.normal.array, tags = g.attributes.aBoar.array;
const N = positions.length / 3, input = new Float32Array( N * 12 );
for ( let i = 0; i < N; i ++ ) {

	input.set( positions.subarray( i * 3, i * 3 + 3 ), i * 12 );
	input.set( normals.subarray( i * 3, i * 3 + 3 ), i * 12 + 4 );
	input.set( tags.subarray( i * 2, i * 2 + 2 ), i * 12 + 8 );

}
const source = new StorageBuffer( { label: 'boar-probe-input', count: N * 3, type: 'vec4f', data: input } );
const result = new StorageBuffer( { label: 'boar-probe-result', count: N * 3, type: 'vec4f' } );
const probe = new ComputeKernel( {
	label: 'actual-boar-vertex', modules: batch.material.modules,
	bindings: { ...batch.material.bindings, source: { storage: source }, result: { storage: result, access: 'read_write' } },
	code: `
struct ProbeVertex { position: vec3f, normal: vec3f, aBoar: vec2f, instance: u32, useWorld: bool, worldPos: vec3f, worldNormal: vec3f, prevWorldPos: vec3f };
struct ProbeOut { vBoarLocal: vec3f, vBoarInfo: vec2f };
fn actualVertex( v: ptr<function, ProbeVertex>, o: ptr<function, ProbeOut> ) { ${ batch.material.vertex } }
@compute @workgroup_size(64) fn main( @builtin(global_invocation_id) id: vec3u ) {
	let i = id.x; if ( i >= ${ N }u ) { return; }
	var v: ProbeVertex; var o: ProbeOut;
	v.position = source[ i * 3u ].xyz; v.normal = source[ i * 3u + 1u ].xyz; v.aBoar = source[ i * 3u + 2u ].xy;
	v.instance = 0u; actualVertex( &v, &o );
	result[ i * 3u ] = vec4f( v.worldPos, 1.0 ); result[ i * 3u + 1u ] = vec4f( v.worldNormal, 0.0 ); result[ i * 3u + 2u ] = vec4f( v.prevWorldPos, 1.0 );
}`,
} );
async function capturePose() {

	write(); L.GPU.beginFrame(); probe.dispatch( Math.ceil( N / 64 ) ); L.GPU.submit();
	return new Float32Array( await readBuffer( result, N * 48 ) );

}
const idle = await capturePose();
for ( let i = 0; i < N; i ++ ) {

	const o = i * 12;
	assert.ok( Math.abs( idle[ o ] - idle[ o + 8 ] - 2 ) < 1e-5 && Math.abs( idle[ o + 2 ] - idle[ o + 10 ] - 1 ) < 1e-5, 'motion vectors include previous world translation' );

}
record.root = 1; record.phase = 0.6; record.stride = 1;
const posed = await capturePose();
assert.ok( posed.every( Number.isFinite ), 'rooting/running vertices and normals stay finite' );
let movingLegs = 0, loweredSnout = 0, turnedNormals = 0;
for ( let i = 0; i < N; i ++ ) {

	const o = i * 12;
	assert.ok( Math.abs( Math.hypot( ...posed.subarray( o + 4, o + 7 ) ) - 1 ) < 0.002, 'deformed normals remain unit vectors' );
	if ( tags[ i * 2 + 1 ] >= 0 && tags[ i * 2 + 1 ] < 4 && Math.abs( idle[ o + 2 ] - posed[ o + 2 ] ) > 0.03 ) movingLegs ++;
	if ( positions[ i * 3 + 2 ] > 1 && idle[ o + 1 ] - posed[ o + 1 ] > 0.2 ) loweredSnout ++;
	if ( Math.abs( idle[ o + 5 ] - posed[ o + 5 ] ) > 0.15 ) turnedNormals ++;
	assert.ok( Math.abs( idle[ o + 8 ] - posed[ o + 8 ] ) < 1e-5 && Math.abs( idle[ o + 9 ] - posed[ o + 9 ] ) < 1e-5 && Math.abs( idle[ o + 10 ] - posed[ o + 10 ] ) < 1e-5, 'previous articulation is independent of the current pose' );

}
assert.ok( movingLegs > 20 && loweredSnout > 10 && turnedNormals > 20, 'the animation moves legs, lowers the snout and rotates lighting normals' );
record.root = 0; record.stride = 0; record.phase = 0;
record.px = 0; record.pz = 0;
const ground = new E.Mesh( new E.PlaneGeometry( 25, 25 ).rotateX( - Math.PI / 2 ), new Material( { color: 0x777963, roughness: 1 } ) );
ground.position.y = - 0.003;
L.scene.add( ground, batch.mesh );
L.camera.position.set( 2.35, 1.42, 2.8 ); L.camera.lookAt( 0, 0.48, 0.14 );
const out = process.argv[ 2 ];
if ( out ) mkdirSync( out, { recursive: true } );
await L.run( 3, write );
if ( out ) await L.save( out + '/boar-idle.png' );
record.root = 1; record.pRoot = 1;
await L.run( 2, write );
if ( out ) await L.save( out + '/boar-rooting.png' );
record.root = 0; record.pRoot = 0; record.stride = 1; record.pStride = 1; record.phase = 0.6; record.pPhase = 0.5;
L.camera.position.set( 3.1, 1.13, 0.5 ); L.camera.lookAt( 0, 0.48, 0.14 );
await L.run( 2, write );
if ( out ) await L.save( out + '/boar-trot.png' );
const error = await L.GPU.device.popErrorScope();
assert.equal( error, null, error?.message );
assert.deepEqual( errors, [], 'main/shadow passes compile and draw without GPU validation errors' );
console.log( `Boar GPU passed: ${ N } vertex poses, independent previous articulation, normal deformation, main/shadow rendering` );
await L.exit();
