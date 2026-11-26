/**
 * Scena 3D principale di PianteStudio (React Three Fiber + Drei + Three.js):
 * - Illuminazione realistica dinamica controllata dallo slider ora del giorno
 * - Environment map procedurale (Lightformer) 100% offline
 * - 4 modalità di camera: Orbita libera, Vista dall'alto, Casa di bambola, Prima persona (WASD)
 * - Esportazione diretta PNG ad alta risoluzione e modello 3D .glb
 */
import React, {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
} from 'react';
import * as THREE from 'three';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { ContactShadows, Environment, Grid, Lightformer, OrbitControls, Sky } from '@react-three/drei';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import { useProjectStore } from '../store/useProjectStore';
import { getWallsBounds } from '../utils/geometry';
import { clipWallsAndOpeningsForRoom, detectRooms, type DetectedRoom } from '../utils/rooms';
import { captureHighResPng, exportSceneToGlb } from '../utils/export3d';
import { RoomMesh3D } from './RoomMesh3D';
import { FurnitureMesh3D } from './FurnitureMesh3D';
import { SceneStylizer, stripStylizedOutlinesForExport } from './SceneStylizer';
import type { CameraMode3D, RenderStylePreset } from '../types/project';

export interface Scene3DHandle {
  exportPng: () => void;
  exportGlb: () => Promise<void>;
  captureDataUrl: () => string | null;
}

/** Calcola posizione, colore e intensità del sole in base all'ora del giorno (6..21) */
function computeSunFromHour(hour: number) {
  // Normalizza 6..20 -> 0..1
  const t = Math.max(0, Math.min(1, (hour - 6) / 14));
  const elevation = Math.sin(t * Math.PI) * 1.15 + 0.14; // radianti
  const azimuth = (t - 0.5) * Math.PI * 1.25;
  const dist = 18;

  const x = Math.sin(azimuth) * Math.cos(elevation) * dist;
  const y = Math.sin(elevation) * dist;
  const z = Math.cos(azimuth) * Math.cos(elevation) * dist;

  // Luce calda all'alba/tramonto, bianca naturale a mezzogiorno
  const warmth = 1 - Math.sin(t * Math.PI);
  const sunColor = new THREE.Color().setRGB(
    1,
    1 - warmth * 0.28,
    1 - warmth * 0.52
  );

  const skyColor = new THREE.Color().setRGB(
    0.72 - warmth * 0.18,
    0.84 - warmth * 0.22,
    0.96 - warmth * 0.25
  );

  const sunIntensity = 0.75 + Math.sin(t * Math.PI) * 1.35;
  const ambientIntensity = 0.35 + Math.sin(t * Math.PI) * 0.35;

  return {
    position: [x, y, z] as [number, number, number],
    sunColor: `#${sunColor.getHexString()}`,
    skyColor: `#${skyColor.getHexString()}`,
    sunIntensity,
    ambientIntensity,
  };
}

