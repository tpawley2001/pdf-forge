import React from 'react';

export default function StatusBar({ currentPage, pageCount, scale, onPageChange, isModified, isLoading, fileName, isProtected }) {
  return (
    <div className="statusbar">
      {/* Page navigation */}
      <div className="statusbar__page-nav">
        <button
          className="tb-btn" style={{ width: 24, height: 24 }}
          disabled={currentPage <= 1}
          onClick={() => onPageChange(Math.max(1, currentPage - 1))}
          data-tooltip="Previous Page"
        >
          <svg viewBox="0 0 24 24" width="14" height="14"><path d="M15.41 7.41L14 6l-6 6 6 6 1.41-1.41L10.83 12z" fill="currentColor"/></svg>
        </button>
        <input
          type="number"
          value={currentPage}
          min={1}
          max={Math.max(pageCount, 1)}
          onChange={(e) => {
            const v = parseInt(e.target.value, 10);
            if (v >= 1 && v <= pageCount) onPageChange(v);
          }}
        />
        <span style={{ whiteSpace: 'nowrap' }}>of {Math.max(pageCount, 0)}</span>
        <button
          className="tb-btn" style={{ width: 24, height: 24 }}
          disabled={currentPage >= pageCount}
          onClick={() => onPageChange(Math.min(pageCount, currentPage + 1))}
          data-tooltip="Next Page"
        >
          <svg viewBox="0 0 24 24" width="14" height="14"><path d="M10 6L8.59 7.41 13.17 12l-4.58 4.59L10 18l6-6z" fill="currentColor"/></svg>
        </button>
      </div>

      {/* Zoom */}
      <div className="statusbar__zoom" onClick={() => {}}>
        {Math.round(scale * 100)}%
      </div>

      {/* Page size */}
      <span>8.5 × 11.0 in</span>

      {/* Modified indicator */}
      {isModified && <span style={{ color: 'var(--warning)' }}>● Modified</span>}

      {/* Protection indicator */}
      {isProtected && <span title="Password protection will be applied on save">🔒 Protected</span>}

      {/* File name */}
      {fileName && <span style={{ marginLeft: 'auto' }}>{fileName}{isModified ? ' *' : ''}</span>}

      {/* Loading */}
      {isLoading && (
        <div className="loading-indicator">
          <div className="loading-dot" />
          <div className="loading-dot" />
          <div className="loading-dot" />
        </div>
      )}
    </div>
  );
}
