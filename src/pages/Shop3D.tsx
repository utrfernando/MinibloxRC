import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { motion } from 'framer-motion';
import { ArrowLeft, ArrowRight, ShoppingCart, X, LayoutGrid } from 'lucide-react';
import { useProducts } from '../lib/queries';
import { useCart } from '../contexts/CartContext';
import { useSettings } from '../contexts/SettingsContext';
import { formatCurrency, type Product } from '../lib/supabase';
import { useToast } from '../contexts/ToastContext';

const COL_W = 1.7;       // distance between shelf columns
const TIER_Y = [0.55, 1.65, 2.75]; // shelf heights
const PASTELS = ['#2dd4bf', '#fbbf24', '#f472b6', '#a78bfa', '#38bdf8', '#fb923c'];   // bright candy colours
const CANDY = ['#fda4af', '#fcd34d', '#6ee7b7', '#93c5fd', '#c4b5fd', '#fdba74'];

const imageOf = (p: Product) => {
  const imgs = [...(p.images || [])].sort((a, b) => Number(b.is_primary) - Number(a.is_primary) || a.sort_order - b.sort_order);
  return imgs[0]?.url || null;
};
const priceOf = (p: Product) => p.discount_price && p.discount_price < p.selling_price ? p.discount_price : p.selling_price;

/** Loads product photos one or two at a time and shrinks them (256px), so the GPU never gets big uploads that freeze the animation. */
const q: (() => void)[] = []; let busy = 0;
const pump = () => { while (busy < 2 && q.length) q.shift()!(); };
function loadSmall(url: string, cb: (t: THREE.Texture) => void) {
  q.push(() => {
    busy++;
    const done = () => { busy--; setTimeout(pump, 40); };
    const img = new Image(); img.crossOrigin = 'anonymous';
    img.onload = () => {
      const sc = Math.min(1, 256 / Math.max(img.width, 1));
      const c = document.createElement('canvas'); c.width = Math.max(1, Math.round(img.width * sc)); c.height = Math.max(1, Math.round(img.height * sc));
      c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height);
      const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.generateMipmaps = false; t.minFilter = THREE.LinearFilter;
      cb(t); done();
    };
    img.onerror = done; img.src = url;
  });
  pump();
}

function hasWebGL() {
  try { const c = document.createElement('canvas'); return !!(c.getContext('webgl2') || c.getContext('webgl')); } catch { return false; }
}

/** Small canvas-drawn textures so we need no image or font files. */
function useCanvasTexture(draw: (g: CanvasRenderingContext2D, w: number, h: number) => void, w: number, h: number) {
  return useMemo(() => {
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    draw(c.getContext('2d')!, w, h);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
    return t;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}

const Floor: React.FC<{ width: number }> = ({ width }) => {
  const tex = useCanvasTexture((g, w, h) => {
    for (let y = 0; y < 2; y++) for (let x = 0; x < 2; x++) { g.fillStyle = (x + y) % 2 ? '#fbcfe8' : '#fde68a'; g.fillRect(x * w / 2, y * h / 2, w / 2, h / 2); }
  }, 128, 128);
  useMemo(() => { tex.wrapS = tex.wrapT = THREE.RepeatWrapping; tex.repeat.set(width / 1.4, 6); }, [tex, width]);
  return <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 2]}><planeGeometry args={[width, 9]} /><meshToonMaterial map={tex} /></mesh>;
};

const Wall: React.FC<{ width: number }> = ({ width }) => {
  const tex = useCanvasTexture((g, w, h) => {
    g.fillStyle = '#fff3c4'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#ffe08a'; g.fillRect(0, 0, w / 2, h);
    const dots = ['#f9a8d4', '#7dd3fc', '#86efac', '#c4b5fd'];
    for (let i = 0; i < 4; i++) { g.fillStyle = dots[i]; g.beginPath(); g.arc(w * (0.25 + (i % 2) * 0.5), h * (0.3 + Math.floor(i / 2) * 0.4), 18, 0, Math.PI * 2); g.fill(); }
  }, 128, 128);
  useMemo(() => { tex.wrapS = tex.wrapT = THREE.RepeatWrapping; tex.repeat.set(width / 1.2, 5.8); }, [tex, width]);
  return <mesh position={[0, 3.2, -0.35]}><planeGeometry args={[width, 7]} /><meshToonMaterial map={tex} /></mesh>;
};

