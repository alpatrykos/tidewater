import { Euler, Quaternion, Vector3, MathUtils } from '../engine/index.js';
import { createZubrCanModel } from './ZubrCanModel.js';
import { CanOpeningFX } from './CanOpeningFX.js';
import { ThrownCan } from './ThrownCan.js';

// Quintic easing has zero velocity and acceleration at the ends of a gesture.
const ease = ( a, b, t ) => {
	const x = MathUtils.clamp( ( t - a ) / ( b - a ), 0, 1 );
	return x * x * x * ( x * ( x * 6 - 15 ) + 10 );
};
const mix = MathUtils.lerp;
const MAX_DISCARDED_CANS = 32;
const GULP_TIMES = [ 1.04, 1.68, 2.31, 2.95 ];
const DRAW_TIME = 0.72, OPEN_TIME = 1.55, DRINK_TIME = 4.25, THROW_TIME = 0.9;
const X_AXIS = new Vector3( 1, 0, 0 ), MAX_PITCH = 1.45;

// B performs one continuous draw, open, finish and discard gesture for a fresh inventory can.
// All action beats use simulation time, so interruption cannot leave scheduled opening cues behind.
export class ZubrCan {

	constructor( { scene, camera, terrain = null, audio = null } ) {

		this.camera = camera;
		this.audio = audio;
		this.consumed = false;
		this.terrain = terrain;
		this.model = createZubrCanModel();
		this.scene = scene;
		this.thrown = new ThrownCan( { scene, terrain, audio } );
		this.drops = [ this.thrown ];
		this._nextDrop = 0;
		this.ready = Promise.all( [ this.model.ready, this.thrown.ready ] );
		this.model.visible = false;
		scene.add( this.model );
		this.fx = new CanOpeningFX( { scene, camera } );
		this.state = 'stowed';
		this.opened = false;
		this.elapsed = 0;
		this._time = 0;
		this._walkPhase = 0;
		this._gulp = 0;
		this._tabTouched = false;
		this._position = new Vector3();
		this._renderPosition = new Vector3();
		this._rotation = new Euler();
		this._quaternion = new Quaternion();
		this._renderQuaternion = new Quaternion();
		this._throwVelocity = new Vector3();
		this._lastCamera = camera.quaternion.clone();
		this._cameraDelta = new Quaternion();
		this._lookEuler = new Euler( 0, 0, 0, 'YXZ' );
		this._sway = new Vector3();
		this._aperture = new Vector3();
		this._up = new Vector3();
		this._forward = new Vector3();
		this._baseCamera = camera.quaternion.clone();
		this._head = 0;
		this._headQ = new Quaternion();
		this._headInverse = new Quaternion();
		this._tiltedCamera = new Quaternion();
		this._poseReady = false;

	}

	get busy() { return this.state !== 'stowed'; }
	get active() { return this.busy; }
	get available() { return ! this.busy; }

	start() {

		if ( ! this.available ) return false;
		this.state = 'drawing';
		this.opened = false;
		this.consumed = false;
		this.elapsed = 0;
		this._gulp = 0;
		this._tabTouched = false;
		this._released = false;
		this._poseReady = false;
		this._lastCamera.copy( this.camera.quaternion );
		this._sway.set( 0, 0, 0 );
		this.audio?.canHandle?.();
		this.update( 0 );
		return true;

	}

	cancel() {

		this.state = 'stowed';
		this.model.visible = false;
		this.fx.clear();
		this._poseReady = false;

	}

