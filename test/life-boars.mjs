// Compile the real material in main + shadow passes and inspect current/previous animated poses
// on WebGPU. Optional argument writes close-up PNGs for visual review.
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync } from 'node:fs';
import { createBoarCoatTexture } from '../src/world/wildlife/BoarTexture.js';
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
const coatTexture = await createBoarCoatTexture( readFileSync( new URL( '../public/models/boar/coat.png', import.meta.url ) ) );
const batch = new renderer.BoarBatch( { capacity: 2, csm: L.shadows, coatTexture } );
const record = { x: 0, y: 0, z: 0, scale: 1, q: [ 0, 0, 0, 1 ], phase: 0, stride: 0, root: 0, seed: 0.37,
	px: - 2, py: 0, pz: - 1, pScale: 1, pq: [ 0, 0, 0, 1 ], pPhase: 0, pStride: 0, pRoot: 0 };
const write = () => { batch.begin(); batch.write( record ); batch.commit(); };
write();

// Invoke the real material vertex entry with template vertices. A broken record field/previous
// pose or a normal left in the rest pose produces a visible error caught here.
function makeProbe( g, material, max = Infinity ) {

	const positions = g.attributes.position.array, normals = g.attributes.normal.array, tags = g.attributes.aBoar.array;
	const N = Math.min( positions.length / 3, max ), input = new Float32Array( N * 20 );
	for ( let i = 0; i < N; i ++ ) {

		input.set( positions.subarray( i * 3, i * 3 + 3 ), i * 20 );
		input.set( normals.subarray( i * 3, i * 3 + 3 ), i * 20 + 4 );
		input.set( tags.subarray( i * 2, i * 2 + 2 ), i * 20 + 8 );
		if ( g.attributes.aRoot ) input.set( g.attributes.aRoot.array.subarray( i * 3, i * 3 + 3 ), i * 20 + 12 );
		if ( g.attributes.aFur ) input.set( g.attributes.aFur.array.subarray( i * 3, i * 3 + 3 ), i * 20 + 16 );

	}
	const source = new StorageBuffer( { label: 'boar-probe-input', count: N * 5, type: 'vec4f', data: input } );
	const result = new StorageBuffer( { label: 'boar-probe-result', count: N * 3, type: 'vec4f' } );
	const probe = new ComputeKernel( {
		label: 'actual-boar-vertex', modules: material.modules,
		bindings: { ...material.bindings, source: { storage: source }, result: { storage: result, access: 'read_write' } },
		code: `
	struct ProbeVertex { position: vec3f, normal: vec3f, aBoar: vec2f, aRoot: vec3f, aFur: vec3f, instance: u32, useWorld: bool, worldPos: vec3f, worldNormal: vec3f, prevWorldPos: vec3f };
	struct ProbeOut { vBoarLocal: vec3f, vBoarInfo: vec2f, vBoarRestNormal: vec3f, vBoarFur: vec3f };
	fn actualVertex( v: ptr<function, ProbeVertex>, o: ptr<function, ProbeOut> ) { ${ material.vertex } }
	@compute @workgroup_size(64) fn main( @builtin(global_invocation_id) id: vec3u ) {
		let i = id.x; if ( i >= ${ N }u ) { return; }
		var v: ProbeVertex; var o: ProbeOut;
		v.position = source[ i * 5u ].xyz; v.normal = source[ i * 5u + 1u ].xyz; v.aBoar = source[ i * 5u + 2u ].xy;
		v.aRoot = source[ i * 5u + 3u ].xyz; v.aFur = source[ i * 5u + 4u ].xyz;
		v.instance = 0u; actualVertex( &v, &o );
		result[ i * 3u ] = vec4f( v.worldPos, 1.0 ); result[ i * 3u + 1u ] = vec4f( v.worldNormal, 0.0 ); result[ i * 3u + 2u ] = vec4f( v.prevWorldPos, 1.0 );
	}`,
	} );
	async function capturePose( writer = write ) {

		writer(); L.GPU.beginFrame(); probe.dispatch( Math.ceil( N / 64 ) ); L.GPU.submit();
		return new Float32Array( await readBuffer( result, N * 48 ) );

	}
	return { capturePose, N, positions, tags };

}
const { capturePose, N, positions, tags } = makeProbe( batch.mesh.geometry, batch.material );
const coatProbe = makeProbe( batch.coatMesh.geometry, batch.coatMaterial, 2048 );
const idleCoat = await coatProbe.capturePose();
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
const posedCoat = await coatProbe.capturePose();
assert.ok( posedCoat.every( Number.isFinite ), 'animated bristles have finite vertices, normals and previous positions' );
for ( let i = 0; i < coatProbe.N; i ++ ) {

	const o = i * 12;
	assert.ok( Math.abs( Math.hypot( ...posedCoat.subarray( o + 4, o + 7 ) ) - 1 ) < 0.002, 'animated bristle normals remain unit length' );
	for ( let k = 8; k < 11; k ++ ) assert.ok( Math.abs( idleCoat[ o + k ] - posedCoat[ o + k ] ) < 1e-5, 'fur motion preserves the previous articulation' );

}
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
// Fine coat geometry is a close-range feature; a distant herd must not keep drawing it.
await L.run( 1, () => { batch.begin(); batch.write( record, 40 ); batch.commit(); } );
assert.equal( batch.mesh.geometry.instanceCount, 1, 'the skin remains visible beyond the groom range' );
assert.equal( batch.coatMesh.geometry.instanceCount, 0, 'far boars do not draw the detailed groom' );
await L.run( 1, write );
assert.equal( batch.coatMesh.geometry.instanceCount, 1, 'the groom returns when an animal is close' );
// A culled animal has no previous visible coat; its first returned groom pose must not
// inherit a stale near-camera detail factor and generate phantom expansion velocity.
Object.assign( record, { x: 0, y: 0, z: 0, px: 0, py: 0, pz: 0, phase: 0, pPhase: 0, stride: 0, pStride: 0, root: 0, pRoot: 0 } );
await coatProbe.capturePose();
batch.begin(); batch.commit();
const resumed = await coatProbe.capturePose( () => { batch.begin(); batch.write( record, 30 ); batch.commit(); } );
for ( let i = 0; i < coatProbe.N; i ++ ) for ( let k = 0; k < 3; k ++ ) {

	assert.ok( Math.abs( resumed[ i * 12 + k ] - resumed[ i * 12 + 8 + k ] ) < 1e-5, 'returning fur has no stale detail motion after a skipped frame' );

}
batch.mesh.onBeforeRender( null, null, L.shadows.cascades[ 1 ].camera );
assert.equal( batch.mesh.geometry.instanceCount, 1, 'boar bodies cast sun shadows in the middle-distance cascade' );
batch.coatMesh.onBeforeRender( null, null, L.shadows.cascades[ 1 ].camera );
assert.equal( batch.coatMesh.geometry.instanceCount, 0, 'dense groom shadows remain limited to the near cascade' );
const error = await L.GPU.device.popErrorScope();
assert.equal( error, null, error?.message );
assert.deepEqual( errors, [], 'main/shadow passes compile and draw without GPU validation errors' );
console.log( `Boar GPU passed: ${ N } vertex poses, independent previous articulation, normal deformation, main/shadow rendering` );
await L.exit();
