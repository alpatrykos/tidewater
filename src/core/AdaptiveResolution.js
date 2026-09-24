// Use sustained frame pacing, not isolated shader/asset stalls. Changes are sparse
// because resizing temporal targets discards their history and allocates textures.
export class AdaptiveResolution {
	constructor( { initial, max = initial } ) {
		this.scale = initial;
		this.max = max;
		this.reset();
	}
	reset() {
		this.elapsed = 0;
		this.frames = 0;
		this.cooldown = 5;
		this.fastWindows = 0;
	}
	update( dt ) {
		if ( ! Number.isFinite( dt ) || dt <= 0 || dt >= 0.1 ) { this.reset(); return null; }
		if ( this.cooldown > 0 ) { this.cooldown -= dt; return null; }
		this.elapsed += dt;
		this.frames++;
		if ( this.elapsed < 2 ) return null;
		const ms = this.elapsed * 1000 / this.frames;
		this.elapsed = 0; this.frames = 0;
		this.fastWindows = ms < 17.2 ? this.fastWindows + 1 : 0;
		const next = ms > 19 ? Math.max( 0.5, this.scale - 0.05 ) :
			this.fastWindows >= 4 ? Math.min( this.max, this.scale + 0.05 ) : this.scale;
		if ( Math.abs( next - this.scale ) < 0.001 ) return null;
		this.scale = Math.round( next * 20 ) / 20;
		this.reset();
		return this.scale;
	}
}