/** Controller camera che gestisce transizioni modalità e movimento WASD in prima persona */
const CameraController: React.FC<{
  mode: CameraMode3D;
  sceneRadius: number;
  focusKey: string;
}> = ({ mode, sceneRadius, focusKey }) => {
  const { camera, gl } = useThree();
  const orbitRef = useRef<OrbitControlsImpl | null>(null);
  const keysPressed = useRef<Set<string>>(new Set());
  const yawPitch = useRef({ yaw: 0, pitch: -0.04 });
  const isDraggingLook = useRef(false);
  const lastPointer = useRef({ x: 0, y: 0 });

  // Posizionamento iniziale quando cambia la modalità di vista o la stanza selezionata
  useEffect(() => {
    const r = Math.max(3.6, sceneRadius);

    if (mode === 'orbit') {
      camera.position.set(r * 0.95, r * 0.72, r * 0.95);
      camera.lookAt(0, 0.8, 0);
      if (orbitRef.current) {
        orbitRef.current.target.set(0, 0.8, 0);
        orbitRef.current.update();
      }
    } else if (mode === 'top') {
      camera.position.set(0.01, r * 1.65, 0.01);
      camera.lookAt(0, 0, 0);
      if (orbitRef.current) {
        orbitRef.current.target.set(0, 0, 0);
        orbitRef.current.update();
      }
    } else if (mode === 'dollhouse') {
      camera.position.set(r * 0.88, r * 1.05, r * 0.92);
      camera.lookAt(0, 0.5, 0);
      if (orbitRef.current) {
        orbitRef.current.target.set(0, 0.5, 0);
        orbitRef.current.update();
      }
    } else if (mode === 'first_person') {
      camera.position.set(0, 1.65, Math.min(1.2, r * 0.22));
      yawPitch.current = { yaw: 0, pitch: -0.05 };
      camera.rotation.order = 'YXZ';
      camera.rotation.set(yawPitch.current.pitch, yawPitch.current.yaw, 0);
    }
  }, [mode, camera, sceneRadius, focusKey]);

  // Gestione tastiera WASD e mouse look per Prima Persona
  useEffect(() => {
    if (mode !== 'first_person') return;

    const onKeyDown = (e: KeyboardEvent) => {
      keysPressed.current.add(e.key.toLowerCase());
    };
    const onKeyUp = (e: KeyboardEvent) => {
      keysPressed.current.delete(e.key.toLowerCase());
    };

    const dom = gl.domElement;
    const onPointerDown = (e: PointerEvent) => {
      isDraggingLook.current = true;
      lastPointer.current = { x: e.clientX, y: e.clientY };
    };
    const onPointerMove = (e: PointerEvent) => {
      if (!isDraggingLook.current) return;
      const dx = e.clientX - lastPointer.current.x;
      const dy = e.clientY - lastPointer.current.y;
      lastPointer.current = { x: e.clientX, y: e.clientY };
      yawPitch.current.yaw -= dx * 0.0045;
      yawPitch.current.pitch = Math.max(
        -Math.PI / 2.4,
        Math.min(Math.PI / 2.4, yawPitch.current.pitch - dy * 0.0045)
      );
    };
    const onPointerUp = () => {
      isDraggingLook.current = false;
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    dom.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);

    return () => {
      keysPressed.current.clear();
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      dom.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
    };
  }, [mode, gl]);

  useFrame((_, delta) => {
    if (mode !== 'first_person') return;

    camera.rotation.order = 'YXZ';
    camera.rotation.set(yawPitch.current.pitch, yawPitch.current.yaw, 0);

    const speed = 3.2 * Math.min(delta, 0.08);
    const forward = new THREE.Vector3(
      -Math.sin(yawPitch.current.yaw),
      0,
      -Math.cos(yawPitch.current.yaw)
    );
    const right = new THREE.Vector3(
      Math.cos(yawPitch.current.yaw),
      0,
      -Math.sin(yawPitch.current.yaw)
    );

    const k = keysPressed.current;
    if (k.has('w') || k.has('arrowup')) camera.position.addScaledVector(forward, speed);
    if (k.has('s') || k.has('arrowdown')) camera.position.addScaledVector(forward, -speed);
    if (k.has('d') || k.has('arrowright')) camera.position.addScaledVector(right, speed);
    if (k.has('a') || k.has('arrowleft')) camera.position.addScaledVector(right, -speed);
    camera.position.y = 1.65;
  });

  if (mode === 'first_person') {
    return null;
  }

  return (
    <OrbitControls
      ref={orbitRef}
      makeDefault
      enableDamping
      dampingFactor={0.08}
      maxPolarAngle={mode === 'top' ? 0.12 : Math.PI / 2 - 0.04}
      minDistance={1.5}
      maxDistance={45}
    />
  );
};

/** Sincronizza toneMappingExposure sul renderer WebGL senza rimontare il canvas */
const ToneMappingSync: React.FC<{ exposure: number }> = ({ exposure }) => {
  const { gl } = useThree();
  useEffect(() => {
    gl.toneMapping = THREE.ACESFilmicToneMapping;
    gl.toneMappingExposure = exposure;
  }, [gl, exposure]);
  return null;
};

