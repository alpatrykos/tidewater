import { Group, Mesh, CylinderGeometry, Vector3 } from '../engine/index.js';
import { Texture } from '../engine/gpu/Texture.js';
import { decodeImage } from '../engine/loaders/GLTF.js';
import { generateMipmaps } from '../engine/gpu/Mipmaps.js';
import { standard } from '../materials/Materials.js';
import { GeoKit, prepare, mergePrepared, cylinder, torus, sphere, rod, mat4 } from '../world/boat/GeoKit.js';
import { createPropMaterial, PAT } from './GameMaterials.js';

// A 500 ml can at hand scale. +Y is up; the front of the label faces +Z.
// The lid aperture and the tab are separate so opening the can has a visible result.
export function createZubrCanModel() {

	const group = new Group();
	group.name = 'Żubr can';
	const label = new Texture( { label: 'Żubr label loading', width: 1, height: 1, format: 'rgba8unorm-srgb', data: new Uint8Array( [ 7, 28, 17, 255 ] ) } );
	const labelMaterial = standard( {
		name: 'zubrPrintedAluminium', roughness: 0.3, metalness: 0.2,
		receiveShadows: false, textures: { zubrLabel: label },
		surface: /* wgsl */`
	let print = textureSample( zubrLabel, smpLinearClamp, vec2f( in.uv.x, 1.0 - in.uv.y ) ).rgb;
	s.albedo = print;
	// The lacquer has a broad highlight without washing out the printed lettering.
	s.roughness = 0.31;
`,
	} );
	const body = new Mesh( new CylinderGeometry( 0.033, 0.033, 0.143, 48, 1, true, Math.PI ), labelMaterial );
	body.name = 'Żubr green label';
	group.add( body );

	const metal = new GeoKit();
	const aluminium = { color: 0xd8dedc, rough: 0.26, metal: 0.88 };
	const add = ( geo, options = {} ) => metal.add( 'metal', geo, { ...aluminium, ...options } );
	// Drawn shoulders, double rolled seams, recessed lid and a shallow bottom dome.
	add( cylinder( 0.0284, 0.033, 0.01, 48 ), { matrix: mat4( 0, 0.0765, 0 ), color: 0x082b19, metal: 0.42 } );
	add( cylinder( 0.033, 0.0285, 0.01, 48 ), { matrix: mat4( 0, - 0.0765, 0 ), color: 0x082b19, metal: 0.42 } );
	for ( const y of [ - 0.082, 0.0827 ] ) add( torus( 0.0288, 0.0016, 6, 48 ), { matrix: mat4( 0, y, 0, Math.PI / 2 ), color: 0xcac09a } );
	add( cylinder( 0.0278, 0.0278, 0.0016, 48 ), { matrix: mat4( 0, 0.081, 0 ), rough: 0.37 } );
	add( torus( 0.0238, 0.00045, 4, 40 ), { matrix: mat4( 0, 0.082, 0, Math.PI / 2 ), color: 0x969f9d } );
	add( cylinder( 0.0265, 0.0265, 0.001, 40 ), { matrix: mat4( 0, - 0.0818, 0 ) } );
	// Fine gold bands at either edge of the printed wrap.
	for ( const y of [ - 0.07, 0.07 ] ) add( cylinder( 0.03315, 0.03315, 0.0014, 48, 1, true ), { matrix: mat4( 0, y, 0 ), color: 0xc5a45a, metal: 0.66 } );
	const metalMaterial = createPropMaterial( 'zubrCanMetal' );
	metalMaterial.receiveShadows = false;
	group.add( new Mesh( metal.merged( 'metal' ), metalMaterial ) );

	// A dark scored outline remains visible before opening; the inset turns black on opening.
	const score = new Mesh( torus( 0.008, 0.00032, 4, 24 ), standard( { name: 'canLidScore', color: 0x717e78, metalness: 0.6, roughness: 0.4, receiveShadows: false } ) );
	score.rotation.x = Math.PI / 2;
	score.scale.set( 0.8, 1.3, 1 );
	score.position.set( 0, 0.08205, 0.012 );
	group.add( score );
	const opening = new Mesh( cylinder( 0.008, 0.008, 0.00025, 24 ), standard( { name: 'canOpening', color: 0x101a13, roughness: 0.84, receiveShadows: false } ) );
	opening.scale.set( 0.8, 1, 1.3 );
	opening.position.set( 0, 0.0822, 0.012 );
	opening.visible = false;
	group.add( opening );
	group.opening = opening;

	const tab = new Group();
	tab.name = 'Can pull tab';
	tab.position.set( 0, 0.0833, - 0.001 );
	const tabGeometry = mergePrepared( [
		prepare( torus( 0.006, 0.00125, 6, 24 ), { ...aluminium, matrix: mat4( 0, 0, - 0.006, Math.PI / 2, 0, 0, 0.8, 1.35, 1 ) } ),
		prepare( cylinder( 0.0024, 0.0024, 0.001, 12 ), { ...aluminium, matrix: mat4( 0, 0.0002, 0 ) } ),
	] );
	tab.add( new Mesh( tabGeometry, metalMaterial ) );
	group.add( tab );
	group.tab = tab;
	group.labelTexture = label;
	// Load the reference-derived image before App precompiles the prop's pipelines.
	// Plain-node logic tests can build the geometry without a browser image decoder.
	group.ready = typeof createImageBitmap === 'function' || globalThis.__assetImage
		? loadLabel().then( texture => {

			group.labelTexture = texture;
			labelMaterial.bindings.zubrLabel.texture = texture;
			labelMaterial.needsUpdate = true;

		} ) : Promise.resolve();
	group.add( createHand() );
	group.traverse( ( object ) => {

		if ( object.isMesh ) {

			object.castShadow = false;
			object.frustumCulled = false;

		}

	} );
	return group;

}

