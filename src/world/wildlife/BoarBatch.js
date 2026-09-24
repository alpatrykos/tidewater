import { Material } from '../../engine/render/Material.js';
import { boarPoseModule } from './BoarPose.js';
import { buildBoar } from './BoarShapes.js';
import { buildBoarCoat } from './BoarCoat.js';
import { Texture } from '../../engine/gpu/Texture.js';
import { loadBoarCoatTexture } from './BoarTexture.js';
import { InstanceRecords, instancedMesh, kitModule } from './Kit.js';

// One skin draw (near/middle shadows) and one close-range groom draw (near shadows).
// Seven vec4s hold independent current and previous poses, including scale and articulation (required by temporal filtering).
// 0 position/scale, 1 quaternion, 2 gait/stride/root/seed, 3 previous position/scale,
// 4 previous quaternion, 5 previous gait/stride/root/unused, 6 current/previous coat detail.
const REC = 7;
const f = ( x ) => {

	const n = String( + x.toFixed( 6 ) );
	return n.includes( '.' ) ? n : n + '.0';

};
const srgb = ( r, g, b ) => `vec3f( ${ f( r ** 2.2 ) }, ${ f( g ** 2.2 ) }, ${ f( b ** 2.2 ) } )`;

export class BoarBatch {

	constructor( { capacity = 16, csm = null, coatTexture = null } = {} ) {

		const built = buildBoar();
		this.coatTexture = coatTexture || new Texture( { label: 'Boar coat placeholder', width: 1, height: 1,
			format: 'rgba8unorm-srgb', data: new Uint8Array( [ 72, 62, 48, 255 ] ) } );
		this.records = new InstanceRecords( 'boarInstances', capacity, REC );
		this.material = this.createMaterial();
		this.mesh = instancedMesh( 'Boars', built.geometry, this.material, this.records, { castShadow: true } );
		// The skin is visible well beyond the first cascade. Keep its full animal silhouette
		// in the middle cascade too, while the much denser coat remains near-only.
		if ( csm ) this.mesh.onBeforeRender = ( renderer, scene, camera ) => {

			const cascade = csm.cascades?.findIndex( ( c ) => c.camera === camera ) ?? - 1;
			this.mesh.geometry.instanceCount = cascade > 1 ? 0 : this.records.count;

		};
		this.triangles = built.triangles;
		const coat = buildBoarCoat( built.geometry );
		this.coatRecords = new InstanceRecords( 'boarCoatInstances', capacity, REC );
		this.coatMaterial = this.createMaterial( this.coatRecords, true );
		this.coatMesh = instancedMesh( 'Boar bristles', coat.geometry, this.coatMaterial, this.coatRecords, { csm, castShadow: true } );
		this.mesh.add( this.coatMesh );
		this.coatTriangles = coat.triangles;
		this._coatDetail = new WeakMap();
		this._frame = 0;
		this.ready = ! coatTexture && typeof window !== 'undefined' ? loadBoarCoatTexture().then( ( texture ) => {

			this.coatTexture = texture;
			for ( const material of [ this.material, this.coatMaterial ] ) {

				material.bindings.boarCoat.texture = texture;
				material.needsUpdate = true;

			}

		} ) : Promise.resolve();

	}

	begin() {

		this._frame ++;
		this.records.begin();
		this.coatRecords.begin();

	}

	write( b, distance = 0 ) {

		const o = this.records.push();
		if ( o < 0 ) return;
		const d = this.records.data;
		d[ o ] = b.x; d[ o + 1 ] = b.y; d[ o + 2 ] = b.z; d[ o + 3 ] = b.scale;
		d.set( b.q, o + 4 );
		d[ o + 8 ] = b.phase; d[ o + 9 ] = b.stride; d[ o + 10 ] = b.root; d[ o + 11 ] = b.seed;
		d[ o + 12 ] = b.px; d[ o + 13 ] = b.py; d[ o + 14 ] = b.pz; d[ o + 15 ] = b.pScale;
		d.set( b.pq, o + 16 );
		d[ o + 20 ] = b.pPhase; d[ o + 21 ] = b.pStride; d[ o + 22 ] = b.pRoot; d[ o + 23 ] = 0;
		const detail = Math.max( 0, Math.min( 1, ( 32 - distance ) / 14 ) );
		const last = this._coatDetail.get( b );
		d[ o + 24 ] = detail;
		d[ o + 25 ] = last?.frame === this._frame - 1 ? last.detail : detail;
		this._coatDetail.set( b, { detail, frame: this._frame } );
		if ( detail > 0 ) {

			const co = this.coatRecords.push();
			if ( co >= 0 ) this.coatRecords.data.set( d.subarray( o, o + REC * 4 ), co );

		}

	}

	commit() {

		this.records.commit();
		this.coatRecords.commit();

	}

	get count() {

		return this.records.count;

	}

