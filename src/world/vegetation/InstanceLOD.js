import * as THREE from '../../engine/index.js';
import { LOD_BAND } from './VegNodes.js';

// Instance storage + distance LOD for one vegetation type.
//
// Each type has up to two levels:
//   near: InstancedMeshes holding only instances within (range + margin) of the camera,
//         re-filled on the CPU when the camera has moved a few metres (cheap grid query);
//   far:  InstancedMeshes holding all instances (static buffers), or - with farExcludeNear -
//         all instances except those certainly inside the near range (small refill).
// The exact per-instance near/far split happens in the vertex shader (uLodRange vs the
// camera distance of the instance base), so the switch is frame-exact and independent of
// how often the CPU refills. Instances outside their window collapse to a point.

// (three.js: > maxUniformBufferBindingSize / 64 forced a vertex-attribute instance matrix; the
// engine always uses one. Kept so the buffers keep their size.)
const MIN_CAPACITY = 1100;

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _yAxis = new THREE.Vector3( 0, 1, 0 );
const _viewProjection = new THREE.Matrix4();
const _frustum = new THREE.Frustum();

export class VegInstances {

	// records: { x, y, z, s, yaw, la, l, H, seed }
	constructor( records, cellSize = 32 ) {

		const n = records.length;
		this.count = n;
		this.px = new Float32Array( n );
		this.py = new Float32Array( n );
		this.pz = new Float32Array( n );
		this.matrices = new Float32Array( n * 16 );
		this.qr2 = new Float32Array( n ); // per-instance near query radius^2 (0: use the type's)
		this.iPos = new Float32Array( n * 4 );
		this.iDat = new Float32Array( n * 4 );

		for ( let i = 0; i < n; i ++ ) {

			const r = records[ i ];
			this.px[ i ] = r.x;
			this.py[ i ] = r.y;
			this.pz[ i ] = r.z;
			_p.set( r.x, r.y, r.z );
			_q.setFromAxisAngle( _yAxis, r.yaw );
			// optional explicit matrix scale (impostor cards sized per species)
			if ( r.msx !== undefined ) _s.set( r.msx, r.msy, r.msz );
			else _s.set( r.s, r.s * Math.abs( r.sy || 1 ), r.s );
			_m.compose( _p, _q, _s ).toArray( this.matrices, i * 16 );
			this.iPos.set( [ r.x, r.y, r.z, r.s ], i * 4 );
			this.iDat.set( [ r.la || 0, r.l || 0, r.H || 1, r.seed ], i * 4 );
			this.qr2[ i ] = r.qr ? r.qr * r.qr : 0;

		}

		// uniform grid for near queries
		this.cellSize = cellSize;
		const cells = new Map();
		for ( let i = 0; i < n; i ++ ) {

			const k = this._key( Math.floor( this.px[ i ] / cellSize ), Math.floor( this.pz[ i ] / cellSize ) );
			let a = cells.get( k );
			if ( ! a ) cells.set( k, a = [] );
			a.push( i );

		}

		this.cells = new Map();
		for ( const [ k, a ] of cells ) this.cells.set( k, Int32Array.from( a ) );

	}

	_key( i, j ) {

		return ( i + 4096 ) * 8192 + ( j + 4096 );

	}

	// indices of instances with horizontal distance < radius, written to out; returns count
	queryNear( x, z, radius, out ) {

		const cs = this.cellSize;
		const i0 = Math.floor( ( x - radius ) / cs ), i1 = Math.floor( ( x + radius ) / cs );
		const j0 = Math.floor( ( z - radius ) / cs ), j1 = Math.floor( ( z + radius ) / cs );
		const r2 = radius * radius;
		let c = 0;
		for ( let j = j0; j <= j1; j ++ ) {

			for ( let i = i0; i <= i1; i ++ ) {

				const a = this.cells.get( this._key( i, j ) );
				if ( ! a ) continue;
				for ( let k = 0; k < a.length; k ++ ) {

					const id = a[ k ];
					const dx = this.px[ id ] - x, dz = this.pz[ id ] - z;
					const q = this.qr2[ id ] || r2;
					if ( dx * dx + dz * dz < q && c < out.length ) out[ c ++ ] = id;

				}

			}

		}

		return c;

	}

}