/** Environment map procedurale architettonica ad alto contrasto (riflessi naturali su vetri, metalli, marmo e parquet) */
const SceneEnvironment: React.FC<{ preset: RenderStylePreset }> = React.memo(({ preset }) => {
  const isEvening = preset === 'evening';
  const isStudio = preset === 'studio';
  return (
    <Environment resolution={256} frames={1}>
      {/* Cupola cielo zenitale morbida */}
      <Lightformer
        form="rect"
        intensity={isEvening ? 0.55 : isStudio ? 2.4 : 1.9}
        color={isEvening ? '#4c5f8a' : isStudio ? '#ffffff' : '#eef6ff'}
        position={[0, 12, 0]}
        rotation={[Math.PI / 2, 0, 0]}
        scale={[22, 22, 1]}
      />
      {/* Disco solare caldo per riflessi speculari netti */}
      <Lightformer
        form="circle"
        intensity={isEvening ? 2.8 : isStudio ? 2.2 : 3.2}
        color={isEvening ? '#ff9d5c' : '#fff4de'}
        position={[12, isEvening ? 4 : 9, 10]}
        scale={[5, 5, 1]}
      />
      {/* Riflesso finestra / cielo laterale fresco */}
      <Lightformer
        form="rect"
        intensity={isEvening ? 0.7 : 1.5}
        color={isEvening ? '#64748b' : '#cfe6ff'}
        position={[-12, 5, 8]}
        rotation={[0, Math.PI / 3, 0]}
        scale={[14, 7, 1]}
      />
      {/* Rimbalzo parete calda opposta */}
      <Lightformer
        form="rect"
        intensity={isEvening ? 1.1 : 0.9}
        color={isEvening ? '#ffbe76' : '#f2e7d8'}
        position={[8, 3, -12]}
        rotation={[0, -Math.PI / 5, 0]}
        scale={[14, 6, 1]}
      />
      {/* Rimbalzo pavimento morbido */}
      <Lightformer
        form="rect"
        intensity={0.45}
        color="#d8cbb8"
        position={[0, -6, 0]}
        rotation={[-Math.PI / 2, 0, 0]}
        scale={[20, 20, 1]}
      />
    </Environment>
  );
});

SceneEnvironment.displayName = 'SceneEnvironment';

