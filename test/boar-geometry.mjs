import assert from 'node:assert/strict';

// A missing/empty template, malformed triangle, or ground-plane offset leaves the herd invisible
// or floating. Validate the actual geometry consumed by the renderer, without GPU mocks.
const shapes = await import( '../src/world/wildlife/BoarShapes.js' ).catch( () => null );
assert.equal( typeof shapes?.buildBoar, 'function', 'the boar needs a renderable geometry template' );
const { geometry: g, triangles } = shapes.buildBoar();
const p = g.attributes.position.array, n = g.attributes.normal.array, idx = g.index.array;
assert.ok( p.length > 0 && p.every( Number.isFinite ), 'all rest positions must be finite' );
assert.ok( n.length === p.length && n.every( Number.isFinite ), 'every vertex needs a finite normal' );
assert.ok( triangles > 0 && triangles < 6000, 'a herd must fit a small instanced geometry budget' );
const lo = [ Infinity, Infinity, Infinity ], hi = [ - Infinity, - Infinity, - Infinity ];
for ( let i = 0; i < p.length; i += 3 ) {

	for ( let k = 0; k < 3; k ++ ) { lo[ k ] = Math.min( lo[ k ], p[ i + k ] ); hi[ k ] = Math.max( hi[ k ], p[ i + k ] ); }
	assert.ok( Math.abs( Math.hypot( ...n.subarray( i, i + 3 ) ) - 1 ) < 0.001, 'rest normals must be unit length' );

}
assert.ok( Math.abs( lo[ 1 ] ) < 1e-5, 'idle hooves rest on the terrain contact plane' );
assert.ok( hi[ 1 ] > 0.8 && hi[ 1 ] < 1.15, 'adult silhouette has a boar shoulder height' );
assert.ok( hi[ 2 ] - lo[ 2 ] > 1.5 && hi[ 2 ] - lo[ 2 ] < 2.3, 'adult silhouette fits the gameplay footprint' );
for ( let i = 0; i < idx.length; i += 3 ) {

	const a = idx[ i ] * 3, b = idx[ i + 1 ] * 3, c = idx[ i + 2 ] * 3;
	assert.ok( Math.max( a, b, c ) < p.length, 'triangle indices stay inside the vertex buffer' );
	const x = p[ b ] - p[ a ], y = p[ b + 1 ] - p[ a + 1 ], z = p[ b + 2 ] - p[ a + 2 ];
	const u = p[ c ] - p[ a ], v = p[ c + 1 ] - p[ a + 1 ], w = p[ c + 2 ] - p[ a + 2 ];
	assert.ok( Math.hypot( y * w - z * v, z * u - x * w, x * v - y * u ) > 1e-9, 'triangles must have nonzero area' );

}
console.log( `Boar geometry passed: ${ p.length / 3 } vertices, ${ triangles } triangles, grounded finite template` );