// A set of InstancedMeshes (e.g. palm wood + palm leaves) sharing instance buffers.
export class LodLevel {

	constructor( parts, capacity, lodRange ) {

		this.capacity = Math.max( capacity, MIN_CAPACITY );
		const cap = this.capacity;
		this.instanceMatrix = new THREE.InstancedBufferAttribute( new Float32Array( cap * 16 ), 16 );
		// iPos / iDat share one instanced vertex buffer
		this.iBuffer = new THREE.InstancedInterleavedBuffer( new Float32Array( cap * 8 ), 8 );
		this.iPos = new THREE.InterleavedBufferAttribute( this.iBuffer, 4, 0 );
		this.iDat = new THREE.InterleavedBufferAttribute( this.iBuffer, 4, 4 );
		this.lodRange = lodRange.clone();
		this.meshes = [];
		this.count = 0;
		this.trianglesPerInstance = 0;

		for ( const { geometry, material, castShadow = false, name = '' } of parts ) {

			geometry.setAttribute( 'iPos', this.iPos );
			geometry.setAttribute( 'iDat', this.iDat );
			const mesh = new THREE.InstancedMesh( geometry, material, cap );
			mesh.instanceMatrix = this.instanceMatrix;
			mesh.count = 0;
			mesh.name = name;
			mesh.castShadow = castShadow;
			mesh.receiveShadow = true;
			mesh.frustumCulled = false; // instances are spread around the camera
			mesh.userData.lodRange = this.lodRange;
			// per-draw uniform (three's onObjectUpdate uLodRange): draw.params.yzw in WGSL
			mesh.drawParams = [ this.lodRange.x, this.lodRange.y, this.lodRange.z ];
			mesh.matrixAutoUpdate = false;
			mesh.updateMatrix();
			this.meshes.push( mesh );
			this.trianglesPerInstance += ( geometry.index ? geometry.index.count : geometry.attributes.position.count ) / 3;

		}

	}

	setDynamic() {

		this.instanceMatrix.setUsage( THREE.DynamicDrawUsage );
		this.iBuffer.setUsage( THREE.DynamicDrawUsage );

	}

	// copy instances (all, or the given index list) into the GPU buffers. matrices: false skips the
	// instance matrices (materials that place the instance from iPos / iDat alone)
	fill( inst, list = null, n = inst.count, matrices = true ) {

		// Keep the distance-query candidates separate from the visible compacted list. A camera
		// turn can reveal a plant without moving far enough to repeat the distance query.
		this.source = { inst, list, n, matrices };
		this.cullDirty = true;
		this._upload( inst, list, n, matrices );

	}

	_upload( inst, list, n, matrices ) {

		n = Math.min( n, this.capacity );
		const M = this.instanceMatrix.array, B = this.iBuffer.array;
		const im = inst.matrices, ip = inst.iPos, id = inst.iDat;
		for ( let k = 0; k < n; k ++ ) {

			const i = list === null ? k : list[ k ];
			if ( matrices ) {

				const o16 = i * 16, d16 = k * 16;
				for ( let e = 0; e < 16; e ++ ) M[ d16 + e ] = im[ o16 + e ];

			}

			const o4 = i * 4, d8 = k * 8;
			B[ d8 ] = ip[ o4 ]; B[ d8 + 1 ] = ip[ o4 + 1 ]; B[ d8 + 2 ] = ip[ o4 + 2 ]; B[ d8 + 3 ] = ip[ o4 + 3 ];
			B[ d8 + 4 ] = id[ o4 ]; B[ d8 + 5 ] = id[ o4 + 1 ]; B[ d8 + 6 ] = id[ o4 + 2 ]; B[ d8 + 7 ] = id[ o4 + 3 ];

		}

		if ( matrices ) {

			this.instanceMatrix.clearUpdateRanges();
			this.instanceMatrix.addUpdateRange( 0, n * 16 );
			this.instanceMatrix.needsUpdate = true;

		}

		this.iBuffer.clearUpdateRanges();
		this.iBuffer.addUpdateRange( 0, n * 8 );
		this.iBuffer.needsUpdate = true;

		this.count = n;
		for ( const m of this.meshes ) m.count = n;

	}

