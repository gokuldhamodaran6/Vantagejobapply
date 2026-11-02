"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Environment, Float, Html, Lightformer, MeshTransmissionMaterial } from "@react-three/drei";
import * as THREE from "three";
import { CARDS, type HeroDemo } from "./cards";
import { createContext, useContext } from "react";

/** One fixed DOM layer for every in-scene card, so cards never remount (and never come up empty). */
const Layer = createContext<React.RefObject<HTMLDivElement | null> | null>(null);

/**
 * The hero in 3D: a job posting enters as white light, a real glass prism splits it, and four beams land on
 * the four things Vantage makes for that one job. Drag to turn the scene, hover a card to light its beam,
 * click a card to fly to it. Everything shown is an illustrative, fictional example.
 */

const DF = 3.4;
const PRISM = new THREE.Vector3(-0.55, -0.15, 0);
const IN_FROM = new THREE.Vector3(-3.4, -0.6, -0.2);
const POSTING = new THREE.Vector3(-1.75, 1.6, 0.1);
const SLOTS = [
  new THREE.Vector3(1.2, 1.8, -0.2),
  new THREE.Vector3(1.55, 0.6, 0.25),
  new THREE.Vector3(1.5, -0.7, 0.1),
  new THREE.Vector3(1.15, -1.9, -0.25),
];

/** A glowing beam between two points: a thin core and a soft halo, additive so beams brighten where they cross. */
function Beam({ from, to, color, power = 1 }: { from: THREE.Vector3; to: THREE.Vector3; color: string; power?: number }) {
  const core = useRef<THREE.MeshBasicMaterial>(null);
  const halo = useRef<THREE.MeshBasicMaterial>(null);
  const { pos, quat, len } = useMemo(() => {
    const d = new THREE.Vector3().subVectors(to, from);
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.clone().normalize());
    return { pos: new THREE.Vector3().addVectors(from, to).multiplyScalar(0.5), quat: q, len: d.length() };
  }, [from, to]);
  useFrame(() => {
    if (core.current) core.current.opacity += (0.55 + 0.45 * power - core.current.opacity) * 0.12;
    if (halo.current) halo.current.opacity += (0.06 + 0.16 * power - halo.current.opacity) * 0.12;
  });
  return (
    <group position={pos} quaternion={quat}>
      <mesh>
        <cylinderGeometry args={[0.012, 0.012, len, 8, 1, true]} />
        <meshBasicMaterial ref={core} color={color} transparent opacity={0.8} blending={THREE.AdditiveBlending} depthWrite={false} toneMapped={false} />
      </mesh>
      <mesh>
        <cylinderGeometry args={[0.06, 0.06, len, 12, 1, true]} />
        <meshBasicMaterial ref={halo} color={color} transparent opacity={0.12} blending={THREE.AdditiveBlending} depthWrite={false} toneMapped={false} />
      </mesh>
    </group>
  );
}

/** Job postings travelling down the white beam into the prism. */
function Postings({ pulse }: { pulse: number }) {
  const n = 12;
  const ref = useRef<THREE.InstancedMesh>(null);
  const tmp = useMemo(() => new THREE.Object3D(), []);
  const offsets = useMemo(() => Array.from({ length: n }, (_, i) => i / n), []);
  const boost = useRef(0);
  useEffect(() => {
    boost.current = 1;
  }, [pulse]);
  useFrame((_, dt) => {
    if (!ref.current) return;
    boost.current = Math.max(0, boost.current - dt * 0.9);
    const speed = 0.16 + boost.current * 0.5;
    offsets.forEach((o, i) => {
      offsets[i] = (o + dt * speed) % 1;
      const t = offsets[i];
      tmp.position.lerpVectors(IN_FROM, PRISM, t);
      const s = 0.035 + 0.03 * Math.sin(t * Math.PI);
      tmp.scale.setScalar(s * (1 + boost.current));
      tmp.updateMatrix();
      ref.current!.setMatrixAt(i, tmp.matrix);
    });
    ref.current.instanceMatrix.needsUpdate = true;
  });
  return (
    <instancedMesh ref={ref} args={[undefined, undefined, n]}>
      <sphereGeometry args={[1, 12, 12]} />
      <meshBasicMaterial color="#ffffff" toneMapped={false} />
    </instancedMesh>
  );
}

