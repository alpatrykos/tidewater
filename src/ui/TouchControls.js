import './touch.css';

// Touch feeds the same input actions as the keyboard, with independent pointer
// ownership so steering, looking and holding the reel can happen together.
export class TouchControls {
	constructor( app, ui ) {
		this.app = app; this.ui = ui; this.input = app.input;
		this.input.touchMode = true;
		this.started = false; this.blocked = true; this.pointers = new Map();
		this.root = document.createElement( 'div' );
		this.root.className = 'touch-controls';
		this.root.setAttribute( 'aria-label', 'Mobile game controls' );
		this.root.innerHTML = `<div class="touch-stick" role="group" aria-label="Move and steer"><span></span></div>
			<div class="touch-actions"><button data-key="KeyE">Interact</button><button data-key="KeyR">Rod</button>
			<button data-action="primary" class="touch-primary">Cast</button><button data-action="secondary">Retrieve</button>
			<button data-key="Space">Jump / Up</button><button data-key="KeyC">Dive</button>
			<button data-key="ShiftLeft">Sprint</button><button data-key="KeyB" aria-label="Open and drink Monster, then toss the empty can">Monster</button><button data-key="KeyV">Boat camera</button></div>
			<div class="touch-tools"><button data-key="KeyI">Cooler</button><button data-key="KeyL">Light</button><button data-action="settings">Settings</button></div>
			<div class="touch-hint">Left stick to move · drag the scene to look</div>`;
		document.body.append( this.root );
		this.photoExit = document.createElement( 'button' );
		this.photoExit.className = 'touch-photo-exit';
		this.photoExit.textContent = 'Exit photo mode';
		this.photoExit.hidden = true;
		this.photoExit.addEventListener( 'click', () => ui.setPhotoMode( false ) );
		document.body.append( this.photoExit );
		document.body.classList.add( 'has-touch-controls' );
		this.stick = this.root.querySelector( '.touch-stick' );
		this.knob = this.stick.firstElementChild;
		this.primary = this.root.querySelector( '[data-action="primary"]' );
		this.retrieve = this.root.querySelector( '[data-action="secondary"]' );
		this.boatCamera = this.root.querySelector( '[data-key="KeyV"]' );
		this.drink = this.root.querySelector( '[data-key="KeyB"]' );
		this.rod = this.root.querySelector( '[data-key="KeyR"]' );
		this.bind( this.stick, 'stick' );
		this.bind( app.engine.domElement, 'look' );
		for ( const button of this.root.querySelectorAll( 'button' ) ) this.bind( button, 'button' );
		window.addEventListener( 'blur', () => this.cancel() );
		window.addEventListener( 'resize', () => this.cancel() );
		document.addEventListener( 'visibilitychange', () => { if ( document.hidden ) this.cancel(); } );
		this.root.hidden = true;
		const startButton = ui.startEl.querySelector( '.tw-start-cta' );
		if ( startButton ) startButton.textContent = 'Tap to explore';
		const startKeys = ui.startEl.querySelector( '.tw-start-keys' );
		if ( startKeys ) startKeys.textContent = 'Left stick to move · drag the scene to look · buttons to fish';
	}
	bind( el, kind ) {
		el.style.touchAction = 'none';
		el.addEventListener( 'contextmenu', e => e.preventDefault() );
		el.addEventListener( 'pointerdown', e => {
			if ( this.blocked || el.disabled || e.button !== 0 || [ ...this.pointers.values() ].some( p => p.el === el ) ) return;
			e.preventDefault(); e.stopPropagation();
			const rect = el.getBoundingClientRect();
			const p = { el, kind, x: e.clientX, y: e.clientY, cx: rect.left + rect.width / 2, cy: rect.top + rect.height / 2 };
			this.pointers.set( e.pointerId, p ); el.setPointerCapture( e.pointerId );
			if ( this.app.audio ) this.app.audio.resume();
			if ( kind === 'button' ) {
				el.classList.add( 'held' );
				if ( el.dataset.key ) this.input.setTouchKey( el.dataset.key, true );
				if ( el.dataset.action === 'primary' ) this.input.touchPrimary = true;
				if ( el.dataset.action === 'secondary' ) this.input.touchSecondary = true;
				if ( el.dataset.action === 'settings' ) { this.ui.togglePanel( true ); this.cancel(); }
			}
			if ( kind === 'stick' ) this.moveStick( e, p );
		} );
		el.addEventListener( 'pointermove', e => {
			const p = this.pointers.get( e.pointerId ); if ( ! p ) return;
			e.preventDefault();
			if ( kind === 'stick' ) this.moveStick( e, p );
			if ( kind === 'look' ) {
				this.input.look.x += e.clientX - p.x;
				this.input.look.y += e.clientY - p.y;
				p.x = e.clientX; p.y = e.clientY;
			}
		} );
		const end = e => {
			const p = this.pointers.get( e.pointerId ); if ( ! p ) return;
			this.pointers.delete( e.pointerId );
			if ( kind === 'stick' ) this.resetStick();
			if ( kind === 'button' ) {
				el.classList.remove( 'held' );
				if ( el.dataset.key ) this.input.setTouchKey( el.dataset.key, false );
				if ( el.dataset.action === 'primary' ) this.input.touchPrimary = false;
				if ( el.dataset.action === 'secondary' ) this.input.touchSecondary = false;
			}
			if ( e.type !== 'pointerup' && el.dataset.action === 'primary' ) this.cancelWindup();
		};
		for ( const type of [ 'pointerup', 'pointercancel', 'lostpointercapture' ] ) el.addEventListener( type, end );
	}
	moveStick( e, p ) {
		const dx = e.clientX - p.cx, dy = e.clientY - p.cy;
		const r = Math.max( 1, Math.hypot( dx, dy ) / 42 );
		const x = dx / r, y = dy / r;
		this.knob.style.transform = `translate(${ x }px, ${ y }px)`;
		for ( const [ key, held ] of [ [ 'KeyA', x < - 12 ], [ 'KeyD', x > 12 ], [ 'KeyW', y < - 12 ], [ 'KeyS', y > 12 ] ] ) this.input.setTouchKey( key, held );
	}
	resetStick() {
		for ( const key of [ 'KeyW', 'KeyA', 'KeyS', 'KeyD' ] ) this.input.setTouchKey( key, false );
		this.knob.style.transform = '';
	}
	cancelWindup() {
		const game = this.app.game;
		if ( game.rod.state === 'windup' ) game.rod.setState( 'idle' );
		game._lmb = game._rmb = false;
	}
	cancel() {
		this.cancelWindup(); this.input.clearTouch(); this.resetStick();
		for ( const [ id, p ] of this.pointers ) {
			p.el.classList.remove( 'held' );
			if ( p.el.hasPointerCapture( id ) ) p.el.releasePointerCapture( id );
		}
		this.pointers.clear();
	}
	update() {
		const game = this.app.game, hud = game.hud;
		this.blocked = ! this.started || this.ui.panelOpen || this.ui.helpOpen || this.ui._start || game.guide?.open || hud?.invOpen || hud?.standOpen || hud?.catchOpen || this.ui._photo || document.hidden;
		this.root.hidden = !! this.blocked;
		this.photoExit.hidden = ! this.ui.photoMode;
		if ( this.blocked ) this.cancel();
		const state = game.rod.state, can = game.drink;
		const label = game.fight ? 'Hold to reel' : state === 'floating' ? 'Strike' : state === 'windup' ? 'Release to cast' : 'Hold to cast';
		if ( this.primary.textContent !== label ) this.primary.textContent = label;
		this.primary.disabled = ! game.rod.equipped;
		this.primary.setAttribute( 'aria-label', label );
		this.retrieve.hidden = ! game.rod.equipped;
		this.rod.disabled = !! can?.busy;
		this.boatCamera.hidden = this.app.player.mode !== 'boat' && this.app.player.mode !== 'heli';
		this.drink.hidden = this.app.player.mode === 'boat';
		this.drink.disabled = ! can?.available || ! game.canDrink;
	}
}