const Bunting: React.FC<{ width: number }> = ({ width }) => {
  const n = Math.floor(width / 0.7);
  const shape = useMemo(() => { const s = new THREE.Shape(); s.moveTo(-0.28, 0); s.lineTo(0.28, 0); s.lineTo(0, -0.5); s.closePath(); return s; }, []);
  return (
    <group position={[0, 4.95, 0.5]}>
      {Array.from({ length: n }, (_, i) => {
        const x = -width / 2 + 0.35 + i * 0.7;
        return <mesh key={i} position={[x, -Math.abs(Math.sin(i * 0.9)) * 0.0 - 0.03 * (i % 2), 0]}><shapeGeometry args={[shape]} /><meshBasicMaterial color={PASTELS[i % PASTELS.length]} side={THREE.DoubleSide} /></mesh>;
      })}
    </group>
  );
};

const Confetti: React.FC<{ width: number }> = ({ width }) => {
  const bits = useMemo(() => Array.from({ length: 16 }, (_, i) => ({ x: (Math.random() - 0.5) * width, y: 1.2 + Math.random() * 3.4, z: 1 + Math.random() * 2.2, c: PASTELS[i % PASTELS.length], ph: Math.random() * 6 })), [width]);
  const g = useRef<THREE.Group>(null!);
  useFrame(({ clock }) => g.current.children.forEach((m, i) => { m.position.y = bits[i].y + Math.sin(clock.elapsedTime * 0.8 + bits[i].ph) * 0.15; m.rotation.y = clock.elapsedTime * 0.6 + bits[i].ph; m.rotation.x = clock.elapsedTime * 0.4; }));
  return <group ref={g}>{bits.map((b, i) => <mesh key={i} position={[b.x, b.y, b.z]} scale={0.09}><octahedronGeometry args={[1]} /><meshToonMaterial color={b.c} /></mesh>)}</group>;
};

const Sign: React.FC<{ x: number }> = ({ x }) => {
  const tex = useCanvasTexture((g, w, h) => {
    g.fillStyle = '#14b8a6'; g.beginPath(); g.roundRect(6, 6, w - 12, h - 12, 40); g.fill();
    g.lineWidth = 10; g.strokeStyle = '#fff'; g.stroke();
    g.fillStyle = '#fff'; g.font = '800 92px "Baloo 2", "Fredoka", "Segoe UI", sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText('MinibloxRC ★', w / 2, h / 2 - 14);
    g.font = '700 40px "Segoe UI", sans-serif'; g.fillText('Small Things. Big Smiles.', w / 2, h / 2 + 66);
  }, 1024, 320);
  return <mesh position={[x, 5.05, -0.2]}><planeGeometry args={[4.4, 1.38]} /><meshBasicMaterial map={tex} transparent /></mesh>;
};

const Awning: React.FC<{ width: number }> = ({ width }) => {
  const n = Math.ceil(width / 0.8);
  return (
    <group position={[0, 4.05, 0.1]}>
      {Array.from({ length: n }, (_, i) => (
        <mesh key={i} position={[-width / 2 + 0.4 + i * 0.8, 0, 0.3]} rotation={[0.55, 0, 0]}>
          <boxGeometry args={[0.8, 0.06, 0.8]} />
          <meshToonMaterial color={PASTELS[i % PASTELS.length]} />
        </mesh>
      ))}
      {Array.from({ length: n }, (_, i) => (
        <mesh key={'s' + i} position={[-width / 2 + 0.4 + i * 0.8, -0.3, 0.68]}>
          <sphereGeometry args={[0.3, 14, 8, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2]} />
          <meshToonMaterial color={PASTELS[i % PASTELS.length]} />
        </mesh>
      ))}
    </group>
  );
};