/** Ponte interno per accedere a gl, scene, camera e al gruppo esportabile .glb */
const SceneContent: React.FC<{
  activeRoom: DetectedRoom | null;
  detectedRooms: DetectedRoom[];
  exportGroupRef: React.RefObject<THREE.Group>;
  onBindThree: (ctx: {
    gl: THREE.WebGLRenderer;
    scene: THREE.Scene;
    camera: THREE.Camera;
  }) => void;
}> = ({ activeRoom, detectedRooms, exportGroupRef, onBindThree }) => {
  const { gl, scene, camera } = useThree();
  const { project } = useProjectStore();
  const { walls, openings, furniture, renderSettings } = project;
  const preset: RenderStylePreset = renderSettings.renderPreset ?? 'realistic';
  const interiorLightsOn = renderSettings.interiorLights ?? true;
  const showBaseboards = renderSettings.showBaseboards ?? true;

  useEffect(() => {
    onBindThree({ gl, scene, camera });
  }, [gl, scene, camera, onBindThree]);

  const allBounds = useMemo(() => getWallsBounds(walls), [walls]);

  // Se è selezionata una singola stanza, isola i suoi muri (ritagliati puliti), aperture, pavimento e mobili
  const visibleData = useMemo(() => {
    if (!activeRoom) {
      return {
        walls,
        openings,
        furniture,
        centerX: allBounds.centerX,
        centerZ: allBounds.centerY,
        sceneRadius: Math.max(allBounds.width, allBounds.height, 6),
        floorStrips: undefined,
      };
    }
    const clipped = clipWallsAndOpeningsForRoom(walls, openings, activeRoom);
    const furnSet = new Set(activeRoom.furnitureIds);
    return {
      walls: clipped.walls,
      openings: clipped.openings,
      furniture: furniture.filter((f) => furnSet.has(f.id)),
      centerX: activeRoom.bounds.centerX,
      centerZ: activeRoom.bounds.centerY,
      sceneRadius: Math.max(activeRoom.bounds.width, activeRoom.bounds.height, 3.6),
      floorStrips: activeRoom.floorStrips,
    };
  }, [activeRoom, walls, openings, furniture, allBounds]);

  // In modalità serale forza luce tramonto calda, altrimenti usa lo slider ora del giorno
  const effectiveHour = preset === 'evening' ? 19.35 : renderSettings.timeOfDay;
  const sun = useMemo(() => computeSunFromHour(effectiveHour), [effectiveHour]);

  // Frustum ombre adattato alle dimensioni reali della scena: texel 3× più nitidi sui mobili!
  const shadowHalf = Math.min(22, Math.max(6.5, visibleData.sceneRadius * 1.08));

  // Tetto visibile solo in prima persona, nascosto in casa di bambola / dall'alto / orbita
  const showRoof = renderSettings.cameraMode === 'first_person';

  // Calcola punti luce interni (max 6 stanze principali per fluidità WebGL)
  const roomLights = useMemo(() => {
    if (!interiorLightsOn) return [];
    const targetRooms = activeRoom ? [activeRoom] : detectedRooms.slice(0, 6);
    const wallH = walls.reduce((m, w) => Math.max(m, w.height), 2.7);
    return targetRooms.map((rm) => ({
      id: rm.id,
      x: rm.bounds.centerX - visibleData.centerX,
      y: Math.max(2.1, wallH - 0.28),
      z: rm.bounds.centerY - visibleData.centerZ,
      radius: Math.max(4.5, Math.hypot(rm.bounds.width, rm.bounds.height) * 0.95),
    }));
  }, [interiorLightsOn, activeRoom, detectedRooms, walls, visibleData.centerX, visibleData.centerZ]);

  // Chiave leggera per ricalcolare ContactShadows solo quando cambia il layout
  const contactKey = `${activeRoom?.id ?? 'all'}_${visibleData.walls.length}_${visibleData.furniture.length}_${visibleData.furniture
    .map((f) => `${Math.round(f.x * 10)}_${Math.round(f.y * 10)}_${Math.round(f.rotation)}`)
    .join('|')}`;

  const bgColor =
    preset === 'studio'
      ? '#edf2f7'
      : preset === 'evening'
        ? '#1e293b'
        : preset === 'sketch'
          ? '#f8f4ec'
          : preset === 'cartoon'
            ? '#cfe9ff'
            : sun.skyColor;

  const exposure =
    preset === 'studio'
      ? 1.12
      : preset === 'evening'
        ? 1.02
        : preset === 'cartoon'
          ? 1.05
          : preset === 'sketch'
            ? 1.06
            : 1.08;
  const mainSunIntensity =
    preset === 'evening'
      ? 0.95
      : preset === 'studio'
        ? sun.sunIntensity * 0.95
        : preset === 'sketch'
          ? 0.9
          : preset === 'cartoon'
            ? 1.45
            : sun.sunIntensity * 1.25;
  const roomLightIntensity =
    preset === 'evening'
      ? 3.2
      : preset === 'cartoon' || preset === 'sketch'
        ? 0.35
        : showRoof
          ? 1.35
          : preset === 'studio'
            ? 0.5
            : 0.72;

  // Versione sintetica della scena per aggiornare la stilizzazione Cartoon/Schizzo quando cambia layout o finiture
  const stylizerVersion = `${contactKey}_${renderSettings.floorTexture}_${renderSettings.floorColor ?? ''}_${renderSettings.wallColor}_${showRoof}_${showBaseboards}_${visibleData.openings.length}`;

  return (
    <>
      <ToneMappingSync exposure={exposure} />
      <color attach="background" args={[bgColor]} />
      <fog attach="fog" args={[bgColor, 30, 82]} />

      {/* Cielo fisico procedurale in modalità Realistico e Serale */}
      {(preset === 'realistic' || preset === 'evening') &&
        renderSettings.cameraMode !== 'top' && (
          <Sky
            distance={450}
            sunPosition={sun.position}
            inclination={0}
            azimuth={0.25}
            turbidity={preset === 'evening' ? 10 : 4.2}
            rayleigh={preset === 'evening' ? 3.2 : 1.1}
            mieCoefficient={0.005}
            mieDirectionalG={0.82}
          />
        )}

      {/* Illuminazione architettonica multi-sorgente: emisferica + sole morbido + fill cielo opposto */}
      <hemisphereLight
        args={[
          preset === 'evening' ? '#93c5fd' : preset === 'sketch' ? '#fffdf8' : '#f4f8ff',
          preset === 'evening' ? '#5c4b3b' : preset === 'sketch' ? '#e7dfd1' : '#c8b9a6',
          preset === 'evening'
            ? 0.48
            : preset === 'studio' || preset === 'sketch'
              ? 1.08
              : preset === 'cartoon'
                ? 0.85
                : sun.ambientIntensity + 0.42,
        ]}
      />
      <directionalLight
        position={sun.position}
        intensity={mainSunIntensity}
        color={preset === 'studio' ? '#fffcf7' : sun.sunColor}
        castShadow
        shadow-mapSize-width={2048}
        shadow-mapSize-height={2048}
        shadow-camera-near={1}
        shadow-camera-far={55}
        shadow-camera-left={-shadowHalf}
        shadow-camera-right={shadowHalf}
        shadow-camera-top={shadowHalf}
        shadow-camera-bottom={-shadowHalf}
        shadow-bias={-0.00018}
        shadow-normalBias={0.025}
        shadow-radius={3.5}
      />
      {/* Luce secondaria di schiarita (sky fill morbido opposto al sole) per volumi scolpiti */}
      <directionalLight
        position={[-sun.position[0] * 0.7, 9, -sun.position[2] * 0.7]}
        intensity={preset === 'evening' ? 0.25 : 0.42}
        color="#d8e8ff"
      />

      {/* Luci interne calde automatiche al centro di ogni stanza */}
      {roomLights.map((rl) => (
        <group key={rl.id} position={[rl.x, rl.y, rl.z]}>
          <pointLight
            color={preset === 'evening' ? '#ffcf87' : '#fff2dc'}
            intensity={roomLightIntensity}
            distance={rl.radius}
            decay={2}
          />
          {/* Plafoniera LED moderna visibile sul soffitto in prima persona */}
          {showRoof && (
            <mesh position={[0, 0.24, 0]}>
              <cylinderGeometry args={[0.2, 0.2, 0.035, 24]} />
              <meshStandardMaterial
                color="#fffdf8"
                emissive="#ffe7bd"
                emissiveIntensity={preset === 'evening' ? 2.2 : 1.1}
                roughness={0.2}
              />
            </mesh>
          )}
        </group>
      ))}

      {/* Environment map procedurale per riflessi naturali su vetri, metalli, marmo e ceramica */}
      <SceneEnvironment preset={preset} />

      {/* Ombre morbide di contatto a pavimento (Ambient Occlusion sotto mobili e lungo i battiscopa) */}
      {visibleData.walls.length > 0 && (
        <ContactShadows
          key={contactKey}
          position={[0, 0.003, 0]}
          opacity={preset === 'evening' ? 0.5 : 0.42}
          scale={Math.max(10, visibleData.sceneRadius * 2.4)}
          blur={1.75}
          far={2.6}
          resolution={512}
          frames={1}
          color="#1e293b"
        />
      )}

      {/* Gruppo completo della casa o della singola stanza (esportato in .glb) */}
      <group
        ref={exportGroupRef}
        name={activeRoom ? `PianteStudio_${activeRoom.name}` : 'PianteStudio_Casa'}
      >
        <RoomMesh3D
          walls={visibleData.walls}
          openings={visibleData.openings}
          floorTexture={renderSettings.floorTexture}
          floorColor={renderSettings.floorColor}
          wallColor={renderSettings.wallColor}
          showRoof={showRoof}
          showBaseboards={showBaseboards}
          showDemolishedWalls={!activeRoom && Boolean(renderSettings.showDemolishedWalls3D)}
          centerX={visibleData.centerX}
          centerZ={visibleData.centerZ}
          floorStrips={visibleData.floorStrips}
        />

        {visibleData.furniture.map((item) => (
          <FurnitureMesh3D
            key={item.id}
            item={item}
            centerX={visibleData.centerX}
            centerZ={visibleData.centerZ}
            walls={visibleData.walls}
            openings={visibleData.openings}
          />
        ))}
      </group>

      {/* Applica Cel-Shading (Cartoon) o Contorni a China (Schizzo SketchUp) 100% client-side */}
      <SceneStylizer
        targetRef={exportGroupRef}
        preset={preset}
        sceneVersion={stylizerVersion}
      />

      {renderSettings.showGrid3D && (
        <Grid
          position={[0, 0.005, 0]}
          args={[30, 30]}
          cellSize={0.5}
          sectionSize={1}
          fadeDistance={24}
          cellColor="#94a3b8"
          sectionColor="#475569"
        />
      )}

      <CameraController
        mode={renderSettings.cameraMode}
        sceneRadius={visibleData.sceneRadius}
        focusKey={activeRoom ? activeRoom.id : 'all'}
      />
    </>
  );
};