/** The glass prism. Real refraction and dispersion, turning gently with the pointer. */
function Prism({ low, mobile }: { low: boolean; mobile?: boolean }) {
  const ref = useRef<THREE.Mesh>(null);
  const geo = useMemo(() => new THREE.CylinderGeometry(0.85, 0.85, 1.25, 3, 1), []);
  const edges = useMemo(() => new THREE.EdgesGeometry(geo), [geo]);
  useFrame((state) => {
    if (!ref.current) return;
    const t = state.clock.elapsedTime;
    ref.current.rotation.y = Math.sin(t * 0.35) * 0.25 + (mobile ? Math.sin(t * 0.5) * 0.2 : state.pointer.x * 0.25);
    ref.current.rotation.x = -Math.PI / 2 + (mobile ? 0 : state.pointer.y * 0.08);
  });
  return (
    <mesh ref={ref} position={PRISM} rotation={[-Math.PI / 2, 0, 0]} geometry={geo} scale={mobile ? 1.25 : 1}>
      <lineSegments geometry={edges}>
        <lineBasicMaterial color="#ffffff" transparent opacity={0.9} toneMapped={false} />
      </lineSegments>
      <MeshTransmissionMaterial
        backside
        samples={mobile ? 2 : low ? 3 : 6}
        resolution={mobile ? 256 : low ? 384 : 768}
        thickness={1.1}
        roughness={0.04}
        transmission={1}
        ior={1.45}
        chromaticAberration={0.9}
        anisotropicBlur={0.15}
        distortion={0.2}
        distortionScale={0.4}
        temporalDistortion={0.05}
        color="#ffffff"
        attenuationColor="#e8eeff"
        attenuationDistance={2.5}
      />
    </mesh>
  );
}

function Posting({ children }: { children: React.ReactNode }) {
  return (
    <Float speed={1.1} rotationIntensity={0.12} floatIntensity={0.3} floatingRange={[-0.05, 0.05]}>
      <group position={[POSTING.x, POSTING.y, POSTING.z]}>
        <Html transform distanceFactor={DF} zIndexRange={[20, 0]} portal={(useContext(Layer) || undefined) as React.RefObject<HTMLElement> | undefined}>
          {children}
        </Html>
      </group>
    </Float>
  );
}

/** Soft spectral light behind the prism: the glass refracts it, so the prism reads as crystal, not grey. */
function Glow() {
  const blobs = useMemo(() => [
    { c: "#7cc7ff", p: [-0.9, 0.5, -2.2] as const, s: 1.1 },
    { c: "#9b8cff", p: [0.3, 0.2, -2.6] as const, s: 1.2 },
    { c: "#f5a3e0", p: [0.1, -0.8, -2.3] as const, s: 1.0 },
    { c: "#ffc48a", p: [-0.8, -0.7, -2.0] as const, s: 0.8 },
  ], []);
  const tex = useMemo(() => {
    const c = document.createElement("canvas");
    c.width = c.height = 128;
    const g = c.getContext("2d")!;
    const r = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    r.addColorStop(0, "rgba(255,255,255,1)");
    r.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = r;
    g.fillRect(0, 0, 128, 128);
    return new THREE.CanvasTexture(c);
  }, []);
  const ref = useRef<THREE.Group>(null);
  useFrame((st) => {
    if (ref.current) ref.current.rotation.z = Math.sin(st.clock.elapsedTime * 0.2) * 0.3;
  });
  return (
    <group ref={ref} position={[PRISM.x, PRISM.y, 0]}>
      {blobs.map((b) => (
        <sprite key={b.c} position={[b.p[0], b.p[1], b.p[2]]} scale={[b.s * 2.4, b.s * 2.4, 1]}>
          <spriteMaterial map={tex} color={b.c} transparent opacity={0.75} depthWrite={false} toneMapped={false} />
        </sprite>
      ))}
    </group>
  );
}

