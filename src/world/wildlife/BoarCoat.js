import * as E from '../../engine/index.js';

// A deterministic groom on the actual sculpt, shared by every animal. These are short curved
// ribbons, not transparent shells: each root inherits its skin bone and each tapered tip can
// catch the light and break the silhouette. The batch only draws this close to the camera.
export function buildBoarCoat( skin, { count = 8200 } = {} ) {

	const sp = skin.attributes.position.array, sn = skin.attributes.normal.array;
	const st = skin.attributes.aBoar.array, si = skin.index.array;
	let seed = 193521;
	const random = () => { seed = ( Math.imul( seed, 1664525 ) + 1013904223 ) >>> 0; return seed / 4294967296; };
	const faces = [];
	let area = 0;
	for ( let i = 0; i < si.length; i += 3 ) {

		const a = si[ i ], b = si[ i + 1 ], c = si[ i + 2 ];
		if ( st[ a * 2 ] !== 0 || st[ b * 2 ] !== 0 || st[ c * 2 ] !== 0 ) continue;
		if ( st[ a * 2 + 1 ] !== st[ b * 2 + 1 ] || st[ a * 2 + 1 ] !== st[ c * 2 + 1 ] ) continue;
		const y = ( sp[ a * 3 + 1 ] + sp[ b * 3 + 1 ] + sp[ c * 3 + 1 ] ) / 3;
		if ( y < 0.12 ) continue;
		const u = new E.Vector3().fromArray( sp, b * 3 ).sub( new E.Vector3().fromArray( sp, a * 3 ) );
		const v = new E.Vector3().fromArray( sp, c * 3 ).sub( new E.Vector3().fromArray( sp, a * 3 ) );
		const weight = u.cross( v ).length() * ( y > 0.82 ? 1.65 : 1 );
		if ( weight < 1e-10 ) continue;
		area += weight;
		faces.push( { a, b, c, end: area } );

	}
	const positions = [], normals = [], roots = [], tags = [], fur = [], indices = [];
	const root = new E.Vector3(), normal = new E.Vector3(), tangent = new E.Vector3();
	const across = new E.Vector3(), forward = new E.Vector3();
	for ( let i = 0; i < count && faces.length; i ++ ) {

		const sample = random() * area;
		let lo = 0, hi = faces.length - 1;
		while ( lo < hi ) { const mid = ( lo + hi ) >>> 1; if ( faces[ mid ].end < sample ) lo = mid + 1; else hi = mid; }
		const face = faces[ lo ], u = Math.sqrt( random() ), v = random();
		const weights = [ 1 - u, u * ( 1 - v ), u * v ], verts = [ face.a, face.b, face.c ];
		root.set( 0, 0, 0 ); normal.set( 0, 0, 0 );
		for ( let k = 0; k < 3; k ++ ) {

			root.addScaledVector( forward.fromArray( sp, verts[ k ] * 3 ), weights[ k ] );
			normal.addScaledVector( forward.fromArray( sn, verts[ k ] * 3 ), weights[ k ] );

		}
		if ( root.y < 0.10 ) { i --; continue; }
		normal.normalize();
		const bone = st[ face.a * 2 + 1 ];
		const mane = Math.max( 0, Math.min( 1, ( normal.y - 0.50 ) / 0.42 ) ) * Math.max( 0, Math.min( 1, ( 0.56 - root.z ) / 0.26 ) ) * Math.exp( - ( ( ( root.z - 0.08 ) / 0.53 ) ** 2 ) );
		const faceShort = Math.max( 0, Math.min( 1, ( root.z - 0.39 ) / 0.54 ) );
		const leg = bone >= 0 && bone < 4, ear = bone > 5;
		const length = ( leg ? 0.018 : ear ? 0.023 : ( 0.042 + mane * 0.062 ) * ( 1 - faceShort * 0.78 ) ) * ( 0.65 + random() * 0.55 );
		// Bristles sweep backwards on the back, downward over the flanks, and down the limbs.
		forward.set( normal.x * 0.18, leg ? - 1 : - 0.45 * ( 1 - mane ), leg ? - 0.14 : - 1 );
		tangent.copy( forward ).addScaledVector( normal, - forward.dot( normal ) );
		if ( tangent.lengthSq() < 0.001 ) tangent.set( 1, 0, 0 );
		tangent.normalize();
		across.crossVectors( normal, tangent ).normalize();
		tangent.addScaledVector( across, ( random() - 0.5 ) * 0.65 ).normalize();
		across.crossVectors( normal, tangent ).normalize();
		const width = ( 0.0015 + random() * 0.0014 ) * ( 1 - faceShort * 0.45 );
		const variation = random(), base = positions.length / 3;
		const lift = 0.26 + mane * 0.51;
		for ( const [ t, side ] of [ [ 0, - 1 ], [ 0, 1 ], [ 0.43, - 1 ], [ 0.43, 1 ], [ 0.78, - 1 ], [ 0.78, 1 ], [ 1, 0 ] ] ) {

			const w = width * ( 1 - t * 0.88 ) * side;
			const outward = - 0.0004 + length * ( Math.sin( t * 1.6 ) * lift );
			const swept = length * ( t * 0.72 + t * t * 0.12 );
			positions.push( root.x + normal.x * outward + tangent.x * swept + across.x * w,
				root.y + normal.y * outward + tangent.y * swept + across.y * w,
				root.z + normal.z * outward + tangent.z * swept + across.z * w );
			normals.push( normal.x, normal.y, normal.z );
			roots.push( root.x, root.y, root.z );
			tags.push( 8, bone );
			fur.push( side, t, variation );

		}
		for ( const index of [ 0, 2, 1, 1, 2, 3, 2, 4, 3, 3, 4, 5, 4, 6, 5 ] ) indices.push( base + index );

	}
	const geometry = new E.BufferGeometry();
	geometry.setAttribute( 'position', new E.Float32BufferAttribute( positions, 3 ) );
	geometry.setAttribute( 'normal', new E.Float32BufferAttribute( normals, 3 ) );
	geometry.setAttribute( 'aRoot', new E.Float32BufferAttribute( roots, 3 ) );
	geometry.setAttribute( 'aBoar', new E.Float32BufferAttribute( tags, 2 ) );
	geometry.setAttribute( 'aFur', new E.Float32BufferAttribute( fur, 3 ) );
	geometry.setIndex( indices );
	geometry.computeBoundingBox();
	return { geometry, strands: positions.length / 21, triangles: indices.length / 3 };

}