const Balloon: React.FC<{ x: number; color: string; phase: number }> = ({ x, color, phase }) => {
  const g = useRef<THREE.Group>(null!);
  useFrame(({ clock }) => { g.current.position.y = 4.55 + Math.sin(clock.elapsedTime * 0.9 + phase) * 0.12; g.current.rotation.z = Math.sin(clock.elapsedTime * 0.6 + phase) * 0.05; });
  return (
    <group ref={g} position={[x, 4.55, 1.6]}>
      <mesh><sphereGeometry args={[0.32, 20, 16]} /><meshToonMaterial color={color} /></mesh>
      <mesh position={[0, -0.36, 0]}><coneGeometry args={[0.05, 0.1, 8]} /><meshToonMaterial color={color} /></mesh>
      <mesh position={[0, -0.95, 0]}><cylinderGeometry args={[0.008, 0.008, 1.1, 4]} /><meshBasicMaterial color="#94a3b8" /></mesh>
    </group>
  );
};

type Placed = { p: Product; x: number; y: number };

const Tile = React.memo<{ item: Placed; index: number; selected: boolean; onPick: (p: Product, x: number) => void; onHover: (n: string | null) => void }>(({ item, index, selected, onPick, onHover }) => {
  const g = useRef<THREE.Group>(null!);
  const [tex, setTex] = useState<THREE.Texture | null>(null);
  const [hover, setHover] = useState(false);
  const url = imageOf(item.p);
  const frame = PASTELS[index % PASTELS.length];

  useEffect(() => {
    if (!url) return;
    let dead = false;
    let made: THREE.Texture | null = null;
    loadSmall(url, t => { if (dead) { t.dispose(); return; } made = t; setTex(t); });
    return () => { dead = true; made?.dispose(); };
  }, [url]);

  useFrame((_, dt) => {
    const lift = hover || selected ? 1.12 : 1;
    const cur = g.current.scale.x;
    if (Math.abs(lift - cur) < 0.001) return;      // settled: do no work
    g.current.scale.setScalar(cur + (lift - cur) * Math.min(1, dt * 10));
  });

  const out = item.p.stock_quantity <= 0;
  return (
    <group ref={g} position={[item.x, item.y + 0.5, 0.15]}
      onPointerOver={e => { e.stopPropagation(); setHover(true); onHover(item.p.name); document.body.style.cursor = 'pointer'; }}
      onPointerOut={() => { setHover(false); onHover(null); document.body.style.cursor = ''; }}
      onClick={e => { e.stopPropagation(); if (e.delta < 6) onPick(item.p, item.x); }}>
      <mesh position={[0, 0, -0.04]}><boxGeometry args={[1.28, 0.96, 0.18]} /><meshToonMaterial color={frame} /></mesh>
      <mesh position={[0, 0, 0.06]}>
        <planeGeometry args={[1.14, 0.82]} />
        {tex ? <meshBasicMaterial map={tex} /> : <meshToonMaterial color="#ffffff" />}
      </mesh>
      {out && <mesh position={[0.42, 0.34, 0.1]} rotation={[0, 0, 0.3]}><circleGeometry args={[0.17, 16]} /><meshBasicMaterial color="#ef4444" /></mesh>}
    </group>
  );
});

