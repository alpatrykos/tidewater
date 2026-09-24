// Exercise the real scatter, LOD records and upload buffers (no impostor baking needed).
import './headless.mjs';
import assert from 'node:assert/strict';
import { GPU } from '../src/engine/gpu/GPU.js';
import { Scene, Vector3 } from '../src/engine/index.js';
import { TerrainData } from '../src/world/TerrainData.js';
import { Vegetation } from '../src/world/Vegetation.js';
import { uCanopyNear } from '../src/world/vegetation/VegMaterials.js';
import { LOD_BAND } from '../src/world/vegetation/VegNodes.js';

await GPU.init( { headless: true } );
const terrain = new TerrainData();
const desktop = new Vegetation( { scene: new Scene(), terrain } );
assert.equal( desktop.palms.nearRange, 120 );
assert.equal( desktop.canopy.nearRange, 65 );
assert.deepEqual( [ uCanopyNear.value.x, uCanopyNear.value.y ], [ 65, 45 ] );

const mobile = new Vegetation( { scene: new Scene(), terrain, quality: 'mobile' } );
assert.equal( mobile.palms.nearRange, 70, 'mobile must switch distant palms to their existing far mesh earlier' );
assert.equal( mobile.canopy.nearRange, 40, 'mobile must switch trees to their existing impostors earlier' );
assert.deepEqual( [ uCanopyNear.value.x, uCanopyNear.value.y ], [ 40, 28 ], 'GPU canopy thresholds must match the CPU profile' );
assert.deepEqual( mobile.records, desktop.records, 'quality must not remove or relocate plants' );
assert.deepEqual( mobile.geometryTriangles, desktop.geometryTriangles, 'close plant meshes must retain their detail' );
assert.deepEqual( mobile.understory.near.lodRange, desktop.understory.near.lodRange, 'understory must retain its full draw distance' );
for ( const name of [ 'bananas', 'monsteras', 'broadleaf' ] ) {

	const mid = mobile[ name ].far;
	assert.ok( mid, `${ name } must gain a cheaper middle mesh on mobile` );
	assert.equal( mid.lodRange.x, name === 'bananas' ? 40 : 30 );
	assert.equal( mid.lodRange.y, desktop[ name ].near.lodRange.y, `${ name } must retain its full draw distance` );
	assert.equal( mid.lodRange.z, desktop[ name ].near.lodRange.z, `${ name } must retain its final fade` );
	assert.ok( mid.trianglesPerInstance < mobile[ name ].near.trianglesPerInstance, `${ name } middle mesh must reduce submitted triangles` );
	assert.ok( mid.meshes.every( ( m ) => m.castShadow ), `${ name } middle mesh must retain shadows` );

}
for ( const name of [ 'palms', 'canopy' ] ) {

	assert.equal( mobile[ name ].far.lodRange.y, 2600 );
	assert.equal( mobile[ name ].far.lodRange.z, 2800 );
	assert.equal( mobile[ name ].inst.count, desktop[ name ].inst.count );

}

const reducedTypes = new Set();
for ( const [ x, y, z ] of [ [ 10, 3, -52 ], [ 60, terrain.heightAt( 60, -200 ) + 1.7, -200 ] ] ) {

	const camera = new Vector3( x, y, z );
	for ( const name of [ 'palms', 'canopy', 'bananas', 'monsteras', 'broadleaf' ] ) {

		const d = desktop[ name ], m = mobile[ name ];
		d.update( camera, true ); m.update( camera, true );
		assert.ok( m.near.count <= d.near.count, `${ name } should not upload more detailed instances` );
		const mobileTriangles = m.near.triangles + m.far.triangles;
		const desktopTriangles = d.near.triangles + ( d.far?.triangles || 0 );
		assert.ok( mobileTriangles <= desktopTriangles, `${ name } should not submit more triangles` );
		if ( mobileTriangles < desktopTriangles ) reducedTypes.add( name );
		const ids = new Set( m.nearIds.subarray( 0, m.near.count ) );
		// The CPU query must retain every plant that can enter the complete transition band
		// while the camera moves up to the next normal buffer refill.
		for ( let a = 0; a < 16; a ++ ) {

			const dx = Math.cos( a * Math.PI / 8 ) * m.margin;
			const dz = Math.sin( a * Math.PI / 8 ) * m.margin;
			for ( let i = 0; i < m.inst.count; i ++ ) {

				const threshold = name === 'palms' ? 70 : name === 'canopy' ? m.inst.iDat[ i * 4 + 1 ] < 0 ? 28 : 40 : name === 'bananas' ? 40 : 30;
				const distance = Math.hypot( m.inst.px[ i ] - x - dx, m.inst.py[ i ] - y, m.inst.pz[ i ] - z - dz );
				if ( distance < threshold * ( 1 + LOD_BAND / 2 ) ) assert.ok( ids.has( i ), `${ name } upload must cover the full dither band before refill` );

			}

		}

	}

}
assert.equal( reducedTypes.size, 5, 'each new mobile LOD should reduce submitted triangles in at least one occupied view' );
console.log( 'Vegetation quality passed: earlier mobile LOD, unchanged density/detail/draw distances, conservative transition buffers' );
process.exit( 0 );