	createMaterial( records = this.records, coat = false ) {

		const F = ( i ) => records.field( i );
		return new Material( {
			name: coat ? 'Boar bristles' : 'Boars', roughness: 0.9, metalness: 0,
			side: coat ? 'double' : 'front',
			defines: { SHEEN: 1 },
			underwaterLighting: 'none',
			shadow: 'return true;',
			modules: [ kitModule, boarPoseModule ],
			storage: { [ records.name ]: records.buffer },
			textures: { boarCoat: this.coatTexture },
			attributes: coat ? { aBoar: 'vec2f', aFur: 'vec3f', aRoot: 'vec3f' } : { aBoar: 'vec2f' },
			varyings: { vBoarLocal: 'vec3f', vBoarInfo: 'vec2f', vBoarRestNormal: 'vec3f', vBoarFur: 'vec3f' },
			vertex: /* wgsl */`
	let P = ${ F( 0 ) }; let Q = ${ F( 1 ) }; let pose = ${ F( 2 ) };
	let PP = ${ F( 3 ) }; let PQ = ${ F( 4 ) }; let previous = ${ F( 5 ) };
	let bone = v.aBoar.y;
	let rest = ${ coat ? `mix( v.aRoot, v.position, ${ F( 6 ) }.x )` : 'v.position' };
	let oldRest = ${ coat ? `mix( v.aRoot, v.position, ${ F( 6 ) }.y )` : 'v.position' };
	let local = boarPose( rest, bone, pose.xyz, pose.w );
	let prior = boarPose( oldRest, bone, previous.xyz, pose.w );
	// Transform surface tangents through the same spatial deformation. This includes the neck
	// and knee blend gradients, which a simple rotation of the rest normal would miss.
	let referenceAxis = select( vec3f( 0.0, 1.0, 0.0 ), vec3f( 1.0, 0.0, 0.0 ), abs( v.normal.y ) > 0.9 );
	let tangent = normalize( cross( referenceAxis, v.normal ) );
	let bitangent = cross( v.normal, tangent );
	let dt = boarPose( rest + tangent * 0.0005, bone, pose.xyz, pose.w ) - local;
	let db = boarPose( rest + bitangent * 0.0005, bone, pose.xyz, pose.w ) - local;
	let normal = normalize( cross( dt, db ) );
	o.vBoarLocal = v.position;
	o.vBoarInfo = vec2f( v.aBoar.x, pose.w );
	o.vBoarRestNormal = v.normal;
	o.vBoarFur = ${ coat ? 'v.aFur' : 'vec3f( 0.0 )' };
	v.useWorld = true;
	v.worldPos = P.xyz + rotateQ( Q, local * P.w );
	v.worldNormal = rotateQ( Q, normal );
	v.prevWorldPos = PP.xyz + rotateQ( PQ, prior * PP.w );
`,
			surface: /* wgsl */`
	let part = in.vs.vBoarInfo.x;
	let seed = in.vs.vBoarInfo.y;
	let p = in.vs.vBoarLocal;
	let fnorm = abs( normalize( in.vs.vBoarRestNormal ) );
	let offset = vec2f( seed * 0.67, seed * 0.43 );
	// Two smoothly blended groom projections avoid an unwrap seam across the shoulder.
	// Limbs use a downwards groom; the back and flanks flow towards the rump.
	let sideUV = vec2f( p.y * 2.8 - p.z * 0.85, -p.z * 2.8 - p.y * 0.85 ) + offset;
	let backUV = vec2f( p.x * 3.0, -p.z * 3.0 ) + offset;
	let legUV = vec2f( p.x * 3.6 + p.z * 2.5, -p.y * 3.6 ) + offset;
	let sideCoat = textureSample( boarCoat, smpAniso4Repeat, sideUV ).rgb;
	let backCoat = textureSample( boarCoat, smpAniso4Repeat, backUV ).rgb;
	let legCoat = textureSample( boarCoat, smpAniso4Repeat, legUV ).rgb;
	let mappedCoat = mix( mix( sideCoat, backCoat, smoothstep( 0.3, 0.87, fnorm.y ) ), legCoat, 1.0 - smoothstep( 0.25, 0.51, p.y ) );
	let mottling = mx_noise_float3( p * 6.0 + seed * 13.0 ) * 0.5 + 0.5;
	let breakup = mx_noise_float3( p * 32.0 + seed * 41.0 ) * 0.5 + 0.5;
	// The undercoat follows the same back-to-rump groom as the silhouette strands. Filter
	// the short fibres by their pixel footprint so they settle down instead of sparkling.
	let groom = mix( p.y * 175.0, p.x * 195.0, smoothstep( 0.35, 0.85, fnorm.y ) )
		+ p.z * 24.0 + mx_noise_float3( p * 21.0 ) * 0.45;
	let fibreFilter = 1.0 - smoothstep( 0.3, 1.0, fwidth( groom ) );
	let fibre = ( sin( groom * 6.283185 ) * 0.5 + 0.5 ) * fibreFilter;
	let paleFace = smoothstep( 0.48, 0.83, p.z ) * ( 1.0 - smoothstep( 0.43, 0.60, p.y ) );
	let saddle = smoothstep( 0.64, 0.96, p.y ) * ( 1.0 - smoothstep( 0.1, 0.53, p.z ) );
	var c = mix( ${ srgb( 0.22, 0.181, 0.139 ) }, ${ srgb( 0.42, 0.358, 0.277 ) }, mottling * 0.58 + seed * 0.20 );
	c *= mix( 0.82, 1.13, breakup ) * ( 1.0 - saddle * 0.15 );
	c = mix( c, ${ srgb( 0.43, 0.389, 0.32 ) }, paleFace * 0.38 );
	c *= 0.92 + fibre * 0.14;
	c = mix( c, mappedCoat * ( 0.84 + mottling * 0.24 + seed * 0.16 ), 0.88 );
	var rough = 0.86;
	var height = dot( mappedCoat, vec3f( 0.2126, 0.7152, 0.0722 ) ) * 0.0035 + breakup * 0.00012;
	var specular = 0.42;
	var sheen = vec3f( 0.065, 0.047, 0.027 );
	if ( part > 0.5 && part < 1.5 ) {
		c = ${ srgb( 0.28, 0.203, 0.165 ) } * ( 0.75 + breakup * 0.35 );
		rough = 0.88; sheen *= 0.2; height = breakup * 0.0007;
	} else if ( part > 1.5 && part < 2.5 ) {
		let pores = mx_noise_float3( p * 340.0 ) * 0.5 + 0.5;
		c = mix( ${ srgb( 0.115, 0.099, 0.085 ) }, ${ srgb( 0.247, 0.208, 0.167 ) }, mottling );
		c *= 0.82 + pores * 0.3;
		rough = 0.37 + breakup * 0.12; specular = 0.9; sheen = vec3f( 0.0 ); height = pores * 0.0006;
	} else if ( part > 2.5 && part < 3.5 ) {
		let grooves = sin( p.y * 670.0 + breakup * 3.0 ) * 0.5 + 0.5;
		c = mix( ${ srgb( 0.103, 0.09, 0.07 ) }, ${ srgb( 0.20, 0.181, 0.142 ) }, breakup );
		rough = 0.68; sheen = vec3f( 0.0 ); height = grooves * 0.0005;
	} else if ( part > 3.5 && part < 4.5 ) {
		c = mix( ${ srgb( 0.37, 0.282, 0.157 ) }, ${ srgb( 0.84, 0.786, 0.636 ) }, smoothstep( 0.365, 0.49, p.y ) );
		rough = 0.37; specular = 0.72; sheen = vec3f( 0.0 );
		height = sin( atan2( p.x, p.z - 0.82 ) * 140.0 ) * 0.00006;
	} else if ( part > 4.5 && part < 5.5 ) {
		c = ${ srgb( 0.033, 0.024, 0.015 ) }; rough = 0.12; specular = 1.0;
		sheen = vec3f( 0.0 ); height = 0.0;
	} else if ( part > 5.5 && part < 6.5 ) {
		c = mix( ${ srgb( 0.21, 0.183, 0.135 ) }, ${ srgb( 0.46, 0.41, 0.32 ) }, breakup );
	} else if ( part > 6.5 && part < 7.5 ) {
		c = ${ srgb( 0.046, 0.035, 0.026 ) }; rough = 0.62;
		sheen = vec3f( 0.0 ); height = breakup * 0.00025;
	} else if ( part > 7.5 && part < 8.5 ) {
		let f = in.vs.vBoarFur;
		let silver = smoothstep( 0.68, 0.97, f.z );
		let tip = smoothstep( 0.27, 0.94, f.y );
		let lighter = mix( ${ srgb( 0.41, 0.355, 0.265 ) }, ${ srgb( 0.64, 0.585, 0.465 ) }, silver );
		c = mix( c * ( 0.67 + f.z * 0.25 ), lighter, tip * ( 0.42 + silver * 0.41 ) );
		rough = 0.81; height = 0.0; sheen = vec3f( 0.085, 0.063, 0.038 );
		s.ao = 0.72 + tip * 0.28;
	} else if ( part > 8.5 ) {
		c = ${ srgb( 0.16, 0.113, 0.077 ) } * ( 0.82 + breakup * 0.34 );
		rough = 0.72; sheen = vec3f( 0.0 ); height = breakup * 0.0003;
	}
	// Irregular dried soil clings to the lower legs and belly, not an even painted sock.
	let mud = ( 1.0 - smoothstep( 0.10, 0.26 + mottling * 0.1, p.y ) ) * ( 0.24 + breakup * 0.40 );
	c = mix( c, ${ srgb( 0.26, 0.226, 0.17 ) }, mud );
	s.albedo = c;
	s.roughness = mix( rough, 0.94, mud );
	s.specularIntensity = specular;
	s.sheenColor = sheen;
	s.sheenRoughness = 0.69;
	s.normal = perturbNormalByHeight( in.P, in.N, dpdx( height ), dpdy( height ), 1.0 );
`,
		} );

	}

}
