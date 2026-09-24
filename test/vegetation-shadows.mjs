// Render the real far vegetation materials into a depth map. Cheap mobile representations
// must retain shaped shadows between the new visual handover and the previous shadow limit.
import './headless.mjs';
import assert from 'node:assert/strict';
import { GPU } from '../src/engine/gpu/GPU.js';
import { Texture } from '../src/engine/gpu/Texture.js';
import { readTexture } from '../src/engine/gpu/Readback.js';
import { MeshRenderer } from '../src/engine/render/MeshRenderer.js';
import { SunShadows } from '../src/engine/render/Shadows.js';
import { G, setFrameCamera } from '../src/engine/render/Frame.js';
import { Scene, Vector3, OrthographicCamera } from '../src/engine/index.js';
import { TerrainData } from '../src/world/TerrainData.js';
import { Vegetation } from '../src/world/Vegetation.js';
import { VegInstances, LodLevel } from '../src/world/vegetation/InstanceLOD.js';
import { uCamPos } from '../src/world/vegetation/VegNodes.js';

await GPU.init( { headless: true } );
const vegetation = new Vegetation( { scene: new Scene(), terrain: new TerrainData(), quality: 'mobile' } );
new SunShadows( { size: 64 } ); // atlas bake uses the renderer's shared lighting bindings
GPU.beginFrame(); vegetation.leafAtlas.bake(); vegetation.atlas.bake(); GPU.submit();
const mr = new MeshRenderer();
const size = 192;
const target = new Texture( { width: size, height: size, format: 'depth32float', usage: [ 'render', 'copySrc' ] } );
G.sunDir.value.set( 0.45, 0.62, 0.35 ).normalize();
const light = new OrthographicCamera( -12, 12, 20, -4, 0.1, 150 );
light.position.copy( G.sunDir.value ).multiplyScalar( 80 ); light.lookAt( 0, 0, 0 );
light.updateMatrixWorld(); light.updateProjectionMatrix();

function fixture( type, shrub = false ) {

	const source = vegetation[ type ].far.meshes[ 0 ];
	assert.ok( source.castShadow, `${ type } far geometry must retain mobile shadows` );
	const record = { x: 0, y: 0, z: 0, s: 1, yaw: 0.3, la: 0.3, l: type === 'palms' ? 0.1 : shrub ? -1 : 1, H: type === 'palms' ? 10 : shrub ? 1.6 : 12.5, seed: 0.25 };
	const level = new LodLevel( [ { geometry: source.geometry, material: source.material, castShadow: true } ], 1, new Vector3( type === 'palms' ? 70 : 40, 2600, 2800 ) );
	level.fill( new VegInstances( [ record ] ) );
	const scene = new Scene(); scene.add( level.meshes[ 0 ] ); scene.updateMatrixWorld();
	return { scene, mesh: level.meshes[ 0 ] };

}

async function coverage( f, distance, solid = false ) {

	uCamPos.value.set( 0, 0, distance );
	const original = f.mesh.material;
	if ( solid ) { f.mesh.material = original.clone(); f.mesh.material.shadow = 'return true;'; }
	GPU.beginFrame(); setFrameCamera( light, size, size );
	mr.render( f.scene, { camera: light, kind: 'depth', colorFormats: [], colorViews: [], depthView: target.view(), depthFormat: 'depth32float', clearDepth: 1, depthCompare: 'less-equal' } );
	GPU.submit();
	const image = await readTexture( target );
	const values = new Float32Array( image.data );
	assert.ok( values.every( Number.isFinite ), 'shadow depth must stay finite' );
	f.mesh.material = original;
	return values.reduce( ( n, value ) => n + ( value < 1 ? 1 : 0 ), 0 );

}

const tree = fixture( 'canopy' );
const treeAlpha = await coverage( tree, 50 );
const treeRectangle = await coverage( tree, 50, true );
assert.ok( treeAlpha > 20, '40–65m trees must continue shading the ground' );
assert.ok( treeAlpha < treeRectangle * 0.9, 'tree shadows must follow atlas alpha, not the whole billboard rectangle' );
assert.equal( await coverage( tree, 75 ), 0, 'tree shadows must stop beyond the original65m transition band' );
assert.equal( await coverage( tree, 20 ), 0, 'close tree shadows remain owned by the detailed near mesh' );
const shrub = fixture( 'canopy', true );
assert.ok( await coverage( shrub, 35 ) > 0, '28–45m shrubs must continue casting shadows' );
assert.equal( await coverage( shrub, 50 ), 0, 'shrubs must retain their original bounded shadow range' );
const palm = fixture( 'palms' );
assert.ok( await coverage( palm, 100 ) > 0, '70–120m palms must continue casting frond shadows' );
assert.equal( await coverage( palm, 140 ), 0, 'far palms must not add distant shadow casters' );
console.log( `Vegetation mobile shadows passed: tree alpha${ treeAlpha }/rectangle${ treeRectangle }px; bounded palm/tree/shrub ranges` );
process.exit( 0 );
