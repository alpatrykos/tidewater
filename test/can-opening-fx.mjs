import assert from 'node:assert/strict';
import { Scene, PerspectiveCamera, Vector3, Quaternion } from '../src/engine/index.js';
import { CanOpeningFX } from '../src/game/CanOpeningFX.js';

const scene = new Scene();
const camera = new PerspectiveCamera();
const fx = new CanOpeningFX( { scene, camera } );
const origin = new Vector3( 0.13, 1.5, - 0.35 );
const rotation = new Quaternion();

// Merely equipping or updating the can must never leak opening particles.
for ( let i = 0; i < 60; i ++ ) fx.update( 1 / 60 );
assert.equal( fx.active, false );
assert.equal( fx.liveCount, 0 );
assert.ok( scene.children.every( mesh => ! mesh.visible ), 'idle effects incur no visible draw' );

// The opening cue creates a bounded burst that disappears in under a second.
fx.burst( origin, rotation );
assert.equal( fx.active, true );
assert.ok( fx.liveCount > 0 && fx.liveCount <= 64 );
assert.ok( scene.children.some( mesh => mesh.visible ) );
fx.update( 0.2 );
assert.equal( fx.active, true, 'opening spray survives more than one frame' );
const childCount = scene.children.length;
for ( let i = 0; i < 60; i ++ ) fx.update( 1 / 60 );
assert.equal( fx.active, false );
assert.equal( fx.liveCount, 0 );
assert.ok( scene.children.every( mesh => ! mesh.visible ) );

// Cancelling / changing player mode immediately removes residual spray.
fx.burst( origin, rotation );
fx.update( 0.05 );
fx.clear();
assert.equal( fx.active, false );
assert.equal( fx.liveCount, 0 );
assert.ok( scene.children.every( mesh => ! mesh.visible ) );
fx.update( 0.1 );
assert.equal( fx.active, false, 'clear cannot restart a pending burst' );

// The pool is reusable; a long frame must expire particles, not extend their life.
fx.burst( origin, rotation );
assert.equal( fx.active, true );
assert.equal( scene.children.length, childCount, 'bursts reuse existing scene objects' );
fx.update( 10 );
assert.equal( fx.active, false );
assert.equal( fx.liveCount, 0 );
assert.ok( scene.children.every( mesh => ! mesh.visible ) );
console.log( 'Can opening FX: explicit emission, bounded lifetime, cancellation and pool reuse passed' );
