"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Html } from "@react-three/drei";
import * as THREE from "three";

/**
 * A dotted globe of the countries Vantage knows the hiring rules for. Drag to spin it, click a country
 * (or pick one beside the globe) and it turns to face you. Land dots are a fixed, bundled map.
 */

export type Pin = { code: string; name: string; lat: number; lon: number };

const R = 1.6;
const toVec = (lat: number, lon: number, r = R) => {
  const a = THREE.MathUtils.degToRad(lat);
  const b = THREE.MathUtils.degToRad(lon);
  return new THREE.Vector3(r * Math.cos(a) * Math.cos(b), r * Math.sin(a), -r * Math.cos(a) * Math.sin(b));
};

function Land() {
  const [geo, setGeo] = useState<THREE.BufferGeometry | null>(null);
  useEffect(() => {
    let alive = true;
    fetch("/globe-land.json")
      .then((r) => r.json())
      .then((flat: number[]) => {
        if (!alive) return;
        const pos = new Float32Array((flat.length / 2) * 3);
        for (let i = 0; i < flat.length; i += 2) {
          const v = toVec(flat[i], flat[i + 1], R * 1.002);
          pos.set([v.x, v.y, v.z], (i / 2) * 3);
        }
        const g = new THREE.BufferGeometry();
        g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
        setGeo(g);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);
  if (!geo) return null;
  return (
    <points geometry={geo}>
      <pointsMaterial color="#2f5beb" size={0.028} sizeAttenuation transparent opacity={0.85} depthWrite={false} />
    </points>
  );
}

/** Soft blue rim light around the planet. */
function Atmosphere() {
  const mat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        transparent: true,
        side: THREE.BackSide,
        depthWrite: false,
        blending: THREE.NormalBlending,
        uniforms: { c: { value: new THREE.Color("#9fb4ff") } },
        vertexShader: "varying vec3 vN; void main(){ vN = normalize(normalMatrix * normal); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }",
        fragmentShader: "uniform vec3 c; varying vec3 vN; void main(){ float i = pow(max(0.0, 0.62 - dot(vN, vec3(0.0,0.0,1.0))), 2.2) * 0.9; gl_FragColor = vec4(c, i * 0.7); }",
      }),
    [],
  );
  return (
    <mesh scale={1.12}>
      <sphereGeometry args={[R, 64, 64]} />
      <primitive object={mat} attach="material" />
    </mesh>
  );
}

function Marker({ pin, active, onPick }: { pin: Pin; active: boolean; onPick: (c: string) => void }) {
  const ring = useRef<THREE.Mesh>(null);
  const label = useRef<HTMLButtonElement>(null);
  const p = useMemo(() => toVec(pin.lat, pin.lon), [pin]);
  const q = useMemo(() => new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), p.clone().normalize()), [p]);
  const world = useMemo(() => new THREE.Vector3(), []);
  const { camera } = useThree();
  useFrame((state) => {
    if (ring.current) {
      const t = (state.clock.elapsedTime * 0.8 + pin.lon / 90) % 1;
      ring.current.scale.setScalar((active ? 1.4 : 0.8) + t * (active ? 2.6 : 1.6));
      (ring.current.material as THREE.MeshBasicMaterial).opacity = (1 - t) * (active ? 0.9 : 0.55);
    }
    // Labels on the far side of the planet fade out.
    if (label.current && ring.current) {
      ring.current.getWorldPosition(world);
      const facing = world.clone().normalize().dot(camera.position.clone().normalize());
      label.current.style.opacity = String(THREE.MathUtils.clamp((facing - 0.05) * 4, 0, 1));
      label.current.style.pointerEvents = facing > 0.2 ? "auto" : "none";
    }
  });
  return (
    <group position={p} quaternion={q}>
      <mesh position={[0, 0, 0.01]}>
        <circleGeometry args={[active ? 0.055 : 0.04, 24]} />
        <meshBasicMaterial color={active ? "#e0457b" : "#0b1a3a"} toneMapped={false} />
      </mesh>
      <mesh ref={ring} position={[0, 0, 0.012]}>
        <ringGeometry args={[0.04, 0.05, 32]} />
        <meshBasicMaterial color={active ? "#e0457b" : "#2f5beb"} transparent depthWrite={false} toneMapped={false} />
      </mesh>
      {active && (
        <mesh position={[0, 0, 0.35]} rotation={[Math.PI / 2, 0, 0]}>
          <cylinderGeometry args={[0.008, 0.02, 0.7, 8, 1, true]} />
          <meshBasicMaterial color="#e0457b" transparent opacity={0.8} blending={THREE.AdditiveBlending} toneMapped={false} />
        </mesh>
      )}
      <Html position={[0, 0, 0.08]} center zIndexRange={[10, 0]}>
        <button
          ref={label}
          type="button"
          onClick={() => onPick(pin.code)}
          aria-label={pin.name}
          aria-pressed={active}
          className={`group flex items-center whitespace-nowrap rounded-full text-[11.5px] font-semibold shadow-sm transition ${active ? "bg-[var(--deep)] px-2.5 py-1 text-white" : "h-5 min-w-5 justify-center bg-white/90 px-1 text-[var(--deep)] hover:bg-white hover:px-2.5"}`}
          style={{ transform: "translateY(-16px)" }}
        >
          {active ? pin.name : <><span aria-hidden className="h-1.5 w-1.5 rounded-full bg-[var(--deep)] group-hover:hidden" /><span className="hidden group-hover:inline">{pin.name}</span></>}
        </button>
      </Html>
    </group>
  );
}

