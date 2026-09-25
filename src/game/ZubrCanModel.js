import { Group, Mesh, CylinderGeometry, Vector3 } from '../engine/index.js';
import { Texture } from '../engine/gpu/Texture.js';
import { decodeImage } from '../engine/loaders/GLTF.js';
import { generateMipmaps } from '../engine/gpu/Mipmaps.js';
import { standard } from '../materials/Materials.js';
import { GeoKit, prepare, mergePrepared, cylinder, torus, sphere, slab, mat4 } from '../world/boat/GeoKit.js';
import { createPropMaterial } from './GameMaterials.js';

// A 500 ml can at hand scale. +Y is up; the front of the label faces +Z.
// The lid aperture and the tab are separate so opening the can has a visible result.
export function createZubrCanModel() {

	const group = new Group();
	group.name = 'Monster Energy can';
	const label = new Texture( { label: 'Monster label loading', width: 1, height: 1, format: 'rgba8unorm-srgb', data: new Uint8Array( [ 7, 8, 7, 255 ] ) } );
	const labelMaterial = standard( {
		name: 'monsterPrintedAluminium', roughness: 0.3, metalness: 0.18,
		defines: { CLEARCOAT: 1 },
		receiveShadows: false, textures: { canLabel: label },
		surface: /* wgsl */`
	let print = textureSample( canLabel, smpLinearClamp, vec2f( in.uv.x, 1.0 - in.uv.y ) ).rgb;
	s.albedo = print;
	// Small cold-can beads are relief in the lacquer, preserving every pixel of the wrap.
	// Fade subpixel droplets before the normal derivatives so the highlight stays stable.
	let dewUV = in.uv * vec2f( 79.0, 59.0 );
	let dewCell = floor( dewUV );
	let dewSeed = fract( sin( dot( dewCell, vec2f( 127.1, 311.7 ) ) ) * 43758.5453 );
	let dewCenter = vec2f( 0.35 + dewSeed * 0.3, 0.35 + fract( dewSeed * 13.7 ) * 0.3 );
	let dewR = length( ( fract( dewUV ) - dewCenter ) * vec2f( 1.0, 0.9 ) );
	let dewAA = 1.0 - smoothstep( 0.3, 1.0, max( fwidth( dewUV.x ), fwidth( dewUV.y ) ) );
	let dew = ( 1.0 - smoothstep( 0.05, 0.22, dewR ) ) * step( 0.76, dewSeed ) * dewAA;
	let dewHeight = dew * dew * 0.00014;
	let dewDx = dpdx( in.P ); let dewDy = dpdy( in.P );
	let dewR1 = cross( dewDy, s.normal ); let dewR2 = cross( s.normal, dewDx );
	let dewDet = dot( dewDx, dewR1 );
	let dewGrad = sign( dewDet ) * ( dpdx( dewHeight ) * dewR1 + dpdy( dewHeight ) * dewR2 );
	s.normal = normalize( abs( dewDet ) * s.normal - dewGrad + s.normal * 1e-12 );
	s.roughness = mix( 0.3, 0.13, dew );
	s.clearcoat = 0.3 + dew * 0.55;
	s.clearcoatRoughness = 0.19;
	s.clearcoatNormal = s.normal;
`,
	} );
	const body = new Mesh( new CylinderGeometry( 0.033, 0.033, 0.143, 48, 1, true, Math.PI ), labelMaterial );
	body.name = 'Monster black and green label';
	group.add( body );

	const metal = new GeoKit();
	const aluminium = { color: 0xd8dedc, rough: 0.26, metal: 0.88 };
	const add = ( geo, options = {} ) => metal.add( 'metal', geo, { ...aluminium, ...options } );
	// Drawn shoulders, double rolled seams, recessed lid and a shallow bottom dome.
	add( cylinder( 0.0284, 0.033, 0.01, 48 ), { matrix: mat4( 0, 0.0765, 0 ), color: 0x080908, metal: 0.42 } );
	add( cylinder( 0.033, 0.0285, 0.01, 48 ), { matrix: mat4( 0, - 0.0765, 0 ), color: 0x080908, metal: 0.42 } );
	for ( const y of [ - 0.082, 0.0827 ] ) add( torus( 0.0288, 0.0016, 6, 48 ), { matrix: mat4( 0, y, 0, Math.PI / 2 ) } );
	// A real cut-out lets the scored flap fold inside the can without revealing a second lid.
	add( slab( ellipse( 0.0278, 0.0278, 0, 0, 56 ), [ ellipse( 0.0064, 0.0104, 0, 0.012, 32 ) ],
		( x, z, side ) => new Vector3( x, side ? 0.0806 : 0.0818, z ) ), { rough: 0.35 } );
	add( torus( 0.0238, 0.00045, 4, 40 ), { matrix: mat4( 0, 0.082, 0, Math.PI / 2 ), color: 0x969f9d } );
	add( cylinder( 0.0265, 0.0265, 0.001, 40 ), { matrix: mat4( 0, - 0.0818, 0 ) } );
	const metalMaterial = createPropMaterial( 'monsterCanMetal' );
	metalMaterial.receiveShadows = false;
	metalMaterial.surface += /* wgsl */`
	// Shallow circular tooling marks catch the light across the aluminium top.
	let brush = sin( length( in.vs.vLocal.xz ) * 28000.0 );
	let brushAA = 1.0 - smoothstep( 0.6, 2.0, fwidth( length( in.vs.vLocal.xz ) * 28000.0 ) );
	s.roughness = clamp( s.roughness + brush * brushAA * 0.018, 0.16, 0.7 );
`;
	group.add( new Mesh( metal.merged( 'metal' ), metalMaterial ) );

	// The closed panel is aluminium, with only a hairline score around its edge.
	const score = new Mesh( torus( 0.008, 0.00016, 4, 32 ), standard( { name: 'canLidScore', color: 0x8c9997, metalness: 0.72, roughness: 0.4, receiveShadows: false } ) );
	score.rotation.x = Math.PI / 2;
	score.scale.set( 0.8, 1.3, 1 );
	score.position.set( 0, 0.08192, 0.012 );
	group.add( score );
	const opening = new Mesh( cylinder( 0.008, 0.008, 0.00025, 32 ), standard( { name: 'canOpening', color: 0x07100b, roughness: 0.74, receiveShadows: false } ) );
	opening.scale.set( 0.8, 1, 1.3 );
	opening.position.set( 0, 0.077, 0.012 );
	opening.visible = false;
	group.add( opening );
	group.opening = opening;
	const lidFlap = new Group();
	lidFlap.name = 'Scored aluminium flap';
	lidFlap.position.set( 0, 0.08192, 0.002 );
	lidFlap.add( new Mesh( prepare( slab( ellipse( 0.0063, 0.0103, 0, 0.010, 32 ), [],
		( x, z, side ) => new Vector3( x, side ? - 0.0003 : 0, z ) ), { ...aluminium, rough: 0.37 } ), metalMaterial ) );
	group.add( lidFlap );
	// Rotate +X from 0 to about 1.35 radians to push this panel into the opening.
	group.lidFlap = lidFlap;

	const tab = new Group();
	tab.name = 'Can pull tab';
	tab.position.set( 0, 0.0833, - 0.001 );
	const tabGeometry = mergePrepared( [
		prepare( slab( ellipse( 0.0054, 0.0114, 0, - 0.005, 36 ), [ ellipse( 0.00325, 0.0048, 0, - 0.009, 28 ) ],
			( x, z, side ) => new Vector3( x, side ? - 0.0004 : 0.00045, z ) ), { ...aluminium, rough: 0.22 } ),
		prepare( torus( 0.0045, 0.0003, 5, 28 ), { ...aluminium, matrix: mat4( 0, 0.0005, - 0.009, Math.PI / 2, 0, 0, 0.78, 1.14, 1 ) } ),
		prepare( cylinder( 0.00165, 0.00215, 0.00065, 20 ), { ...aluminium, matrix: mat4( 0, 0.0005, 0 ), rough: 0.3 } ),
		prepare( sphere( 1, 16, 8 ), { ...aluminium, matrix: mat4( 0, 0.00085, 0, 0, 0, 0, 0.0014, 0.00035, 0.0014 ) } ),
	] );
	tab.add( new Mesh( tabGeometry, metalMaterial ) );
	group.add( tab );
	group.tab = tab;
	group.labelTexture = label;
	// Load the generated wrap before App precompiles the prop's pipelines.
	// Plain-node logic tests can build the geometry without a browser image decoder.
	group.ready = typeof createImageBitmap === 'function' || globalThis.__assetImage
		? loadLabel().then( texture => {

			group.labelTexture = texture;
			labelMaterial.bindings.canLabel.texture = texture;
			labelMaterial.needsUpdate = true;

		} ) : Promise.resolve();
	group.traverse( ( object ) => {

		if ( object.isMesh ) {

			object.castShadow = false;
			object.frustumCulled = false;

		}

	} );
	return group;

}

function ellipse( radiusX, radiusZ, x = 0, z = 0, segments = 32 ) {

	return Array.from( { length: segments }, ( _, i ) => {

		const angle = i / segments * Math.PI * 2;
		return [ x + Math.cos( angle ) * radiusX, z + Math.sin( angle ) * radiusZ ];

	} );

}

// Generated with imagegen. See public/models/monster/README.md for provenance.
async function loadLabel() {

	const url = ( import.meta.env?.BASE_URL || '/' ) + 'models/monster/label.png';
	let bytes;
	if ( globalThis.__assetFile ) bytes = await globalThis.__assetFile( url );
	else {

		const response = await fetch( url );
		if ( ! response.ok ) throw new Error( 'Monster label: ' + response.status );
		bytes = await response.arrayBuffer();

	}
	const image = await decodeImage( new Uint8Array( bytes ), 'image/png' );
	const texture = new Texture( { label: 'Monster Energy generated wrap', width: image.width, height: image.height,
		format: 'rgba8unorm-srgb', data: image.data, mips: true } );
	texture.getGPU();
	generateMipmaps( texture );
	return texture;

}
