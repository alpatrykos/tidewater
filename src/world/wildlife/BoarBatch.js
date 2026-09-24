import { Material } from '../../engine/render/Material.js';
import { ShaderModule } from '../../engine/gpu/Shader.js';
import { buildBoar } from './BoarShapes.js';
import { InstanceRecords, instancedMesh, kitModule } from './Kit.js';

// One draw for the herd, with shadows in the near cascade only. Six vec4s hold independent
// current and previous poses, including scale and articulation (required by temporal filtering).
// 0 position/scale, 1 quaternion, 2 gait/stride/root/seed, 3 previous position/scale,
// 4 previous quaternion, 5 previous gait/stride/root/unused.
const REC = 6;
const f = ( x ) => {

	const n = String( + x.toFixed( 6 ) );
	return n.includes( '.' ) ? n : n + '.0';

};
const srgb = ( r, g, b ) => `vec3f( ${ f( r ** 2.2 ) }, ${ f( g ** 2.2 ) }, ${ f( b ** 2.2 ) } )`;

const boarPoseModule = new ShaderModule( {
	name: 'boarPose',
	code: /* wgsl */`
fn boarRotateX( p: vec3f, a: f32 ) -> vec3f {
	return vec3f( p.x, p.y * cos( a ) - p.z * sin( a ), p.y * sin( a ) + p.z * cos( a ) );
}
fn boarRotateY( p: vec3f, a: f32 ) -> vec3f {
	return vec3f( p.x * cos( a ) + p.z * sin( a ), p.y, -p.x * sin( a ) + p.z * cos( a ) );
}
fn boarPose( rest: vec3f, bone: f32, pose: vec3f, seed: f32 ) -> vec3f {
	let phase = pose.x; let stride = pose.y; let root = pose.z;
	var p = rest;
	if ( bone < -0.5 ) {
		let breath = sin( phase * 1.1 + seed * 6.283185 ) * 0.006 * ( 1.0 - stride )
			* smoothstep( 0.35, 0.65, rest.y ) * ( 1.0 - smoothstep( 0.18, 0.5, rest.z ) );
		p.x *= 1.0 + breath; p.y += breath * 0.3;
	}
	if ( bone >= 0.0 && bone < 3.5 ) {
		let front = bone < 1.5;
		let side = select( 1.0, -1.0, bone == 1.0 || bone == 3.0 );
		// Diagonal pairs alternate, from a quiet walk to an extended fleeing trot.
		let ph = phase + select( 0.0, 3.14159265, bone == 1.0 || bone == 2.0 );
		let hip = vec3f( side * 0.20, 0.54, select( -0.43, 0.245, front ) );
		let knee = vec3f( side * 0.218, 0.28, hip.z + select( 0.055, -0.036, front ) );
		let shin = 1.0 - smoothstep( 0.13, 0.31, rest.y );
		let bend = max( sin( ph ), 0.0 ) * stride * select( -0.62, 0.5, front );
		p = mix( p, knee + boarRotateX( p - knee, bend ), shin );
		p = hip + boarRotateX( p - hip, cos( ph ) * stride * 0.39 );
	} else if ( bone > 4.5 ) {
		let base = vec3f( 0.0, 0.65, -0.64 );
		p = base + boarRotateY( p - base, sin( phase * 0.65 + seed * 6.283185 ) * 0.12 );
	} else {
		let w = select( smoothstep( 0.23, 0.49, rest.z ), 1.0, bone > 3.5 );
		let neck = vec3f( 0.0, 0.61, 0.35 );
		let a = root * ( 0.54 + sin( phase * 1.5 + seed * 6.283185 ) * 0.016 );
		p = mix( p, neck + boarRotateX( p - neck, a ), w );
	}
	p.y += stride * 0.012 * ( 1.0 - cos( phase * 2.0 ) );
	return p;
}
`,
} );

export class BoarBatch {

	constructor( { capacity = 16, csm = null } = {} ) {

		const built = buildBoar();
		this.records = new InstanceRecords( 'boarInstances', capacity, REC );
		this.material = this.createMaterial();
		this.mesh = instancedMesh( 'Boars', built.geometry, this.material, this.records, { csm, castShadow: true } );
		this.triangles = built.triangles;

	}

	begin() {

		this.records.begin();

	}

	write( b ) {

		const o = this.records.push();
		if ( o < 0 ) return;
		const d = this.records.data;
		d[ o ] = b.x; d[ o + 1 ] = b.y; d[ o + 2 ] = b.z; d[ o + 3 ] = b.scale;
		d.set( b.q, o + 4 );
		d[ o + 8 ] = b.phase; d[ o + 9 ] = b.stride; d[ o + 10 ] = b.root; d[ o + 11 ] = b.seed;
		d[ o + 12 ] = b.px; d[ o + 13 ] = b.py; d[ o + 14 ] = b.pz; d[ o + 15 ] = b.pScale;
		d.set( b.pq, o + 16 );
		d[ o + 20 ] = b.pPhase; d[ o + 21 ] = b.pStride; d[ o + 22 ] = b.pRoot; d[ o + 23 ] = 0;

	}

