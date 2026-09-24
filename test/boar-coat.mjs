import assert from 'node:assert/strict';
import { buildBoar } from '../src/world/wildlife/BoarShapes.js';

const coat = await import( '../src/world/wildlife/BoarCoat.js' ).catch( () => null );
assert.equal( typeof coat?.buildBoarCoat, 'function', 'close boars need a groomed silhouette coat' );
const base = buildBoar().geometry;
const { geometry: g, strands } = coat.buildBoarCoat( base );
assert.ok( strands > 5000 && strands <= 10000, 'coat density is bounded for an instanced herd' );
const p = g.attributes.position.array, n = g.attributes.normal.array;
const roots = g.attributes.aRoot.array, fur = g.attributes.aFur.array, tags = g.attributes.aBoar.array;
assert.ok( p.every( Number.isFinite ) && n.every( Number.isFinite ) );
let mane = 0, flank = 0, face = 0;
for ( let i = 0; i < p.length / 3; i ++ ) {

	const o = i * 3;
	assert.ok( Math.abs( Math.hypot( ...n.subarray( o, o + 3 ) ) - 1 ) < 0.001 );
	const length = Math.hypot( ...p.subarray( o, o + 3 ).map( ( v, k ) => v - roots[ o + k ] ) );
	assert.ok( length < 0.16, 'bristles stay a coat rather than long porcupine quills' );
	assert.ok( roots[ o + 1 ] > 0.095, 'hooves remain bare' );
	assert.ok( tags[ i * 2 ] === 8 && fur[ o + 1 ] >= 0 && fur[ o + 1 ] <= 1 );
	if ( roots[ o + 1 ] > 0.84 && roots[ o + 2 ] < 0.4 ) mane ++;
	if ( Math.abs( roots[ o ] ) > 0.21 && roots[ o + 2 ] < 0.2 ) flank ++;
	if ( roots[ o + 2 ] > 0.55 ) face ++;

}
assert.ok( mane > 50 && flank > 500 && face > 50, 'fur covers the mane, flanks and face' );
const idx = g.index.array;
for ( let i = 0; i < idx.length; i += 3 ) {

	const a = idx[ i ] * 3, b = idx[ i + 1 ] * 3, c = idx[ i + 2 ] * 3;
	const u = [ 0, 1, 2 ].map( ( k ) => p[ b + k ] - p[ a + k ] );
	const v = [ 0, 1, 2 ].map( ( k ) => p[ c + k ] - p[ a + k ] );
	const cross = [ u[ 1 ] * v[ 2 ] - u[ 2 ] * v[ 1 ], u[ 2 ] * v[ 0 ] - u[ 0 ] * v[ 2 ], u[ 0 ] * v[ 1 ] - u[ 1 ] * v[ 0 ] ];
	assert.ok( cross.reduce( ( sum, value, k ) => sum + value * n[ a + k ], 0 ) > 0, 'ribbon winding faces the same hemisphere as its groom normal' );

}
const again = coat.buildBoarCoat( base ).geometry;
assert.deepEqual( again.attributes.position.array, p, 'groom stays deterministic across reloads' );
console.log( `Boar coat passed: ${ strands } groomed strands, finite normals, bounded length and deterministic distribution` );
