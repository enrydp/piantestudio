/**
 * Pipeline di Post-Processing fotografico per PianteStudio 3D (100% client-side, WebGL2):
 * - ArchitecturalGTAOPass: Ground Truth Ambient Occlusion calibrato per interni architettonici
 *   (ignora vetri trasparenti, cielo, griglia e ContactShadows nel G-Buffer per zero artefatti)
 * - PhotographicFinishShader: Grana fotografica organica (luma-weighted), micro-contrasto/nitidezza
 *   e leggera vignettatura d'obiettivo in spazio display sRGB dopo ACES Filmic
 * - Preset automatici per ogni stile 3D (Realistico, Studio, Serale, Cartoon, Schizzo)
 */
import * as THREE from 'three';
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js';
import type { RenderStylePreset } from '../types/project';

export interface PostProcessPresetConfig {
  aoEnabled: boolean;
  aoIntensity: number;
  aoRadius: number;
  aoScale: number;
  bloomEnabled: boolean;
  bloomStrength: number;
  bloomThreshold: number;
  bloomRadius: number;
  grainIntensity: number;
  vignetteIntensity: number;
  clarity: number;
  contrast: number;
  saturation: number;
}

/** Restituisce i parametri calibrati di AO, Bloom e Grana per ciascuno stile 3D */
export function getPostProcessPresetConfig(preset: RenderStylePreset): PostProcessPresetConfig {
  switch (preset) {
    case 'evening':
      return {
        aoEnabled: true,
        aoIntensity: 0.92,
        aoRadius: 0.52,
        aoScale: 1.18,
        bloomEnabled: true,
        bloomStrength: 0.36,
        bloomThreshold: 0.78,
        bloomRadius: 0.62,
        grainIntensity: 0.032,
        vignetteIntensity: 0.22,
        clarity: 0.14,
        contrast: 1.05,
        saturation: 1.06,
      };
    case 'studio':
      return {
        aoEnabled: true,
        aoIntensity: 0.72,
        aoRadius: 0.44,
        aoScale: 1.1,
        bloomEnabled: true,
        bloomStrength: 0.14,
        bloomThreshold: 0.98,
        bloomRadius: 0.45,
        grainIntensity: 0.016,
        vignetteIntensity: 0.08,
        clarity: 0.12,
        contrast: 1.02,
        saturation: 1.02,
      };
    case 'cartoon':
      return {
        aoEnabled: true,
        aoIntensity: 0.35,
        aoRadius: 0.36,
        aoScale: 1.0,
        bloomEnabled: true,
        bloomStrength: 0.1,
        bloomThreshold: 0.98,
        bloomRadius: 0.4,
        grainIntensity: 0.008,
        vignetteIntensity: 0.06,
        clarity: 0.06,
        contrast: 1.03,
        saturation: 1.05,
      };
    case 'sketch':
      return {
        aoEnabled: true,
        aoIntensity: 0.55,
        aoRadius: 0.42,
        aoScale: 1.05,
        bloomEnabled: false,
        bloomStrength: 0.0,
        bloomThreshold: 1.1,
        bloomRadius: 0.3,
        grainIntensity: 0.036, // Grana carta da disegno architettonico
        vignetteIntensity: 0.12,
        clarity: 0.15,
        contrast: 1.02,
        saturation: 0.94,
      };
    case 'realistic':
    default:
      return {
        aoEnabled: true,
        aoIntensity: 0.82,
        aoRadius: 0.48,
        aoScale: 1.15,
        bloomEnabled: true,
        bloomStrength: 0.2,
        bloomThreshold: 0.94,
        bloomRadius: 0.55,
        grainIntensity: 0.022,
        vignetteIntensity: 0.14,
        clarity: 0.14,
        contrast: 1.04,
        saturation: 1.04,
      };
  }
}

/**
 * Estensione di GTAOPass ottimizzata per l'architettura:
 * durante il calcolo del G-Buffer (profondità + normali) nasconde automaticamente:
 * - vetri trasparenti e box doccia (così non generano aloni neri AO)
 * - cielo procedurale Sky, griglia 3D e piano ContactShadows (ShaderMaterial / depthWrite=false)
 * - linee e punti (es. contorni Cartoon/Schizzo)
 */
export class ArchitecturalGTAOPass extends GTAOPass {
  private maxInternalDim: number;

  constructor(
    scene: THREE.Scene,
    camera: THREE.Camera,
    width: number,
    height: number,
    maxInternalDim = 1152
  ) {
    const scale = Math.min(1, maxInternalDim / Math.max(1, width, height));
    super(scene, camera, Math.max(64, Math.round(width * scale)), Math.max(64, Math.round(height * scale)));
    this.maxInternalDim = maxInternalDim;
  }

  override setSize(width: number, height: number): void {
    const scale = Math.min(1, this.maxInternalDim / Math.max(1, width, height));
    super.setSize(
      Math.max(64, Math.round(width * scale)),
      Math.max(64, Math.round(height * scale))
    );
  }

