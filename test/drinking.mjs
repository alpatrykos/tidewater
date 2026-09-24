import assert from 'node:assert/strict';
import { Scene, PerspectiveCamera, Vector3 } from '../src/engine/index.js';
import { ZubrCan } from '../src/game/ZubrCan.js';
import { Game } from '../src/game/Game.js';

const scene = new Scene(), camera = new PerspectiveCamera( 60, 16 / 9, 0.01, 100 );
camera.position.set( 0, 1.7, 0 );
let opens = 0, gulps = 0, bursts = 0;
const drink = new ZubrCan( { scene, camera, terrain: { heightAt: () => 0 }, audio: {
	canOpen() { opens ++; }, drinkSip() { gulps ++; },
} } );
const step = ( seconds, allowed = true ) => { for ( let t = 0; t < seconds; t += 1 / 60 ) drink.update( 1 / 60, allowed ); };
const burst = drink.fx.burst.bind( drink.fx );
drink.fx.burst = ( ...args ) => { bursts ++; burst( ...args ); };

assert.equal( drink.available, true );
assert.equal( drink.start(), true );
assert.equal( drink.start(), false, 'repeated B cannot restart the gesture' );
step( 0.5 );
assert.equal( drink.opened, false, 'can stays sealed as it is drawn' );
assert.equal( opens, 0 );
step( 1.1 );
assert.equal( drink.opened, true );
assert.equal( drink.model.opening.visible, true );
assert.equal( opens, 1 );
assert.equal( bursts, 1 );
assert.equal( gulps, 0, 'seal opens before the first drink' );
assert.equal( drink.fx.active, true );
step( 4.8 );
assert.equal( gulps, 4, 'one action drinks the whole can' );
assert.equal( drink.consumed, false, 'release has not happened yet' );
step( 1 );
assert.equal( drink.consumed, true );
assert.equal( drink.model.visible, false, 'first-person can disappears at release' );
assert.equal( drink.thrown.visible, true, 'empty can now exists in the world' );
step( 8 );
assert.equal( drink.busy, false );
assert.equal( drink.model.visible, false, 'first-person can stays hidden after the throw' );
assert.equal( drink.thrown.visible, true, 'discarded can remains on the ground' );
assert.equal( drink.thrown.settled, true );
assert.equal( drink.available, true, 'unlimited supply is ready after throwing' );
assert.equal( opens, 1 );
assert.equal( bursts, 1 );
drink.cancel();
assert.equal( drink.thrown.visible, true, 'menus do not remove discarded world objects' );

// The next B takes a new sealed can and leaves the first empty on the ground.
const firstEmpty = drink.thrown;
assert.equal( drink.start(), true );
assert.equal( drink.opened, false );
step( 10 );
assert.equal( opens, 2 ); assert.equal( gulps, 8 ); assert.equal( bursts, 2 );
assert.equal( drink.drops.length, 2 );
assert.notEqual( drink.thrown, firstEmpty );
assert.equal( firstEmpty.visible, true );
assert.equal( drink.thrown.visible, true );
assert.equal( drink.drops[ 0 ].model.children[ 0 ].geometry, drink.drops[ 1 ].model.children[ 0 ].geometry, 'world drops share geometry' );

// Unlimited use must not allocate unbounded meshes/textures after a long session.
for ( let i = 0; i < 35; i ++ ) { assert.equal( drink.start(), true ); step( 9 ); }
assert.ok( drink.drops.length <= 32 );
assert.equal( drink.available, true );
assert.equal( opens, 37 );

// Real game input / eligibility integration without constructing the whole island.
const game = Object.create( Game.prototype );
const ui = { panelOpen: false, helpOpen: false, _start: false, _photo: false };
const player = { mode: 'walk', velocity: new Vector3(), grounded: true };
const keys = new Set();
game.app = { player, ui: { ui }, freeCam: false, input: { enabled: true, hit: key => keys.has( key ) } };
game.rod = { equipped: true, state: 'idle', equip( on ) { this.equipped = on; this.state = on ? 'idle' : 'stowed'; } };
game.drink = new ZubrCan( { scene, camera } ); game.toast = () => {};
assert.equal( game.canDrink, true );
for ( const mode of [ 'swim', 'boat' ] ) { player.mode = mode; assert.equal( game.canDrink, false ); }
player.mode = 'deck'; assert.equal( game.canDrink, true );
for ( const key of [ 'panelOpen', 'helpOpen', '_start', '_photo' ] ) {
	ui[ key ] = true; assert.equal( game.canDrink, false, key ); ui[ key ] = false;
}
for ( const key of [ 'invOpen', 'standOpen', 'catchOpen' ] ) { game.hud = { [ key ]: true }; assert.equal( game.canDrink, false, key ); }
game.hud = null;
game.guide = { open: true }; assert.equal( game.canDrink, false ); game.guide.open = false;
game.app.freeCam = true; assert.equal( game.canDrink, false ); game.app.freeCam = false;
for ( const rodState of [ 'windup', 'flying', 'floating', 'fighting', 'retrieving', 'landing' ] ) {
	game.rod.state = rodState; keys.add( 'KeyB' ); game.updateDrink( 0.1 );
	assert.equal( game.drink.busy, false, `do not interrupt ${ rodState }` );
	assert.equal( game.rod.state, rodState ); keys.clear();
}
game.rod.state = 'idle'; keys.add( 'KeyB' ); game.updateDrink( 0.1 ); keys.clear();
assert.equal( game.drink.busy, true ); assert.equal( game.rod.equipped, false );
for ( let i = 0; i < 520; i ++ ) game.updateDrink( 1 / 60 );
assert.equal( game.drink.consumed, true, 'B alone completes open/drink/throw without any clicks' );

// Hidden tabs may not run a frame: lifecycle events must immediately cancel pending cues.
const previousWindow = globalThis.window, previousDocument = globalThis.document;
globalThis.window = new EventTarget(); globalThis.document = new EventTarget();
globalThis.document.hidden = false;
game.bindCanInterruption();
for ( const event of [ 'visibilitychange', 'blur' ] ) {
	game.drink.consumed = false; game.drink.opened = false; game.drink.start();
	for ( let i = 0; i < 80; i ++ ) game.updateDrink( 1 / 60 );
	assert.equal( game.drink.opened, false );
	if ( event === 'visibilitychange' ) {
		globalThis.document.hidden = true;
		globalThis.document.dispatchEvent( new Event( event ) );
		globalThis.document.hidden = false;
		globalThis.document.dispatchEvent( new Event( event ) );
	} else globalThis.window.dispatchEvent( new Event( event ) );
	for ( let i = 0; i < 520; i ++ ) game.updateDrink( 1 / 60 );
	assert.equal( game.drink.opened, false, `${ event } cancels opening without a background frame` );
	assert.equal( game.drink.state, 'stowed' );
	assert.equal( game.drink.consumed, false );
}
if ( previousWindow === undefined ) delete globalThis.window; else globalThis.window = previousWindow;
if ( previousDocument === undefined ) delete globalThis.document; else globalThis.document = previousDocument;
console.log( 'Żubr: one B opens/drinks/throws, world drop settles, unlimited fresh cans, one-shot FX and input/lifecycle guards passed' );