	// One immutable selection for all passes in this frame. Never compact a shadow-casting
	// level against the main camera: a tree outside the picture may still shade visible ground.
	cull( frustum, radius, windRadius ) {

		if ( ! this.source || this.meshes.some( ( m ) => m.castShadow ) ) {

			this.cullDirty = false;
			return;

		}
		const { inst, list, n, matrices } = this.source;
		const ids = this.visibleIds || ( this.visibleIds = new Int32Array( inst.count ) );
		const { px, py, pz } = inst;
		let count = 0, changed = this.cullDirty;
		for ( let k = 0; k < n; k ++ ) {

			const i = list === null ? k : list[ k ];
			const r = radius[ i ] + windRadius * Math.abs( inst.iDat[ i * 4 + 2 ] );
			let visible = true;
			for ( const p of frustum.planes ) {

				if ( p.normal.x * px[ i ] + p.normal.y * py[ i ] + p.normal.z * pz[ i ] + p.constant < - r ) {

					visible = false;
					break;

				}

			}

			if ( visible ) {

				if ( ids[ count ] !== i ) changed = true;
				ids[ count ++ ] = i;

			}

		}

		if ( changed || this.count !== Math.min( count, this.capacity ) ) this._upload( inst, ids, count, matrices );
		this.cullDirty = false;

	}

	get triangles() {

		return this.count * this.trianglesPerInstance;

	}

}

// One vegetation type: instances + near (dynamic) and optional far (static) levels.
export class VegType {

