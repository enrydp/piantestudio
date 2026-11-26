/**
 * Root dell'applicazione PianteStudio.
 * Collega:
 * - HeaderWizard (navigazione 4 step, Undo/Redo, JSON import/export, tema)
 * - LeftToolbar (strumenti contestuali per ogni step)
 * - FloorplanCanvas (Konva 2D per Step 0, 1, 2) e Scene3D (Three.js/R3F per Step 3)
 * - RightPropertiesPanel (proprietà contestuali, catalogo JSON, luci/materiali/export 3D)
 */
import React, { useEffect, useRef, useState } from 'react';
import { HeaderWizard } from './components/HeaderWizard';
import { LeftToolbar } from './components/LeftToolbar';
import { RightPropertiesPanel } from './components/RightPropertiesPanel';
import { Toast } from './components/Toast';
import { ShortcutsModal } from './components/ShortcutsModal';
import { FloorplanCropModal } from './components/FloorplanCropModal';
import { AiPhotoRenderModal } from './components/AiPhotoRenderModal';
import { MepEstimatorView, type MepTabId } from './components/MepEstimatorView';
import { FloorplanCanvas } from './editor2d/FloorplanCanvas';
import { Scene3D, type Scene3DHandle } from './viewer3d/Scene3D';
import { useProjectStore } from './store/useProjectStore';
import { generateSampleFloorplanImage } from './utils/sampleFloorplan';