  override overrideVisibility(): void {
    const scene = this.scene;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const cache = (this as any)._visibilityCache as Map<THREE.Object3D, boolean>;

    scene.traverse((object) => {
      cache.set(object, object.visible);
      if (!object.visible) return;

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const objAny = object as any;
      if (objAny.isPoints || objAny.isLine) {
        object.visible = false;
        return;
      }

      if (objAny.isMesh) {
        const mesh = object as THREE.Mesh;
        const mat = mesh.material;
        const shouldHideMaterial = (m: THREE.Material | undefined): boolean => {
          if (!m) return false;
          // Nasconde Sky, Grid e helper shader
          if ((m as THREE.ShaderMaterial).isShaderMaterial) return true;
          // Nasconde piani senza depthWrite (ContactShadows, muri fantasma)
          if (m.depthWrite === false) return true;
          // Nasconde vetri trasparenti (così la luce e l'AO vedono la stanza dietro il vetro)
          if (m.transparent && m.opacity < 0.85) return true;
          return false;
        };

        if (Array.isArray(mat)) {
          if (mat.every((m) => shouldHideMaterial(m))) {
            object.visible = false;
          }
        } else if (shouldHideMaterial(mat)) {
          object.visible = false;
        }
      }
    });
  }

  override dispose(): void {
    super.dispose();
    // GTAOPass in Three.js 0.169 non chiama dispose su gtaoMaterial e blendMaterial
    try {
      this.gtaoMaterial?.dispose();
    } catch {
      // ignore
    }
    try {
      this.blendMaterial?.dispose();
    } catch {
      // ignore
    }
  }
}

/**
 * Shader di finitura fotografica (eseguito dopo OutputPass in spazio sRGB):
 * - Micro-nitidezza / Clarity delicata (3x3 unsharp mask controllato)
 * - Contrasto filmico morbido e saturazione naturale
 * - Vignettatura d'obiettivo architettonico
 * - Grana pellicola organica (luma-weighted: naturale nei mezzitoni e nelle ombre, delicata sulle alte luci)
 */
export const PhotographicFinishShader = {
  name: 'PhotographicFinishShader',
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    resolution: { value: new THREE.Vector2(1280, 720) },
    time: { value: 0.0 },
    grainIntensity: { value: 0.022 },
    vignetteIntensity: { value: 0.14 },
    clarity: { value: 0.14 },
    contrast: { value: 1.04 },
    saturation: { value: 1.04 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform vec2 resolution;
    uniform float time;
    uniform float grainIntensity;
    uniform float vignetteIntensity;
    uniform float clarity;
    uniform float contrast;
    uniform float saturation;

    varying vec2 vUv;

    // Hash ad alta qualità (senza pattern a righe) per grana pellicola fine
    float hash12(vec2 p) {
      vec3 p3 = fract(vec3(p.xyx) * 0.1031);
      p3 += dot(p3, p3.yzx + 33.33);
      return fract((p3.x + p3.y) * p3.z);
    }

    // Distribuzione pseudo-gaussiana triangolare (più organica del rumore uniforme)
    float filmNoise(vec2 fragCoord, float t) {
      vec2 p = fragCoord + fract(vec2(t * 17.31, t * 29.73)) * 128.0;
      float n1 = hash12(p);
      float n2 = hash12(p + vec2(37.17, 19.43));
      return (n1 + n2) - 1.0; // [-1, 1] centrato a 0
    }

    void main() {
      vec4 centerSample = texture2D(tDiffuse, vUv);
      vec3 color = centerSample.rgb;

      // 1. Micro-nitidezza (Clarity) delicata per venature legno, fughe e spigoli
      if (clarity > 0.001) {
        vec2 texel = 1.0 / max(resolution, vec2(1.0));
        vec3 n = texture2D(tDiffuse, vUv + vec2(0.0, texel.y)).rgb;
        vec3 s = texture2D(tDiffuse, vUv - vec2(0.0, texel.y)).rgb;
        vec3 e = texture2D(tDiffuse, vUv + vec2(texel.x, 0.0)).rgb;
        vec3 w = texture2D(tDiffuse, vUv - vec2(texel.x, 0.0)).rgb;
        vec3 blur = (n + s + e + w) * 0.25;
        vec3 detail = clamp(color - blur, vec3(-0.08), vec3(0.08));
        color += detail * clarity;
      }

      // 2. Contrasto filmico leggero e saturazione naturale
      if (abs(contrast - 1.0) > 0.001) {
        color = (color - 0.5) * contrast + 0.5;
      }
      float luma = dot(color, vec3(0.2126, 0.7152, 0.0722));
      if (abs(saturation - 1.0) > 0.001) {
        color = mix(vec3(luma), color, saturation);
      }

      // 3. Vignettatura morbida da obiettivo fotografico grandangolare
      if (vignetteIntensity > 0.001) {
        vec2 centered = (vUv - 0.5) * 2.0;
        float distSq = dot(centered, centered);
        float vig = 1.0 - smoothstep(0.45, 1.85, distSq) * vignetteIntensity;
        color *= vig;
      }

      // 4. Grana fotografica organica pesata sulla luminanza (più ricca nei mezzitoni, sottile nelle alte luci)
      if (grainIntensity > 0.0005) {
        vec2 px = vUv * resolution;
        float gLuma = filmNoise(px, time);
        float gChroma = filmNoise(px + vec2(11.3, 53.7), time + 1.37);
        // Curva fotografica: picco sui mezzitoni/ombre, attenua sui bianchi puri e neri profondi
        float lumaWeight = 0.45 + 0.75 * (1.0 - smoothstep(0.15, 0.95, abs(luma - 0.42) * 1.4));
        vec3 grain = vec3(gLuma) + vec3(gChroma * 0.12, -gChroma * 0.06, -gChroma * 0.08);
        color += grain * grainIntensity * lumaWeight;
      }

      gl_FragColor = vec4(clamp(color, 0.0, 1.0), centerSample.a);
    }
  `,
};
