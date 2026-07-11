import { useState, useCallback, useRef, useEffect } from 'react';

export function usePDFEngine() {
  const [pdfDocument, setPdfDocument] = useState(null);
  const [filePath, setFilePath] = useState(null);
  const [fileName, setFileName] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);
  const [isModified, setIsModified] = useState(false);
  const engineRef = useRef(null);

  const loadPDF = useCallback(async (path) => {
    setIsLoading(true);
    setError(null);
    try {
      // In production, this loads through PDFEngine
      // For now, we track the file path and metadata
      const result = await window.electronAPI.readFile(path);
      setFilePath(path);
      setFileName(path.split('/').pop() || path.split('\\').pop() || 'Untitled.pdf');
      setPdfDocument(result);
      setIsModified(false);
      engineRef.current = { filePath: path, data: result };
    } catch (err) {
      setError(err.message || 'Failed to load PDF');
      console.error('Failed to load PDF:', err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const openPDF = useCallback(async () => {
    try {
      const result = await window.electronAPI.openFile();
      if (result && result.filePath) {
        await loadPDF(result.filePath);
      }
    } catch (err) {
      if (err.message !== 'cancelled') {
        setError(err.message);
      }
    }
  }, [loadPDF]);

  const savePDF = useCallback(async () => {
    if (!filePath) {
      return saveAsPDF();
    }
    setIsLoading(true);
    try {
      await window.electronAPI.saveFile(filePath, pdfDocument);
      setIsModified(false);
    } catch (err) {
      setError(err.message || 'Failed to save');
    } finally {
      setIsLoading(false);
    }
  }, [filePath, pdfDocument]);

  const saveAsPDF = useCallback(async () => {
    setIsLoading(true);
    try {
      const result = await window.electronAPI.saveAsFile(pdfDocument);
      if (result && result.filePath) {
        setFilePath(result.filePath);
        setFileName(result.filePath.split('/').pop() || 'Untitled.pdf');
        setIsModified(false);
      }
    } catch (err) {
      if (err.message !== 'cancelled') {
        setError(err.message || 'Failed to save');
      }
    } finally {
      setIsLoading(false);
    }
  }, [pdfDocument]);

  const getEngine = useCallback(() => {
    return engineRef.current;
  }, []);

  const markModified = useCallback(() => {
    setIsModified(true);
  }, []);

  return {
    pdfDocument,
    filePath,
    fileName,
    isLoading,
    error,
    isModified,
    loadPDF,
    openPDF,
    savePDF,
    saveAsPDF,
    getEngine,
    markModified,
    setError,
  };
}
