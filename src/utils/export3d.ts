/**
 * Utility di esportazione 3D:
 * - Salvataggio immagine PNG ad alta risoluzione dal canvas WebGL
 * - Esportazione modello 3D binario in formato .glb tramite GLTFExporter
 */
import * as THREE from 'three';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';

/** Esporta un gruppo/scena Three.js in formato binario .glb */
export function exportSceneToGlb(object: THREE.Object3D, fileName: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const exporter = new GLTFExporter();
    exporter.parse(
      object,
      (result) => {
        if (result instanceof ArrayBuffer) {
          const blob = new Blob([result], { type: 'model/gltf-binary' });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = fileName.endsWith('.glb') ? fileName : `${fileName}.glb`;
          a.click();
          URL.revokeObjectURL(url);
          resolve();
        } else {
          const json = JSON.stringify(result, null, 2);
          const blob = new Blob([json], { type: 'application/json' });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = fileName.replace(/\.glb$/i, '') + '.gltf';
          a.click();
          URL.revokeObjectURL(url);
          resolve();
        }
      },
      (error) => reject(error),
      { binary: true }
    );
  });
}

/** Cattura il canvas WebGL ad alta risoluzione e scarica un file PNG */
export function captureHighResPng(
  gl: THREE.WebGLRenderer,
  scene: THREE.Scene,
  camera: THREE.Camera,
  fileName: string
): void {
  const prevPixelRatio = gl.getPixelRatio();
  // Forza densità pixel 2x per export nitido ad alta risoluzione
  gl.setPixelRatio(Math.max(2, prevPixelRatio));
  gl.render(scene, camera);

  const dataUrl = gl.domElement.toDataURL('image/png', 1.0);
  gl.setPixelRatio(prevPixelRatio);
  gl.render(scene, camera);

  const a = document.createElement('a');
  a.href = dataUrl;
  a.download = fileName.endsWith('.png') ? fileName : `${fileName}.png`;
  a.click();
}