export const Scene3D = forwardRef<Scene3DHandle>((_, ref) => {
  const { project, selectedRoomId3D, setSelectedRoomId3D, showToast } = useProjectStore();
  const exportGroupRef = useRef<THREE.Group>(null);
  const threeCtxRef = useRef<{
    gl: THREE.WebGLRenderer;
    scene: THREE.Scene;
    camera: THREE.Camera;
  } | null>(null);

  const detectedRooms = useMemo(
    () => detectRooms(project.walls, project.furniture),
    [project.walls, project.furniture]
  );

  const activeRoom = useMemo(
    () => detectedRooms.find((r) => r.id === selectedRoomId3D) ?? null,
    [detectedRooms, selectedRoomId3D]
  );

  useImperativeHandle(ref, () => ({
    exportPng: () => {
      const ctx = threeCtxRef.current;
      if (!ctx) return;
      const safeName = (project.name || 'piantestudio').toLowerCase().replace(/[^a-z0-9]+/g, '-');
      const roomSuffix = activeRoom
        ? `-${activeRoom.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`
        : '';
      captureHighResPng(ctx.gl, ctx.scene, ctx.camera, `${safeName}${roomSuffix}-render-3d.png`);
      showToast('Immagine PNG ad alta risoluzione salvata!', 'success');
    },
    exportGlb: async () => {
      if (!exportGroupRef.current) return;
      const safeName = (project.name || 'piantestudio').toLowerCase().replace(/[^a-z0-9]+/g, '-');
      const roomSuffix = activeRoom
        ? `-${activeRoom.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`
        : '';
      const restore = stripStylizedOutlinesForExport(exportGroupRef.current);
      try {
        await exportSceneToGlb(exportGroupRef.current, `${safeName}${roomSuffix}-modello-3d.glb`);
      } finally {
        restore();
      }
      showToast('Modello 3D (.glb) esportato con successo!', 'success');
    },
    captureDataUrl: () => {
      const ctx = threeCtxRef.current;
      if (!ctx) return null;
      ctx.gl.render(ctx.scene, ctx.camera);
      return ctx.gl.domElement.toDataURL('image/png', 1.0);
    },
  }));

  const handleBindThree = useCallback(
    (ctx: { gl: THREE.WebGLRenderer; scene: THREE.Scene; camera: THREE.Camera }) => {
      threeCtxRef.current = ctx;
    },
    []
  );

  const mode = project.renderSettings.cameraMode;
  const hourStr = `${Math.floor(project.renderSettings.timeOfDay)
    .toString()
    .padStart(2, '0')}:${Math.round((project.renderSettings.timeOfDay % 1) * 60)
    .toString()
    .padStart(2, '0')}`;

  return (
    <div className="relative w-full h-full bg-slate-200 dark:bg-slate-950 select-none">
      <Canvas
        shadows
        dpr={[1, 2]}
        camera={{ fov: 44, near: 0.08, far: 160, position: [8, 9, 8] }}
        gl={{
          preserveDrawingBuffer: true,
          antialias: true,
          toneMapping: THREE.ACESFilmicToneMapping,
          toneMappingExposure: 1.08,
        }}
      >
        <SceneContent
          activeRoom={activeRoom}
          detectedRooms={detectedRooms}
          exportGroupRef={exportGroupRef}
          onBindThree={handleBindThree}
        />
      </Canvas>

      {/* Selettore rapido Tutta la casa / Singola stanza in alto a sinistra */}
      {detectedRooms.length > 0 && (
        <div className="absolute top-3 left-3 right-3 flex flex-wrap items-center gap-1.5 pointer-events-none z-10">
          <div className="pointer-events-auto flex flex-wrap items-center gap-1 p-1 rounded-xl bg-white/92 dark:bg-slate-900/92 backdrop-blur border border-slate-200 dark:border-slate-700 shadow-sm max-w-full">
            <button
              type="button"
              onClick={() => setSelectedRoomId3D(null)}
              className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold transition-colors cursor-pointer ${
                !activeRoom
                  ? 'bg-blue-600 text-white shadow-xs'
                  : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
              }`}
            >
              Tutta la casa
            </button>
            {detectedRooms.map((room) => {
              const isSelected = activeRoom?.id === room.id;
              return (
                <button
                  key={room.id}
                  type="button"
                  onClick={() => setSelectedRoomId3D(room.id)}
                  title={`Visualizza solo ${room.name} (${room.areaSqm} m²)`}
                  className={`px-2.5 py-1 rounded-lg text-[11px] font-medium transition-colors cursor-pointer ${
                    isSelected
                      ? 'bg-blue-600 text-white shadow-xs font-semibold'
                      : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
                  }`}
                >
                  {room.name}{' '}
                  <span className={isSelected ? 'text-blue-100 text-[10px]' : 'text-slate-400 text-[10px]'}>
                    {room.areaSqm} m²
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Badge informativo overlay in basso a sinistra */}
      <div className="absolute bottom-3 left-3 px-3 py-1.5 rounded-xl bg-white/90 dark:bg-slate-900/90 backdrop-blur border border-slate-200 dark:border-slate-700 text-[11px] text-slate-700 dark:text-slate-200 shadow-sm flex items-center gap-3 pointer-events-none">
        <span className="font-semibold text-blue-600 dark:text-blue-400">
          {activeRoom ? `${activeRoom.name} (${activeRoom.areaSqm} m²)` : 'Tutta la casa'}
        </span>
        <span className="text-slate-400">•</span>
        <span>
          {mode === 'orbit' && 'Orbita libera'}
          {mode === 'top' && "Vista dall'alto"}
          {mode === 'dollhouse' && 'Casa di bambola'}
          {mode === 'first_person' && 'Prima persona (WASD + trascina mouse)'}
        </span>
        <span className="text-slate-400">•</span>
        <span>Sole {hourStr}</span>
      </div>

      {project.walls.length === 0 && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className="px-5 py-4 rounded-2xl bg-white/95 dark:bg-slate-900/95 border border-slate-200 dark:border-slate-700 shadow-lg text-center max-w-sm">
            <p className="text-sm font-semibold text-slate-800 dark:text-slate-100">
              Nessun muro tracciato
            </p>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
              Torna allo Step 0 per caricare una piantina e tracciare i muri della casa.
            </p>
          </div>
        </div>
      )}
    </div>
  );
});

Scene3D.displayName = 'Scene3D';
