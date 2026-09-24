// Selected before allocating GPU resources. URL overrides allow repeatable comparisons
// on the same device; mobile detection is a starting preset, not a GPU benchmark.
const PRESETS = {
	desktop: { renderScale: 1, cloudScale: 1, shadowSize: 2048, shoreResolution: 768, reflections: true, causticScale: 1, refractionScale: 0.5, motionBlur: 0.5 },
	mobile: { renderScale: 0.7, cloudScale: 0.65, shadowSize: 1024, shoreResolution: 384, reflections: false, causticScale: 0.5, refractionScale: 0.35, motionBlur: 0 },
};

export function resolveQuality( search = '', device = {} ) {

	const qs = new URLSearchParams( search );
	const mobile = device.userAgentData?.mobile === true || /Android|iPhone|iPad|iPod/i.test( device.userAgent || '' ) ||
		( /Macintosh/i.test( device.userAgent || '' ) && device.maxTouchPoints > 1 );
	const requested = qs.get( 'quality' );
	const name = Object.hasOwn( PRESETS, requested ) ? requested : mobile ? 'mobile' : 'desktop';
	const quality = { name, ...PRESETS[ name ] };
	const rawScale = qs.get( 'scale' );
	const scale = Number( rawScale );
	if ( rawScale?.trim() && Number.isFinite( scale ) ) quality.renderScale = Math.max( 0.5, Math.min( 1, Math.round( scale * 20 ) / 20 ) );
	return quality;

}