	// sortFar: keep the far level roughly front to back (distance buckets, re-sorted after the
	// camera moved farRefresh metres; alpha-tested impostors then get rejected by the early depth
	// test behind nearer ones). Implies a far material that ignores the instance matrices.
	constructor( name, records, { near = null, far = null, nearRange = 100, fade = null, margin = 14, refreshDistance = 6, farExcludeNear = false, farDistanceLimit = Infinity, sortNear = false, sortFar = false, farRefresh = 16, cull = false } = {} ) {

		this.name = name;
		this.sortNear = sortNear;
		this.sortFar = sortFar && !! far && ! farExcludeNear && ! Number.isFinite( farDistanceLimit );
		this.farDistanceLimit = farDistanceLimit;
		this.farRefresh = farRefresh;
		this.farX = Infinity;
		this.farZ = Infinity;
		this.inst = new VegInstances( records );
		this.nearRange = nearRange;
		this.margin = margin;
		this.refreshDistance = refreshDistance;
		this.lastX = Infinity;
		this.lastY = Infinity;
		this.lastZ = Infinity;
		this.levels = [];
		this.cullEnabled = cull && [ near, far?.parts ].some( ( parts ) => parts?.length && parts.every( ( p ) => ! p.castShadow ) );
		if ( this.cullEnabled ) {

			// A base-centred sphere, deliberately wider than the undeformed plant. Plant crowns
			// rotate without changing length; palms additionally translate by their height and
			// lean. Three source radii cover canopy lobe variation and the enlarged, camera-facing
			// far crowns (up to sqrt(2) scale). The 2m guard also covers view jitter and leaf edges.
			let extent = 0;
			for ( const part of [ ...( near || [] ), ...( far?.parts || [] ) ] ) {

				const p = part.geometry.attributes.position;
				for ( let i = 0; i < p.count; i ++ ) extent = Math.max( extent, Math.hypot( p.getX( i ), p.getY( i ), p.getZ( i ) ) );

			}

			this.cullRadius = Float32Array.from( records, ( r ) => {

				const scale = r.msx !== undefined ? Math.max( Math.abs( r.msx ), Math.abs( r.msy ), Math.abs( r.msz ) ) : Math.abs( r.s ) * Math.max( 1, Math.abs( r.sy || 1 ) );
				return 3 * extent * scale + Math.abs( r.H || 1 ) * ( 1 + Math.abs( r.l || 0 ) ) + 2;

			} );
			this._cullView = new THREE.Matrix4();
			this._cullViewValid = false;

		}

		// fade = [start, end] for types without a far level (shrink out)
		const nearWindow = far ? new THREE.Vector3( 0, nearRange, nearRange + 0.01 ) : new THREE.Vector3( 0, fade[ 0 ], fade[ 1 ] );
		// Hard handovers retain near geometry through the outer half of the dither band.
		// Include that band plus all movement allowed by the deferred-refill scheduler.
		this.queryRadius = ( far ? nearRange * ( 1 + LOD_BAND / 2 ) : fade[ 1 ] ) + margin;

		if ( near ) {

			// capacity estimate: density near the densest point is unknown, so size for the
			// worst case the query can return (bounded by the instance count)
			this.nearIds = new Int32Array( Math.max( 1, this.inst.count ) );
			this.near = new LodLevel( near, Math.min( this.inst.count, 6000 ), nearWindow );
			this.near.setDynamic();
			this.levels.push( this.near );

		}

		if ( far ) {

			this.far = new LodLevel( far.parts, this.inst.count, new THREE.Vector3( nearRange, far.fade[ 0 ], far.fade[ 1 ] ) );
			this.far.fill( this.inst );
			this.levels.push( this.far );
			if ( this.sortFar ) {

				this.far.setDynamic();
				this.farIds = new Int32Array( Math.max( 1, this.inst.count ) );

			}
			// optionally keep instances that are certainly near out of the far buffer
			// (saves their collapsed triangles); must include anything that can cross
			// nearRange before the next refresh
			this.farExcludeNear = farExcludeNear;
			if ( farExcludeNear || Number.isFinite( farDistanceLimit ) ) {

				this.far.setDynamic();
				this.farIds = new Int32Array( Math.max( 1, this.inst.count ) );

			}

		}

	}

	get meshes() {

		return this.levels.flatMap( ( l ) => l.meshes );

	}

	// Mobile opt-in: call after distance refills, once per frame before any render passes.
	// The shared buffer stays unchanged throughout the frame, including refraction. Desktop
	// reflections retain the original uncropped lists by leaving cull disabled.
	cull( camera, windSpeed = 25 ) {

		if ( ! this.cullEnabled ) return;
		camera.updateMatrixWorld();
		_viewProjection.multiplyMatrices( camera.projectionMatrix, camera.matrixWorldInverse );
		const wind = Math.max( Math.abs( windSpeed ) * 0.1, 0.03 );
		const windRadius = 0.04 * wind * wind + 0.04 * wind;
		const view = this._cullView.elements, next = _viewProjection.elements;
		let changed = ! this._cullViewValid || windRadius !== this._cullWind;
		for ( let i = 0; i < 16; i ++ ) if ( next[ i ] !== view[ i ] ) changed = true;
		if ( ! changed && ! this.levels.some( ( level ) => level.cullDirty ) ) return;
		this._cullView.copy( _viewProjection );
		this._cullViewValid = true;
		this._cullWind = windRadius;
		_frustum.setFromProjectionMatrix( _viewProjection, camera.coordinateSystem, camera.reversedDepth !== false );
		for ( const level of this.levels ) level.cull( _frustum, this.cullRadius, windRadius );

	}

	// how far (3D) past its refresh distance the camera has moved (> 0: needs a refill)
	overdue( camPos ) {

		if ( ! this.near ) return - 1;
		const dx = camPos.x - this.lastX, dy = camPos.y - this.lastY, dz = camPos.z - this.lastZ;
		const d2 = dx * dx + dy * dy + dz * dz;
		const d = Number.isFinite( d2 ) ? Math.sqrt( d2 ) - this.refreshDistance : 1e9;
		if ( ! this.sortFar ) return d;
		const fd = Math.hypot( camPos.x - this.farX, camPos.z - this.farZ );
		return Math.max( d, Number.isFinite( fd ) ? fd - this.farRefresh : 1e9 );

	}

