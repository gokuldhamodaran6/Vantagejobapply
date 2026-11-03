"use client";
import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Environment, Html, Lightformer, PerformanceMonitor, RoundedBox, Sparkles } from "@react-three/drei";
import { Bloom, ChromaticAberration, EffectComposer, Noise, Vignette } from "@react-three/postprocessing";
import { BlendFunction, type ChromaticAberrationEffect } from "postprocessing";
import * as THREE from "three";
import { clusters, globe, rng, shield, vee } from "./shapes";

/**
 * The Vantage journey: one scroll, four scenes in a world of light and ice.
 * 0  A crystal prism floats in the dark: a job posting is light.
 * 1  The light splits into four beams; each freezes into an ice block: resume, letter, application, interview kit.
 * 2  The camera flies through the prism; the particles inside the blocks swarm into the world: where you can be hired.
 * 3  They fold into a shield with a check (every line checked), then into the Vantage V.
 */

export type Drive = { p: number };

export const BLOCKS = [
  { label: "Resume", color: "#4f7bff", pos: [4.2, 1.7, -0.4] as [number, number, number] },
  { label: "Cover letter", color: "#9b7bff", pos: [4.85, 0.55, 0.2] as [number, number, number] },
  { label: "Application", color: "#ff5c93", pos: [4.85, -0.65, 0.1] as [number, number, number] },
  { label: "Interview kit", color: "#ffae4d", pos: [4.2, -1.8, -0.3] as [number, number, number] },
];
const Layer = createContext<React.RefObject<HTMLDivElement | null> | null>(null);
const G: [number, number, number] = [0, 0, -10];
const CA0 = new THREE.Vector2(0.0006, 0.0006);
const BLOCK_V = BLOCKS.map((b) => new THREE.Vector3(...b.pos));
const BEAM_SHOW = BLOCKS.map((_, i) => (p: number) => ss(0.17 + i * 0.02, 0.26 + i * 0.02, p) * (1 - ss(0.46, 0.52, p)));
const IN_SHOW = (p: number) => 0.35 + ss(0.08, 0.2, p) * 0.65 - ss(0.5, 0.56, p);

const ss = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/* ------------------------------ camera ------------------------------ */

type Key = { p: number; pos: [number, number, number]; look: [number, number, number] };
function keys(portrait: boolean): Key[] {
  const low = portrait ? -1 : 0; // phones: shapes sit higher, above the words
  return [
    // Desktop: the prism sits right of the headline; phones: centred above it.
    { p: 0, pos: [portrait ? 0 : -1.6, 0.25, portrait ? 14 : 8.5], look: [portrait ? 0 : -1.6, portrait ? -2.9 : 0, 0] },
    { p: 0.18, pos: [1.4, 0.5, 8 * (portrait ? 1.5 : 1)], look: [0.6, portrait ? -2 : 0, 0] },
    // Phones pull back and look low, so the split sits above the words.
    { p: 0.32, pos: portrait ? [2.5, -1.6, 21] : [2.6, 0.45, 9], look: portrait ? [2.5, -2.6, 0] : [2.3, 0, 0] },
    { p: 0.42, pos: portrait ? [2.4, -1.6, 20.4] : [2.4, 0.4, 8.6], look: portrait ? [2.4, -2.6, 0] : [2.3, 0, 0] },
    { p: 0.5, pos: [0.25, 0.08, 2.2], look: [0, 0, -3] },
    { p: 0.56, pos: [0, 0, -1.6], look: [0, low, -10] },
    { p: 0.76, pos: [0.35, 0.22, -3 + (portrait ? 3.6 : 0)], look: [0, low, -10] },
    { p: 1, pos: [0, 0, -3.2 + (portrait ? 3.6 : 0)], look: [0, low, -10] },
  ];
}

