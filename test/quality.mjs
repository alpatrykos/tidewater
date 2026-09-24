import assert from 'node:assert/strict';
import { resolveQuality } from '../src/core/Quality.js';

// Catch missed mobile detection, including iPadOS's desktop user agent.
for ( const device of [
	{ userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)' },
	{ userAgent: 'Mozilla/5.0 (Linux; Android 15)' },
	{ userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X)', maxTouchPoints: 5 },
	{ userAgentData: { mobile: true } },
] ) assert.equal( resolveQuality( '', device ).name, 'mobile' );
assert.equal( resolveQuality( '', { userAgent: 'Windows NT', maxTouchPoints: 10 } ).name, 'desktop' );
assert.equal( resolveQuality( '?quality=desktop', { userAgent: 'iPhone' } ).name, 'desktop' );
assert.equal( resolveQuality( '?quality=mobile', {} ).name, 'mobile' );
assert.equal( resolveQuality( '?quality=typo', { userAgent: 'Android' } ).name, 'mobile' );
// Invalid URL input must never poison render-target dimensions.
for ( const scale of [ 'NaN', 'Infinity', '', '-Infinity' ] ) {
	assert.equal( resolveQuality( `?scale=${ scale }`, {} ).renderScale, resolveQuality( '', {} ).renderScale );
}
assert.equal( resolveQuality( '?scale=0.01', {} ).renderScale, 0.5 );
assert.equal( resolveQuality( '?scale=2', {} ).renderScale, 1 );
assert.equal( resolveQuality( '?quality=mobile&scale=0.8', {} ).renderScale, 0.8 );
assert.equal( resolveQuality( '?quality=mobile' ).fftSize, 64 );
assert.equal( resolveQuality( '?quality=desktop' ).fftSize, 256 );
assert.equal( resolveQuality( '?fft=128' ).fftSize, 128 );
for ( const value of [ '96', 'NaN', '0', '' ] ) assert.equal( resolveQuality( '?quality=mobile&fft=' + value ).fftSize, 64 );
console.log( 'Quality selection and render-scale validation passed' );
