// Keyboard / mouse input with pointer lock support.
export class Input {

	constructor( dom ) {

		this.dom = dom;
		this.keys = new Set();
		this.touchKeys = new Set();
		this.touchPrimary = false;
		this.touchSecondary = false;
		this.touchMode = false;
		this.pressed = new Set();
		this.look = { x: 0, y: 0 };
		this.wheel = 0;
		this.mouseDown = false;
		this.rightDown = false;
		this.locked = false;
		this.enabled = true;

		window.addEventListener( 'keydown', ( e ) => {

			if ( e.target && ( e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT' || e.target.tagName === 'TEXTAREA' ) ) return;
			if ( ! this.keys.has( e.code ) ) this.pressed.add( e.code );
			this.keys.add( e.code );
			if ( [ 'Space', 'ArrowUp', 'ArrowDown', 'Tab' ].includes( e.code ) ) e.preventDefault();

		} );
		window.addEventListener( 'keyup', ( e ) => this.keys.delete( e.code ) );
		window.addEventListener( 'blur', () => this.reset() );
		document.addEventListener( 'visibilitychange', () => { if ( document.hidden ) this.reset(); } );

		dom.addEventListener( 'mousedown', ( e ) => {

			if ( this.touchMode ) return;
			if ( e.button === 0 ) this.mouseDown = true;
			if ( e.button === 2 ) this.rightDown = true;

		} );
		window.addEventListener( 'mouseup', ( e ) => {

			if ( e.button === 0 ) this.mouseDown = false;
			if ( e.button === 2 ) this.rightDown = false;

		} );
		dom.addEventListener( 'contextmenu', ( e ) => e.preventDefault() );
		window.addEventListener( 'mousemove', ( e ) => {

			if ( this.locked || this.mouseDown || this.rightDown ) {

				this.look.x += e.movementX;
				this.look.y += e.movementY;

			}

		} );
		dom.addEventListener( 'wheel', ( e ) => {

			this.wheel += Math.sign( e.deltaY );
			e.preventDefault();

		}, { passive: false } );

		document.addEventListener( 'pointerlockchange', () => {

			this.locked = document.pointerLockElement === dom;

		} );

	}

	requestLock() {

		if ( ! this.touchMode && ! this.locked ) this.dom.requestPointerLock?.()?.catch?.( () => {} );

	}

	setTouchKey( code, held ) {
		if ( held && ! this.touchKeys.has( code ) && ! this.keys.has( code ) ) this.pressed.add( code );
		if ( held ) this.touchKeys.add( code ); else this.touchKeys.delete( code );
	}

	clearTouch() {
		for ( const code of this.touchKeys ) if ( ! this.keys.has( code ) ) this.pressed.delete( code );
		this.touchKeys.clear();
		this.touchPrimary = this.touchSecondary = false;
		this.look.x = this.look.y = 0;
	}

	reset() {
		this.keys.clear(); this.pressed.clear(); this.clearTouch();
		this.mouseDown = this.rightDown = false; this.wheel = 0;
	}

	down( code ) {

		return this.enabled && ( this.keys.has( code ) || this.touchKeys.has( code ) );

	}

	// true once per physical key press
	hit( code ) {

		return this.enabled && this.pressed.has( code );

	}

	consumeLook() {

		const l = { x: this.look.x, y: this.look.y };
		this.look.x = 0;
		this.look.y = 0;
		return l;

	}

	consumeWheel() {

		const w = this.wheel;
		this.wheel = 0;
		return w;

	}

	endFrame() {

		this.pressed.clear();

	}

}