function Rig({ drive, portrait }: { drive: Drive; portrait: boolean }) {
  const { camera } = useThree();
  const ks = useMemo(() => keys(portrait), [portrait]);
  const cur = useRef(0);
  const vecs = useRef({ pos: new THREE.Vector3(), look: new THREE.Vector3(), b: new THREE.Vector3() });
  useFrame((state, dt) => {
    const { pos, look, b: tmp } = vecs.current;
    cur.current = THREE.MathUtils.damp(cur.current, drive.p, 4, dt);
    const p = cur.current;
    let i = 0;
    while (i < ks.length - 2 && p > ks[i + 1].p) i++;
    const a = ks[i], b = ks[i + 1];
    const t = ss(a.p, b.p, p);
    pos.set(...a.pos).lerp(tmp.set(...b.pos), t);
    look.set(...a.look).lerp(tmp.set(...b.look), t);
    // A breath of parallax from the pointer.
    pos.x += state.pointer.x * 0.25;
    pos.y += state.pointer.y * 0.15;
    camera.position.copy(pos);
    camera.lookAt(look);
    // Phones widen the lens for the globe and shapes, so they fit above the words.
    const cam = state.camera;
    if (portrait && cam instanceof THREE.PerspectiveCamera) {
      const fov = 38 + 16 * ss(0.5, 0.6, p);
      if (Math.abs(cam.fov - fov) > 0.01) {
        cam.fov = fov;
        cam.updateProjectionMatrix();
      }
    }
  });
  return null;
}

/* ------------------------------ prism ------------------------------ */

function Prism({ drive }: { drive: Drive }) {
  const ref = useRef<THREE.Mesh>(null);
  const geo = useMemo(() => new THREE.CylinderGeometry(1.15, 1.15, 1.7, 3, 1), []);
  const edges = useMemo(() => new THREE.EdgesGeometry(geo), [geo]);
  useFrame((st) => {
    if (!ref.current) return;
    const t = st.clock.elapsedTime;
    ref.current.rotation.y = Math.sin(t * 0.25) * 0.35 + drive.p * 1.2;
    ref.current.position.y = Math.sin(t * 0.6) * 0.06;
  });
  return (
    <mesh ref={ref} geometry={geo} rotation={[-Math.PI / 2, 0, 0]}>
      <meshPhysicalMaterial transmission={1} thickness={1.6} roughness={0.02} ior={1.5} dispersion={6} color="#ffffff" specularIntensity={1} envMapIntensity={1.6} attenuationColor="#dfe8ff" attenuationDistance={4} />
      <lineSegments geometry={edges}>
        <lineBasicMaterial color="#cfe0ff" transparent opacity={0.85} toneMapped={false} />
      </lineSegments>
    </mesh>
  );
}

/* ------------------------------ beams ------------------------------ */

function Beam({ from, to, color, show, drive, width = 0.018 }: { from: THREE.Vector3; to: THREE.Vector3; color: string; show: (p: number) => number; drive: Drive; width?: number }) {
  const core = useRef<THREE.MeshBasicMaterial>(null);
  const halo = useRef<THREE.MeshBasicMaterial>(null);
  const g = useRef<THREE.Group>(null);
  const { pos, quat, len } = useMemo(() => {
    const d = new THREE.Vector3().subVectors(to, from);
    return { pos: new THREE.Vector3().addVectors(from, to).multiplyScalar(0.5), quat: new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.clone().normalize()), len: d.length() };
  }, [from, to]);
  useFrame((st) => {
    const v = show(drive.p);
    const flick = 0.92 + Math.sin(st.clock.elapsedTime * 9 + len) * 0.08;
    if (core.current) core.current.opacity = v * flick;
    if (halo.current) halo.current.opacity = v * 0.18;
    if (g.current) g.current.visible = v > 0.01;
  });
  return (
    <group ref={g} position={pos} quaternion={quat}>
      <mesh>
        <cylinderGeometry args={[width, width, len, 8, 1, true]} />
        <meshBasicMaterial ref={core} color={color} transparent blending={THREE.AdditiveBlending} depthWrite={false} toneMapped={false} />
      </mesh>
      <mesh>
        <cylinderGeometry args={[width * 5, width * 5, len, 12, 1, true]} />
        <meshBasicMaterial ref={halo} color={color} transparent blending={THREE.AdditiveBlending} depthWrite={false} toneMapped={false} />
      </mesh>
    </group>
  );
}