const Shelves: React.FC<{ items: Placed[]; cols: number }> = ({ items, cols }) => {
  return (
    <group>
      {Array.from({ length: cols }, (_, c) => (
        <group key={c} position={[(c - (cols - 1) / 2) * COL_W, 0, 0]}>
          {TIER_Y.map(y => <mesh key={y} position={[0, y, 0.15]}><boxGeometry args={[COL_W - 0.06, 0.1, 0.7]} /><meshToonMaterial color={CANDY[c % CANDY.length]} /></mesh>)}
          <mesh position={[-(COL_W - 0.06) / 2, 1.65, 0.15]}><boxGeometry args={[0.07, 3.2, 0.7]} /><meshToonMaterial color={PASTELS[c % PASTELS.length]} /></mesh>
        </group>
      ))}
      <mesh position={[((cols - 1) / 2) * COL_W + COL_W / 2 - 0.03, 1.65, 0.15]}><boxGeometry args={[0.07, 3.2, 0.7]} /><meshToonMaterial color={PASTELS[cols % PASTELS.length]} /></mesh>
      {items.length === 0 && null}
    </group>
  );
};

const Rig: React.FC<{ target: React.MutableRefObject<number>; min: number; max: number; intro: React.MutableRefObject<boolean> }> = ({ target, min, max, intro }) => {
  const { camera, size } = useThree();
  useFrame(({ clock }, dt) => {
    const portrait = size.width < size.height;
    const z = intro.current ? (portrait ? 10 : 6.6) : 15;
    const x = THREE.MathUtils.clamp(target.current, min, max);
    camera.position.x += (x - camera.position.x) * Math.min(1, dt * 4);
    camera.position.y += (2.35 + Math.sin(clock.elapsedTime * 0.5) * 0.03 + (intro.current ? 0 : 0.9) - camera.position.y) * Math.min(1, dt * 3);
    camera.position.z += (z - camera.position.z) * Math.min(1, dt * 2);
    camera.lookAt(camera.position.x, 2.35, 0);
  });
  return null;
};

const Scene = React.memo<{ items: Placed[]; cols: number; target: React.MutableRefObject<number>; selectedId: string | null; onPick: (p: Product, x: number) => void; onHover: (n: string | null) => void; intro: React.MutableRefObject<boolean> }>(({ items, cols, target, selectedId, onPick, onHover, intro }) => {
  const width = Math.max(cols * COL_W + 4, 12);
  const half = (cols * COL_W) / 2;
  return (
    <>
      <color attach="background" args={['#bae6fd']} />
      <fog attach="fog" args={['#bae6fd', 26, 55]} />
      <ambientLight intensity={1.0} />
      <directionalLight position={[4, 8, 6]} intensity={1.6} />
      <Floor width={width + 8} />
      {/* back wall + stripe */}
      <Wall width={width + 8} />
      <mesh position={[0, 0.5, -0.34]}><planeGeometry args={[width + 8, 1]} /><meshToonMaterial color="#5eead4" /></mesh>
      <Bunting width={width} />
      <Confetti width={width} />
      <Awning width={width} />
      <Sign x={-half + 2.2} />
      <Shelves items={items} cols={cols} />
      {items.map((it, i) => <Tile key={it.p.id} item={it} index={i} selected={selectedId === it.p.id} onPick={onPick} onHover={onHover} />)}
      {Array.from({ length: Math.max(3, Math.floor(cols / 2)) }, (_, i) => <Balloon key={i} x={-half + 3 + i * 3.6} color={PASTELS[(i * 2 + 1) % PASTELS.length]} phase={i * 1.7} />)}
      <Rig target={target} min={-half + 3} max={half - 3} intro={intro} />
    </>
  );
});

