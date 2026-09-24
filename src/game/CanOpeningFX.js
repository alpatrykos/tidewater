import { BufferAttribute, DynamicDrawUsage, InstancedBufferAttribute, InstancedBufferGeometry, Mesh, Vector3 } from '../engine/index.js';
import { Material } from '../engine/render/Material.js';
import { LAYERS } from '../core/SceneRenderer.js';

const DROPS = 36, COUNT = 48;
const smooth = t => { t = Math.max( 0, Math.min( 1, t ) ); return t * t * ( 3 - 2 * t ); };

// A short pressure release, in metres. The detached spray stays in the world as the hand
// moves away. One persistent draw, no textures / compute buffers / per-frame allocations.
export class CanOpeningFX {

	constructor( { scene, camera } ) {

		this.camera = camera;
		this.liveCount = 0;
		this._elapsed = 0;
		this._seed = 7729;
		this._origin = new Float32Array( COUNT * 3 );
		this._launch = new Float32Array( COUNT * 3 );
		this._life = new Float32Array( COUNT );
		this._radius = new Float32Array( COUNT );
		this._point = new Vector3();
		this._velocity = new Vector3();

		const geometry = new InstancedBufferGeometry();
		geometry.setAttribute( 'position', new BufferAttribute( new Float32Array( [ - 1, - 1, 0, 1, - 1, 0, 1, 1, 0, - 1, 1, 0 ] ), 3 ) );
		geometry.setIndex( [ 0, 1, 2, 0, 2, 3 ] );
		geometry.instanceCount = COUNT;
		const attribute = ( name, size ) => {

			const a = new InstancedBufferAttribute( new Float32Array( COUNT * size ), size ).setUsage( DynamicDrawUsage );
			geometry.setAttribute( name, a );
			return a;

		};
		this._particles = attribute( 'aParticle', 4 ); // world centre, alpha
		this._previous = attribute( 'aPrevious', 3 );
		this._shapes = attribute( 'aShape', 4 ); // radius, mist, life fraction, random phase
		this._velocities = attribute( 'aVelocity', 3 );

		const material = new Material( {
			name: 'canOpeningSpray', lit: false, transparent: true, blending: 'premultiplied',
			depthTest: true, depthWrite: false, side: 'double', receiveShadows: false,
			attributes: { aParticle: 'vec4f', aPrevious: 'vec3f', aShape: 'vec4f', aVelocity: 'vec3f' },
			varyings: { vCanUV: 'vec2f', vCanShape: 'vec4f', vCanLight: 'vec4f' },
			vertex: /* wgsl */`
	let p = v.aParticle.xyz;
	let mist = v.aShape.y > 0.5;
	let t = v.aShape.z;
	let towardEye = frame.cameraPos - p;
	let distance = max( length( towardEye ), 0.001 );
	let eye = towardEye / distance;
	let right = frame.invView[ 0 ].xyz;
	let up = frame.invView[ 1 ].xyz;
	let motion = vec2f( dot( v.aVelocity, right ), dot( v.aVelocity, up ) );
	let speed = length( motion );
	let direction = select( vec2f( 0.0, 1.0 ), motion / max( speed, 0.0001 ), speed > 0.0001 );
	let angle = v.aShape.w * 6.283185 + t * 0.65;
	let yAxis = select( direction, vec2f( sin( angle ), cos( angle ) ), mist );
	let xAxis = vec2f( yAxis.y, - yAxis.x );
	let pixel = distance * 2.0 / max( frame.proj[ 1 ][ 1 ] * frame.resolution.y, 1.0 );
	let radius = max( v.aShape.x, pixel * 0.7 );
	let halfLength = select( radius + min( speed * 0.003, 0.0045 ), radius * 1.35, mist );
	let plane = xAxis * ( v.position.x * radius ) + yAxis * ( v.position.y * halfLength );
	let offset = right * plane.x + up * plane.y;
	v.useWorld = true;
	v.worldPos = p + offset;
	v.prevWorldPos = v.aPrevious + offset;
	v.worldNormal = eye;
	// A real sky/sun response keeps pale vapour from glowing at night. Beer droplets have
	// just a warm edge; pressure gas is transparent and the visible haze is condensed water.
	let forward = pow( max( dot( - eye, frame.sunDir ), 0.0 ), 8.0 );
	let light = frame.skyIrradiance * 0.95 + frame.sunColor * ( 0.12 + forward * 0.35 );
	let tint = select( vec3f( 1.0, 0.91, 0.69 ), vec3f( 0.97, 0.99, 1.0 ), mist );
	let cover = select( min( 1.0, v.aShape.x * v.aShape.x * 3.5 / ( radius * halfLength ) ), 1.0, mist );
	o.vCanUV = v.position.xy;
	o.vCanShape = v.aShape;
	o.vCanLight = vec4f( light * tint, v.aParticle.w * cover );
`,
			output: /* wgsl */`
	let uv = in.vs.vCanUV;
	let q = dot( uv, uv );
	let shape = in.vs.vCanShape;
	let mist = shape.y > 0.5;
	let envelope = max( 0.0, 1.0 - q );
	// Fine droplets have a brighter off-centre reflection and a soft, slender silhouette.
	let drop = max( exp( - 3.5 * q ) - 0.03, 0.0 );
	let highlight = exp( - dot( uv - vec2f( -0.24, 0.27 ), uv - vec2f( -0.24, 0.27 ) ) * 19.0 );
	// Interleaved wisps, with no hard discs or dense smoke puffs.
	let phase = shape.w * 17.0 + shape.z * 1.7;
	let curl = sin( uv.y * 5.0 + sin( uv.x * 3.0 + phase ) * 1.5 + phase );
	let veil = envelope * envelope * ( 0.5 + curl * 0.25 );
	let alpha = in.vs.vCanLight.a * select( drop, veil, mist );
	if ( alpha < 0.001 ) { discard; }
	let wet = select( 0.8 + highlight * 1.2, 1.0, mist );
	r.color = vec4f( in.vs.vCanLight.rgb * wet * alpha, alpha );
`,
		} );
		this.mesh = new Mesh( geometry, material );
		this.mesh.name = 'Can opening droplets and vapour';
		this.mesh.frustumCulled = false;
		this.mesh.visible = false;
		this.mesh.castShadow = false;
		this.mesh.receiveShadow = false;
		this.mesh.renderOrder = 21;
		this.mesh.layers.set( LAYERS.TRANSPARENT );
		scene.add( this.mesh );

	}

