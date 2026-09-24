// Probe the production shader directly: a swinging rigid leg would fail the stance contacts,
// while frozen appendages or a singular deformation would fail articulation/normal checks.
import assert from 'node:assert/strict';
import './headless.mjs';
import '../src/engine/render/Frame.js';
import { GPU, ComputeKernel, StorageBuffer, readBuffer } from '../src/engine/webgpu.js';
import { boarPoseModule } from '../src/world/wildlife/BoarPose.js';
import { buildBoar } from '../src/world/wildlife/BoarShapes.js';

await GPU.init( { headless: true } );
GPU.device.pushErrorScope( 'validation' );
const cases = [];
const add = ( p, bone, phase, stride, root = 0, normal = [ 0, 1, 0 ] ) => {

	cases.push( [ ...p, bone, phase, stride, root, 0.37, ...normal, 0 ] );
	return cases.length - 1;

};
// The front-right foot is in stance here. A world advance of cycleLength * dPhase / TAU
// must be exactly cancelled by its local backwards displacement, at both walk and trot.
const contacts = [];
for ( const [ drive, cycleLength ] of [ [ 0.2, 0.60 ], [ 1, 1.20 ] ] ) {

	const first = add( [ 0.22, 0, 0.288 ], 0, 0.8, drive );
	const next = add( [ 0.22, 0, 0.288 ], 0, 1.1, drive );
	contacts.push( { first, next, forward: cycleLength * 0.3 / ( Math.PI * 2 ) } );

}
const swing = add( [ 0.22, 0, 0.288 ], 0, Math.PI * 1.60, 1 );
const diagonal = [ 0, 1, 2, 3 ].map( bone => add( [ bone % 2 ? - 0.22 : 0.22, 0, bone < 2 ? 0.288 : - 0.418 ], bone, 0.65, 1 ) );
const earA = add( [ 0.34, 0.925, 0.455 ], 6, 0.4, 0 );
const earB = add( [ 0.34, 0.925, 0.455 ], 6, 4.4, 0 );
const earBaseA = add( [ 0.16, 0.70, 0.485 ], 6, 0.4, 0 );
const earBaseB = add( [ 0.16, 0.70, 0.485 ], 6, 4.4, 0 );
const rootA = add( [ 0, 0.395, 1.04 ], 4, 0.3, 0, 1 );
const rootB = add( [ 0, 0.395, 1.04 ], 4, 2.3, 0, 1 );

// Actual template tangents include blended knees, neck, ears and fur attachment points.
const geometry = buildBoar().geometry;
const p = geometry.attributes.position.array, n = geometry.attributes.normal.array, tags = geometry.attributes.aBoar.array;
const geometryStart = cases.length;
for ( const phase of [ 0, 1.3, 3.4, 5.7 ] ) for ( let i = 0; i < p.length / 3; i ++ ) {

	add( Array.from( p.subarray( i * 3, i * 3 + 3 ) ), tags[ i * 2 + 1 ], phase, phase === 0 ? 0 : 1, phase === 3.4 ? 1 : 0, Array.from( n.subarray( i * 3, i * 3 + 3 ) ) );

}
const input = new StorageBuffer( { label: 'boar-pose-input', count: cases.length * 3, type: 'vec4f', data: new Float32Array( cases.flat() ) } );
const output = new StorageBuffer( { label: 'boar-pose-output', count: cases.length * 2, type: 'vec4f' } );
const kernel = new ComputeKernel( {

	label: 'boar-foot-contact-regression', modules: [ boarPoseModule ],
	bindings: { input: { storage: input }, output: { storage: output, access: 'read_write' } },
	code: `@compute @workgroup_size(64) fn main(@builtin(global_invocation_id) id: vec3u) {
		let i=id.x; if(i>=${ cases.length }u){return;}
		let p=input[i*3u]; let pose=input[i*3u+1u]; let n=input[i*3u+2u].xyz;
		let local=boarPose(p.xyz,p.w,pose.xyz,pose.w);
		let reference=select(vec3f(0.,1.,0.),vec3f(1.,0.,0.),abs(n.y)>0.9);
		let tangent=normalize(cross(reference,n)); let bitangent=cross(n,tangent);
		let a=boarPose(p.xyz+tangent*0.0005,p.w,pose.xyz,pose.w)-local;
		let b=boarPose(p.xyz+bitangent*0.0005,p.w,pose.xyz,pose.w)-local;
		let normal=normalize(cross(a,b));
		output[i*2u]=vec4f(local,1.); output[i*2u+1u]=vec4f(normal,0.);
	}`,

} );
GPU.beginFrame(); kernel.dispatch( Math.ceil( cases.length / 64 ) ); GPU.submit();
const result = new Float32Array( await readBuffer( output, cases.length * 32 ) );
const point = i => Array.from( result.subarray( i * 8, i * 8 + 3 ) );
for ( const { first, next, forward } of contacts ) {

	const a = point( first ), b = point( next );
	assert.ok( Math.abs( a[ 1 ] ) < 0.0001 && Math.abs( b[ 1 ] ) < 0.0001, 'stance hooves stay on the ground plane' );
	assert.ok( Math.abs( b[ 2 ] + forward - a[ 2 ] ) < 0.0001, 'stance foot cancels the body translation without skating' );

}
assert.ok( point( swing )[ 1 ] > 0.05, 'swing hooves lift clear of the ground' );
assert.ok( Math.abs( point( diagonal[ 0 ] )[ 1 ] - point( diagonal[ 3 ] )[ 1 ] ) < 0.0001, 'trot diagonal pair touches down together' );
assert.ok( point( diagonal[ 1 ] )[ 1 ] > 0.02 && point( diagonal[ 2 ] )[ 1 ] > 0.02, 'opposite diagonal pair is in swing' );
const earTipDelta = point( earB ).map( ( x, k ) => x - point( earA )[ k ] );
const earBaseDelta = point( earBaseB ).map( ( x, k ) => x - point( earBaseA )[ k ] );
assert.ok( Math.hypot( ...earTipDelta.map( ( x, k ) => x - earBaseDelta[ k ] ) ) > 0.003, 'ear tips articulate around attached roots' );
assert.ok( Math.abs( point( rootA )[ 0 ] - point( rootB )[ 0 ] ) > 0.008, 'rooting noses sweep laterally through the soil' );
assert.ok( point( rootA )[ 1 ] < 0.15 && point( rootB )[ 1 ] < 0.15, 'rooting lowers the nose to the soil' );
assert.ok( result.every( Number.isFinite ), 'all articulated template points and differential normals are finite' );
for ( let i = geometryStart; i < cases.length; i ++ ) assert.ok( Math.abs( Math.hypot( ...result.subarray( i * 8 + 4, i * 8 + 7 ) ) - 1 ) < 0.002 );
const error = await GPU.device.popErrorScope();
assert.equal( error, null, error?.message );
console.log( 'Boar pose: planted walk/trot contacts, swing clearance, diagonal gait, ear/root animation and finite deformed normals passed' );
process.exit( 0 );
