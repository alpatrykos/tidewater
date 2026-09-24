import * as THREE from '../../engine/index.js';

// Metres, +z forward, y=0 under the hooves. The trunk, neck, forehead and long snout are one
// continuous loft. A small set of secondary forms supplies the boar's identifying silhouette.
// aBoar: material part, bone (-1 torso/neck, 0..3 legs, 4 head, 5 tail).
export const BOAR_PART = { COAT: 0, EAR: 1, NOSE: 2, HOOF: 3, TUSK: 4, EYE: 5, BRISTLE: 6, NOSTRIL: 7 };

export function buildBoar() {

	const p = [], tag = [], idx = [];
	const vertex = ( v, part, bone ) => {

		const i = p.length / 3;
		p.push( ...v ); tag.push( part, bone );
		return i;

	};
	// rings contain centre, U and V vectors. U cross V points along the loft; end caps are closed.
	const loft = ( rings, part = 0, bone = - 1, sides = 12, square = 1 ) => {

		const base = p.length / 3;
		for ( const [ c, u, v ] of rings ) {

			for ( let j = 0; j < sides; j ++ ) {

				const a = j / sides * Math.PI * 2;
				const co = Math.sign( Math.cos( a ) ) * Math.abs( Math.cos( a ) ) ** square;
				const si = Math.sign( Math.sin( a ) ) * Math.abs( Math.sin( a ) ) ** square;
				vertex( c.map( ( x, k ) => x + u[ k ] * co + v[ k ] * si ), part, bone );

			}

		}
		for ( let i = 0; i < rings.length - 1; i ++ ) for ( let j = 0; j < sides; j ++ ) {

			const a = base + i * sides + j, b = base + i * sides + ( j + 1 ) % sides;
			idx.push( a, b, a + sides, b, b + sides, a + sides );

		}
		const first = vertex( rings[ 0 ][ 0 ], part, bone ), last = vertex( rings.at( - 1 )[ 0 ], part, bone );
		for ( let j = 0; j < sides; j ++ ) {

			const a = base + j, b = base + ( j + 1 ) % sides;
			const c = base + ( rings.length - 1 ) * sides;
			idx.push( first, b, a, last, c + j, c + ( j + 1 ) % sides );

		}

	};
	const tube = ( stations, part, bone, sides = 7 ) => {

		const rings = stations.map( ( [ x, y, z, r ], i ) => {

			const a = stations[ Math.max( 0, i - 1 ) ], b = stations[ Math.min( stations.length - 1, i + 1 ) ];
			const t = new THREE.Vector3( b[ 0 ] - a[ 0 ], b[ 1 ] - a[ 1 ], b[ 2 ] - a[ 2 ] ).normalize();
			const u = new THREE.Vector3().crossVectors( Math.abs( t.y ) > 0.9 ? new THREE.Vector3( 1, 0, 0 ) : new THREE.Vector3( 0, 1, 0 ), t ).normalize();
			const v = new THREE.Vector3().crossVectors( t, u );
			return [ [ x, y, z ], [ u.x * r, u.y * r, u.z * r ], [ v.x * r, v.y * r, v.z * r ] ];

		} );
		loft( rings, part, bone, sides );

	};
	const ellipsoid = ( center, radius, part, bone, sides = 10 ) => {

		const rings = [];
		for ( let i = 1; i < 6; i ++ ) {

			const t = - Math.PI / 2 + i / 6 * Math.PI;
			rings.push( [ [ center[ 0 ], center[ 1 ], center[ 2 ] + Math.sin( t ) * radius[ 2 ] ], [ Math.cos( t ) * radius[ 0 ], 0, 0 ], [ 0, Math.cos( t ) * radius[ 1 ], 0 ] ] );

		}
		loft( rings, part, bone, sides );

	};

	// Raised heavy shoulders, a lower rounded rump, and a wedge-shaped skull tapering into the
	// blunt rooting disc. Dorsal and ventral radii differ so the belly does not read as a cylinder.
	const body = [
		[ - 0.65, 0.60, 0.045, 0.08, 0.10 ], [ - 0.59, 0.61, 0.16, 0.17, 0.16 ],
		[ - 0.45, 0.62, 0.235, 0.205, 0.21 ], [ - 0.24, 0.63, 0.285, 0.235, 0.24 ],
		[ 0.0, 0.64, 0.31, 0.275, 0.26 ], [ 0.20, 0.64, 0.30, 0.285, 0.275 ],
		[ 0.35, 0.62, 0.275, 0.25, 0.24 ], [ 0.49, 0.565, 0.225, 0.205, 0.18 ],
		[ 0.61, 0.505, 0.185, 0.16, 0.135 ], [ 0.75, 0.44, 0.142, 0.11, 0.09 ],
		[ 0.88, 0.405, 0.109, 0.074, 0.065 ], [ 1.035, 0.395, 0.097, 0.061, 0.055 ],
	];
	const sides = 16, bodyBase = p.length / 3;
	for ( const [ z, y, w, up, down ] of body ) for ( let j = 0; j < sides; j ++ ) {

		const a = j / sides * Math.PI * 2, sy = Math.sin( a );
		vertex( [ w * Math.cos( a ), y + sy * ( sy > 0 ? up : down ), z ], 0, - 1 );

	}
	for ( let i = 0; i < body.length - 1; i ++ ) for ( let j = 0; j < sides; j ++ ) {

		const a = bodyBase + i * sides + j, b = bodyBase + i * sides + ( j + 1 ) % sides;
		idx.push( a, b, a + sides, b, b + sides, a + sides );

	}
	const rump = vertex( [ 0, 0.60, - 0.66 ], 0, - 1 );
	const nose = vertex( [ 0, 0.395, 1.039 ], BOAR_PART.NOSE, 4 );
	// A separate front rim gives the rooting disc a clean material boundary.
	const rim = p.length / 3;
	for ( let j = 0; j < sides; j ++ ) {

		const a = j / sides * Math.PI * 2;
		vertex( [ 0.097 * Math.cos( a ), 0.395 + Math.sin( a ) * 0.059, 1.038 ], BOAR_PART.NOSE, 4 );

	}
	for ( let j = 0; j < sides; j ++ ) {

		idx.push( rump, bodyBase + ( j + 1 ) % sides, bodyBase + j );
		idx.push( nose, rim + j, rim + ( j + 1 ) % sides );

	}

	// Four short, stout legs: full thighs inside the trunk taper through the wrist/hock. The
	// split hooves use two closed, flattened lobes with an actual gap instead of a painted line.
	for ( let k = 0; k < 4; k ++ ) {

		const side = k % 2 ? - 1 : 1, front = k < 2;
		const x = side * 0.20, z = front ? 0.245 : - 0.43;
		const leg = front ? [
			[ 0.64, x * 0.9, z, 0.102, 0.12 ], [ 0.43, x * 1.07, z - 0.012, 0.08, 0.09 ],
			[ 0.28, x * 1.09, z - 0.036, 0.059, 0.065 ], [ 0.13, x * 1.1, z + 0.005, 0.045, 0.047 ],
			[ 0.075, x * 1.1, z + 0.025, 0.051, 0.053 ],
		] : [
			[ 0.64, x * 0.82, z, 0.073, 0.115 ], [ 0.41, x * 1.1, z + 0.06, 0.087, 0.093 ],
			[ 0.28, x * 1.1, z + 0.055, 0.061, 0.061 ], [ 0.16, x * 1.1, z - 0.03, 0.037, 0.044 ],
			[ 0.075, x * 1.1, z - 0.012, 0.042, 0.049 ],
		];
		// Reverse stations so the ring frame points +y.
		loft( leg.toReversed().map( ( [ y, xx, zz, rx, rz ] ) => [ [ xx, y, zz ], [ rx, 0, 0 ], [ 0, 0, - rz ] ] ), 0, k, 10 );
		const footZ = z + ( front ? 0.043 : 0.012 );
		for ( const toe of [ - 1, 1 ] ) {

			loft( [ [ 0, 0.038, 0.068 ], [ 0.028, 0.041, 0.072 ], [ 0.086, 0.031, 0.044 ] ].map( ( [ y, rx, rz ] ) => [ [ x * 1.1 + toe * 0.043, y, footZ ], [ rx, 0, 0 ], [ 0, 0, - rz ] ] ), BOAR_PART.HOOF, k, 8, 0.6 );

		}

	}

	for ( const s of [ - 1, 1 ] ) {

		// Small side-set eyes under the brow, two dark nostril recesses, and a subtle jaw seam.
		ellipsoid( [ s * 0.158, 0.622, 0.581 ], [ 0.017, 0.015, 0.019 ], BOAR_PART.EYE, 4 );
		ellipsoid( [ s * 0.046, 0.412, 1.043 ], [ 0.018, 0.012, 0.006 ], BOAR_PART.NOSTRIL, 4, 8 );
		tube( [ [ s * 0.124, 0.369, 0.80, 0.004 ], [ s * 0.109, 0.36, 0.91, 0.0035 ], [ s * 0.089, 0.365, 1.024, 0.002 ] ], BOAR_PART.NOSTRIL, 4, 5 );
		tube( [ [ s * 0.128, 0.36, 0.81, 0.038 ], [ s * 0.187, 0.373, 0.827, 0.030 ], [ s * 0.227, 0.419, 0.849, 0.022 ], [ s * 0.232, 0.482, 0.893, 0.013 ], [ s * 0.214, 0.535, 0.921, 0.0015 ] ], BOAR_PART.TUSK, 4, 8 );
		// Thick triangular ear shell, leaning outward and forward; a smaller dark inner triangle.
		const e = [ [ s * 0.12, 0.67, 0.52 ], [ s * 0.275, 0.66, 0.43 ], [ s * 0.285, 0.90, 0.49 ], [ s * 0.19, 0.74, 0.43 ] ];
		const a = e.map( ( v ) => vertex( v, 0, 4 ) );
		for ( const tri of [ [ 0, 1, 2 ], [ 0, 3, 1 ], [ 1, 3, 2 ], [ 2, 3, 0 ] ] ) {

			idx.push( ...( s > 0 ? tri : tri.toReversed() ).map( ( i ) => a[ i ] ) );

		}
		const inner = [ [ 0.7, 0.15, 0.15 ], [ 0.15, 0.7, 0.15 ], [ 0.1, 0.1, 0.8 ] ].map( ( weights ) => {

			const v = [ 0, 1, 2 ].map( ( k ) => e[ 0 ][ k ] * weights[ 0 ] + e[ 1 ][ k ] * weights[ 1 ] + e[ 2 ][ k ] * weights[ 2 ] );
			v[ 0 ] += s * 0.001; v[ 2 ] += 0.001;
			return vertex( v, BOAR_PART.EAR, 4 );

		} );
		idx.push( ...( s > 0 ? inner : inner.toReversed() ) );

	}

	// A wiry, slightly curved tail with a darker tuft, never a domestic pig's corkscrew.
	tube( [ [ 0, 0.67, - 0.615, 0.026 ], [ 0.012, 0.626, - 0.731, 0.021 ], [ 0.021, 0.53, - 0.813, 0.014 ], [ 0.045, 0.444, - 0.831, 0.011 ], [ 0.084, 0.409, - 0.844, 0.008 ] ], 0, 5 );
	tube( [ [ 0.067, 0.422, - 0.84, 0.022 ], [ 0.105, 0.386, - 0.856, 0.019 ], [ 0.127, 0.359, - 0.853, 0.0015 ] ], BOAR_PART.BRISTLE, 5, 6 );

	// Low irregular bristle tufts break the shoulder ridge and merge into the coat at their base.
	for ( let i = 0; i < 45; i ++ ) {

		const z = - 0.43 + i * 0.019, x = Math.sin( i * 2.1 ) * 0.035;
		let y = 0;
		for ( let k = 1; k < body.length; k ++ ) if ( z >= body[ k - 1 ][ 0 ] && z <= body[ k ][ 0 ] ) {

			const a = body[ k - 1 ], b = body[ k ], t = ( z - a[ 0 ] ) / ( b[ 0 ] - a[ 0 ] );
			y = ( a[ 1 ] + a[ 3 ] ) * ( 1 - t ) + ( b[ 1 ] + b[ 3 ] ) * t - 0.009 - Math.abs( x ) * 0.14;

		}
		const h = 0.025 + Math.sin( i * 2.6 ) ** 2 * 0.037;
		const a = [ [ x - 0.007, y, z - 0.01 ], [ x + 0.007, y, z - 0.01 ], [ x, y, z + 0.013 ], [ x + Math.sin( i * 4.1 ) * 0.006, y + h, z - 0.012 ] ].map( ( v ) => vertex( v, BOAR_PART.BRISTLE, - 1 ) );
		idx.push( a[ 0 ], a[ 2 ], a[ 1 ], a[ 0 ], a[ 1 ], a[ 3 ], a[ 1 ], a[ 2 ], a[ 3 ], a[ 2 ], a[ 0 ], a[ 3 ] );

	}

	const geometry = new THREE.BufferGeometry();
	geometry.setAttribute( 'position', new THREE.Float32BufferAttribute( p, 3 ) );
	geometry.setAttribute( 'aBoar', new THREE.Float32BufferAttribute( tag, 2 ) );
	geometry.setIndex( idx );
	geometry.computeVertexNormals();
	geometry.computeBoundingBox();
	return { geometry, vertices: p.length / 3, triangles: idx.length / 3 };

}
