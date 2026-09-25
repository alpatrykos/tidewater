import { Quaternion, Vector3 } from '../engine/index.js';
import { createZubrCanModel } from './ZubrCanModel.js';

const RADIUS = 0.0335, HALF_HEIGHT = 0.084;

// One persistent empty can, released from the hand into world space. A bounded
// cylinder/heightfield simulation provides a few light bounces, tumble and roll.
export class ThrownCan {

	constructor( { scene, terrain, audio = null, template = null } ) {

		this.terrain = terrain;
		this.audio = audio;
		this.model = template ? template.model.clone( true ) : createZubrCanModel();
		this.ready = template ? template.ready : this.model.ready;
		this.model.name = 'Discarded empty Monster can';
		this.model.visible = false;
		if ( ! template ) {

			this.model.opening.visible = true;
			this.model.lidFlap.rotation.x = 1.35;
			this.model.tab.rotation.x = 0.35;

		}
		this.model.traverse( object => {

			if ( ! object.isMesh ) return;
			object.castShadow = true;
			object.frustumCulled = true;
			object.material.receiveShadows = true;

		} );
		scene.add( this.model );
		this.settled = false;
		this._velocity = new Vector3();
		this._spin = new Vector3();
		this._axis = new Vector3();
		this._normal = new Vector3( 0, 1, 0 );
		this._tangent = new Vector3();
		this._turn = new Quaternion();
		this._side = new Quaternion();
		this._carrier = null;
		this._carrierPosition = new Vector3();
		this._carrierRotation = new Quaternion();
		this._elapsed = 0;
		this._contactTime = 0;
		this._lastImpactSound = - 1;

	}

	get visible() { return this.model.visible; }

	throw( position, quaternion, velocity ) {

		if ( this.visible ) return false;
		this.model.position.copy( position );
		this.model.quaternion.copy( quaternion );
		this._velocity.copy( velocity );
		this._spin.set( 8.5, 2.2, - 3.7 ).applyQuaternion( quaternion );
		this._elapsed = 0;
		this._contactTime = 0;
		this._lastImpactSound = - 1;
		this._carrier = null;
		this.model.visible = true;
		this.settled = false;
		return true;

	}

	update( dt ) {

		if ( ! this.visible ) return;
		if ( this.settled ) {

			if ( this._carrier ) {

				this._carrier.toWorld( this._carrierPosition, this.model.position );
				this.model.quaternion.copy( this._carrier.quaternion ).multiply( this._carrierRotation );

			}
			return;

		}
		if ( ! Number.isFinite( dt ) || dt <= 0 ) return;
		// Preserve narrow collision contacts during a slow frame; tab-resume catch-up
		// is capped to one second so this small prop never monopolizes the main loop.
		const time = Math.min( dt, 1 );
		const steps = Math.ceil( time * 120 );
		const step = time / steps;
		for ( let i = 0; i < steps && ! this.settled; i ++ ) this._step( step );

	}