	// far level front to back: counting sort into 6 m distance buckets
	_sortFar( camPos ) {

		this.farX = camPos.x;
		this.farZ = camPos.z;
		const { px, pz, count } = this.inst;
		const B = 6, NB = 1024;
		const bucket = this._bucket || ( this._bucket = new Uint16Array( count ) );
		const start = this._bstart || ( this._bstart = new Int32Array( NB + 1 ) );
		start.fill( 0 );
		for ( let i = 0; i < count; i ++ ) {

			const b = Math.min( NB - 1, Math.floor( Math.hypot( px[ i ] - camPos.x, pz[ i ] - camPos.z ) / B ) );
			bucket[ i ] = b;
			start[ b + 1 ] ++;

		}

		for ( let b = 0; b < NB; b ++ ) start[ b + 1 ] += start[ b ];
		for ( let i = 0; i < count; i ++ ) this.farIds[ start[ bucket[ i ] ] ++ ] = i;
		this.far.fill( this.inst, this.farIds, count, false );

	}

	// returns true when the near buffers were rebuilt
	update( camPos, force = false ) {

		if ( ! this.near ) return false;
		if ( ! force && this.overdue( camPos ) < 0 ) return false;
		if ( this.sortFar && ! ( Math.hypot( camPos.x - this.farX, camPos.z - this.farZ ) < this.farRefresh ) ) this._sortFar( camPos );
		this.lastX = camPos.x;
		this.lastY = camPos.y;
		this.lastZ = camPos.z;
		// vertical distance only makes instances *further* away, so a horizontal query is conservative
		const n = this.inst.queryNear( camPos.x, camPos.z, this.queryRadius, this.nearIds );
		if ( this.sortNear ) {

			// front to back: alpha-tested foliage can still be rejected by the early depth test
			const { px, pz } = this.inst;
			const ids = this.nearIds.subarray( 0, n );
			const key = this._sortKey || ( this._sortKey = new Float32Array( this.nearIds.length ) );
			for ( let k = 0; k < n; k ++ ) {

				const i = ids[ k ];
				key[ i ] = ( px[ i ] - camPos.x ) ** 2 + ( pz[ i ] - camPos.z ) ** 2;

			}

			ids.sort( ( a, b ) => key[ a ] - key[ b ] );

		}

		this.near.fill( this.inst, this.nearIds, n );

		if ( this.far && ( this.farExcludeNear || Number.isFinite( this.farDistanceLimit ) ) ) {

			// drop only instances that stay inside the near range (3D, like the shader test)
			// until the next refill. The scheduler can defer a type beyond refreshDistance,
			// up to its movement margin, so both LODs must cover that entire allowance.
			const movement = Math.max( this.refreshDistance, this.margin );
			const rMin = this.farExcludeNear ? Math.max( 0, this.nearRange * ( 1 - LOD_BAND / 2 ) - movement - 2 ) : 0;
			const r2 = rMin * rMin;
			// Medium geometry also stops after its final fade. Use its own radius, rather than
			// queryNear's per-record radius which may only cover the detailed near mesh.
			const rMax2 = ( this.farDistanceLimit + this.margin ) ** 2;
			const { px, py, pz } = this.inst;
			let c = 0;
			for ( let i = 0; i < this.inst.count; i ++ ) {

				const dx = px[ i ] - camPos.x, dy = py[ i ] - camPos.y, dz = pz[ i ] - camPos.z;
				const d2 = dx * dx + dy * dy + dz * dz;
				if ( d2 >= r2 && d2 <= rMax2 ) this.farIds[ c ++ ] = i;

			}

			this.far.fill( this.inst, this.farIds, c );

		}

		return true;

	}

}