/** A cute toon toy shop you can look around. Loaded only when the shopper opens /shop-3d. */
const Shop3D: React.FC = () => {
  const { products, loading } = useProducts({ sort: 'newest' }, []);
  const { addToCart } = useCart();
  const { currency } = useSettings();
  const { success } = useToast();
  const [ok] = useState(hasWebGL);
  const [selected, setSelected] = useState<Product | null>(null);
  const [hoverName, setHoverName] = useState<string | null>(null);
  const reduce = useMemo(() => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches, []);
  const [minWait, setMinWait] = useState(!!reduce);
  const [gone, setGone] = useState(!!reduce);
  useEffect(() => { if (reduce) return; const t = setTimeout(() => setMinWait(true), 1100); return () => clearTimeout(t); }, [reduce]);
  const open = minWait && !loading;
  const introRef = useRef(false);
  introRef.current = open;
  useEffect(() => { if (!open || gone) return; const t = setTimeout(() => setGone(true), 1400); return () => clearTimeout(t); }, [open, gone]);
  const target = useRef(0);
  const drag = useRef<{ x: number; t: number } | null>(null);

  const list = useMemo(() => products.slice(0, 36), [products]);
  const cols = Math.max(Math.ceil(list.length / TIER_Y.length), 4);
  const half = (cols * COL_W) / 2;
  const items: Placed[] = useMemo(() => list.map((p, i) => ({ p, x: (Math.floor(i / 3) - (cols - 1) / 2) * COL_W, y: TIER_Y[i % 3] })), [list, cols]);

  const onPick = useCallback((p: Product, x: number) => { setSelected(p); target.current = x; }, []);
  const move = (dx: number) => { target.current = THREE.MathUtils.clamp(target.current + dx, -half + 3, half - 3); };
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'ArrowRight') move(2.2); if (e.key === 'ArrowLeft') move(-2.2); if (e.key === 'Escape') setSelected(null); };
    window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k);
  });

  if (!ok) {
    return (
      <div className="max-w-xl mx-auto px-4 py-20 text-center">
        <h1 className="font-display text-3xl font-extrabold text-ink-900">3D shop isn&rsquo;t available here</h1>
        <p className="mt-3 text-ink-500">Your device or browser can&rsquo;t show 3D graphics, so please use the normal shop instead.</p>
        <Link to="/shop" className="mt-6 inline-flex rounded-full bg-mint-500 px-6 py-3 font-extrabold text-white">Go to the shop</Link>
      </div>
    );
  }

  return (
    <div className="relative h-[calc(100vh-9rem)] min-h-[460px] sm:h-[calc(100vh-11rem)] bg-mint-50 select-none overflow-hidden"
      onPointerDown={e => { drag.current = { x: e.clientX, t: target.current }; }}
      onPointerMove={e => { if (drag.current && e.buttons) { target.current = THREE.MathUtils.clamp(drag.current.t - (e.clientX - drag.current.x) / 90, -half + 3, half - 3); } }}
      onPointerUp={() => { drag.current = null; }}
      onWheel={e => move((Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY) / 120)}
      style={{ touchAction: 'pan-y' }}>
      <Canvas dpr={[1, window.innerWidth < 768 ? 1 : 1.5]} camera={{ position: [0, 3.2, 15], fov: 52 }} gl={{ antialias: true, powerPreference: 'low-power' }}>
        <Scene intro={introRef} items={items} cols={cols} target={target} selectedId={selected?.id ?? null}
          onPick={onPick} onHover={setHoverName} />
      </Canvas>

      {!gone && (
        <div className="pointer-events-none absolute inset-0 z-20 overflow-hidden" aria-hidden={open}>
          <motion.div className="absolute inset-y-0 left-0 w-1/2 bg-gradient-to-br from-mint-400 to-mint-500" style={{ backgroundImage: 'repeating-linear-gradient(90deg,#2dd4bf 0 36px,#99f6e4 36px 72px)' }}
            initial={{ x: 0 }} animate={{ x: open ? '-101%' : 0 }} transition={{ duration: 0.95, ease: [0.7, 0, 0.2, 1] }} />
          <motion.div className="absolute inset-y-0 right-0 w-1/2" style={{ backgroundImage: 'repeating-linear-gradient(90deg,#f472b6 0 36px,#fbcfe8 36px 72px)' }}
            initial={{ x: 0 }} animate={{ x: open ? '101%' : 0 }} transition={{ duration: 0.95, ease: [0.7, 0, 0.2, 1] }} />
          <motion.div className="absolute inset-0 flex flex-col items-center justify-center text-center"
            initial={{ opacity: 0, scale: 0.7 }} animate={open ? { opacity: 0, scale: 1.3 } : { opacity: 1, scale: 1 }} transition={{ duration: open ? 0.35 : 0.6, type: open ? 'tween' : 'spring' }}>
            <span className="text-6xl drop-shadow">🧸</span>
            <span className="mt-2 rounded-full bg-white px-6 py-2 font-display text-2xl font-extrabold text-mint-700 shadow-soft">Welcome to Toy Town!</span>
            <span className="mt-2 text-sm font-bold text-white drop-shadow">Opening the shop doors…</span>
          </motion.div>
        </div>
      )}
      {!loading && list.length === 0 && <div className="absolute inset-0 flex items-center justify-center font-extrabold text-ink-500">The shelves are empty right now.</div>}

      <div className="pointer-events-none absolute left-3 right-3 top-3 flex items-start justify-between gap-2">
        <Link to="/shop" className="pointer-events-auto inline-flex items-center gap-1.5 rounded-full bg-white/95 px-4 py-2 text-sm font-extrabold text-ink-700 shadow-soft hover:bg-white"><LayoutGrid size={15} /> Normal shop</Link>
        <p className="rounded-full bg-white/90 px-3 py-1.5 text-xs font-bold text-ink-500 shadow-soft">Drag or use ← → to walk along the shelves · tap a toy</p>
      </div>

      <button onClick={() => move(-2.4)} aria-label="Walk left" className="absolute left-3 top-1/2 -translate-y-1/2 rounded-full bg-white/95 p-3 text-mint-700 shadow-soft hover:bg-white"><ArrowLeft size={20} /></button>
      <button onClick={() => move(2.4)} aria-label="Walk right" className="absolute right-3 top-1/2 -translate-y-1/2 rounded-full bg-white/95 p-3 text-mint-700 shadow-soft hover:bg-white"><ArrowRight size={20} /></button>

      {hoverName && !selected && <div className="pointer-events-none absolute bottom-4 left-1/2 -translate-x-1/2 rounded-full bg-ink-900/85 px-4 py-2 text-sm font-bold text-white">{hoverName}</div>}

      {selected && (
        <div className="absolute inset-x-3 bottom-3 mx-auto flex max-w-lg items-center gap-3 rounded-4xl border border-ink-100 bg-white p-3 pr-4 shadow-soft-lg" role="dialog" aria-label={selected.name}>
          {imageOf(selected) && <img src={imageOf(selected)!} alt="" className="h-20 w-20 shrink-0 rounded-3xl object-cover" />}
          <div className="min-w-0 flex-1">
            <p className="truncate font-display text-base font-extrabold text-ink-900">{selected.name}</p>
            <p className="text-lg font-extrabold text-mint-700">{formatCurrency(priceOf(selected), currency)}</p>
            <div className="mt-1.5 flex flex-wrap gap-2">
              <button disabled={selected.stock_quantity <= 0} onClick={() => { addToCart(selected); success('Added to cart'); }}
                className="inline-flex items-center gap-1.5 rounded-full bg-mint-500 px-4 py-1.5 text-sm font-extrabold text-white disabled:bg-ink-200 disabled:text-ink-500"><ShoppingCart size={15} /> {selected.stock_quantity <= 0 ? 'Sold out' : 'Add to cart'}</button>
              <Link to={`/product/${selected.id}`} className="inline-flex items-center rounded-full border border-ink-200 px-4 py-1.5 text-sm font-extrabold text-ink-700 hover:bg-ink-50">Details</Link>
            </div>
          </div>
          <button onClick={() => setSelected(null)} aria-label="Close" className="self-start rounded-full p-1.5 text-ink-400 hover:bg-ink-50"><X size={18} /></button>
        </div>
      )}
    </div>
  );
};

export default Shop3D;
