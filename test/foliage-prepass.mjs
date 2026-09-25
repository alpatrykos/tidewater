import assert from 'node:assert/strict';
import './headless.mjs';
import { GPU } from '../src/engine/gpu/GPU.js';
import { readTexture } from '../src/engine/gpu/Readback.js';
import { G, setFrameCamera } from '../src/engine/render/Frame.js';
import { Material } from '../src/engine/render/Material.js';
import { MeshRenderer } from '../src/engine/render/MeshRenderer.js';
import { SceneRenderer } from '../src/engine/render/SceneRenderer.js';
import { SunShadows } from '../src/engine/render/Shadows.js';
import * as E from '../src/engine/index.js';

// The foliage depth pre-pass must not change the image: stacked cut-out cards (discard), an opaque
// object between them, and a card with a shadow-only vertex branch (as the mobile far palms and the
// sun-facing impostors have; here it moves the card toward the camera, which would occlude the scene
// if it leaked into the pre-pass) render identically with and without it.
await GPU.init( { headless: true } );
const W = 320, H = 200;
const scene = new E.Scene();
const ground = new E.Mesh( new E.PlaneGeometry( 40, 40 ).rotateX( - Math.PI / 2 ), new Material( { name: 'ground', color: 0x8a7a60, roughness: 0.9,
	surface: 's.albedo = s.albedo * ( 0.8 + 0.2 * step( 0.5, fract( in.P.x * 0.5 ) ) );' } ) );
const cut = /* wgsl */`
	let c = fract( in.uv * vec2f( 7.0, 5.0 ) ) - 0.5;
	return length( c ) < 0.36;`;
const leaf = ( collapseInShadows ) => {

	const mat = new Material( {
		name: collapseInShadows ? 'cards-shadow-lod' : 'cards', side: 'double', color: 0x3f8a2a, roughness: 0.7,
		vertex: collapseInShadows ? /* wgsl */`
#if PASS_DEPTH && !MAIN_DEPTH_PREPASS
	v.worldOffset = vec3f( 0.0, 0.0, 2.0 );
#endif` : '',
		surface: `if ( ! ( length( fract( in.uv * vec2f( 7.0, 5.0 ) ) - 0.5 ) < 0.36 ) ) { discard; }
	s.albedo = s.albedo * ( 0.6 + 0.4 * in.uv.y );`,
		shadow: cut,
	} );
	mat.depthPrepass = true;
	return mat;

};
const cards = [];
for ( let i = 0; i < 6; i ++ ) {

	const card = new E.Mesh( new E.PlaneGeometry( 4, 3 ), leaf( i === 2 ) );
	card.position.set( ( i % 3 - 1 ) * 0.9, 1.6 + ( i % 2 ) * 0.3, - i * 0.7 );
	card.rotation.y = ( i - 2.5 ) * 0.25;
	card.castShadow = true;
	cards.push( card );

}
const post = new E.Mesh( new E.BoxGeometry( 0.6, 3, 0.6 ), new Material( { name: 'post', color: 0xaa5533, roughness: 0.5 } ) );
post.position.set( 0.4, 1.5, - 1.6 );
ground.castShadow = post.castShadow = true;
scene.add( ground, post, ...cards );

const camera = new E.PerspectiveCamera( 55, W / H, 0.1, 500 );
camera.position.set( 1.5, 2.4, 5.5 ); camera.lookAt( 0, 1.5, - 1.5 );
G.sunDir.value.set( 0.4, 0.8, 0.45 ).normalize();
G.sunColor.value.setRGB( 3, 2.9, 2.7 );
G.skyIrradiance.value.setRGB( 0.25, 0.32, 0.45 );

const mr = new MeshRenderer();
const shadows = new SunShadows( { size: 512 } );
const sr = new SceneRenderer( mr, scene, camera );
sr.setSize( W, H );
sr.clearColor = [ 0.4, 0.55, 0.8, 1 ];

async function render( prepass ) {

	sr.depthPrepass = prepass;
	for ( let f = 0; f < 2; f ++ ) {

		GPU.beginFrame();
		setFrameCamera( camera, W, H );
		shadows.render( scene, mr, shadows.update( camera, G.sunDir.value ) );
		sr.render();
		GPU.submit();

	}
	const color = await readTexture( sr.sceneRT.textures[ 0 ] );
	const depth = await readTexture( sr.sceneRT.depthTexture );
	return { color: new Uint16Array( color.data ), depth: new Float32Array( depth.data ) };

}

const off = await render( false );
const on = await render( true );
let colorDiff = 0, cardPixels = 0;
for ( let i = 0; i < off.color.length; i ++ ) if ( off.color[ i ] !== on.color[ i ] ) colorDiff ++;
for ( let i = 0; i < off.depth.length; i ++ ) if ( off.depth[ i ] > 0 ) cardPixels ++;
assert.ok( cardPixels > W * H * 0.5, 'the scene covers the view' );
assert.equal( colorDiff, 0, 'the pre-pass leaves every colour channel unchanged' );
// the colour pass rewrites the pre-pass depth wherever the cards show (1e-6 relative push)
let depthDiff = 0;
for ( let i = 0; i < off.depth.length; i ++ ) if ( Math.abs( off.depth[ i ] - on.depth[ i ] ) > Math.abs( off.depth[ i ] ) * 2e-6 ) depthDiff ++;
assert.equal( depthDiff, 0, 'final depth matches' );
console.log( `Foliage depth pre-pass: identical colour (${ W }x${ H }) with stacked cut-out cards, an occluder and a shadow-only vertex branch` );
await new Promise( ( r ) => setTimeout( r, 200 ) );
process.exit( 0 );
