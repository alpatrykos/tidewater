import assert from 'node:assert/strict';
import { Scene, PerspectiveCamera } from '../src/engine/index.js';
import { ZubrCan } from '../src/game/ZubrCan.js';
import { Game } from '../src/game/Game.js';

// A repeated press must not restart a sip or replay its opening sound.
const scene = new Scene(), camera = new PerspectiveCamera();
let opens = 0, sips = 0;
const drink = new ZubrCan( { scene, camera, audio: {
	canOpen() { opens ++; }, drinkSip() { sips ++; },
} } );
assert.equal( drink.start(), true );
assert.equal( drink.start(), false );
for ( let i = 0; i < 45; i ++ ) drink.update( 0.1 );
assert.equal( drink.active, false );
assert.equal( drink.model.visible, false );
assert.equal( opens, 1 );
assert.equal( sips, 1 );
drink.start();
for ( let i = 0; i < 45; i ++ ) drink.update( 0.1 );
assert.equal( opens, 1, 'the same open can is not opened again' );
assert.equal( sips, 2 );

// The can must remain visible when the viewport narrows to a portrait phone.
camera.aspect = 390 / 844;
camera.updateProjectionMatrix();
drink.start();
drink.update( 0.8 );
drink.model.updateWorldMatrix( true, true );
const { Vector3 } = await import( '../src/engine/index.js' );
for ( const p of [ new Vector3( - 0.033, 0.083, 0 ), new Vector3( 0.033, - 0.083, 0 ) ] ) {
	const screen = p.applyMatrix4( drink.model.matrixWorld ).project( camera );
	assert.ok( Math.abs( screen.x ) < 1 && Math.abs( screen.y ) < 1, 'can fits portrait frustum' );
}
drink.cancel();

// Mode changes and overlays must abort before a pending gulp can fire.
drink.start();
drink.update( 0.2 );
drink.update( 0.1, false );
for ( let i = 0; i < 45; i ++ ) drink.update( 0.1 );
assert.equal( drink.active, false );
assert.equal( drink.model.visible, false );
assert.equal( sips, 2 );

// Exercise the game's real eligibility and input integration without building the island.
const game = Object.create( Game.prototype );
const ui = { panelOpen: false, helpOpen: false, _start: false, _photo: false };
const player = { mode: 'walk' };
let pressed = false;
game.app = { player, ui: { ui }, freeCam: false, input: { enabled: true, hit: key => pressed && key === 'KeyB' } };
game.rod = { equipped: true, state: 'idle', lineInWater: false, equip( on ) { this.equipped = on; this.state = on ? 'idle' : 'stowed'; } };
game.drink = drink;
game.toast = () => {};
assert.equal( game.canDrink, true );
for ( const mode of [ 'swim', 'boat' ] ) {
	player.mode = mode;
	assert.equal( game.canDrink, false, mode );
}
player.mode = 'deck';
assert.equal( game.canDrink, true );
for ( const key of [ 'panelOpen', 'helpOpen', '_start', '_photo' ] ) {
	ui[ key ] = true;
	assert.equal( game.canDrink, false, key );
	ui[ key ] = false;
}
for ( const key of [ 'invOpen', 'standOpen', 'catchOpen' ] ) {
	game.hud = { [ key ]: true };
	assert.equal( game.canDrink, false, key );
}
game.hud = null;
game.guide = { open: true };
assert.equal( game.canDrink, false );
game.guide.open = false;
game.app.freeCam = true;
assert.equal( game.canDrink, false );
game.app.freeCam = false;
for ( const state of [ 'windup', 'flying', 'floating', 'fighting', 'retrieving', 'landing' ] ) {
	game.rod.state = state;
	pressed = true;
	game.updateDrink( 0.1 );
	assert.equal( drink.active, false, `do not interrupt ${ state }` );
	assert.equal( game.rod.state, state );
}
game.rod.state = 'idle';
game.updateDrink( 0.1 );
assert.equal( drink.active, true );
assert.equal( game.rod.equipped, false, 'the idle rod is put away before drinking' );
ui.panelOpen = true;
game.updateDrink( 0.1 );
assert.equal( drink.active, false, 'opening a menu cancels the sip' );
assert.equal( drink.model.visible, false );
console.log( 'Żubr drinking: repeat presses, audio timing, cancellation and interaction guards passed' );