function createHand() {

	const kit = new GeoKit();
	const skin = { color: 0xbd8868, rough: 0.61, pattern: PAT.skin };
	const point = ( x, y, z ) => new Vector3( x, y, z );
	const addSkin = ( geometry, matrix ) => kit.add( 'grip', geometry, { ...skin, matrix } );
	addSkin( sphere( 1, 16, 10 ), mat4( 0.036, - 0.05, - 0.008, 0, 0, - 0.1, 0.016, 0.038, 0.026 ) );
	// Fingers curl around the lower half, leaving the name and bison unobscured.
	for ( let i = 0; i < 4; i ++ ) {

		const y = - 0.03 - i * 0.011;
		const r = 0.0052 - i * 0.00025;
		const a = point( 0.035, y, 0.012 );
		const b = point( 0.024, y - 0.002, 0.029 );
		const c = point( 0.003 + i * 0.003, y - 0.003, 0.034 );
		addSkin( rod( a, b, r, 8 ), null );
		addSkin( rod( b, c, r, 8 ), null );
		addSkin( sphere( r, 8, 6 ), mat4( b.x, b.y, b.z ) );
		addSkin( sphere( r, 8, 6 ), mat4( c.x, c.y, c.z ) );

	}
	addSkin( rod( point( 0.04, - 0.036, 0 ), point( 0.028, - 0.006, 0.018 ), 0.0075, 10 ), null );
	addSkin( sphere( 0.0075, 10, 6 ), mat4( 0.028, - 0.006, 0.018 ) );
	addSkin( rod( point( 0.038, - 0.075, - 0.008 ), point( 0.06, - 0.132, 0 ), 0.017, 12, 0.018 ), null );
	kit.add( 'grip', rod( point( 0.051, - 0.11, - 0.002 ), point( 0.087, - 0.21, 0.014 ), 0.024, 14, 0.028 ), { color: 0x283c3a, rough: 0.93, pattern: PAT.cloth } );
	const material = createPropMaterial( 'zubrHandAndSleeve' );
	material.receiveShadows = false;
	const mesh = new Mesh( kit.merged( 'grip' ), material );
	mesh.name = 'Can grip';
	return mesh;

}

// Generated with imagegen from the user's classic Żubr can photo. See public/models/zubr/README.md.
async function loadLabel() {

	const url = ( import.meta.env?.BASE_URL || '/' ) + 'models/zubr/label.png';
	let bytes;
	if ( globalThis.__assetFile ) bytes = await globalThis.__assetFile( url );
	else {

		const response = await fetch( url );
		if ( ! response.ok ) throw new Error( 'Żubr label: ' + response.status );
		bytes = await response.arrayBuffer();

	}
	const image = await decodeImage( new Uint8Array( bytes ), 'image/png' );
	const texture = new Texture( { label: 'Żubr classic reference wrap', width: image.width, height: image.height,
		format: 'rgba8unorm-srgb', data: image.data, mips: true } );
	texture.getGPU();
	generateMipmaps( texture );
	return texture;

}