/** On phones each output is a glowing orb; the readable card sits below the scene. */
function Orb({ i, pos, on }: { i: number; pos: THREE.Vector3; on: boolean }) {
  const ref = useRef<THREE.Group>(null);
  useFrame((st) => {
    if (!ref.current) return;
    const t = st.clock.elapsedTime;
    const s = (on ? 1.5 : 1) * (1 + Math.sin(t * 2 + i) * 0.06);
    ref.current.scale.x += (s - ref.current.scale.x) * 0.12;
    ref.current.scale.y = ref.current.scale.z = ref.current.scale.x;
  });
  return (
    <group ref={ref} position={pos}>
      <mesh>
        <sphereGeometry args={[0.16, 24, 24]} />
        <meshBasicMaterial color={CARDS[i].color} toneMapped={false} />
      </mesh>
      <mesh>
        <sphereGeometry args={[0.32, 24, 24]} />
        <meshBasicMaterial color={CARDS[i].color} transparent opacity={on ? 0.28 : 0.14} blending={THREE.AdditiveBlending} depthWrite={false} toneMapped={false} />
      </mesh>
    </group>
  );
}

function Card({ i, pos, active, hovered, dim, onHover, onPick, children }: { i: number; pos: THREE.Vector3; active: boolean; hovered: boolean; dim?: boolean; onHover: (i: number | null) => void; onPick: (i: number) => void; children: React.ReactNode }) {
  const g = useRef<THREE.Group>(null);
  useFrame(() => {
    if (!g.current) return;
    const lift = hovered || active ? 0.28 : 0;
    g.current.position.z += (pos.z + lift - g.current.position.z) * 0.12;
    const s = hovered ? 1.06 : 1;
    g.current.scale.x += (s - g.current.scale.x) * 0.15;
    g.current.scale.y = g.current.scale.z = g.current.scale.x;
  });
  return (
    <Float speed={1.4} rotationIntensity={0.18} floatIntensity={0.35} floatingRange={[-0.05, 0.05]}>
      <group ref={g} position={[pos.x, pos.y, pos.z]}>
        <Html transform distanceFactor={DF} zIndexRange={[20, 0]} occlude={false} pointerEvents="auto" portal={(useContext(Layer) || undefined) as React.RefObject<HTMLElement> | undefined}>
          <button
            type="button"
            onPointerEnter={(e) => e.pointerType === "mouse" && onHover(i)}
            onPointerLeave={(e) => e.pointerType === "mouse" && onHover(null)}
            onFocus={() => onHover(i)}
            onBlur={() => onHover(null)}
            onClick={() => onPick(i)}
            aria-label={`Open the ${CARDS[i].label.toLowerCase()} example`}
            className="v3-card block w-[230px] select-none rounded-[18px] p-3.5 text-left"
            style={{ ["--tone" as string]: CARDS[i].color, opacity: dim ? 0.3 : 1, transition: "opacity .35s, box-shadow .25s, background .25s" }}
          >
            {children}
          </button>
        </Html>
      </group>
    </Float>
  );
}