	get active() { return this.liveCount > 0; }

	_random() {

		this._seed = ( Math.imul( this._seed, 1664525 ) + 1013904223 ) >>> 0;
		return this._seed / 4294967296;

	}

	// Position is the world-space aperture; quaternion rotates the can's local +Y normal.
	burst( position, quaternion ) {

		this._elapsed = 0;
		const centres = this._particles.array;
		for ( let i = 0; i < COUNT; i ++ ) {

			const mist = i >= DROPS, j = i * 3, k = i * 4;
			const angle = this._random() * Math.PI * 2;
			const spread = Math.sqrt( this._random() );
			this._point.set( Math.cos( angle ) * spread * 0.004, 0.002, Math.sin( angle ) * spread * 0.004 );
			this._point.applyQuaternion( quaternion ).add( position );
			this._velocity.set(
				Math.cos( angle ) * spread * ( mist ? 0.11 : 0.3 ),
				mist ? 0.18 + this._random() * 0.26 : 0.45 + this._random() * 0.7,
				Math.sin( angle ) * spread * ( mist ? 0.11 : 0.3 ),
			).applyQuaternion( quaternion );
			this._origin[ j ] = centres[ k ] = this._point.x;
			this._origin[ j + 1 ] = centres[ k + 1 ] = this._point.y;
			this._origin[ j + 2 ] = centres[ k + 2 ] = this._point.z;
			this._launch[ j ] = this._velocity.x;
			this._launch[ j + 1 ] = this._velocity.y;
			this._launch[ j + 2 ] = this._velocity.z;
			this._life[ i ] = mist ? 0.48 + this._random() * 0.36 : 0.28 + this._random() * 0.4;
			this._radius[ i ] = mist ? 0.007 + this._random() * 0.007 : 0.00055 + this._random() * 0.00085;
			this._shapes.array[ k + 1 ] = mist ? 1 : 0;
			this._shapes.array[ k + 3 ] = this._random();

		}
		this.liveCount = COUNT;
		this.mesh.visible = true;
		this.update( 0 );

	}

	update( dt ) {

		if ( ! this.active ) return;
		this._elapsed += Number.isFinite( dt ) ? Math.max( 0, dt ) : 0;
		const centres = this._particles.array, shapes = this._shapes.array;
		const previous = this._previous.array, velocity = this._velocities.array;
		let live = 0;
		for ( let i = 0; i < COUNT; i ++ ) {

			const j = i * 3, k = i * 4, life = this._life[ i ];
			if ( this._elapsed >= life ) { centres[ k + 3 ] = 0; continue; }
			live ++;
			const mist = i >= DROPS, drag = mist ? 4.8 : 2.6, gravity = mist ? 0.045 : - 6.3;
			const t = this._elapsed, fraction = t / life;
			// Analytic linear drag avoids frame-rate-dependent burst height and conserves the
			// short lifetime even after tab switching or a slow frame.
			const damping = Math.exp( - drag * t ), travel = ( 1 - damping ) / drag;
			previous[ j ] = centres[ k ]; previous[ j + 1 ] = centres[ k + 1 ]; previous[ j + 2 ] = centres[ k + 2 ];
			centres[ k ] = this._origin[ j ] + this._launch[ j ] * travel;
			centres[ k + 1 ] = this._origin[ j + 1 ] + this._launch[ j + 1 ] * travel + gravity * ( t - travel ) / drag;
			centres[ k + 2 ] = this._origin[ j + 2 ] + this._launch[ j + 2 ] * travel;
			centres[ k + 3 ] = ( mist ? 0.25 * smooth( t / 0.025 ) : 0.72 ) * ( 1 - smooth( ( fraction - 0.35 ) / 0.65 ) );
			velocity[ j ] = this._launch[ j ] * damping;
			velocity[ j + 1 ] = this._launch[ j + 1 ] * damping + gravity * travel;
			velocity[ j + 2 ] = this._launch[ j + 2 ] * damping;
			shapes[ k ] = this._radius[ i ] * ( mist ? 0.55 + fraction * 2 : 1 );
			shapes[ k + 2 ] = fraction;

		}
		this.liveCount = live;
		this.mesh.visible = live > 0;
		this._particles.needsUpdate = true;
		this._previous.needsUpdate = true;
		this._shapes.needsUpdate = true;
		this._velocities.needsUpdate = true;

	}

	clear() {

		this.liveCount = 0;
		this.mesh.visible = false;
		this._elapsed = 0;

	}

}
