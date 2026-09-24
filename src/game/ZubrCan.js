import { Euler, Quaternion, Vector3, MathUtils } from '../engine/index.js';
import { createZubrCanModel } from './ZubrCanModel.js';

const smooth = ( a, b, t ) => MathUtils.smoothstep( t, a, b );
const DURATION = 3.4;

// A camera-relative hand prop, using the same world lighting as the fishing rod.
// Opening and gulp cues happen once at their animation beats, never on key repeat.
export class ZubrCan {

	constructor( { scene, camera, audio = null } ) {

		this.camera = camera;
		this.audio = audio;
		this.model = createZubrCanModel();
		this.ready = this.model.ready;
		this.model.visible = false;
		scene.add( this.model );
		this.active = false;
		this.opened = false;
		this.elapsed = 0;
		this._sipped = false;
		this._position = new Vector3();
		this._rotation = new Euler();
		this._quaternion = new Quaternion();

	}

	start() {

		if ( this.active ) return false;
		this.active = true;
		this.elapsed = 0;
		this._sipped = false;
		this.update( 0 );
		return true;

	}

	cancel() {

		this.active = false;
		this.model.visible = false;

	}

	update( dt, allowed = true ) {

		if ( ! allowed ) this.cancel();
		if ( ! this.active ) return;
		this.elapsed += Math.max( 0, dt );
		const t = this.elapsed;
		if ( ! this.opened && t >= 0.7 ) {

			this.opened = true;
			this.audio?.canOpen?.();

		}
		if ( ! this._sipped && t >= 1.65 ) {

			this._sipped = true;
			this.audio?.drinkSip?.();

		}
		if ( t >= DURATION ) { this.cancel(); return; }

		const raise = smooth( 0, 0.5, t ) * ( 1 - smooth( 2.95, DURATION, t ) );
		const sip = smooth( 1.05, 1.65, t ) * ( 1 - smooth( 2.3, 2.9, t ) );
		const gulp = t > 1.65 && t < 2.3 ? Math.sin( ( t - 1.65 ) * 21 ) * 0.004 : 0;
		// Bring the hand inward in portrait so the label stays inside the narrow view.
		const handX = Math.min( 0.15, 0.37 * Math.tan( this.camera.fov * Math.PI / 360 ) * this.camera.aspect - 0.045 );
		const handY = this.camera.aspect < 0.8 ? 0.015 : - 0.075;
		this._position.set(
			MathUtils.lerp( Math.max( 0, handX ), 0.025, sip ),
			MathUtils.lerp( handY, - 0.025, sip ) - ( 1 - raise ) * 0.35 + gulp,
			MathUtils.lerp( - 0.37, - 0.225, sip ),
		);
		this._rotation.set( 0.1 + sip * 1.8, - 0.18 * ( 1 - sip ), 0.1 - sip * 0.18 );
		this._quaternion.setFromEuler( this._rotation );
		this.model.position.copy( this._position ).applyQuaternion( this.camera.quaternion ).add( this.camera.position );
		this.model.quaternion.copy( this.camera.quaternion ).multiply( this._quaternion );
		this.model.opening.visible = this.opened;
		this.model.tab.rotation.x = this.opened ? 0.35 + 0.7 * ( 1 - smooth( 0.7, 1.05, t ) ) : 0;
		this.model.visible = true;

	}

}