/** Drag anywhere to turn the whole scene; it eases back toward the pointer when you let go. */
function Rig({ focus, children, compact, mobile }: { focus: number | null; children: React.ReactNode; compact: boolean; mobile?: boolean }) {
  const group = useRef<THREE.Group>(null);
  const drag = useRef({ on: false, x: 0, y: 0, rx: 0, ry: 0 });
  const { gl, camera } = useThree();
  useEffect(() => {
    const el = gl.domElement;
    const down = (e: PointerEvent) => {
      if (e.pointerType === "touch") return; // touch scrolls the page; the scene follows taps instead
      drag.current = { ...drag.current, on: true, x: e.clientX, y: e.clientY };
    };
    const move = (e: PointerEvent) => {
      if (!drag.current.on) return;
      drag.current.ry = THREE.MathUtils.clamp(drag.current.ry + (e.clientX - drag.current.x) * 0.006, -0.75, 0.75);
      drag.current.rx = THREE.MathUtils.clamp(drag.current.rx + (e.clientY - drag.current.y) * 0.004, -0.35, 0.35);
      drag.current.x = e.clientX;
      drag.current.y = e.clientY;
    };
    const up = () => (drag.current.on = false);
    el.addEventListener("pointerdown", down);
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    return () => {
      el.removeEventListener("pointerdown", down);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
  }, [gl]);
  const look = useMemo(() => new THREE.Vector3(), []);
  const want = useMemo(() => new THREE.Vector3(), []);
  useFrame((state) => {
    const g = group.current;
    if (!g) return;
    const d = drag.current;
    if (!d.on) {
      d.ry *= 0.985;
      d.rx *= 0.985;
    }
    const t = state.clock.elapsedTime;
    const ty = mobile ? Math.sin(t * 0.3) * 0.32 : d.ry + (focus === null ? state.pointer.x * 0.18 : 0);
    const tx = mobile ? Math.sin(t * 0.23) * 0.08 : d.rx - (focus === null ? state.pointer.y * 0.08 : 0);
    g.rotation.y += (ty - g.rotation.y) * 0.08;
    g.rotation.x += (tx - g.rotation.x) * 0.08;
    // Camera: overview, or close on the chosen card.
    const base = compact ? 12.2 : 10;
    if (mobile) {
      want.set(-0.15, 0, 8.4);
      look.lerp(new THREE.Vector3(-0.15, 0, 0), 0.08);
    } else if (focus === null) {
      want.set(0, 0, base);
      look.lerp(new THREE.Vector3(0, 0, 0), 0.08);
    } else {
      const p = SLOTS[focus].clone().applyEuler(g.rotation);
      // Close enough to read, far enough to keep its beam and the prism in view; the card sits upper right.
      want.set(p.x * 0.55, p.y * 0.5 - 0.35, (compact ? 10.5 : 8.4));
      look.lerp(new THREE.Vector3(p.x * 0.5, p.y * 0.45 - 0.5, 0), 0.08);
    }
    camera.position.lerp(want, 0.07);
    camera.lookAt(look);
  });
  return <group ref={group}>{children}</group>;
}

export default function HeroScene({ demo, demoKey, focus, setFocus, hovered, setHovered, compact, low, mobile = false, onLost }: {
  demo: HeroDemo;
  demoKey: number;
  focus: number | null;
  setFocus: (i: number | null) => void;
  hovered: number | null;
  setHovered: (i: number | null) => void;
  compact: boolean;
  low: boolean;
  /** Phones: a lighter scene that never takes touches (they scroll the page); the cards live below it. */
  mobile?: boolean;
  /** The browser dropped the WebGL context (memory pressure on phones): show the flat version instead. */
  onLost?: () => void;
}) {
  const wrap = useRef<HTMLDivElement>(null);
  const layer = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(true);
  useEffect(() => {
    const io = new IntersectionObserver(([e]) => setVisible(e.isIntersecting), { rootMargin: "120px" });
    if (wrap.current) io.observe(wrap.current);
    return () => io.disconnect();
  }, []);
  const prismOut = useMemo(() => PRISM.clone().add(new THREE.Vector3(0.55, 0.05, 0)), []);
  const prismIn = useMemo(() => PRISM.clone().add(new THREE.Vector3(-0.5, -0.12, 0)), []);

  return (
    <div ref={wrap} className="absolute inset-0 touch-pan-y" style={mobile ? { pointerEvents: "none" } : { cursor: "grab" }}>
      <div ref={layer} className="pointer-events-none absolute inset-0 z-10" />
      <Layer.Provider value={layer}>
      <Canvas
        dpr={mobile ? [1, 1.5] : low ? [1, 1.25] : [1, 1.75]}
        frameloop={visible ? "always" : "never"}
        camera={{ position: [0, 0, compact ? 12.2 : 10], fov: 32 }}
        gl={{ antialias: true, alpha: true, powerPreference: "high-performance" }}
        onPointerMissed={() => !mobile && setFocus(null)}
        onCreated={({ gl }) => {
          // Only a real loss (the canvas is still on the page and didn't come back) switches to the flat version;
          // unmounting also fires this event and must not.
          gl.domElement.addEventListener("webglcontextlost", (e) => {
            e.preventDefault();
            setTimeout(() => {
              if (gl.domElement.isConnected && gl.getContext().isContextLost()) onLost?.();
            }, 2000);
          });
        }}
      >
        <ambientLight intensity={0.8} />
        <directionalLight position={[3, 4, 5]} intensity={1.2} />
        <Environment resolution={256}>
          <Lightformer form="rect" intensity={3} position={[0, 4, 4]} scale={[8, 2, 1]} color="#ffffff" />
          <Lightformer form="rect" intensity={2} position={[-5, 0, 2]} scale={[2, 6, 1]} color="#c9d8ff" />
          <Lightformer form="rect" intensity={2} position={[5, -1, 2]} scale={[2, 6, 1]} color="#ffd9ec" />
          <Lightformer form="ring" intensity={2.5} position={[0, 0, -6]} scale={4} color="#e6ecff" />
        </Environment>
        <Rig focus={mobile ? null : focus} compact={compact} mobile={mobile}>
          <Beam from={IN_FROM} to={prismIn} color="#ffffff" power={1} />
          <Postings pulse={demoKey} />
          <Glow />
          <Prism low={low} mobile={mobile} />
          {SLOTS.map((s, i) => (
            <Beam key={i} from={prismOut} to={s} color={CARDS[i].color} power={hovered === i || focus === i ? 1.6 : hovered === null && focus === null ? 0.7 : 0.25} />
          ))}

          {mobile && SLOTS.map((p, i) => <Orb key={i} i={i} pos={p} on={hovered === i} />)}
          {!mobile && <>
          {/* the posting that came in */}
          <Posting>
            <div key={demoKey} className="v3-posting w-[250px] rounded-[18px] p-3.5">
                  <div className="flex items-center gap-2.5">
                    <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-[var(--deep)] text-[13px] font-bold text-white">{demo.company[0]}</span>
                    <div className="min-w-0">
                      <p className="truncate text-[12.5px] font-semibold">{demo.title}</p>
                      <p className="truncate text-[11px] text-[var(--deep-3)]">{demo.company} · {demo.place}</p>
                    </div>
                  </div>
                  <p className="mt-2.5 text-[11.5px] font-medium text-[var(--deep-3)]">The job asks for</p>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {demo.reqs.map((r) => <span key={r} className="rounded-full border border-[rgba(11,26,58,0.1)] bg-white/90 px-2 py-0.5 text-[11.5px] font-medium">{r}</span>)}
                  </div>
                </div>
          </Posting>

          <Card i={0} pos={SLOTS[0]} active={focus === 0} dim={focus !== null && focus !== 0} hovered={hovered === 0} onHover={setHovered} onPick={setFocus}>
            <Head i={0} sub={`Written for ${demo.company.split(" ")[0]}`} right={<span className="rounded-full bg-[#eef2fe] px-2 py-0.5 text-[11.5px] font-bold text-[#2448c8]">Review {demo.score}</span>} />
            <p className="mt-2 line-clamp-1 text-[11.5px] font-semibold text-[var(--deep-2)]">{demo.headline}</p>
            <p className="mt-1 line-clamp-2 text-[11.5px] leading-snug text-[var(--deep-3)]">• {demo.bullet}</p>
          </Card>
          <Card i={1} pos={SLOTS[1]} active={focus === 1} dim={focus !== null && focus !== 1} hovered={hovered === 1} onHover={setHovered} onPick={setFocus}>
            <Head i={1} sub="One page, this job only" />
            <p className="mt-2 text-[11.5px] leading-snug text-[var(--deep-3)]">Dear {demo.company} team, the {demo.reqs[0]} work in this role is exactly what I&apos;ve done…</p>
          </Card>
          <Card i={2} pos={SLOTS[2]} active={focus === 2} dim={focus !== null && focus !== 2} hovered={hovered === 2} onHover={setHovered} onPick={setFocus}>
            <Head i={2} sub={`${demo.company} careers site`} />
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-[rgba(11,26,58,0.08)]"><div className="v3-fill h-full rounded-full bg-[#e0457b]" key={demoKey} /></div>
            <p className="mt-1.5 text-[11.5px] text-[var(--deep-3)]">{demo.fields} of {demo.fields} fields filled · you press Submit</p>
          </Card>
          <Card i={3} pos={SLOTS[3]} active={focus === 3} dim={focus !== null && focus !== 3} hovered={hovered === 3} onHover={setHovered} onPick={setFocus}>
            <Head i={3} sub="Defend every line" />
            <p className="mt-2 text-[11.5px] leading-snug text-[var(--deep-3)]">3 stories ready · 12 likely questions · 1 gap with an honest answer</p>
          </Card>
          </>}
        </Rig>
      </Canvas>
      </Layer.Provider>
    </div>
  );
}

function Head({ i, sub, right }: { i: number; sub: string; right?: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2">
      <span className="mt-0.5 h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: CARDS[i].color, boxShadow: `0 0 12px ${CARDS[i].color}` }} />
      <div className="min-w-0 flex-1">
        <p className="text-[13px] font-bold leading-tight text-[var(--deep)]">{CARDS[i].label}</p>
        <p className="truncate text-[11.5px] text-[var(--deep-3)]">{sub}</p>
      </div>
      {right}
    </div>
  );
}