export const App: React.FC = () => {
  const {
    theme,
    step,
    undo,
    redo,
    setActiveTool,
    rotateSelectedFurniture,
    copySelectedFurniture,
    pasteFurniture,
    deleteSelectedFurniture,
    selectedWallId,
    deleteWall,
    selectedOpeningId,
    deleteOpening,
    duplicateOpening,
    clearSelection,
    showShortcutsModal,
    setShowShortcutsModal,
    showCropModal,
    setShowCropModal,
    project,
    setFloorplan,
    applyCroppedFloorplan,
    showToast,
  } = useProjectStore();

  const fileInputRef = useRef<HTMLInputElement>(null);
  const scene3DRef = useRef<Scene3DHandle>(null);
  const [aiSourceRenderUrl, setAiSourceRenderUrl] = useState<string | null>(null);
  const [mepTab, setMepTab] = useState<MepTabId>('all');

  // Sincronizza classe 'dark' sull'elemento <html>
  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'dark') {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }
  }, [theme]);

  // Scorciatoie da tastiera globali
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const isInput =
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable);
      if (isInput) return;

      const mod = e.ctrlKey || e.metaKey;

      if (mod && e.key.toLowerCase() === 'z' && !e.shiftKey) {
        e.preventDefault();
        undo();
        return;
      }
      if (
        (mod && e.key.toLowerCase() === 'y') ||
        (mod && e.shiftKey && e.key.toLowerCase() === 'z')
      ) {
        e.preventDefault();
        redo();
        return;
      }
      if (e.key === '?' || (e.shiftKey && e.key === '/')) {
        e.preventDefault();
        setShowShortcutsModal(!showShortcutsModal);
        return;
      }
      if (e.key === 'Escape') {
        clearSelection();
        if (showShortcutsModal) setShowShortcutsModal(false);
        return;
      }

      if (step < 3) {
        if (!mod && e.key.toLowerCase() === 'v') {
          setActiveTool('select');
          return;
        }
        if (!mod && e.key.toLowerCase() === 'h') {
          setActiveTool('pan');
          return;
        }
        if (step === 0 && !mod && e.key.toLowerCase() === 'c') {
          setActiveTool('calibrate');
          return;
        }
        if (step === 0 && !mod && e.key.toLowerCase() === 'w') {
          setActiveTool('wall');
          return;
        }
        if (step === 0 && !mod && e.key.toLowerCase() === 'd') {
          setActiveTool('demolish');
          return;
        }
      }

      if (step === 1 && mod && e.key.toLowerCase() === 'd' && selectedOpeningId) {
        e.preventDefault();
        duplicateOpening(selectedOpeningId);
        return;
      }

      if (step === 2) {
        if (!mod && e.key.toLowerCase() === 'r') {
          e.preventDefault();
          rotateSelectedFurniture(e.shiftKey ? -15 : 15);
          return;
        }
        if (mod && e.key.toLowerCase() === 'c') {
          e.preventDefault();
          copySelectedFurniture();
          return;
        }
        if (mod && e.key.toLowerCase() === 'v') {
          e.preventDefault();
          pasteFurniture();
          return;
        }
      }

      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (step === 0 && selectedWallId) {
          e.preventDefault();
          deleteWall(selectedWallId);
        } else if (step === 1 && selectedOpeningId) {
          e.preventDefault();
          deleteOpening(selectedOpeningId);
        } else if (step === 2) {
          e.preventDefault();
          deleteSelectedFurniture();
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [
    step,
    undo,
    redo,
    setActiveTool,
    rotateSelectedFurniture,
    copySelectedFurniture,
    pasteFurniture,
    deleteSelectedFurniture,
    selectedWallId,
    deleteWall,
    selectedOpeningId,
    deleteOpening,
    duplicateOpening,
    clearSelection,
    showShortcutsModal,
    setShowShortcutsModal,
  ]);

  const handleLoadSampleFloorplan = () => {
    const sample = generateSampleFloorplanImage();
    setFloorplan(sample);
  };

  const handleTriggerUploadFloorplan = () => {
    fileInputRef.current?.click();
  };

  const handleExportPng = () => {
    scene3DRef.current?.exportPng();
  };

  const handleExportGlb = async () => {
    try {
      await scene3DRef.current?.exportGlb();
    } catch {
      showToast('Errore durante l’esportazione del modello 3D (.glb)', 'error');
    }
  };

  const handleOpenAiPhotoModal = () => {
    const dataUrl = scene3DRef.current?.captureDataUrl();
    if (!dataUrl) {
      showToast('Attendi il caricamento della scena 3D prima di generare la foto AI', 'warning');
      return;
    }
    setAiSourceRenderUrl(dataUrl);
  };

  return (
    <div className="h-screen w-screen flex flex-col bg-slate-100 dark:bg-slate-950 text-slate-900 dark:text-slate-100 overflow-hidden">
      <HeaderWizard />

      <div className="flex-1 flex min-h-0 overflow-hidden">
        <LeftToolbar
          onTriggerUploadFloorplan={handleTriggerUploadFloorplan}
          mepTab={mepTab}
          onChangeMepTab={setMepTab}
        />

        <main className="flex-1 relative min-w-0 min-h-0 flex">
          {step < 3 ? (
            <FloorplanCanvas
              onLoadSampleFloorplan={handleLoadSampleFloorplan}
              externalFileInputRef={fileInputRef}
            />
          ) : step === 3 ? (
            <Scene3D ref={scene3DRef} />
          ) : (
            <MepEstimatorView activeTab={mepTab} onChangeTab={setMepTab} />
          )}
        </main>

        {step < 4 && (
          <RightPropertiesPanel
            onTriggerUploadFloorplan={handleTriggerUploadFloorplan}
            onLoadSampleFloorplan={handleLoadSampleFloorplan}
            onExportPng={handleExportPng}
            onExportGlb={handleExportGlb}
            onOpenAiPhotoModal={handleOpenAiPhotoModal}
          />
        )}
      </div>

      <Toast />
      <ShortcutsModal />
      {showCropModal && project.floorplan && (
        <FloorplanCropModal
          floorplan={project.floorplan}
          onCancel={() => setShowCropModal(false)}
          onApply={(cropped, meta) => applyCroppedFloorplan(cropped, meta)}
        />
      )}
      {aiSourceRenderUrl && (
        <AiPhotoRenderModal
          sourceRenderDataUrl={aiSourceRenderUrl}
          onClose={() => setAiSourceRenderUrl(null)}
        />
      )}
    </div>
  );
};

export default App;