	_step( dt ) {

		this._elapsed += dt;
		const p = this.model.position, q = this.model.quaternion, v = this._velocity;
		v.y -= 9.81 * dt;
		v.multiplyScalar( Math.exp( - 0.12 * dt ) );
		p.addScaledVector( v, dt );
		const spin = this._spin.length();
		if ( spin > 0.0001 ) {

			this._axis.copy( this._spin ).multiplyScalar( 1 / spin );
			this._turn.setFromAxisAngle( this._axis, spin * dt );
			q.premultiply( this._turn ).normalize();

		}
		const height = this._surface();
		const support = this._support();
		if ( p.y > height + support ) return;
		p.y = height + support;
		this._contactTime += dt;
		const inward = v.dot( this._normal );
		const impact = Math.max( 0, - inward );
		if ( inward < 0 ) {

			const bounce = impact > 0.55 ? 0.27 : 0;
			v.addScaledVector( this._normal, - inward * ( 1 + bounce ) );
			if ( impact > 0.55 ) {

				this._spin.multiplyScalar( 0.72 );
				if ( this._elapsed - this._lastImpactSound > 0.085 ) {

					this.audio?.canImpact?.( Math.min( 1, Math.max( 0.1, impact / 4 ) ) );
					this._lastImpactSound = this._elapsed;

				}

			}

		}
		// Ground drag and rolling resistance remove energy without reversing direction.
		const outward = Math.max( 0, v.dot( this._normal ) );
		this._tangent.copy( v ).addScaledVector( this._normal, - outward );
		const speed = this._tangent.length();
		this._tangent.multiplyScalar( Math.max( 0, 1 - 1.8 * dt / Math.max( speed, 1e-6 ) ) * Math.exp( - 2.8 * dt ) );
		v.copy( this._tangent ).addScaledVector( this._normal, outward );
		this._spin.multiplyScalar( Math.exp( - 7 * dt ) );
		// As an empty thin cylinder loses its spin, gravity tips it onto its long side.
		// Preserve the current label twist and use the local ground tangent, not world-up.
		this._sideRotation();
		q.slerp( this._side, 1 - Math.exp( - 7.5 * dt ) ).normalize();
		p.y = height + this._support();
		const quiet = v.lengthSq() < 0.012 && this._spin.lengthSq() < 0.04;
		if ( this._contactTime > 0.45 && quiet || this._elapsed > 12 ) {

			this._sideRotation();
			q.copy( this._side );
			p.y = height + this._support();
			v.set( 0, 0, 0 );
			this._spin.set( 0, 0, 0 );
			this.settled = true;
			this._carrier = this.terrain?.carrierAt?.( p.x, p.z, p.y + 0.12 ) || null;
			if ( this._carrier ) {

				this._turn.copy( this._carrier.quaternion ).invert();
				this._carrierPosition.copy( p ).sub( this._carrier.position ).applyQuaternion( this._turn );
				this._carrierRotation.copy( this._turn ).multiply( q );

			}

		}

	}

	_surface() {

		const p = this.model.position, terrain = this.terrain;
		if ( ! terrain ) { this._normal.set( 0, 1, 0 ); return 0; }
		const e = 0.04, maxY = p.y + 0.12;
		const height = terrain.heightAt( p.x, p.z, maxY );
		if ( ! Number.isFinite( height ) ) { this._normal.set( 0, 1, 0 ); return - Infinity; }
		// Use a nearby sample only if it belongs to the same continuous floor. A pier's
		// edge exposes much lower terrain; treating that drop as a slope would kick the
		// can sideways and give it an incorrect cylinder support height.
		const dx = floorSlope( terrain.heightAt( p.x - e, p.z, maxY ), terrain.heightAt( p.x + e, p.z, maxY ), height, e );
		const dz = floorSlope( terrain.heightAt( p.x, p.z - e, maxY ), terrain.heightAt( p.x, p.z + e, maxY ), height, e );
		this._normal.set( - dx, 1, - dz ).normalize();
		return height;

	}

	_support() {

		this._axis.set( 0, 1, 0 ).applyQuaternion( this.model.quaternion );
		const along = Math.min( 1, Math.abs( this._axis.dot( this._normal ) ) );
		return ( HALF_HEIGHT * along + RADIUS * Math.sqrt( Math.max( 0, 1 - along * along ) ) ) / Math.max( 0.2, this._normal.y );

	}

	_sideRotation() {

		this._axis.set( 0, 1, 0 ).applyQuaternion( this.model.quaternion );
		this._tangent.copy( this._axis ).addScaledVector( this._normal, - this._axis.dot( this._normal ) );
		if ( this._tangent.lengthSq() < 0.0001 ) {

			this._tangent.set( 1, 0, 0 ).addScaledVector( this._normal, - this._normal.x );

		}
		this._tangent.normalize();
		this._turn.setFromUnitVectors( this._axis, this._tangent );
		this._side.copy( this.model.quaternion ).premultiply( this._turn ).normalize();

	}

	reset() {

		this.model.visible = false;
		this.settled = false;
		this._carrier = null;
		this._velocity.set( 0, 0, 0 );
		this._spin.set( 0, 0, 0 );

	}

}

function floorSlope( low, high, centre, step ) {

	const useLow = Number.isFinite( low ) && Math.abs( low - centre ) <= 0.08;
	const useHigh = Number.isFinite( high ) && Math.abs( high - centre ) <= 0.08;
	if ( useLow && useHigh ) return ( high - low ) / ( 2 * step );
	if ( useLow ) return ( centre - low ) / step;
	if ( useHigh ) return ( high - centre ) / step;
	return 0;

}
