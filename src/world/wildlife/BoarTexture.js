import { Texture } from '../../engine/gpu/Texture.js';
import { generateMipmaps } from '../../engine/gpu/Mipmaps.js';
import { decodePNG } from '../marine/WhaleTextures.js';

// The same RGBA bytes and colour conversion are used by the game and headless review renders.
export async function createBoarCoatTexture( bytes ) {

	const buffer = ArrayBuffer.isView( bytes ) ? bytes.buffer.slice( bytes.byteOffset, bytes.byteOffset + bytes.byteLength ) : bytes;
	const image = await decodePNG( buffer );
	const texture = new Texture( { label: 'Wild boar undercoat', width: image.width, height: image.height,
		format: 'rgba8unorm-srgb', data: image.data, mips: true, sampler: 'anisoRepeat' } );
	texture.getGPU();
	generateMipmaps( texture );
	return texture;

}

export async function loadBoarCoatTexture() {

	const response = await fetch( ( import.meta.env?.BASE_URL || '/' ) + 'models/boar/coat.png' );
	if ( ! response.ok ) throw new Error( 'Boar coat texture: HTTP ' + response.status );
	return createBoarCoatTexture( await response.arrayBuffer() );

}
