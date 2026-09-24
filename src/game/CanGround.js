import { Quaternion, Vector3 } from '../engine/index.js';

// Heightfield for loose cans: static walkable surfaces plus the boat's local deck.
// BoatController exposes toWorld(), position and quaternion; invert the latter
// explicitly to intersect a world-vertical ray with its pitched/rolled floors.
export function createCanGround( player, boat ) {

	const inverse = new Quaternion();
	const origin = new Vector3(), local = new Vector3(), up = new Vector3();
	const deckHeightAt = ( x, z, maxY ) => {

		if ( ! boat?.model?.lines ) return - Infinity;
		const ceiling = Number.isFinite( maxY ) ? maxY : boat.position.y + 10;
		inverse.copy( boat.quaternion ).invert();
		origin.set( x, ceiling, z ).sub( boat.position ).applyQuaternion( inverse );
		up.set( 0, 1, 0 ).applyQuaternion( inverse );
		if ( up.y < 0.2 ) return - Infinity;
		const lines = boat.model.lines;
		let highest = - Infinity;
		let distance = ( origin.y - lines.deckY ) / up.y;
		local.copy( origin ).addScaledVector( up, - distance );
		if ( distance >= - 1e-7 && local.z >= lines.zAft + lines.shell && local.z <= lines.zBow - lines.shell ) {

			const width = lines.halfBreadth( lines.tAtSheerZ( local.z ), lines.deckY ) - lines.shell;
			if ( width > 0 && Math.abs( local.x ) <= width ) highest = ceiling - distance;

		}
		// Intersect each actual plane first, then test the hit point against its box.
		// The ray's local X/Z varies with height on a tilted boat, so probing a column
		// from the ceiling can miss raised equipment near a corner. These are the
		// same walkable collider tops consumed by Player.deckGroundAt().
		for ( const box of boat.model.colliders || [] ) {

			if ( ! box.walkable ) continue;
			const top = box.center.y + box.half.y;
			distance = ( origin.y - top ) / up.y;
			if ( ! Number.isFinite( distance ) || distance < - 1e-7 ) continue;
			local.copy( origin ).addScaledVector( up, - distance );
			if ( Math.abs( local.x - box.center.x ) > box.half.x + 1e-7 || Math.abs( local.z - box.center.z ) > box.half.z + 1e-7 ) continue;
			highest = Math.max( highest, ceiling - distance );

		}
		return highest;

	};
	return {

		heightAt( x, z, maxY = Infinity ) {

			return Math.max( player.groundAt( x, z, maxY ), deckHeightAt( x, z, maxY ) );

		},
		carrierAt( x, z, maxY = Infinity ) {

			const deck = deckHeightAt( x, z, maxY );
			return Number.isFinite( deck ) && deck >= player.groundAt( x, z, maxY ) - 0.0001 ? boat : null;

		},

	};

}
