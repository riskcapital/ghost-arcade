import{eN as De,bO as ue,aN as re,ac as j,gp as Be,dV as le,bf as Ae,B as x,A as ae,hg as Z,hh as Ce,V as G,hi as J,M as H,af as W,f3 as Ue,bm as Ie,b0 as Ge,hj as Re,W as He,R as ke,C as fe,S as Oe,J as C,O as Ve,ad as pe,P as We,fM as ge,fN as me,cj as A,bH as ye,G as q,fL as Ne,fz as ve,bg as te,bw as Y,bn as je,fs as qe,e2 as ie,aP as Se,f2 as we}from"./main-4BlCn4xa.js";const xe=new le,X=new x;class _e extends De{constructor(){super(),this.isLineSegmentsGeometry=!0,this.type="LineSegmentsGeometry";const e=[-1,2,0,1,2,0,-1,1,0,1,1,0,-1,0,0,1,0,0,-1,-1,0,1,-1,0],t=[-1,2,1,2,-1,1,1,1,-1,-1,1,-1,-1,-2,1,-2],i=[0,2,1,2,3,1,2,4,3,4,5,3,4,6,5,6,7,5];this.setIndex(i),this.setAttribute("position",new ue(e,3)),this.setAttribute("uv",new ue(t,2))}applyMatrix4(e){const t=this.attributes.instanceStart,i=this.attributes.instanceEnd;return t!==void 0&&(t.applyMatrix4(e),i.applyMatrix4(e),t.needsUpdate=!0),this.boundingBox!==null&&this.computeBoundingBox(),this.boundingSphere!==null&&this.computeBoundingSphere(),this}setPositions(e){let t;e instanceof Float32Array?t=e:Array.isArray(e)&&(t=new Float32Array(e));const i=new re(t,6,1);return this.setAttribute("instanceStart",new j(i,3,0)),this.setAttribute("instanceEnd",new j(i,3,3)),this.instanceCount=this.attributes.instanceStart.count,this.computeBoundingBox(),this.computeBoundingSphere(),this}setColors(e){let t;e instanceof Float32Array?t=e:Array.isArray(e)&&(t=new Float32Array(e));const i=new re(t,6,1);return this.setAttribute("instanceColorStart",new j(i,3,0)),this.setAttribute("instanceColorEnd",new j(i,3,3)),this}fromWireframeGeometry(e){return this.setPositions(e.attributes.position.array),this}fromEdgesGeometry(e){return this.setPositions(e.attributes.position.array),this}fromMesh(e){return this.fromWireframeGeometry(new Be(e.geometry)),this}fromLineSegments(e){const t=e.geometry;return this.setPositions(t.attributes.position.array),this}computeBoundingBox(){this.boundingBox===null&&(this.boundingBox=new le);const e=this.attributes.instanceStart,t=this.attributes.instanceEnd;e!==void 0&&t!==void 0&&(this.boundingBox.setFromBufferAttribute(e),xe.setFromBufferAttribute(t),this.boundingBox.union(xe))}computeBoundingSphere(){this.boundingSphere===null&&(this.boundingSphere=new Ae),this.boundingBox===null&&this.computeBoundingBox();const e=this.attributes.instanceStart,t=this.attributes.instanceEnd;if(e!==void 0&&t!==void 0){const i=this.boundingSphere.center;this.boundingBox.getCenter(i);let n=0;for(let l=0,c=e.count;l<c;l++)X.fromBufferAttribute(e,l),n=Math.max(n,i.distanceToSquared(X)),X.fromBufferAttribute(t,l),n=Math.max(n,i.distanceToSquared(X));this.boundingSphere.radius=Math.sqrt(n),isNaN(this.boundingSphere.radius)&&console.error("THREE.LineSegmentsGeometry.computeBoundingSphere(): Computed radius is NaN. The instanced position data is likely to have NaN values.",this)}}toJSON(){}}J.line={worldUnits:{value:1},linewidth:{value:1},resolution:{value:new G(1,1)},dashOffset:{value:0},dashScale:{value:1},dashSize:{value:1},gapSize:{value:1}};Z.line={uniforms:Ce.merge([J.common,J.fog,J.line]),vertexShader:`
		#include <common>
		#include <color_pars_vertex>
		#include <fog_pars_vertex>
		#include <logdepthbuf_pars_vertex>
		#include <clipping_planes_pars_vertex>

		uniform float linewidth;
		uniform vec2 resolution;

		attribute vec3 instanceStart;
		attribute vec3 instanceEnd;

		attribute vec3 instanceColorStart;
		attribute vec3 instanceColorEnd;

		#ifdef WORLD_UNITS

			varying vec4 worldPos;
			varying vec3 worldStart;
			varying vec3 worldEnd;

			#ifdef USE_DASH

				varying vec2 vUv;

			#endif

		#else

			varying vec2 vUv;

		#endif

		#ifdef USE_DASH

			uniform float dashScale;
			attribute float instanceDistanceStart;
			attribute float instanceDistanceEnd;
			varying float vLineDistance;

		#endif

		void trimSegment( const in vec4 start, inout vec4 end ) {

			// trim end segment so it terminates between the camera plane and the near plane

			// conservative estimate of the near plane
			float a = projectionMatrix[ 2 ][ 2 ]; // 3nd entry in 3th column
			float b = projectionMatrix[ 3 ][ 2 ]; // 3nd entry in 4th column
			float nearEstimate = - 0.5 * b / a;

			float alpha = ( nearEstimate - start.z ) / ( end.z - start.z );

			end.xyz = mix( start.xyz, end.xyz, alpha );

		}

		void main() {

			#ifdef USE_COLOR

				vColor.xyz = ( position.y < 0.5 ) ? instanceColorStart : instanceColorEnd;

			#endif

			#ifdef USE_DASH

				vLineDistance = ( position.y < 0.5 ) ? dashScale * instanceDistanceStart : dashScale * instanceDistanceEnd;
				vUv = uv;

			#endif

			float aspect = resolution.x / resolution.y;

			// camera space
			vec4 start = modelViewMatrix * vec4( instanceStart, 1.0 );
			vec4 end = modelViewMatrix * vec4( instanceEnd, 1.0 );

			#ifdef WORLD_UNITS

				worldStart = start.xyz;
				worldEnd = end.xyz;

			#else

				vUv = uv;

			#endif

			// special case for perspective projection, and segments that terminate either in, or behind, the camera plane
			// clearly the gpu firmware has a way of addressing this issue when projecting into ndc space
			// but we need to perform ndc-space calculations in the shader, so we must address this issue directly
			// perhaps there is a more elegant solution -- WestLangley

			bool perspective = ( projectionMatrix[ 2 ][ 3 ] == - 1.0 ); // 4th entry in the 3rd column

			if ( perspective ) {

				if ( start.z < 0.0 && end.z >= 0.0 ) {

					trimSegment( start, end );

				} else if ( end.z < 0.0 && start.z >= 0.0 ) {

					trimSegment( end, start );

				}

			}

			// clip space
			vec4 clipStart = projectionMatrix * start;
			vec4 clipEnd = projectionMatrix * end;

			// ndc space
			vec3 ndcStart = clipStart.xyz / clipStart.w;
			vec3 ndcEnd = clipEnd.xyz / clipEnd.w;

			// direction
			vec2 dir = ndcEnd.xy - ndcStart.xy;

			// account for clip-space aspect ratio
			dir.x *= aspect;
			dir = normalize( dir );

			#ifdef WORLD_UNITS

				vec3 worldDir = normalize( end.xyz - start.xyz );
				vec3 tmpFwd = normalize( mix( start.xyz, end.xyz, 0.5 ) );
				vec3 worldUp = normalize( cross( worldDir, tmpFwd ) );
				vec3 worldFwd = cross( worldDir, worldUp );
				worldPos = position.y < 0.5 ? start: end;

				// height offset
				float hw = linewidth * 0.5;
				worldPos.xyz += position.x < 0.0 ? hw * worldUp : - hw * worldUp;

				// don't extend the line if we're rendering dashes because we
				// won't be rendering the endcaps
				#ifndef USE_DASH

					// cap extension
					worldPos.xyz += position.y < 0.5 ? - hw * worldDir : hw * worldDir;

					// add width to the box
					worldPos.xyz += worldFwd * hw;

					// endcaps
					if ( position.y > 1.0 || position.y < 0.0 ) {

						worldPos.xyz -= worldFwd * 2.0 * hw;

					}

				#endif

				// project the worldpos
				vec4 clip = projectionMatrix * worldPos;

				// shift the depth of the projected points so the line
				// segments overlap neatly
				vec3 clipPose = ( position.y < 0.5 ) ? ndcStart : ndcEnd;
				clip.z = clipPose.z * clip.w;

			#else

				vec2 offset = vec2( dir.y, - dir.x );
				// undo aspect ratio adjustment
				dir.x /= aspect;
				offset.x /= aspect;

				// sign flip
				if ( position.x < 0.0 ) offset *= - 1.0;

				// endcaps
				if ( position.y < 0.0 ) {

					offset += - dir;

				} else if ( position.y > 1.0 ) {

					offset += dir;

				}

				// adjust for linewidth
				offset *= linewidth;

				// adjust for clip-space to screen-space conversion // maybe resolution should be based on viewport ...
				offset /= resolution.y;

				// select end
				vec4 clip = ( position.y < 0.5 ) ? clipStart : clipEnd;

				// back to clip space
				offset *= clip.w;

				clip.xy += offset;

			#endif

			gl_Position = clip;

			vec4 mvPosition = ( position.y < 0.5 ) ? start : end; // this is an approximation

			#include <logdepthbuf_vertex>
			#include <clipping_planes_vertex>
			#include <fog_vertex>

		}
		`,fragmentShader:`
		uniform vec3 diffuse;
		uniform float opacity;
		uniform float linewidth;

		#ifdef USE_DASH

			uniform float dashOffset;
			uniform float dashSize;
			uniform float gapSize;

		#endif

		varying float vLineDistance;

		#ifdef WORLD_UNITS

			varying vec4 worldPos;
			varying vec3 worldStart;
			varying vec3 worldEnd;

			#ifdef USE_DASH

				varying vec2 vUv;

			#endif

		#else

			varying vec2 vUv;

		#endif

		#include <common>
		#include <color_pars_fragment>
		#include <fog_pars_fragment>
		#include <logdepthbuf_pars_fragment>
		#include <clipping_planes_pars_fragment>

		vec2 closestLineToLine(vec3 p1, vec3 p2, vec3 p3, vec3 p4) {

			float mua;
			float mub;

			vec3 p13 = p1 - p3;
			vec3 p43 = p4 - p3;

			vec3 p21 = p2 - p1;

			float d1343 = dot( p13, p43 );
			float d4321 = dot( p43, p21 );
			float d1321 = dot( p13, p21 );
			float d4343 = dot( p43, p43 );
			float d2121 = dot( p21, p21 );

			float denom = d2121 * d4343 - d4321 * d4321;

			float numer = d1343 * d4321 - d1321 * d4343;

			mua = numer / denom;
			mua = clamp( mua, 0.0, 1.0 );
			mub = ( d1343 + d4321 * ( mua ) ) / d4343;
			mub = clamp( mub, 0.0, 1.0 );

			return vec2( mua, mub );

		}

		void main() {

			float alpha = opacity;
			vec4 diffuseColor = vec4( diffuse, alpha );

			#include <clipping_planes_fragment>

			#ifdef USE_DASH

				if ( vUv.y < - 1.0 || vUv.y > 1.0 ) discard; // discard endcaps

				if ( mod( vLineDistance + dashOffset, dashSize + gapSize ) > dashSize ) discard; // todo - FIX

			#endif

			#ifdef WORLD_UNITS

				// Find the closest points on the view ray and the line segment
				vec3 rayEnd = normalize( worldPos.xyz ) * 1e5;
				vec3 lineDir = worldEnd - worldStart;
				vec2 params = closestLineToLine( worldStart, worldEnd, vec3( 0.0, 0.0, 0.0 ), rayEnd );

				vec3 p1 = worldStart + lineDir * params.x;
				vec3 p2 = rayEnd * params.y;
				vec3 delta = p1 - p2;
				float len = length( delta );
				float norm = len / linewidth;

				#ifndef USE_DASH

					#ifdef USE_ALPHA_TO_COVERAGE

						float dnorm = fwidth( norm );
						alpha = 1.0 - smoothstep( 0.5 - dnorm, 0.5 + dnorm, norm );

					#else

						if ( norm > 0.5 ) {

							discard;

						}

					#endif

				#endif

			#else

				#ifdef USE_ALPHA_TO_COVERAGE

					// artifacts appear on some hardware if a derivative is taken within a conditional
					float a = vUv.x;
					float b = ( vUv.y > 0.0 ) ? vUv.y - 1.0 : vUv.y + 1.0;
					float len2 = a * a + b * b;
					float dlen = fwidth( len2 );

					if ( abs( vUv.y ) > 1.0 ) {

						alpha = 1.0 - smoothstep( 1.0 - dlen, 1.0 + dlen, len2 );

					}

				#else

					if ( abs( vUv.y ) > 1.0 ) {

						float a = vUv.x;
						float b = ( vUv.y > 0.0 ) ? vUv.y - 1.0 : vUv.y + 1.0;
						float len2 = a * a + b * b;

						if ( len2 > 1.0 ) discard;

					}

				#endif

			#endif

			#include <logdepthbuf_fragment>
			#include <color_fragment>

			gl_FragColor = vec4( diffuseColor.rgb, alpha );

			#include <tonemapping_fragment>
			#include <colorspace_fragment>
			#include <fog_fragment>
			#include <premultiplied_alpha_fragment>

		}
		`};class k extends ae{constructor(e){super({type:"LineMaterial",uniforms:Ce.clone(Z.line.uniforms),vertexShader:Z.line.vertexShader,fragmentShader:Z.line.fragmentShader,clipping:!0}),this.isLineMaterial=!0,this.setValues(e)}get color(){return this.uniforms.diffuse.value}set color(e){this.uniforms.diffuse.value=e}get worldUnits(){return"WORLD_UNITS"in this.defines}set worldUnits(e){e===!0!==this.worldUnits&&(this.needsUpdate=!0),e===!0?this.defines.WORLD_UNITS="":delete this.defines.WORLD_UNITS}get linewidth(){return this.uniforms.linewidth.value}set linewidth(e){this.uniforms.linewidth&&(this.uniforms.linewidth.value=e)}get dashed(){return"USE_DASH"in this.defines}set dashed(e){e===!0!==this.dashed&&(this.needsUpdate=!0),e===!0?this.defines.USE_DASH="":delete this.defines.USE_DASH}get dashScale(){return this.uniforms.dashScale.value}set dashScale(e){this.uniforms.dashScale.value=e}get dashSize(){return this.uniforms.dashSize.value}set dashSize(e){this.uniforms.dashSize.value=e}get dashOffset(){return this.uniforms.dashOffset.value}set dashOffset(e){this.uniforms.dashOffset.value=e}get gapSize(){return this.uniforms.gapSize.value}set gapSize(e){this.uniforms.gapSize.value=e}get opacity(){return this.uniforms.opacity.value}set opacity(e){this.uniforms&&(this.uniforms.opacity.value=e)}get resolution(){return this.uniforms.resolution.value}set resolution(e){this.uniforms.resolution.value.copy(e)}get alphaToCoverage(){return"USE_ALPHA_TO_COVERAGE"in this.defines}set alphaToCoverage(e){this.defines&&(e===!0!==this.alphaToCoverage&&(this.needsUpdate=!0),e===!0?this.defines.USE_ALPHA_TO_COVERAGE="":delete this.defines.USE_ALPHA_TO_COVERAGE)}}const ne=new W,be=new x,Me=new x,E=new W,P=new W,F=new W,se=new x,oe=new Ie,L=new Ue,Ee=new x,$=new le,Q=new Ae,D=new W;let B,V;function Pe(M,e,t){return D.set(0,0,-e,1).applyMatrix4(M.projectionMatrix),D.multiplyScalar(1/D.w),D.x=V/t.width,D.y=V/t.height,D.applyMatrix4(M.projectionMatrixInverse),D.multiplyScalar(1/D.w),Math.abs(Math.max(D.x,D.y))}function Ye(M,e){const t=M.matrixWorld,i=M.geometry,n=i.attributes.instanceStart,l=i.attributes.instanceEnd,c=Math.min(i.instanceCount,n.count);for(let h=0,d=c;h<d;h++){L.start.fromBufferAttribute(n,h),L.end.fromBufferAttribute(l,h),L.applyMatrix4(t);const f=new x,s=new x;B.distanceSqToSegment(L.start,L.end,s,f),s.distanceTo(f)<V*.5&&e.push({point:s,pointOnLine:f,distance:B.origin.distanceTo(s),object:M,face:null,faceIndex:h,uv:null,uv1:null})}}function Xe(M,e,t){const i=e.projectionMatrix,l=M.material.resolution,c=M.matrixWorld,h=M.geometry,d=h.attributes.instanceStart,f=h.attributes.instanceEnd,s=Math.min(h.instanceCount,d.count),a=-e.near;B.at(1,F),F.w=1,F.applyMatrix4(e.matrixWorldInverse),F.applyMatrix4(i),F.multiplyScalar(1/F.w),F.x*=l.x/2,F.y*=l.y/2,F.z=0,se.copy(F),oe.multiplyMatrices(e.matrixWorldInverse,c);for(let o=0,r=s;o<r;o++){if(E.fromBufferAttribute(d,o),P.fromBufferAttribute(f,o),E.w=1,P.w=1,E.applyMatrix4(oe),P.applyMatrix4(oe),E.z>a&&P.z>a)continue;if(E.z>a){const S=E.z-P.z,y=(E.z-a)/S;E.lerp(P,y)}else if(P.z>a){const S=P.z-E.z,y=(P.z-a)/S;P.lerp(E,y)}E.applyMatrix4(i),P.applyMatrix4(i),E.multiplyScalar(1/E.w),P.multiplyScalar(1/P.w),E.x*=l.x/2,E.y*=l.y/2,P.x*=l.x/2,P.y*=l.y/2,L.start.copy(E),L.start.z=0,L.end.copy(P),L.end.z=0;const u=L.closestPointToPointParameter(se,!0);L.at(u,Ee);const g=Ge.lerp(E.z,P.z,u),m=g>=-1&&g<=1,v=se.distanceTo(Ee)<V*.5;if(m&&v){L.start.fromBufferAttribute(d,o),L.end.fromBufferAttribute(f,o),L.start.applyMatrix4(c),L.end.applyMatrix4(c);const S=new x,y=new x;B.distanceSqToSegment(L.start,L.end,y,S),t.push({point:y,pointOnLine:S,distance:B.origin.distanceTo(y),object:M,face:null,faceIndex:o,uv:null,uv1:null})}}}class $e extends H{constructor(e=new _e,t=new k({color:Math.random()*16777215})){super(e,t),this.isLineSegments2=!0,this.type="LineSegments2"}computeLineDistances(){const e=this.geometry,t=e.attributes.instanceStart,i=e.attributes.instanceEnd,n=new Float32Array(2*t.count);for(let c=0,h=0,d=t.count;c<d;c++,h+=2)be.fromBufferAttribute(t,c),Me.fromBufferAttribute(i,c),n[h]=h===0?0:n[h-1],n[h+1]=n[h]+be.distanceTo(Me);const l=new re(n,2,1);return e.setAttribute("instanceDistanceStart",new j(l,1,0)),e.setAttribute("instanceDistanceEnd",new j(l,1,1)),this}raycast(e,t){const i=this.material.worldUnits,n=e.camera;n===null&&!i&&console.error('LineSegments2: "Raycaster.camera" needs to be set in order to raycast against LineSegments2 while worldUnits is set to false.');const l=e.params.Line2!==void 0&&e.params.Line2.threshold||0;B=e.ray;const c=this.matrixWorld,h=this.geometry,d=this.material;V=d.linewidth+l,h.boundingSphere===null&&h.computeBoundingSphere(),Q.copy(h.boundingSphere).applyMatrix4(c);let f;if(i)f=V*.5;else{const a=Math.max(n.near,Q.distanceToPoint(B.origin));f=Pe(n,a,d.resolution)}if(Q.radius+=f,B.intersectsSphere(Q)===!1)return;h.boundingBox===null&&h.computeBoundingBox(),$.copy(h.boundingBox).applyMatrix4(c);let s;if(i)s=V*.5;else{const a=Math.max(n.near,$.distanceToPoint(B.origin));s=Pe(n,a,d.resolution)}$.expandByScalar(s),B.intersectsBox($)!==!1&&(i?Ye(this,t):Xe(this,n,t))}onBeforeRender(e){const t=this.material.uniforms;t&&t.resolution&&(e.getViewport(ne),this.material.uniforms.resolution.value.set(ne.z,ne.w))}}class O extends _e{constructor(){super(),this.isLineGeometry=!0,this.type="LineGeometry"}setPositions(e){const t=e.length-3,i=new Float32Array(2*t);for(let n=0;n<t;n+=3)i[2*n]=e[n],i[2*n+1]=e[n+1],i[2*n+2]=e[n+2],i[2*n+3]=e[n+3],i[2*n+4]=e[n+4],i[2*n+5]=e[n+5];return super.setPositions(i),this}setColors(e){const t=e.length-3,i=new Float32Array(2*t);for(let n=0;n<t;n+=3)i[2*n]=e[n],i[2*n+1]=e[n+1],i[2*n+2]=e[n+2],i[2*n+3]=e[n+3],i[2*n+4]=e[n+4],i[2*n+5]=e[n+5];return super.setColors(i),this}setFromPoints(e){const t=e.length-1,i=new Float32Array(6*t);for(let n=0;n<t;n++)i[6*n]=e[n].x,i[6*n+1]=e[n].y,i[6*n+2]=e[n].z||0,i[6*n+3]=e[n+1].x,i[6*n+4]=e[n+1].y,i[6*n+5]=e[n+1].z||0;return super.setPositions(i),this}fromLine(e){const t=e.geometry;return this.setPositions(t.attributes.position.array),this}}class N extends $e{constructor(e=new O,t=new k({color:Math.random()*16777215})){super(e,t),this.isLine2=!0,this.type="Line2"}}const Le=[{h:0,s:.8,l:.5},{h:20,s:.9,l:.5},{h:280,s:.7,l:.5},{h:200,s:.8,l:.5},{h:340,s:.85,l:.5},{h:40,s:.9,l:.55},{h:180,s:.7,l:.45},{h:320,s:.75,l:.5}],ze={vertexShader:`
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,fragmentShader:`
    uniform float uTime, uIntensity, uSpeed;
    varying vec2 vUv;

    vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
    vec4 mod289(vec4 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
    vec4 permute(vec4 x) { return mod289(((x*34.0)+1.0)*x); }
    vec4 taylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }

    float snoise(vec3 v) {
      const vec2 C = vec2(1.0/6.0, 1.0/3.0);
      const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);
      vec3 i = floor(v + dot(v, C.yyy));
      vec3 x0 = v - i + dot(i, C.xxx);
      vec3 g = step(x0.yzx, x0.xyz);
      vec3 l = 1.0 - g;
      vec3 i1 = min(g.xyz, l.zxy);
      vec3 i2 = max(g.xyz, l.zxy);
      vec3 x1 = x0 - i1 + C.xxx;
      vec3 x2 = x0 - i2 + C.yyy;
      vec3 x3 = x0 - D.yyy;
      i = mod289(i);
      vec4 p = permute(permute(permute(
        i.z + vec4(0.0, i1.z, i2.z, 1.0))
        + i.y + vec4(0.0, i1.y, i2.y, 1.0))
        + i.x + vec4(0.0, i1.x, i2.x, 1.0));
      float n_ = 0.142857142857;
      vec3 ns = n_ * D.wyz - D.xzx;
      vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
      vec4 x_ = floor(j * ns.z);
      vec4 y_ = floor(j - 7.0 * x_);
      vec4 x = x_ *ns.x + ns.yyyy;
      vec4 y = y_ *ns.x + ns.yyyy;
      vec4 h = 1.0 - abs(x) - abs(y);
      vec4 b0 = vec4(x.xy, y.xy);
      vec4 b1 = vec4(x.zw, y.zw);
      vec4 s0 = floor(b0)*2.0 + 1.0;
      vec4 s1 = floor(b1)*2.0 + 1.0;
      vec4 sh = -step(h, vec4(0.0));
      vec4 a0 = b0.xzyw + s0.xzyw*sh.xxyy;
      vec4 a1 = b1.xzyw + s1.xzyw*sh.zzww;
      vec3 p0 = vec3(a0.xy, h.x);
      vec3 p1 = vec3(a0.zw, h.y);
      vec3 p2 = vec3(a1.xy, h.z);
      vec3 p3 = vec3(a1.zw, h.w);
      vec4 norm = taylorInvSqrt(vec4(dot(p0,p0), dot(p1,p1), dot(p2,p2), dot(p3,p3)));
      p0 *= norm.x;
      p1 *= norm.y;
      p2 *= norm.z;
      p3 *= norm.w;
      vec4 m = max(0.6 - vec4(dot(x0,x0), dot(x1,x1), dot(x2,x2), dot(x3,x3)), 0.0);
      m = m * m;
      return 42.0 * dot(m*m, vec4(dot(p0,x0), dot(p1,x1), dot(p2,x2), dot(p3,x3)));
    }

    void main() {
      float t = uTime * uSpeed;
      vec2 uv = vUv * 2.0 - 1.0;
      float n1 = snoise(vec3(uv * 0.5, t * 0.1)) * 0.5 + 0.5;
      float n2 = snoise(vec3(uv * 0.8 + 100.0, t * 0.15)) * 0.5 + 0.5;
      float n3 = snoise(vec3(uv * 1.2 + 200.0, t * 0.2)) * 0.5 + 0.5;
      vec3 c1 = vec3(0.1, 0.0, 0.2);
      vec3 c2 = vec3(0.0, 0.05, 0.15);
      vec3 c3 = vec3(0.15, 0.0, 0.1);
      vec3 color = c1 * n1 + c2 * n2 + c3 * n3;
      color *= uIntensity;
      gl_FragColor = vec4(color, 1.0);
    }
  `},Te={vertexShader:`
    varying vec2 vUv;
    varying vec3 vPosition;
    void main() {
      vUv = uv;
      vPosition = position;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,fragmentShader:`
    precision highp float;
    uniform float uTime;
    uniform vec3 uColor;
    uniform float uOpacity;
    uniform int uFillMode;
    uniform float uFillLevel;
    uniform float uWaveAmp;
    uniform float uWaveSpeed;
    uniform vec2 uBoundsMin;
    uniform vec2 uBoundsMax;
    uniform float uGradientAngle;
    uniform float uGradientSpread;
    uniform float uShimmerSpeed;
    uniform float uShimmerScale;
    uniform float uShimmerIntensity;
    uniform float uPulseSpeed;
    uniform float uPulseRingScale;
    uniform float uPulseRingSpeed;
    uniform float uNoiseScale;
    uniform float uNoiseSpeed;
    uniform float uNoiseContrast;
    uniform float uHeartbeat;

    varying vec2 vUv;
    varying vec3 vPosition;

    #define PI 3.14159265359

    float random(vec2 st) {
      return fract(sin(dot(st.xy, vec2(12.9898, 78.233))) * 43758.5453123);
    }

    float noise(vec2 st) {
      vec2 i = floor(st);
      vec2 f = fract(st);
      float a = random(i);
      float b = random(i + vec2(1.0, 0.0));
      float c = random(i + vec2(0.0, 1.0));
      float d = random(i + vec2(1.0, 1.0));
      vec2 u = f * f * (3.0 - 2.0 * f);
      return mix(a, b, u.x) + (c - a) * u.y * (1.0 - u.x) + (d - b) * u.x * u.y;
    }

    float fbm(vec2 st) {
      float value = 0.0;
      float amplitude = 0.5;
      for (int i = 0; i < 5; i++) {
        value += amplitude * noise(st);
        st *= 2.0;
        amplitude *= 0.5;
      }
      return value;
    }

    void main() {
      vec2 size = uBoundsMax - uBoundsMin;
      vec2 localUV = (vPosition.xy - uBoundsMin) / size;

      vec4 color = vec4(uColor, uOpacity);

      // Apply heartbeat effect
      float heartbeatScale = 1.0 + uHeartbeat * 0.1;

      if (uFillMode == 0) {
        // Liquid fill
        float wave = sin(localUV.x * 10.0 + uTime * uWaveSpeed) * uWaveAmp;
        wave += sin(localUV.x * 7.0 - uTime * uWaveSpeed * 0.7) * uWaveAmp * 0.5;
        float fillY = uFillLevel + wave;
        float alpha = smoothstep(fillY - 0.02, fillY + 0.02, localUV.y);
        color.a *= (1.0 - alpha);
      } else if (uFillMode == 1) {
        // Solid fill - just use color as is
      } else if (uFillMode == 2) {
        // Gradient fill
        float angle = uGradientAngle * PI / 180.0;
        vec2 dir = vec2(cos(angle), sin(angle));
        float t = dot(localUV - 0.5, dir) + 0.5;
        float hueShift = (t - 0.5) * uGradientSpread;
        // Simple hue shift approximation
        color.rgb = mix(color.rgb * 0.7, color.rgb * 1.3, t);
      } else if (uFillMode == 3) {
        // Shimmer
        float shimmer = noise(localUV * uShimmerScale * 100.0 + uTime * uShimmerSpeed);
        shimmer = pow(shimmer, 2.0) * uShimmerIntensity;
        color.rgb += shimmer;
      } else if (uFillMode == 4) {
        // Pulse
        float dist = length(localUV - 0.5) * 2.0;
        float rings = sin(dist * uPulseRingScale - uTime * uPulseRingSpeed) * 0.5 + 0.5;
        float pulse = sin(uTime * uPulseSpeed) * 0.5 + 0.5;
        color.rgb *= (0.5 + rings * 0.5) * (0.7 + pulse * 0.3);
      } else if (uFillMode == 5) {
        // Noise (FBM)
        float n = fbm(localUV * uNoiseScale * 50.0 + uTime * uNoiseSpeed);
        n = mix(0.5, n, uNoiseContrast);
        color.rgb *= n * 2.0;
      } else if (uFillMode == 6) {
        // Particles (animated dots)
        vec2 grid = fract(localUV * 20.0 + uTime * 0.1);
        float particle = smoothstep(0.1, 0.0, length(grid - 0.5));
        color.rgb += particle * 0.5;
      }

      gl_FragColor = color;
    }
  `};class Je{scene;camera;renderer;renderTarget;ownsRenderer;mainGroup;polygons=[];allEdges=[];sharedVertices=[];allVertices=[];edgeConnections=new Map;outlines=[];liquidFills=[];glowNodes=[];energyPulses=[];connectionLines=[];ripples=[];lightningBolts=[];edgeFlowLines=[];innerGlows=[];nebulaPlanes=[];plasmaTendrils=[];echoLayers=[];arcBridges=[];particles=null;particleLinkPool=[];animationTime=0;heartbeatPhase=0;colorCycleOffset=0;frameCount=0;width;height;initialWidth;initialHeight;svgWidth=1e3;svgHeight=1e3;svgMinX=0;svgMinY=0;scaleX=.55;scaleY=.55;sceneRoot;constructor(e,t,i){e=Math.max(1,Math.floor(e)),t=Math.max(1,Math.floor(t)),this.width=e,this.height=t,this.initialWidth=e,this.initialHeight=t,i?(this.renderer=i,this.ownsRenderer=!1):(this.renderer=new Re({antialias:!0,alpha:!0,powerPreference:"high-performance"}),this.renderer.setSize(e,t),this.renderer.setPixelRatio(1),this.ownsRenderer=!0),this.renderTarget=new He(e,t,{minFilter:fe,magFilter:fe,format:ke}),this.scene=new Oe,this.scene.background=new C(0),this.camera=new Ve(-e/2,e/2,-t/2,t/2,1,1e3),this.camera.position.z=500,this.sceneRoot=new pe,this.scene.add(this.sceneRoot),this.mainGroup=new pe,this.sceneRoot.add(this.mainGroup)}parseSVG(e){if(!e)return;const i=new DOMParser().parseFromString(e,"image/svg+xml"),n=i.querySelector("svg");if(n){const r=n.getAttribute("viewBox");if(r){const g=r.split(/[\s,]+/).map(Number).filter(m=>!isNaN(m));g.length>=4&&(this.svgMinX=g[0],this.svgMinY=g[1],this.svgWidth=g[2],this.svgHeight=g[3])}else this.svgMinX=0,this.svgMinY=0;const p=n.getAttribute("width"),u=n.getAttribute("height");p&&u&&!r&&(this.svgWidth=parseFloat(p)||1e3,this.svgHeight=parseFloat(u)||1e3,this.svgMinX=0,this.svgMinY=0)}this.initialWidth=this.width,this.initialHeight=this.height,this._needsRebuild=!1,this.sceneRoot.scale.set(1,1,1);const l=this.width/this.svgWidth,c=this.height/this.svgHeight,h=Math.min(l,c);this.scaleX=h,this.scaleY=h;const d=[];i.querySelectorAll("polygon").forEach((r,p)=>{const u=r.getAttribute("points");u&&d.push({points:u,fill:!0,id:p})}),i.querySelectorAll("polyline").forEach((r,p)=>{const u=r.getAttribute("points");u&&d.push({points:u,fill:!1,id:d.length})}),i.querySelectorAll("rect").forEach((r,p)=>{const u=parseFloat(r.getAttribute("x")||"0"),g=parseFloat(r.getAttribute("y")||"0"),m=parseFloat(r.getAttribute("width")||"0"),v=parseFloat(r.getAttribute("height")||"0");if(m>0&&v>0){const S=`${u},${g} ${u+m},${g} ${u+m},${g+v} ${u},${g+v}`;d.push({points:S,fill:!0,id:d.length})}}),i.querySelectorAll("circle").forEach((r,p)=>{const u=parseFloat(r.getAttribute("cx")||"0"),g=parseFloat(r.getAttribute("cy")||"0"),m=parseFloat(r.getAttribute("r")||"0");if(m>0){const S=[];for(let y=0;y<32;y++){const w=y/32*Math.PI*2;S.push(`${u+Math.cos(w)*m},${g+Math.sin(w)*m}`)}d.push({points:S.join(" "),fill:!0,id:d.length})}}),i.querySelectorAll("ellipse").forEach((r,p)=>{const u=parseFloat(r.getAttribute("cx")||"0"),g=parseFloat(r.getAttribute("cy")||"0"),m=parseFloat(r.getAttribute("rx")||"0"),v=parseFloat(r.getAttribute("ry")||"0");if(m>0&&v>0){const y=[];for(let w=0;w<32;w++){const b=w/32*Math.PI*2;y.push(`${u+Math.cos(b)*m},${g+Math.sin(b)*v}`)}d.push({points:y.join(" "),fill:!0,id:d.length})}}),i.querySelectorAll("line").forEach((r,p)=>{const u=parseFloat(r.getAttribute("x1")||"0"),g=parseFloat(r.getAttribute("y1")||"0"),m=parseFloat(r.getAttribute("x2")||"0"),v=parseFloat(r.getAttribute("y2")||"0");d.push({points:`${u},${g} ${m},${v}`,fill:!1,id:d.length})}),i.querySelectorAll("path").forEach((r,p)=>{const u=r.getAttribute("d");if(u){const g=this.parsePathToPoints(u);g&&d.push({points:g,fill:!0,id:d.length})}});let f=1/0,s=-1/0,a=1/0,o=-1/0;if(d.forEach(r=>{const p=r.points.trim().split(/\s+/).map(Number);for(let u=0;u<p.length;u+=2)f=Math.min(f,p[u]),s=Math.max(s,p[u]),a=Math.min(a,p[u+1]),o=Math.max(o,p[u+1])}),d.length>0){const r=s-f,p=o-a;this.svgMinX=f,this.svgMinY=a,this.svgWidth=r,this.svgHeight=p;const u=this.width/this.svgWidth,g=this.height/this.svgHeight,m=Math.min(u,g),v=.75;this.scaleX=m*v,this.scaleY=m*v}this.buildPolygons(d)}parsePathToPoints(e){const t=[];let i=0,n=0,l=0,c=0;const h=e.match(/[MLHVCSQTAZmlhvcsqtaz][^MLHVCSQTAZmlhvcsqtaz]*/gi)||[];for(const d of h){const f=d[0],s=(d.slice(1).match(/-?\d*\.?\d+(?:e[+-]?\d+)?/gi)||[]).map(Number),a=f===f.toLowerCase();switch(f.toUpperCase()){case"M":for(let o=0;o<s.length;o+=2)i=a?i+s[o]:s[o],n=a?n+s[o+1]:s[o+1],o===0&&(l=i,c=n),t.push(i,n);break;case"L":for(let o=0;o<s.length;o+=2)i=a?i+s[o]:s[o],n=a?n+s[o+1]:s[o+1],t.push(i,n);break;case"H":for(let o=0;o<s.length;o++)i=a?i+s[o]:s[o],t.push(i,n);break;case"V":for(let o=0;o<s.length;o++)n=a?n+s[o]:s[o],t.push(i,n);break;case"C":{for(let r=0;r+5<s.length;r+=6){const p=i,u=n,g=a?p+s[r]:s[r],m=a?u+s[r+1]:s[r+1],v=a?p+s[r+2]:s[r+2],S=a?u+s[r+3]:s[r+3],y=a?p+s[r+4]:s[r+4],w=a?u+s[r+5]:s[r+5];for(let b=1;b<=8;b++){const z=b/8,U=z*z,I=U*z,T=1-z,_=T*T,R=_*T;t.push(R*p+3*_*z*g+3*T*U*v+I*y,R*u+3*_*z*m+3*T*U*S+I*w)}i=y,n=w}break}case"S":{for(let r=0;r+3<s.length;r+=4){const p=i,u=n,g=p,m=u,v=a?p+s[r]:s[r],S=a?u+s[r+1]:s[r+1],y=a?p+s[r+2]:s[r+2],w=a?u+s[r+3]:s[r+3];for(let b=1;b<=8;b++){const z=b/8,U=z*z,I=U*z,T=1-z,_=T*T,R=_*T;t.push(R*p+3*_*z*g+3*T*U*v+I*y,R*u+3*_*z*m+3*T*U*S+I*w)}i=y,n=w}break}case"Q":{for(let r=0;r+3<s.length;r+=4){const p=i,u=n,g=a?p+s[r]:s[r],m=a?u+s[r+1]:s[r+1],v=a?p+s[r+2]:s[r+2],S=a?u+s[r+3]:s[r+3];for(let y=1;y<=8;y++){const w=y/8,b=1-w;t.push(b*b*p+2*b*w*g+w*w*v,b*b*u+2*b*w*m+w*w*S)}i=v,n=S}break}case"T":{for(let o=0;o+1<s.length;o+=2)i=a?i+s[o]:s[o],n=a?n+s[o+1]:s[o+1],t.push(i,n);break}case"A":{for(let o=0;o+6<s.length;o+=7)i=a?i+s[o+5]:s[o+5],n=a?n+s[o+6]:s[o+6],t.push(i,n);break}case"Z":i=l,n=c;break}}return t.length<4?null:t.join(" ")}buildPolygons(e){this.polygons=[],this.allEdges=[],this.sharedVertices=[],this.allVertices=[],e.forEach((n,l)=>{const c=this.parsePolygonPoints(n.points),h=this.getCentroid(c),d=this.getBounds(c),f=this.getPerimeter(c),s=[];for(let r=0;r<c.length;r++){const p=c[r],u=c[(r+1)%c.length];s.push({start:p.clone(),end:u.clone(),polyId:l}),this.allEdges.push({start:p.clone(),end:u.clone(),polyId:l,edgeId:this.allEdges.length})}c.forEach(r=>this.allVertices.push(r.clone()));const a=l%Le.length,o=Le[a];this.polygons.push({id:l,points:c,centroid:h,bounds:d,edges:s,perimeter:f,fillPhase:Math.random()*Math.PI*2,breathPhase:Math.random()*Math.PI*2,colorHue:o.h,colorSat:o.s,colorLight:o.l})});const t=5,i=new Map;this.polygons.forEach(n=>{n.points.forEach(l=>{const c=`${Math.round(l.x/t)},${Math.round(l.y/t)}`;i.has(c)||i.set(c,{pos:l.clone(),polygons:new Set}),i.get(c).polygons.add(n.id)})}),i.forEach(n=>{n.polygons.size>=2&&this.sharedVertices.push({pos:n.pos,polygons:Array.from(n.polygons)})}),this.edgeConnections=new Map;for(let n=0;n<this.allEdges.length;n++){const l=this.allEdges[n],c=[];for(let h=0;h<this.allEdges.length;h++)n!==h&&this.allEdges[h].start.distanceTo(l.end)<5&&c.push(h);this.edgeConnections.set(n,c)}}parsePolygonPoints(e){const t=e.trim().split(/\s+/).map(Number),i=[];for(let n=0;n<t.length;n+=2){const l=t[n]-this.svgMinX,c=t[n+1]-this.svgMinY;i.push(new x((l-this.svgWidth/2)*this.scaleX,(c-this.svgHeight/2)*this.scaleY,0))}return i}getCentroid(e){const t=new x;return e.forEach(i=>t.add(i)),t.divideScalar(e.length)}getBounds(e){const t=new x(1/0,1/0,0),i=new x(-1/0,-1/0,0);return e.forEach(n=>{t.x=Math.min(t.x,n.x),t.y=Math.min(t.y,n.y),i.x=Math.max(i.x,n.x),i.y=Math.max(i.y,n.y)}),{min:t,max:i,width:i.x-t.x,height:i.y-t.y}}getPerimeter(e){let t=0;for(let i=0;i<e.length;i++)t+=e[i].distanceTo(e[(i+1)%e.length]);return t}buildScene(e){this.clearScene(),this.polygons.length!==0&&(e.nebulaEnabled&&this.createNebulaBackground(e),e.echoEnabled&&this.createEchoLayers(e),e.innerGlowEnabled&&this.createInnerGlows(e),this.createPolygonFills(e),e.ripplesEnabled&&this.createRipples(e),e.connectionsEnabled&&this.createConnections(e),e.arcBridgesEnabled&&this.createArcBridges(e),e.edgeFlowEnabled&&this.createEdgeFlow(e),this.createPolygonOutlines(e),e.particlesEnabled&&this.createEdgeParticleSystem(e),e.particleLinksEnabled&&this.particles&&this.createParticleLinks(e),e.energyEnabled&&this.createEnergyPulses(e),e.glowEnabled&&this.createGlowNodes(e),e.lightningEnabled&&this.createLightning(e),e.plasmaEnabled&&this.createPlasmaTendrils(e))}clearScene(){for(;this.mainGroup.children.length>0;){const e=this.mainGroup.children[0];e.geometry&&e.geometry.dispose(),e.material&&(Array.isArray(e.material)?e.material.forEach(t=>t.dispose()):e.material.dispose()),this.mainGroup.remove(e)}this.outlines=[],this.liquidFills=[],this.glowNodes=[],this.energyPulses=[],this.connectionLines=[],this.ripples=[],this.lightningBolts=[],this.edgeFlowLines=[],this.innerGlows=[],this.nebulaPlanes=[],this.plasmaTendrils=[],this.echoLayers=[],this.arcBridges=[],this.particles=null,this.particleLinkPool=[]}hslToColor(e,t,i){return new C().setHSL(e/360,t,i)}getColorForShape(e,t,i){const n=this.polygons[e];if(i.colorMode==="white")return new C(1,1,1);if(i.colorMode==="rainbow"){const l=(e/this.polygons.length+t*i.colorCycleSpeed)%1;return new C().setHSL(l,i.colorCycleSaturation,i.colorCycleLightness)}if(i.colorMode==="monochrome"){const l=.3+e/this.polygons.length*.4;return new C().setHSL(i.monochromeHue/360,.8,l)}if(i.colorMode==="complementary"){const l=i.monochromeHue/360,c=e%2===0?l:(l+.5)%1;return new C().setHSL(c,i.colorCycleSaturation,i.colorCycleLightness)}if(i.colorMode==="analogous"){const l=i.monochromeHue/360,c=(e%3-1)*.08;return new C().setHSL((l+c+1)%1,i.colorCycleSaturation,i.colorCycleLightness)}if(i.colorCycleEnabled){const l=(n.colorHue/360+t*i.colorCycleSpeed)%1;return new C().setHSL(l,i.colorCycleSaturation,i.colorCycleLightness)}return this.hslToColor(n.colorHue,n.colorSat,n.colorLight)}createNebulaBackground(e){const t=new We(this.width*1.5,this.height*1.5),i=new ae({uniforms:{uTime:{value:0},uIntensity:{value:e.nebulaIntensity},uSpeed:{value:e.nebulaSpeed}},vertexShader:ze.vertexShader,fragmentShader:ze.fragmentShader,transparent:!0,depthWrite:!1}),n=new H(t,i);n.position.z=-100,this.mainGroup.add(n),this.nebulaPlanes.push(n)}createPolygonFills(e){const t={liquid:0,solid:1,gradient:2,shimmer:3,pulse:4,noise:5,particles:6};this.polygons.forEach((i,n)=>{const l=new ge;l.moveTo(i.points[0].x,i.points[0].y);for(let s=1;s<i.points.length;s++)l.lineTo(i.points[s].x,i.points[s].y);l.closePath();const c=new me(l),h=this.getColorForShape(n,0,e),d=new ae({uniforms:{uTime:{value:0},uColor:{value:h},uOpacity:{value:.6},uFillMode:{value:t[e.fillMode]||0},uFillLevel:{value:e.liquidEnabled?.5:1},uWaveAmp:{value:e.liquidWaveAmp},uWaveSpeed:{value:e.liquidSpeed*5},uBoundsMin:{value:new G(i.bounds.min.x,i.bounds.min.y)},uBoundsMax:{value:new G(i.bounds.max.x,i.bounds.max.y)},uGradientAngle:{value:e.gradientAngle},uGradientSpread:{value:e.gradientSpread},uShimmerSpeed:{value:e.shimmerSpeed},uShimmerScale:{value:e.shimmerScale},uShimmerIntensity:{value:e.shimmerIntensity},uPulseSpeed:{value:e.pulseSpeed},uPulseRingScale:{value:e.pulseRingScale},uPulseRingSpeed:{value:e.pulseRingSpeed},uNoiseScale:{value:e.noiseScale},uNoiseSpeed:{value:e.noiseSpeed},uNoiseContrast:{value:e.noiseContrast},uHeartbeat:{value:0}},vertexShader:Te.vertexShader,fragmentShader:Te.fragmentShader,transparent:!0,side:ye,depthWrite:!1,blending:A}),f=new H(c,d);f.userData.polyIdx=n,this.mainGroup.add(f),this.liquidFills.push(f)})}createPolygonOutlines(e){this.polygons.forEach((t,i)=>{const n=[];t.points.forEach(f=>{n.push(f.x,f.y,0)}),n.push(t.points[0].x,t.points[0].y,0);const l=new O;l.setPositions(n);const c=this.getColorForShape(i,0,e),h=new k({color:c.getHex(),linewidth:e.outlineThickness,resolution:new G(this.width,this.height),transparent:!0,opacity:.8,blending:A}),d=new N(l,h);d.userData.polyIdx=i,this.mainGroup.add(d),this.outlines.push(d)})}createEchoLayers(e){this.polygons.forEach((t,i)=>{for(let n=1;n<=e.echoLayers;n++){const l=[];t.points.forEach(s=>{const o=s.clone().sub(t.centroid).normalize().multiplyScalar(n*e.echoSpacing);l.push(s.x+o.x,s.y+o.y,0)}),l.push(l[0],l[1],0);const c=new O;c.setPositions(l);const h=this.getColorForShape(i,0,e),d=new k({color:h.getHex(),linewidth:e.echoThickness,resolution:new G(this.width,this.height),transparent:!0,opacity:e.echoOpacity*(1-n/(e.echoLayers+1)),blending:A}),f=new N(c,d);this.mainGroup.add(f),this.echoLayers.push(f)}})}createInnerGlows(e){this.polygons.forEach((t,i)=>{const n=new ge;n.moveTo(t.points[0].x,t.points[0].y);for(let f=1;f<t.points.length;f++)n.lineTo(t.points[f].x,t.points[f].y);n.closePath();const l=new me(n),c=this.getColorForShape(i,0,e),h=new q({color:c,transparent:!0,opacity:e.innerGlowIntensity*.3,blending:A}),d=new H(l,h);d.position.z=-1,this.mainGroup.add(d),this.innerGlows.push(d)})}createRipples(e){this.sharedVertices.forEach(i=>{for(let n=0;n<3;n++){const l=new Ne(5,8,32),c=new q({color:16777215,transparent:!0,opacity:.5,side:ye,blending:A}),h=new H(l,c);h.position.copy(i.pos),h.userData.phase=n/3,h.userData.basePos=i.pos.clone(),this.mainGroup.add(h),this.ripples.push(h)}})}createConnections(e){for(let t=0;t<this.polygons.length;t++)for(let i=t+1;i<this.polygons.length;i++){const n=this.polygons[t].centroid,l=this.polygons[i].centroid,c=n.distanceTo(l);if(c<200){const h=new x().lerpVectors(n,l,.5);h.y+=c*.2;const f=new ve(n,h,l).getPoints(20),s=[];f.forEach(p=>s.push(p.x,p.y,p.z));const a=new O;a.setPositions(s);const o=new k({color:16729156,linewidth:e.connectionThickness,resolution:new G(this.width,this.height),transparent:!0,opacity:.4,blending:A}),r=new N(a,o);this.mainGroup.add(r),this.connectionLines.push(r)}}}createArcBridges(e){for(let t=0;t<this.polygons.length;t++)for(let i=t+1;i<this.polygons.length;i++){const n=this.polygons[t].centroid,l=this.polygons[i].centroid,c=n.distanceTo(l);if(c<150&&c>50){const h=new x().lerpVectors(n,l,.5);h.z=e.arcBridgeHeight;const f=new ve(n,h,l).getPoints(20),s=[];f.forEach(p=>s.push(p.x,p.y,p.z));const a=new O;a.setPositions(s);const o=new k({color:16776960,linewidth:e.arcBridgeThickness,resolution:new G(this.width,this.height),transparent:!0,opacity:e.arcBridgeOpacity,blending:A}),r=new N(a,o);this.mainGroup.add(r),this.arcBridges.push(r)}}}createEdgeFlow(e){this.allEdges.forEach(t=>{const i=[t.start.x,t.start.y,t.start.z,t.end.x,t.end.y,t.end.z],n=new O;n.setPositions(i);const l=new k({color:16746564,linewidth:e.edgeFlowThickness,resolution:new G(this.width,this.height),transparent:!0,opacity:.5,blending:A}),c=new N(n,l);c.userData.progress=Math.random(),this.mainGroup.add(c),this.edgeFlowLines.push(c)})}createEdgeParticleSystem(e){const i=new Float32Array(9e3),n=new Float32Array(3e3*3),l=[];for(let d=0;d<3e3;d++){const f=Math.floor(Math.random()*this.allEdges.length),s=Math.random(),a=this.allEdges[f],o=new x().lerpVectors(a.start,a.end,s);i[d*3]=o.x,i[d*3+1]=o.y,i[d*3+2]=o.z,n[d*3]=1,n[d*3+1]=1,n[d*3+2]=1,l.push({edgeIdx:f,t:s})}const c=new te;c.setAttribute("position",new Y(i,3)),c.setAttribute("color",new Y(n,3));const h=new je({size:e.particleSize,vertexColors:!0,transparent:!0,opacity:.8,blending:A});this.particles=new qe(c,h),this.particles.userData.particleData=l,this.mainGroup.add(this.particles)}createParticleLinks(e){const t=e.particleLinkMaxLinks||800;this.particleLinkPool=[];for(let i=0;i<t;i++){const n=new O;n.setPositions([0,0,0,0,0,0]);const l=new k({color:16746598,linewidth:e.particleLinkThickness||2,resolution:new G(this.width,this.height),transparent:!0,opacity:e.particleLinkOpacity,blending:A}),c=new N(n,l);c.visible=!1,c.frustumCulled=!1,this.mainGroup.add(c),this.particleLinkPool.push(c)}}createEnergyPulses(e){for(let i=0;i<50;i++){const n=new ie(3,16),l=new q({color:16755200,transparent:!0,opacity:.8,blending:A}),c=new H(n,l),h=Math.floor(Math.random()*this.allEdges.length),d=Math.random(),f=this.allEdges[h],s=new x().lerpVectors(f.start,f.end,d);c.position.copy(s),c.userData={edgeIdx:h,t:d},this.mainGroup.add(c),this.energyPulses.push(c)}}createGlowNodes(e){this.allVertices.forEach((t,i)=>{const n=new ie(5,16),l=this.getColorForShape(i%this.polygons.length,0,e),c=new q({color:l,transparent:!0,opacity:.6,blending:A}),h=new H(n,c);h.position.copy(t),h.userData.baseScale=1,this.mainGroup.add(h),this.glowNodes.push(h)}),this.polygons.forEach((t,i)=>{const n=new ie(8,16),l=this.getColorForShape(i,0,e),c=new q({color:l,transparent:!0,opacity:.8,blending:A}),h=new H(n,c);h.position.copy(t.centroid),h.userData.baseScale=1.5,this.mainGroup.add(h),this.glowNodes.push(h)})}createLightning(e){for(let t=0;t<20;t++){const i=new te,n=new Float32Array(90);i.setAttribute("position",new Y(n,3)),i.setDrawRange(0,0);const l=new Se({color:8965375,transparent:!0,opacity:0,blending:A}),c=new we(i,l);c.userData={active:!1,startTime:0},this.mainGroup.add(c),this.lightningBolts.push(c)}}createPlasmaTendrils(e){this.polygons.forEach((t,i)=>{for(let n=0;n<5;n++){const l=Math.floor(Math.random()*t.edges.length),c=t.edges[l],h=Math.random(),d=new x().lerpVectors(c.start,c.end,h),f=new te,s=new Float32Array(60);f.setAttribute("position",new Y(s,3));const a=this.getColorForShape(i,0,e),o=new Se({color:a,transparent:!0,opacity:e.plasmaOpacity,linewidth:e.plasmaThickness,blending:A}),r=new we(f,o);r.userData={start:t.centroid.clone(),target:d,phase:Math.random()*Math.PI*2},this.mainGroup.add(r),this.plasmaTendrils.push(r)}})}animate(e,t){this.animationTime+=e,this.frameCount++;const i=(t.panX||0)*(this.width/2),n=(t.panY||0)*(this.height/2);this.mainGroup.position.x=i,this.mainGroup.position.y=n;const l=t.contentScale||1;this.mainGroup.scale.set(l,l,1),t.heartbeatEnabled&&(this.heartbeatPhase+=e*t.heartbeatSpeed*2*Math.PI,Math.sin(this.heartbeatPhase)),t.colorCycleEnabled&&(this.colorCycleOffset+=e*t.colorCycleSpeed),this.nebulaPlanes.forEach(s=>{const a=s.material;a.uniforms.uTime.value=this.animationTime,a.uniforms.uIntensity.value=t.nebulaIntensity,a.uniforms.uSpeed.value=t.nebulaSpeed});const c=t.heartbeatEnabled?Math.sin(this.heartbeatPhase)*t.heartbeatIntensity:0,d={liquid:0,solid:1,gradient:2,shimmer:3,pulse:4,noise:5,particles:6}[t.fillMode]||0;if(this.liquidFills.forEach((s,a)=>{const o=s.material;o.uniforms.uTime.value=this.animationTime,o.uniforms.uHeartbeat.value=c;const r=this.getColorForShape(s.userData.polyIdx,this.animationTime,t);o.uniforms.uColor.value=r,o.uniforms.uFillMode.value=d,o.uniforms.uFillLevel.value=t.liquidEnabled?.5:1,o.uniforms.uWaveAmp.value=t.liquidWaveAmp,o.uniforms.uWaveSpeed.value=t.liquidSpeed*5,o.uniforms.uGradientAngle.value=t.gradientAngle,o.uniforms.uGradientSpread.value=t.gradientSpread,o.uniforms.uShimmerSpeed.value=t.shimmerSpeed,o.uniforms.uShimmerScale.value=t.shimmerScale,o.uniforms.uShimmerIntensity.value=t.shimmerIntensity,o.uniforms.uPulseSpeed.value=t.pulseSpeed,o.uniforms.uPulseRingScale.value=t.pulseRingScale,o.uniforms.uPulseRingSpeed.value=t.pulseRingSpeed,o.uniforms.uNoiseScale.value=t.noiseScale,o.uniforms.uNoiseSpeed.value=t.noiseSpeed,o.uniforms.uNoiseContrast.value=t.noiseContrast}),this.outlines.forEach(s=>{const a=s.material,o=this.getColorForShape(s.userData.polyIdx,this.animationTime,t);a.color=o,a.linewidth=t.outlineThickness}),this.glowNodes.forEach((s,a)=>{const o=s.userData.baseScale*(1+Math.sin(this.animationTime*t.glowPulseSpeed+a)*.3)*t.glowSize;s.scale.set(o,o,1),s.material.opacity=.6*t.glowIntensity}),this.innerGlows.forEach((s,a)=>{s.material.opacity=t.innerGlowIntensity*.3;const o=this.getColorForShape(a,this.animationTime,t);s.material.color=o}),this.echoLayers.forEach(s=>{const a=s.material;a.linewidth=t.echoThickness}),this.energyPulses.forEach(s=>{if(s.userData.t+=e*t.energySpeed/1e3,s.userData.t>1){const r=this.edgeConnections.get(s.userData.edgeIdx)||[];r.length>0?s.userData.edgeIdx=r[Math.floor(Math.random()*r.length)]:s.userData.edgeIdx=Math.floor(Math.random()*this.allEdges.length),s.userData.t=0}const a=this.allEdges[s.userData.edgeIdx];if(a){const r=new x().lerpVectors(a.start,a.end,s.userData.t);s.position.copy(r)}const o=t.energySize||1;s.scale.set(o,o,1)}),this.ripples.forEach(s=>{const a=(this.animationTime*t.rippleSpeed+s.userData.phase)%1,o=(1+a*4)*t.rippleSize;s.scale.set(o,o,1),s.material.opacity=t.rippleOpacity*(1-a)}),this.particles&&t.particlesEnabled){const s=this.particles.geometry.attributes.position.array,a=this.particles.userData.particleData;for(let o=0;o<a.length;o++){const r=a[o];if(r.t+=e*t.particleSpeed/1e3,r.t>1){const u=this.edgeConnections.get(r.edgeIdx)||[];u.length>0?r.edgeIdx=u[Math.floor(Math.random()*u.length)]:r.edgeIdx=Math.floor(Math.random()*this.allEdges.length),r.t=0}const p=this.allEdges[r.edgeIdx];if(p){const u=new x().lerpVectors(p.start,p.end,r.t);s[o*3]=u.x,s[o*3+1]=u.y,s[o*3+2]=u.z}}this.particles.geometry.attributes.position.needsUpdate=!0,this.particles.material.size=t.particleSize}const f=Math.max(1,Math.floor(11-(t.particleLinkSpeed||5)));if(this.particleLinkPool.length>0&&t.particleLinksEnabled&&this.particles&&this.frameCount%f===0){const s=this.particles.geometry.attributes.position.array,a=s.length/3;for(const y of this.particleLinkPool)y.visible=!1;const o=Math.min(200,a),r=Math.max(1,Math.floor(a/o)),p=t.particleLinkDistance,u=p*p,g=25;let m=0;const v=Math.min(this.particleLinkPool.length,t.particleLinkMaxLinks||800);let S;t.colorMode==="rainbow"?S=new C().setHSL(this.colorCycleOffset%1,.8,.55):t.colorMode==="monochrome"?S=new C().setHSL(t.monochromeHue/360,.8,.55):t.colorMode==="white"?S=new C(1,1,1):S=new C(16746598);for(let y=0;y<o&&m<v;y++){const w=y*r,b=s[w*3],z=s[w*3+1],U=s[w*3+2]||0;for(let I=y+1;I<o&&m<v;I++){const T=I*r,_=s[T*3],R=s[T*3+1],Fe=s[T*3+2]||0,ce=_-b,he=R-z,de=ce*ce+he*he;if(de<u&&de>g){const K=this.particleLinkPool[m];K.geometry.setPositions([b,z,U+2.5,_,R,Fe+2.5]);const ee=K.material;ee.linewidth=t.particleLinkThickness||2,ee.opacity=t.particleLinkOpacity,ee.color=S,K.visible=!0,m++}}}}if(this.connectionLines.forEach((s,a)=>{const o=s.material;o.opacity=.3+Math.sin(this.animationTime*t.connectionPulseSpeed+a)*.2,o.linewidth=t.connectionThickness}),this.edgeFlowLines.forEach(s=>{s.userData.progress+=e*t.edgeFlowSpeed,s.userData.progress>1&&(s.userData.progress=0);const a=s.material;a.opacity=.3+Math.sin(s.userData.progress*Math.PI*2)*.3,a.linewidth=t.edgeFlowThickness}),this.arcBridges.forEach(s=>{const a=s.material;a.linewidth=t.arcBridgeThickness,a.opacity=t.arcBridgeOpacity}),t.lightningEnabled&&Math.random()<e*t.lightningFrequency){const s=this.lightningBolts.find(a=>!a.userData.active);s&&this.generateLightningBolt(s,t)}this.lightningBolts.forEach(s=>{if(s.userData.active){const a=this.animationTime-s.userData.startTime;if(a>t.lightningDuration)s.userData.active=!1,s.material.opacity=0;else{const o=1-a/t.lightningDuration;s.material.opacity=o}}}),this.plasmaTendrils.forEach(s=>{const a=s.geometry.attributes.position.array,o=s.userData.start,r=s.userData.target,p=s.userData.phase+this.animationTime*t.plasmaSpeed,u=20;for(let g=0;g<u;g++){const m=g/(u-1),v=new x().lerpVectors(o,r,m),S=new x().subVectors(r,o).normalize(),y=new x(-S.y,S.x,0),w=Math.sin(m*10+p)*t.plasmaIntensity*5*(1-Math.abs(m-.5)*2);v.add(y.multiplyScalar(w)),a[g*3]=v.x,a[g*3+1]=v.y,a[g*3+2]=v.z}s.geometry.attributes.position.needsUpdate=!0,s.material.opacity=t.plasmaOpacity})}generateLightningBolt(e,t){if(this.polygons.length<2)return;const i=Math.floor(Math.random()*this.polygons.length);let n=Math.floor(Math.random()*this.polygons.length);n===i&&(n=(n+1)%this.polygons.length);const l=this.polygons[i].centroid.clone(),c=this.polygons[n].centroid.clone(),h=e.geometry.attributes.position.array,d=10+t.lightningBranches*2;let f=l.clone();h[0]=f.x,h[1]=f.y,h[2]=f.z;for(let s=1;s<d;s++){const a=s/(d-1),o=new x().lerpVectors(l,c,a),r=new x((Math.random()-.5)*30,(Math.random()-.5)*30,0);f=o.add(r),h[s*3]=f.x,h[s*3+1]=f.y,h[s*3+2]=f.z}e.geometry.attributes.position.needsUpdate=!0,e.geometry.setDrawRange(0,d),e.material.opacity=1,e.userData.active=!0,e.userData.startTime=this.animationTime}render(){const e=this.renderer.getRenderTarget(),t=this.renderer.autoClear,i=new W;this.renderer.getViewport(i);const n=new W;this.renderer.getScissor(n);const l=this.renderer.getScissorTest();return this.renderer.autoClear=!0,this.renderer.setRenderTarget(this.renderTarget),this.renderer.setViewport(0,0,this.renderTarget.width,this.renderTarget.height),this.renderer.setScissor(0,0,this.renderTarget.width,this.renderTarget.height),this.renderer.setScissorTest(!0),this.renderer.clear(),this.renderer.render(this.scene,this.camera),this.renderer.setRenderTarget(e),this.renderer.setViewport(i),this.renderer.setScissor(n),this.renderer.setScissorTest(l),this.renderer.autoClear=t,this.renderTarget.texture}getTexture(){return this.renderTarget.texture}resize(e,t){if(!(e===this.width&&t===this.height)){if(e=Math.max(1,Math.floor(e)),t=Math.max(1,Math.floor(t)),this.width=e,this.height=t,this.ownsRenderer&&this.renderer.setSize(e,t),this.renderTarget.setSize(e,t),this.camera.left=-e/2,this.camera.right=e/2,this.camera.top=-t/2,this.camera.bottom=t/2,this.camera.updateProjectionMatrix(),this.initialWidth>0&&this.initialHeight>0){const i=e/this.initialWidth,n=t/this.initialHeight;this.sceneRoot.scale.set(i,n,1)}[...this.outlines,...this.connectionLines,...this.edgeFlowLines,...this.echoLayers,...this.arcBridges,...this.particleLinkPool].forEach(i=>{i.material&&i.material.resolution.set(e,t)}),this._needsRebuild=!0}}needsRebuild(){return this._needsRebuild||!1}_needsRebuild=!1;dispose(){this.clearScene(),this.ownsRenderer&&this.renderer.dispose(),this.renderTarget.dispose()}}export{Je as SVGLayerRenderer};