/* ------------------------------ ice blocks ------------------------------ */

function docTexture(label: string, color: string) {
  const c = document.createElement("canvas");
  c.width = 256;
  c.height = 320;
  const g = c.getContext("2d")!;
  g.fillStyle = "rgba(255,255,255,0.92)";
  g.beginPath();
  g.roundRect(8, 8, 240, 304, 18);
  g.fill();
  g.fillStyle = color;
  g.fillRect(28, 34, 46, 46);
  g.fillStyle = "#0b1a3a";
  g.font = "700 26px ui-monospace, Menlo, monospace";
  g.fillText(label.toUpperCase(), 28, 120);
  for (let i = 0; i < 7; i++) {
    g.fillStyle = i % 3 === 0 ? color : "rgba(11,26,58,0.28)";
    g.fillRect(28, 146 + i * 22, i % 3 === 0 ? 120 : 200 - (i % 2) * 40, 8);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function IceBlock({ i, drive, low }: { i: number; drive: Drive; low: boolean }) {
  const b = BLOCKS[i];
  const g = useRef<THREE.Group>(null);
  const tag = useRef<HTMLDivElement>(null);
  const host = useContext(Layer);
  const tex = useMemo(() => docTexture(b.label, b.color), [b.label, b.color]);
  const crystals = useMemo(() => {
    const r = rng(11 + i);
    return Array.from({ length: low ? 12 : 26 }, () => ({
      pos: [(r() - 0.5) * 0.8, (r() - 0.5) * 0.8, (r() - 0.5) * 0.8] as [number, number, number],
      rot: [r() * Math.PI, r() * Math.PI, r() * Math.PI] as [number, number, number],
      len: 0.15 + r() * 0.45,
    }));
  }, [i, low]);
  useFrame((st) => {
    if (!g.current) return;
    const v = ss(0.2 + i * 0.025, 0.3 + i * 0.025, drive.p) * (1 - ss(0.47, 0.53, drive.p));
    const s = 0.001 + v;
    g.current.scale.setScalar(s);
    g.current.visible = v > 0.01;
    g.current.rotation.y = Math.sin(st.clock.elapsedTime * 0.4 + i) * 0.25 - 0.35;
    g.current.rotation.x = Math.sin(st.clock.elapsedTime * 0.3 + i * 2) * 0.12;
    if (tag.current) tag.current.style.opacity = String(ss(0.27, 0.32, drive.p) * (1 - ss(0.42, 0.46, drive.p)));
  });
  return (
    <group ref={g} position={b.pos}>
      <RoundedBox args={[1.05, 1.05, 1.05]} radius={0.12} smoothness={3}>
        <meshPhysicalMaterial transmission={1} thickness={1.1} roughness={0.22} ior={1.31} color="#eaf2ff" attenuationColor={b.color} attenuationDistance={3} envMapIntensity={1.4} clearcoat={1} clearcoatRoughness={0.1} />
      </RoundedBox>
      <mesh>
        <planeGeometry args={[0.46, 0.575]} />
        <meshBasicMaterial map={tex} transparent toneMapped={false} />
      </mesh>
      {crystals.map((c, k) => (
        <mesh key={k} position={c.pos} rotation={c.rot}>
          <boxGeometry args={[0.012, c.len, 0.012]} />
          <meshBasicMaterial color="#dff0ff" transparent opacity={0.55} blending={THREE.AdditiveBlending} depthWrite={false} toneMapped={false} />
        </mesh>
      ))}
      <Html position={[0, -0.66, 0]} center zIndexRange={[5, 0]} style={{ pointerEvents: "none" }} portal={(host || undefined) as React.RefObject<HTMLElement> | undefined}>
        <div ref={tag} className="jr-tag" style={{ opacity: 0, ["--tone" as string]: b.color }}>
          <span>0{i + 1}</span>
          {b.label}
        </div>
      </Html>
    </group>
  );
}

/* ------------------------------ particles ------------------------------ */

const VERT = /* glsl */ `
uniform float uMorph; uniform float uTime; uniform float uSize; uniform float uPixel;
attribute vec3 aPos0; attribute vec3 aPos1; attribute vec3 aPos2; attribute vec3 aPos3; attribute float aRand;
varying float vMid; varying float vRand;
void main(){
  float m = clamp(uMorph, 0.0, 2.999);
  float seg = floor(m); float t = m - seg;
  float st = clamp((t - aRand * 0.4) / 0.6, 0.0, 1.0); st = st * st * (3.0 - 2.0 * st);
  vec3 a = seg < 0.5 ? aPos0 : (seg < 1.5 ? aPos1 : aPos2);
  vec3 b = seg < 0.5 ? aPos1 : (seg < 1.5 ? aPos2 : aPos3);
  vec3 p = mix(a, b, st);
  float mid = sin(st * 3.14159);
  // Swirl while travelling, a quiet drift at rest.
  float ang = mid * (2.0 + aRand * 3.0);
  vec3 c = mix(a, b, 0.5);
  vec3 d = p - c; p = c + vec3(d.x * cos(ang) - d.z * sin(ang), d.y, d.x * sin(ang) + d.z * cos(ang));
  p += vec3(sin(uTime * 0.7 + aRand * 40.0), cos(uTime * 0.6 + aRand * 31.0), sin(uTime * 0.5 + aRand * 23.0)) * (0.018 + mid * 0.6);
  vMid = mid; vRand = aRand;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_PointSize = uSize * (0.55 + aRand * 0.9) * uPixel / -mv.z;
  gl_Position = projectionMatrix * mv;
}`;
const FRAG = /* glsl */ `
uniform float uAlpha; varying float vMid; varying float vRand;
void main(){
  vec2 q = gl_PointCoord - 0.5; float d = length(q);
  if (d > 0.5) discard;
  float a = smoothstep(0.5, 0.0, d);
  vec3 ice = mix(vec3(0.62, 0.8, 1.0), vec3(1.0), vRand * 0.5);
  vec3 hot = mix(vec3(0.6, 0.45, 1.0), vec3(1.0, 0.45, 0.65), vRand);
  vec3 col = mix(ice, hot, vMid);
  gl_FragColor = vec4(col * (1.0 + vMid * 1.5), a * uAlpha);
}`;

function Swarm({ drive, land, n }: { drive: Drive; land: number[]; n: number }) {
  const mat = useRef<THREE.ShaderMaterial>(null);
  const { gl } = useThree();
  const geo = useMemo(() => {
    const g = new THREE.BufferGeometry();
    const p0 = clusters(n, BLOCKS.map((b) => b.pos), 0.62);
    g.setAttribute("position", new THREE.BufferAttribute(p0, 3));
    g.setAttribute("aPos0", new THREE.BufferAttribute(p0, 3));
    g.setAttribute("aPos1", new THREE.BufferAttribute(globe(n, land, G, 1.75), 3));
    g.setAttribute("aPos2", new THREE.BufferAttribute(shield(n, G), 3));
    g.setAttribute("aPos3", new THREE.BufferAttribute(vee(n, G), 3));
    const r = rng(9);
    g.setAttribute("aRand", new THREE.BufferAttribute(Float32Array.from({ length: n }, () => r()), 1));
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(2, 0, -5), 20);
    return g;
  }, [land, n]);
  const uniforms = useMemo(() => ({ uMorph: { value: 0 }, uTime: { value: 0 }, uSize: { value: 0.05 }, uPixel: { value: 1 }, uAlpha: { value: 0 } }), []);
  useFrame((st) => {
    const u = mat.current?.uniforms;
    if (!u) return;
    const p = drive.p;
    u.uTime.value = st.clock.elapsedTime;
    u.uPixel.value = gl.getPixelRatio() * st.size.height * 0.5;
    u.uMorph.value = ss(0.46, 0.6, p) + ss(0.74, 0.84, p) + ss(0.88, 0.97, p);
    u.uAlpha.value = ss(0.27, 0.34, p);
  });
  return (
    <points geometry={geo} frustumCulled={false}>
      <shaderMaterial ref={mat} vertexShader={VERT} fragmentShader={FRAG} uniforms={uniforms} transparent depthWrite={false} blending={THREE.AdditiveBlending} />
    </points>
  );
}

/* ------------------------------ background ------------------------------ */

const AURORA = {
        vertexShader: "varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }",
        fragmentShader: `uniform float uTime; varying vec2 vUv;
          float n(vec2 p){ return sin(p.x*3.1+uTime*0.15)*sin(p.y*2.3-uTime*0.12)+sin((p.x+p.y)*1.7+uTime*0.09); }
          void main(){
            vec2 p = vUv*2.0-1.0;
            float a = n(p*1.4)*0.5+0.5; float b = n(p*0.9+3.0)*0.5+0.5;
            vec3 base = vec3(0.012,0.022,0.06);
            vec3 c1 = vec3(0.10,0.22,0.55); vec3 c2 = vec3(0.32,0.16,0.55);
            vec3 col = base + c1*pow(a,3.0)*0.35 + c2*pow(b,4.0)*0.28;
            col *= 1.0 - length(p)*0.35;
            gl_FragColor = vec4(col,1.0);
          }`,
};
function Aurora() {
  const mat = useRef<THREE.ShaderMaterial>(null);
  const uniforms = useMemo(() => ({ uTime: { value: 0 } }), []);
  useFrame((st) => {
    if (mat.current) mat.current.uniforms.uTime.value = st.clock.elapsedTime;
  });
  return (
    <mesh position={[0, 0, -40]} scale={[120, 70, 1]}>
      <planeGeometry />
      <shaderMaterial ref={mat} depthWrite={false} uniforms={uniforms} vertexShader={AURORA.vertexShader} fragmentShader={AURORA.fragmentShader} />
    </mesh>
  );
}

/* ------------------------------ effects ------------------------------ */

function Effects({ drive, full }: { drive: Drive; full: boolean }) {
  const ca = useRef<ChromaticAberrationEffect>(null);
  const off = useRef(new THREE.Vector2(0.0006, 0.0006));
  useFrame(() => {
    // The lens bends hardest while flying through the prism and between scenes.
    const p = drive.p;
    const spike = Math.max(ss(0.44, 0.5, p) * (1 - ss(0.52, 0.58, p)), ss(0.18, 0.21, p) * (1 - ss(0.21, 0.25, p)) * 0.5, ss(0.73, 0.76, p) * (1 - ss(0.76, 0.8, p)) * 0.6);
    const v = 0.0006 + spike * 0.006;
    off.current.set(v, v * 0.6);
    if (ca.current) ca.current.offset = off.current;
  });
  if (!full)
    return (
      <EffectComposer multisampling={0}>
        <Bloom intensity={1.0} luminanceThreshold={0.3} mipmapBlur />
        <Vignette darkness={0.55} offset={0.3} />
      </EffectComposer>
    );
  return (
    <EffectComposer multisampling={0}>
      <Bloom intensity={1.15} luminanceThreshold={0.28} luminanceSmoothing={0.2} mipmapBlur />
      <ChromaticAberration ref={ca} offset={CA0} radialModulation={false} modulationOffset={0} />
      <Noise opacity={0.055} blendFunction={BlendFunction.OVERLAY} />
      <Vignette darkness={0.6} offset={0.28} />
    </EffectComposer>
  );
}

/* ------------------------------ scene ------------------------------ */

export default function JourneyScene({ drive, mobile, onLost }: { drive: Drive; mobile: boolean; onLost?: () => void }) {
  const [land, setLand] = useState<number[] | null>(null);
  const [dpr, setDpr] = useState(mobile ? 1.25 : 1.6);
  const [full, setFull] = useState(!mobile);
  const [portrait, setPortrait] = useState(false);
  // Labels live in a plain layer over the canvas; drei's default host can drop one on a quick remount.
  const layer = useRef<HTMLDivElement>(null);
  useEffect(() => {
    fetch("/globe-land.json").then((r) => r.json()).then(setLand).catch(() => setLand([0, 0]));
    const on = () => setPortrait(window.innerWidth / window.innerHeight < 0.9);
    on();
    window.addEventListener("resize", on);
    return () => window.removeEventListener("resize", on);
  }, []);
  const prismOut = useMemo(() => new THREE.Vector3(0.95, 0, 0), []);
  const prismIn = useMemo(() => new THREE.Vector3(-0.85, -0.1, 0), []);
  const from = useMemo(() => new THREE.Vector3(-14, -1.2, -0.5), []);

  return (
    <div className="absolute inset-0">
    <div ref={layer} className="pointer-events-none absolute inset-0 z-10" />
    <Layer.Provider value={layer}>
    <Canvas
      dpr={dpr}
      camera={{ position: [0, 0.25, 8.5], fov: 38, near: 0.1, far: 200 }}
      gl={{ antialias: false, alpha: false, powerPreference: "high-performance", stencil: false }}
      onCreated={({ gl }) => {
        gl.toneMapping = THREE.ACESFilmicToneMapping;
        gl.domElement.addEventListener("webglcontextlost", (e) => {
          e.preventDefault();
          setTimeout(() => gl.domElement.isConnected && gl.getContext().isContextLost() && onLost?.(), 2000);
        });
      }}
    >
      <PerformanceMonitor onDecline={() => { setDpr(1); setFull(false); }} flipflops={2} />
      <color attach="background" args={["#040812"]} />
      <fog attach="fog" args={["#040812", 18, 60]} />
      <ambientLight intensity={0.25} />
      <Environment resolution={256} frames={1}>
        <Lightformer form="rect" intensity={4} position={[0, 5, 5]} scale={[10, 2, 1]} color="#ffffff" />
        <Lightformer form="rect" intensity={3} position={[-6, 0, 3]} scale={[2, 8, 1]} color="#7fa8ff" />
        <Lightformer form="rect" intensity={3} position={[6, -1, 3]} scale={[2, 8, 1]} color="#ff8fd0" />
        <Lightformer form="ring" intensity={3} position={[0, 0, -8]} scale={5} color="#a9c4ff" />
      </Environment>
      <Aurora />
      <Sparkles count={mobile ? 70 : 160} scale={[26, 12, 30]} position={[1, 0, -6]} size={2.2} speed={0.25} opacity={0.6} color="#cfe0ff" />
      <Rig drive={drive} portrait={portrait} />

      <Beam from={from} to={prismIn} color="#ffffff" drive={drive} width={0.022} show={IN_SHOW} />
      <Prism drive={drive} />
      {BLOCKS.map((b, i) => (
        <Beam key={b.label} from={prismOut} to={BLOCK_V[i]} color={b.color} drive={drive} show={BEAM_SHOW[i]} />
      ))}
      {BLOCKS.map((b, i) => <IceBlock key={b.label} i={i} drive={drive} low={mobile} />)}
      {land && <Swarm drive={drive} land={land} n={mobile ? 4200 : 9000} />}
      <Effects drive={drive} full={full} />
    </Canvas>
    </Layer.Provider>
    </div>
  );
}