	commit() {

		this.records.commit();

	}

	get count() {

		return this.records.count;

	}

	createMaterial() {

		const F = ( i ) => this.records.field( i );
		return new Material( {
			name: 'Boars', roughness: 0.94, metalness: 0,
			underwaterLighting: 'none',
			modules: [ kitModule, boarPoseModule ],
			storage: { boarInstances: this.records.buffer },
			attributes: { aBoar: 'vec2f' },
			varyings: { vBoarLocal: 'vec3f', vBoarInfo: 'vec2f' },
			vertex: /* wgsl */`
	let P = ${ F( 0 ) }; let Q = ${ F( 1 ) }; let pose = ${ F( 2 ) };
	let PP = ${ F( 3 ) }; let PQ = ${ F( 4 ) }; let previous = ${ F( 5 ) };
	let bone = v.aBoar.y;
	let local = boarPose( v.position, bone, pose.xyz, pose.w );
	let prior = boarPose( v.position, bone, previous.xyz, pose.w );
	// Transform surface tangents through the same spatial deformation. This includes the neck
	// and knee blend gradients, which a simple rotation of the rest normal would miss.
	let referenceAxis = select( vec3f( 0.0, 1.0, 0.0 ), vec3f( 1.0, 0.0, 0.0 ), abs( v.normal.y ) > 0.9 );
	let tangent = normalize( cross( referenceAxis, v.normal ) );
	let bitangent = cross( v.normal, tangent );
	let dt = boarPose( v.position + tangent * 0.0005, bone, pose.xyz, pose.w ) - local;
	let db = boarPose( v.position + bitangent * 0.0005, bone, pose.xyz, pose.w ) - local;
	let normal = normalize( cross( dt, db ) );
	o.vBoarLocal = v.position;
	o.vBoarInfo = vec2f( v.aBoar.x, pose.w );
	v.useWorld = true;
	v.worldPos = P.xyz + rotateQ( Q, local * P.w );
	v.worldNormal = rotateQ( Q, normal );
	v.prevWorldPos = PP.xyz + rotateQ( PQ, prior * PP.w );
`,
			surface: /* wgsl */`
	let part = in.vs.vBoarInfo.x;
	let seed = in.vs.vBoarInfo.y;
	let p = in.vs.vBoarLocal;
	let mottling = mx_noise_float3( p * 9.0 + seed * 13.0 ) * 0.5 + 0.5;
	let fur = mx_noise_float3( p * vec3f( 125.0, 88.0, 25.0 ) + seed * 41.0 ) * 0.5 + 0.5;
	let pale = smoothstep( 0.61, 0.96, p.y ) * 0.35;
	var c = mix( ${ srgb( 0.245, 0.207, 0.171 ) }, ${ srgb( 0.405, 0.345, 0.275 ) }, mottling * 0.55 + seed * 0.2 + pale );
	c *= mix( 0.79, 1.13, fur );
	c *= mix( 0.67, 1.0, smoothstep( 0.13, 0.54, p.y ) );
	var rough = 0.94;
	if ( part > 0.5 && part < 1.5 ) {
		c = ${ srgb( 0.205, 0.139, 0.111 ) } * ( 0.88 + mottling * 0.2 );
	} else if ( part > 1.5 && part < 2.5 ) {
		c = ${ srgb( 0.215, 0.17, 0.143 ) } * ( 0.9 + fur * 0.2 ); rough = 0.65;
	} else if ( part > 2.5 && part < 3.5 ) {
		c = ${ srgb( 0.087, 0.079, 0.067 ) } * ( 0.85 + fur * 0.25 ); rough = 0.69;
	} else if ( part > 3.5 && part < 4.5 ) {
		c = mix( ${ srgb( 0.59, 0.50, 0.35 ) }, ${ srgb( 0.90, 0.855, 0.71 ) }, smoothstep( 0.365, 0.5, p.y ) ); rough = 0.39;
	} else if ( part > 4.5 && part < 5.5 ) {
		c = ${ srgb( 0.026, 0.019, 0.014 ) }; rough = 0.13;
	} else if ( part > 5.5 && part < 6.5 ) {
		c = mix( ${ srgb( 0.17, 0.15, 0.12 ) }, ${ srgb( 0.30, 0.27, 0.22 ) }, fur );
	} else if ( part > 6.5 ) {
		c = ${ srgb( 0.052, 0.042, 0.037 ) }; rough = 0.74;
	}
	s.albedo = c;
	s.roughness = rough;
`,
		} );

	}

}