function Planet({ pins, active, onPick }: { pins: Pin[]; active: string; onPick: (c: string) => void }) {
  const tilt = useRef<THREE.Group>(null);
  const spin = useRef<THREE.Group>(null);
  const drag = useRef({ on: false, x: 0, y: 0, vy: 0, idleAt: 0, ry: 0, rx: 0, aim: true });
  const { gl } = useThree();
  const pin = pins.find((p) => p.code === active)!;

  // A new choice turns the globe to face it.
  useEffect(() => {
    drag.current.aim = true;
  }, [active]);

  useEffect(() => {
    const el = gl.domElement;
    const down = (e: PointerEvent) => {
      if (e.pointerType === "touch") return;
      drag.current = { ...drag.current, on: true, x: e.clientX, y: e.clientY, aim: false };
    };
    const move = (e: PointerEvent) => {
      const d = drag.current;
      if (!d.on) return;
      d.vy = (e.clientX - d.x) * 0.006;
      d.ry += d.vy;
      d.rx = THREE.MathUtils.clamp(d.rx + (e.clientY - d.y) * 0.004, -0.9, 0.9);
      d.x = e.clientX;
      d.y = e.clientY;
    };
    const up = () => {
      drag.current.on = false;
      drag.current.idleAt = performance.now();
    };
    el.addEventListener("pointerdown", down);
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    return () => {
      el.removeEventListener("pointerdown", down);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
  }, [gl]);

  useFrame((_, dt) => {
    const d = drag.current;
    if (!spin.current || !tilt.current) return;
    if (d.aim) {
      // Shortest turn to bring the chosen country to the front.
      const want = -Math.PI / 2 - THREE.MathUtils.degToRad(pin.lon);
      let diff = (want - d.ry) % (Math.PI * 2);
      if (diff > Math.PI) diff -= Math.PI * 2;
      if (diff < -Math.PI) diff += Math.PI * 2;
      d.ry += diff * 0.06;
      d.rx += (THREE.MathUtils.degToRad(pin.lat) * 0.85 - d.rx) * 0.06;
    } else if (!d.on) {
      d.vy *= 0.94;
      d.ry += d.vy;
      // Drift slowly after a few idle seconds.
      if (performance.now() - d.idleAt > 3500) d.ry += dt * 0.08;
    }
    spin.current.rotation.y = d.ry;
    tilt.current.rotation.x = d.rx;
  });

  return (
    <group ref={tilt}>
      <group ref={spin}>
        <mesh>
          <sphereGeometry args={[R * 0.995, 64, 64]} />
          <meshBasicMaterial color="#fbfcff" toneMapped={false} />
        </mesh>
        <Land />
        {pins.map((p) => <Marker key={p.code} pin={p} active={p.code === active} onPick={onPick} />)}
      </group>
      <Atmosphere />
    </group>
  );
}

export default function GlobeScene({ pins, active, onPick }: { pins: Pin[]; active: string; onPick: (c: string) => void }) {
  const wrap = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const io = new IntersectionObserver(([e]) => setVisible(e.isIntersecting), { rootMargin: "160px" });
    if (wrap.current) io.observe(wrap.current);
    return () => io.disconnect();
  }, []);
  return (
    <div ref={wrap} className="absolute inset-0 touch-pan-y" style={{ cursor: "grab" }}>
      <Canvas dpr={[1, 1.75]} frameloop={visible ? "always" : "never"} camera={{ position: [0, 0, 6.1], fov: 38 }} gl={{ antialias: true, alpha: true }}>
        <ambientLight intensity={1.6} />
        <directionalLight position={[-3, 2, 4]} intensity={1.1} />
        <Planet pins={pins} active={active} onPick={onPick} />
      </Canvas>
    </div>
  );
}