	update( dt, allowed = true, motion = {} ) {

		dt = Number.isFinite( dt ) ? Math.max( 0, Math.min( 0.1, dt ) ) : 0;
		this.tiltHead( dt, allowed );
		if ( ! allowed ) this.cancel();
		this.fx.update( dt );
		for ( const drop of this.drops ) drop.update( dt );
		if ( this.state === 'stowed' ) return;
		this._time += dt;
		this.elapsed += dt;
		let pop = false;
		if ( this.state === 'opening' ) {

			if ( ! this._tabTouched && this.elapsed >= 0.48 ) {
				this._tabTouched = true;
				this.audio?.canTab?.();
			}
			if ( ! this.opened && this.elapsed >= 0.82 ) {
				this.opened = true;
				pop = true;
				this.audio?.canOpen?.();
			}
			if ( this.elapsed >= OPEN_TIME ) { this.state = 'drinking'; this.elapsed -= OPEN_TIME; }

		}
		if ( this.state === 'drinking' ) {

			if ( this._gulp < GULP_TIMES.length && this.elapsed >= GULP_TIMES[ this._gulp ] ) {
				this._gulp ++;
				this.audio?.drinkSip?.();
			}
			if ( this.elapsed >= DRINK_TIME ) {
				this.state = 'throwing'; this.elapsed -= DRINK_TIME;
				this.audio?.canThrow?.();
			}

		}
		if ( this.state === 'drawing' && this.elapsed >= DRAW_TIME ) {
			this.state = this.opened ? 'drinking' : 'opening'; this.elapsed -= DRAW_TIME;
		}
		if ( this.state === 'throwing' && this.elapsed >= THROW_TIME ) { this.cancel(); return; }

		this.pose( dt, motion );
		if ( this.state === 'throwing' && this.elapsed >= 0.48 && ! this._released ) {

			this._released = true;
			this.consumed = true;
			this._throwVelocity.set( 0, 0, - 1 ).applyQuaternion( this.camera.quaternion );
			this._throwVelocity.y = 0;
			if ( this._throwVelocity.lengthSq() < 0.01 ) this._throwVelocity.set( 0, 0, - 1 );
			this._throwVelocity.normalize().multiplyScalar( 3.1 );
			this._throwVelocity.y = 1.9;
			// Reuse shared can geometry/materials, keeping a bounded amount of world clutter.
			if ( this._nextDrop === this.drops.length ) this.drops.push( new ThrownCan( {
				scene: this.scene, terrain: this.terrain, audio: this.audio, template: this.drops[ 0 ],
			} ) );
			this.thrown = this.drops[ this._nextDrop ];
			this._nextDrop = ( this._nextDrop + 1 ) % MAX_DISCARDED_CANS;
			this.thrown.reset();
			this.thrown.throw( this.model.position, this.model.quaternion, this._throwVelocity );

		}
		// The world prop takes over at release.
		if ( this._released ) this.model.visible = false;
		if ( pop ) {

			this.model.updateWorldMatrix( true, true );
			this._aperture.set( 0, 0.084, 0.012 ).applyMatrix4( this.model.matrixWorld );
			this.fx.burst( this._aperture, this.model.quaternion );

		}

	}

	// Target head pitch: the head tips back a little further with each gulp to finish the can.
	headTarget() {

		if ( this.state !== 'drinking' ) return 0;
		const t = this.elapsed;
		let head = 0.1 * ease( 0.35, 1.0, t );
		for ( const g of GULP_TIMES ) head += 0.042 * ease( g - 0.34, g - 0.02, t );
		return head * ( 1 - ease( 3.1, 3.8, t ) );

	}

	// The player controller rebuilds the view every frame; this adds the drinking pitch on top.
	// If nothing rebuilt it since last frame, the previous tilt is removed first so it never accumulates.
	tiltHead( dt, allowed ) {

		const camera = this.camera;
		if ( this._head && camera.quaternion.equals( this._tiltedCamera ) ) camera.quaternion.multiply( this._headInverse );
		this._baseCamera.copy( camera.quaternion );
		if ( ! allowed ) { this._head = 0; return; }
		this._forward.set( 0, 0, - 1 ).applyQuaternion( camera.quaternion );
		const room = Math.max( 0, MAX_PITCH - Math.asin( MathUtils.clamp( this._forward.y, - 1, 1 ) ) );
		this._head += ( Math.min( this.headTarget(), room ) - this._head ) * ( 1 - Math.exp( - dt * 10 ) );
		if ( this.state === 'stowed' && this._head < 1e-4 ) this._head = 0;
		if ( ! this._head ) return;
		this._headQ.setFromAxisAngle( X_AXIS, this._head );
		this._headInverse.copy( this._headQ ).invert();
		camera.quaternion.multiply( this._headQ );
		this._tiltedCamera.copy( camera.quaternion );

	}

