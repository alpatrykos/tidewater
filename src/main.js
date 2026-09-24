import { TouchControls } from './ui/TouchControls.js';
import { App } from './App.js';
import { UI } from './ui/UI.js';
import { AppUI } from './ui/AppUI.js';

const ui = new UI();
const app = new App();
window.__ui = ui;

app.init( ( p, text, until ) => ui.setLoading( p, text, until ) ).then( async () => {

	app.ui = new AppUI( app, ui );
	if ( app.qs.get( 'touch' ) !== '0' && ( app.qs.has( 'touch' ) || matchMedia( '(pointer: coarse)' ).matches ) ) app.touchControls = new TouchControls( app, ui );
	ui.setLoading( 1, 'Ready' );
	await ui.hideLoader();
	app.start();
	ui.showStartOverlay( () => {

		if ( app.touchControls ) app.touchControls.started = true;
		app.input.requestLock();
		if ( app.audio ) app.audio.resume();

	} );

} ).catch( ( e ) => {

	console.error( e );
	ui.setLoadingError( 'Something went wrong: ' + e.message );

} );
