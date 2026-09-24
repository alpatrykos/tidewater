import assert from 'node:assert/strict';
import { buildBroadleaf, buildMonsteraMesh, buildBananas } from '../src/world/vegetation/PlantGeometry.js';

for ( const [ name, build ] of [ [ 'broadleaf', buildBroadleaf ], [ 'monstera', buildMonsteraMesh ], [ 'bananas', buildBananas ] ] ) {
 const near = build(), far = build( { lowDetail: true } );
 assert.ok( far.triangles < near.triangles * 0.65, `${ name }: distant geometry must reduce submitted triangles by at least 35%` );
 const ng = near.geometry, fg = far.geometry;
 // Coarser indexing must not regenerate/randomize any leaf, silhouette anchor, normal,
 // wind attribute or material tag. Close-up geometry remains the same full-detail mesh.
 for ( const key of Object.keys( ng.attributes ) ) assert.deepEqual( fg.attributes[ key ].data.array, ng.attributes[ key ].data.array, `${ name }: preserve ${ key } values` );
 assert.deepEqual( fg.boundingBox, ng.boundingBox );
 assert.deepEqual( fg.boundingSphere, ng.boundingSphere );
 assert.ok( [ ...fg.index.array ].every( i => i >= 0 && i < fg.attributes.position.count ) );
 assert.ok( new Set( fg.index.array ).size < new Set( ng.index.array ).size * 0.8, `${ name }: skip vertex work as well as triangles` );
 const kinds = g => new Set( [ ...g.index.array ].map( i => g.attributes.aLobe.data.array[ i * g.attributes.aLobe.data.stride + g.attributes.aLobe.offset + 3 ] ) );
 assert.deepEqual( kinds( fg ), kinds( ng ), `${ name }: preserve every merged plant kind` );
 console.log( `${ name }: ${ near.triangles } -> ${ far.triangles } triangles, unchanged leaf attributes and bounds` );
}