	pose( dt, motion ) {

		const t = this.elapsed, state = this.state;
		const portrait = this.camera.aspect < 0.8;
		const handX = Math.max( 0, Math.min( 0.145, 0.37 * Math.tan( this.camera.fov * Math.PI / 360 ) * this.camera.aspect - 0.049 ) );
		const handY = portrait ? 0.014 : - 0.068;
		let x = handX, y = handY, z = - 0.37, rx = 0.10, ry = - 0.18, rz = 0.10;
		if ( state === 'drawing' ) {

			const a = 1 - ease( 0, DRAW_TIME, t );
			x += 0.035 * a; y -= 0.34 * a; z += 0.09 * a;
			rx -= 0.5 * a; rz += 0.3 * a;

		} else if ( state === 'opening' ) {

			const a = ease( 0, 0.4, t ) * ( 1 - ease( 1.15, OPEN_TIME, t ) );
			x = mix( x, portrait ? 0.015 : 0.065, a );
			y = mix( y, portrait ? 0.025 : - 0.052, a );
			z = mix( z, - 0.325, a );
			rx += 0.35 * a; ry += 0.24 * a; rz -= 0.15 * a;
			// The wrist absorbs the tab releasing rather than snapping the whole camera.
			const recoil = t > 0.82 ? Math.sin( ( t - 0.82 ) * 31 ) * Math.exp( - ( t - 0.82 ) * 15 ) : 0;
			y -= recoil * 0.0028; rx += recoil * 0.018;

		} else if ( state === 'drinking' ) {

			// The lid rests on the lower lip, just under the frame, and the can pivots about it.
			// Each gulp tips it a little further as it empties, so the base climbs into view.
			const lift = ease( 0.08, 0.78, t ) * ( 1 - ease( 3.3, 3.95, t ) );
			let tilt = 1.62 * ease( 0.3, 0.98, t );
			let gulp = 0;
			for ( let i = 0; i < GULP_TIMES.length; i ++ ) {
				const g = GULP_TIMES[ i ];
				tilt += 0.1 * ease( g - 0.34, g - 0.02, t );
				// Wrist tips in as the mouthful is taken, then eases while swallowing.
				const u = MathUtils.clamp( ( t - g + 0.3 ) / 0.55, 0, 1 );
				gulp += Math.sin( u * Math.PI ) ** 2 * ( 1 - u * 0.4 );
			}
			tilt *= 1 - ease( 3.18, 3.85, t );
			// The tipped-back head supplies part of the can's tilt in the world.
			rx = mix( rx, 0.10 + tilt + 0.045 * gulp - 0.7 * this._head, lift );
			ry = mix( ry, - 0.1, lift ); rz = mix( rz, 0.16, lift );
			this._up.set( 0, 1, 0 ).applyEuler( this._rotation.set( rx, ry, rz ) );
			// Kept clear of the 0.1 m near plane wherever the can is inside the view.
			const mouthY = - 0.11 + 0.002 * gulp, mouthZ = - 0.115 + 0.003 * gulp;
			x = mix( x, 0.012 - this._up.x * 0.082, lift );
			y = mix( y, mouthY - this._up.y * 0.082, lift );
			z = mix( z, mouthZ - this._up.z * 0.082, lift );
			// Back at the hand, a quick shake checks that the can is really empty.
			const shake = ease( 3.72, 3.84, t ) * ( 1 - ease( 4.02, 4.22, t ) ) * Math.sin( ( t - 3.72 ) * 42 );
			rz += shake * 0.09; x += shake * 0.004;

		} else if ( state === 'throwing' ) {

			const back = ease( 0, 0.23, t ) * ( 1 - ease( 0.23, 0.48, t ) );
			const swing = ease( 0.23, 0.50, t );
			x += 0.04 * back - 0.045 * swing;
			y -= 0.065 * back; y += 0.045 * swing;
			z += 0.045 * back; z -= 0.16 * swing;
			rx -= 0.5 * back; rx += 0.85 * swing;
			rz -= 0.3 * swing;

		}

		// Small view inertia, breathing and footfall movement, measured on the view before the head tilt.
		this._cameraDelta.copy( this._lastCamera ).invert().multiply( this._baseCamera );
		this._lookEuler.setFromQuaternion( this._cameraDelta, 'YXZ' );
		this._lastCamera.copy( this._baseCamera );
		const rate = dt > 0 ? 1 / dt : 0, k = 1 - Math.exp( - dt * 9 );
		this._sway.x += ( MathUtils.clamp( this._lookEuler.y * rate, - 2, 2 ) * 0.006 - this._sway.x ) * k;
		this._sway.y += ( - MathUtils.clamp( this._lookEuler.x * rate, - 2, 2 ) * 0.004 - this._sway.y ) * k;
		const speed = Math.min( 1, ( motion.speed || 0 ) / 3 ) * ( motion.grounded === false ? 0 : 1 );
		this._walkPhase += dt * ( 7 + speed * 4 );
		const calm = 0.22;
		x += ( this._sway.x + Math.sin( this._walkPhase * 0.5 ) * speed * 0.003 ) * calm;
		y += ( this._sway.y + Math.sin( this._time * 1.65 ) * 0.0012 + Math.cos( this._walkPhase ) * speed * 0.0025 ) * calm;
		rz -= this._sway.x * 0.7 * calm;
		this._position.set( x, y, z );
		this._quaternion.setFromEuler( this._rotation.set( rx, ry, rz ) );

		const follow = this._poseReady ? 1 - Math.exp( - dt * 34 ) : 1;
		this._renderPosition.lerp( this._position, follow );
		this._renderQuaternion.slerp( this._quaternion, follow );
		this._poseReady = true;
		this.model.position.copy( this._renderPosition ).applyQuaternion( this.camera.quaternion ).add( this.camera.position );
		this.model.quaternion.copy( this.camera.quaternion ).multiply( this._renderQuaternion );
		this.model.opening.visible = this.opened;
		const flap = state === 'opening' ? ease( 0.82, 0.96, t ) : this.opened ? 1 : 0;
		if ( this.model.lidFlap ) this.model.lidFlap.rotation.x = flap * 1.4;
		let tab = this.opened ? 0.08 : 0;
		if ( state === 'opening' ) tab = 1.05 * ease( 0.5, 0.88, t ) - 0.97 * ease( 0.94, 1.2, t );
		this.model.tab.rotation.x = tab;
		this.model.visible = true;

	}

}
