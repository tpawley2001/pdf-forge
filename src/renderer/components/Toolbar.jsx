import React, { useState, useRef, useEffect } from 'react';
import {
  IconNewFile, IconOpen, IconSave, IconSaveAs, IconPrint,
  IconUndo, IconRedo, IconZoomIn, IconZoomOut,
  IconFitPage, IconFitWidth, IconRotateCW, IconRotateCCW,
  IconSelect, IconHand, IconHighlight, IconPen,
  IconRectangle, IconEllipse, IconLine, IconArrow,
  IconText, IconNote, IconStamp, IconSignature,
  IconSearch, IconClose, IconLeftPanel, IconRightPanel,
  IconMore, IconChevronDown,
  IconUnderline, IconStrikethrough,
  IconOCR, IconRedact, IconWatermark, IconLock,
} from './Icons';

const ANNOTATION_COLORS = [
  { value: 'rgba(255,255,0,0.5)', label: 'Yellow', display: '#ffe000' },
  { value: '#e74c3c',             label: 'Red',    display: '#e74c3c' },
  { value: '#3498db',             label: 'Blue',   display: '#3498db' },
  { value: '#2ecc71',             label: 'Green',  display: '#2ecc71' },
  { value: '#e67e22',             label: 'Orange', display: '#e67e22' },
  { value: '#9b59b6',             label: 'Purple', display: '#9b59b6' },
  { value: '#1abc9c',             label: 'Teal',   display: '#1abc9c' },
  { value: '#000000',             label: 'Black',  display: '#333' },
];

const STROKE_SIZES = [1, 2, 3, 5, 8];

const TOOL_GROUPS = {
  nav:    ['select', 'hand', 'editText'],
  markup: ['highlight', 'underline', 'strikethrough', 'redact'],
  draw:   ['freehand', 'rectangle', 'ellipse', 'line', 'arrow'],
  insert: ['text', 'note', 'stamp', 'signature'],
};

const TOOL_META = {
  select:        { icon: IconSelect,        label: 'Select Text (V)',           group: 'nav' },
  hand:          { icon: IconHand,          label: 'Hand Tool (H)',             group: 'nav' },
  editText:      { icon: IconText,          label: 'Edit Text: click existing text', group: 'nav' },
  highlight:     { icon: IconHighlight,     label: 'Highlight',                 group: 'markup' },
  underline:     { icon: IconUnderline,     label: 'Underline',                 group: 'markup' },
  strikethrough: { icon: IconStrikethrough, label: 'Strikethrough',             group: 'markup' },
  redact:        { icon: IconRedact,        label: 'Redact — mark areas, then Apply Redactions', group: 'markup' },
  freehand:      { icon: IconPen,           label: 'Freehand Draw',            group: 'draw' },
  rectangle:     { icon: IconRectangle,     label: 'Rectangle',                group: 'draw' },
  ellipse:       { icon: IconEllipse,       label: 'Ellipse',                  group: 'draw' },
  line:          { icon: IconLine,          label: 'Line',                     group: 'draw' },
  arrow:         { icon: IconArrow,         label: 'Arrow',                    group: 'draw' },
  text:          { icon: IconText,          label: 'Add Text Box',             group: 'insert' },
  note:          { icon: IconNote,          label: 'Sticky Note',              group: 'insert' },
  stamp:         { icon: IconStamp,         label: 'Stamp',                    group: 'insert' },
  signature:     { icon: IconSignature,     label: 'Signature',                group: 'insert' },
};

const COLOR_TOOLS    = ['highlight','underline','strikethrough','freehand','rectangle','ellipse','line','arrow','text','note'];
const STROKE_TOOLS   = ['freehand','rectangle','ellipse','line','arrow'];
const MARKUP_TOOLS   = new Set([...TOOL_GROUPS.markup, ...TOOL_GROUPS.draw, ...TOOL_GROUPS.insert]);

export default function Toolbar({
  activeTool, onToolChange,
  canUndo, canRedo, onUndo, onRedo,
  onZoomIn, onZoomOut, onFitPage, onFitWidth,
  onRotateCW, onRotateCCW,
  searchQuery, onSearchChange, onSearchSubmit,
  onOpen, onSave, onSaveAs, onPrint, onNewFile,
  onToggleLeftSidebar, onToggleRightSidebar,
  leftSidebarOpen, rightSidebarOpen,
  hasDocument, scale, onScaleChange,
  annotationColor, onColorChange,
  annotationSize,  onSizeChange,
  onOCR, ocrRunning,
  onOrganizePages, onExport, onDocumentProperties, onMergePDF, onImagesToPdf,
  onWatermark, onHeaderFooter, onProtect, onFlattenForm,
  redactCount, onApplyRedactions, isProtected,
}) {
  const [showFileMenu, setShowFileMenu] = useState(false);
  const [showZoomMenu, setShowZoomMenu] = useState(false);
  const [showToolsMenu, setShowToolsMenu] = useState(false);
  const fileMenuRef = useRef(null);
  const zoomMenuRef = useRef(null);
  const toolsMenuRef = useRef(null);

  useEffect(() => {
    const close = (e) => {
      if (fileMenuRef.current && !fileMenuRef.current.contains(e.target)) setShowFileMenu(false);
      if (zoomMenuRef.current && !zoomMenuRef.current.contains(e.target)) setShowZoomMenu(false);
      if (toolsMenuRef.current && !toolsMenuRef.current.contains(e.target)) setShowToolsMenu(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);

  const Btn = ({ icon: Icon, label, onClick, active, disabled, style }) => (
    <button
      className={`tb-btn${active ? ' tb-btn--active' : ''}`}
      onClick={onClick}
      data-tooltip={label}
      disabled={disabled}
      aria-label={label}
      style={style}
    >
      <Icon />
    </button>
  );

  const zoomPresets = [25, 50, 75, 100, 125, 150, 200, 300, 400];
  const showOptions = MARKUP_TOOLS.has(activeTool);

  return (
    <>
      {/* ── Main toolbar ── */}
      <div className="toolbar">
        {/* File */}
        <div className="toolbar__group">
          <div className="dropdown" ref={fileMenuRef}>
            <Btn icon={IconMore} label="File menu" onClick={() => setShowFileMenu(v => !v)} />
            <div className={`dropdown__menu${showFileMenu ? ' dropdown--open' : ''}`}>
              <div className="dropdown__item" onClick={() => { onNewFile?.(); setShowFileMenu(false); }}>
                <IconNewFile /> New
              </div>
              <div className="dropdown__item" onClick={() => { onOpen?.(); setShowFileMenu(false); }}>
                <IconOpen /> Open… <span style={{ marginLeft: 'auto', opacity: 0.5, fontSize: 10 }}>Ctrl+O</span>
              </div>
              <div className="dropdown__separator" />
              <div className="dropdown__item" onClick={() => { onSave?.(); setShowFileMenu(false); }}>
                <IconSave /> Save <span style={{ marginLeft: 'auto', opacity: 0.5, fontSize: 10 }}>Ctrl+S</span>
              </div>
              <div className="dropdown__item" onClick={() => { onSaveAs?.(); setShowFileMenu(false); }}>
                <IconSaveAs /> Save As…
              </div>
              <div className="dropdown__separator" />
              <div className="dropdown__item" onClick={() => { onPrint?.(); setShowFileMenu(false); }}>
                <IconPrint /> Print… <span style={{ marginLeft: 'auto', opacity: 0.5, fontSize: 10 }}>Ctrl+P</span>
              </div>
            </div>
          </div>
        </div>

        <div className="toolbar__divider" />

        {/* History */}
        <div className="toolbar__group">
          <Btn icon={IconUndo} label="Undo (Ctrl+Z)" onClick={onUndo} disabled={!canUndo} />
          <Btn icon={IconRedo} label="Redo (Ctrl+Y)" onClick={onRedo} disabled={!canRedo} />
        </div>

        <div className="toolbar__divider" />

        {/* Zoom */}
        <div className="toolbar__group">
          <Btn icon={IconZoomOut} label="Zoom Out (Ctrl+-)" onClick={onZoomOut} disabled={!hasDocument} />
          <div className="dropdown" ref={zoomMenuRef}>
            <button
              className="tb-btn tb-btn--text"
              onClick={() => setShowZoomMenu(v => !v)}
              data-tooltip="Zoom Level"
              disabled={!hasDocument}
              style={{ minWidth: 48 }}
            >
              {Math.round(scale * 100)}%
              <IconChevronDown style={{ width: 9, height: 9 }} />
            </button>
            <div className={`dropdown__menu${showZoomMenu ? ' dropdown--open' : ''}`}>
              {zoomPresets.map(z => (
                <div key={z} className="dropdown__item" onClick={() => { onScaleChange(z / 100); setShowZoomMenu(false); }}>
                  {z}%
                </div>
              ))}
              <div className="dropdown__separator" />
              <div className="dropdown__item" onClick={() => { onFitPage?.(); setShowZoomMenu(false); }}>
                <IconFitPage /> Fit Page
              </div>
              <div className="dropdown__item" onClick={() => { onFitWidth?.(); setShowZoomMenu(false); }}>
                <IconFitWidth /> Fit Width
              </div>
            </div>
          </div>
          <Btn icon={IconZoomIn} label="Zoom In (Ctrl+=)" onClick={onZoomIn} disabled={!hasDocument} />
        </div>

        <div className="toolbar__divider" />

        {/* Rotate */}
        <div className="toolbar__group">
          <Btn icon={IconRotateCW}  label="Rotate CW"  onClick={onRotateCW}  disabled={!hasDocument} />
          <Btn icon={IconRotateCCW} label="Rotate CCW" onClick={onRotateCCW} disabled={!hasDocument} />
        </div>

        <div className="toolbar__divider" />

        {/* Nav tools */}
        <div className="toolbar__group">
          {TOOL_GROUPS.nav.map(id => {
            const t = TOOL_META[id];
            return <Btn key={id} icon={t.icon} label={t.label} onClick={() => onToolChange(id)} active={activeTool === id} disabled={!hasDocument} />;
          })}
        </div>

        <div className="toolbar__divider" />

        {/* Markup tools */}
        <div className="toolbar__group">
          {TOOL_GROUPS.markup.map(id => {
            const t = TOOL_META[id];
            return <Btn key={id} icon={t.icon} label={t.label} onClick={() => onToolChange(id)} active={activeTool === id} disabled={!hasDocument} />;
          })}
        </div>

        <div className="toolbar__divider" />

        {/* Draw tools */}
        <div className="toolbar__group">
          {TOOL_GROUPS.draw.map(id => {
            const t = TOOL_META[id];
            return <Btn key={id} icon={t.icon} label={t.label} onClick={() => onToolChange(id)} active={activeTool === id} disabled={!hasDocument} />;
          })}
        </div>

        <div className="toolbar__divider" />

        {/* Insert tools */}
        <div className="toolbar__group">
          {TOOL_GROUPS.insert.map(id => {
            const t = TOOL_META[id];
            return <Btn key={id} icon={t.icon} label={t.label} onClick={() => onToolChange(id)} active={activeTool === id} disabled={!hasDocument} />;
          })}
        </div>

        <div className="toolbar__divider" />

        <div className="toolbar__group">
          <button
            className={`tb-btn tb-btn--labeled${ocrRunning ? ' tb-btn--active' : ''}`}
            onClick={onOCR}
            disabled={!hasDocument || ocrRunning}
            data-tooltip={ocrRunning ? 'Running OCR…' : 'OCR — edit text on scanned/image PDFs'}
            aria-label="OCR"
          >
            <IconOCR />
            <span>{ocrRunning ? '…' : 'OCR'}</span>
          </button>
        </div>

        <div className="toolbar__divider" />

        {/* Document operations */}
        <div className="toolbar__group">
          <button
            className="tb-btn tb-btn--labeled"
            onClick={onOrganizePages}
            disabled={!hasDocument}
            data-tooltip="Organize Pages — delete, rotate, reorder, extract"
            aria-label="Organize Pages"
          >
            <svg viewBox="0 0 16 16" style={{ width: 14, height: 14, fill: 'currentColor' }}>
              <rect x="1" y="1" width="6" height="7" rx="1" opacity="0.7" />
              <rect x="9" y="1" width="6" height="7" rx="1" opacity="0.7" />
              <rect x="1" y="10" width="6" height="5" rx="1" opacity="0.7" />
              <rect x="9" y="10" width="6" height="5" rx="1" opacity="0.7" />
            </svg>
            <span>Organize</span>
          </button>
          <button
            className="tb-btn tb-btn--labeled"
            onClick={onExport}
            disabled={!hasDocument}
            data-tooltip="Export — save pages as PNG, JPEG, or PDF"
            aria-label="Export"
          >
            <svg viewBox="0 0 16 16" style={{ width: 14, height: 14, fill: 'currentColor' }}>
              <path d="M8 1v9M4 7l4 4 4-4" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" />
              <rect x="2" y="12" width="12" height="2" rx="1" />
            </svg>
            <span>Export</span>
          </button>
          <button
            className="tb-btn tb-btn--labeled"
            onClick={onMergePDF}
            data-tooltip="Merge PDFs — combine multiple PDF files into one"
            aria-label="Merge PDFs"
          >
            <svg viewBox="0 0 16 16" style={{ width: 14, height: 14, fill: 'currentColor' }}>
              <rect x="1" y="2" width="5" height="8" rx="1" opacity="0.7" />
              <rect x="10" y="2" width="5" height="8" rx="1" opacity="0.7" />
              <path d="M7 6h2M8 5v2" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" />
              <rect x="3" y="12" width="10" height="2" rx="1" />
            </svg>
            <span>Merge</span>
          </button>
          <button
            className="tb-btn tb-btn--labeled"
            onClick={onImagesToPdf}
            data-tooltip="Images to PDF — build a PDF from JPEG/PNG pictures"
            aria-label="Images to PDF"
          >
            <svg viewBox="0 0 16 16" style={{ width: 14, height: 14, fill: 'currentColor' }}>
              <rect x="1.5" y="2.5" width="13" height="10" rx="1" fill="none" stroke="currentColor" strokeWidth="1.3" />
              <circle cx="5.2" cy="6" r="1.2" />
              <path d="M3 11l3.2-3.4 2.4 2.4 2-2.2 2.4 3.2z" />
            </svg>
            <span>Images</span>
          </button>
          <button
            className="tb-btn"
            onClick={onDocumentProperties}
            disabled={!hasDocument}
            data-tooltip="Document Properties — edit title, author, metadata"
            aria-label="Document Properties"
          >
            <svg viewBox="0 0 16 16" style={{ width: 14, height: 14, fill: 'currentColor' }}>
              <circle cx="8" cy="8" r="6.5" stroke="currentColor" strokeWidth="1.2" fill="none" />
              <text x="8" y="12" textAnchor="middle" fontSize="9" fontWeight="bold" fill="currentColor">i</text>
            </svg>
          </button>
          <div className="dropdown" ref={toolsMenuRef}>
            <button
              className={`tb-btn tb-btn--labeled${isProtected ? ' tb-btn--active' : ''}`}
              onClick={() => setShowToolsMenu(v => !v)}
              disabled={!hasDocument}
              data-tooltip="More tools — watermark, headers, protection"
              aria-label="More tools"
            >
              <IconMore />
              <span>More</span>
              <IconChevronDown style={{ width: 9, height: 9 }} />
            </button>
            <div className={`dropdown__menu${showToolsMenu ? ' dropdown--open' : ''}`}>
              <div className="dropdown__item" onClick={() => { onWatermark?.(); setShowToolsMenu(false); }}>
                <IconWatermark /> Add Watermark…
              </div>
              <div className="dropdown__item" onClick={() => { onHeaderFooter?.(); setShowToolsMenu(false); }}>
                <IconText /> Header &amp; Footer / Page Numbers…
              </div>
              <div className="dropdown__separator" />
              <div className="dropdown__item" onClick={() => { onProtect?.(); setShowToolsMenu(false); }}>
                <IconLock /> {isProtected ? 'Password Protection… 🔒' : 'Protect with Password…'}
              </div>
              <div className="dropdown__separator" />
              <div className="dropdown__item" onClick={() => { onFlattenForm?.(); setShowToolsMenu(false); }}>
                <IconText /> Flatten Form Fields
              </div>
            </div>
          </div>
        </div>

        <div className="toolbar__spacer" />

        {/* Search */}
        <div className="toolbar__search">
          <IconSearch style={{ width: 13, height: 13, fill: 'var(--text-muted)', flexShrink: 0 }} />
          <input
            type="text"
            placeholder="Search…"
            value={searchQuery}
            onChange={e => onSearchChange?.(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') onSearchSubmit?.(); }}
          />
          {searchQuery && (
            <button onClick={() => onSearchChange?.('')} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, display: 'flex' }}>
              <IconClose style={{ width: 11, height: 11, fill: 'var(--text-muted)' }} />
            </button>
          )}
        </div>

        {/* Panel toggles */}
        <div className="toolbar__group" style={{ marginLeft: 4 }}>
          <Btn icon={IconLeftPanel}  label="Left Panel"  onClick={onToggleLeftSidebar}  active={leftSidebarOpen} />
          <Btn icon={IconRightPanel} label="Right Panel" onClick={onToggleRightSidebar} active={rightSidebarOpen} />
        </div>
      </div>

      {/* ── Tool options bar ── */}
      {showOptions && hasDocument && (
        <div className="tool-options-bar">
          <span className="tool-options-bar__label">
            {TOOL_META[activeTool]?.label}
          </span>
          <div className="tool-options-bar__divider" />

          {COLOR_TOOLS.includes(activeTool) && (
            <>
              <span className="tool-options-bar__label">Color:</span>
              {ANNOTATION_COLORS.map(c => (
                <div
                  key={c.value}
                  className={`color-swatch${annotationColor === c.value ? ' color-swatch--active' : ''}`}
                  style={{ background: c.display }}
                  title={c.label}
                  onClick={() => onColorChange?.(c.value)}
                />
              ))}
              <div className="tool-options-bar__divider" />
            </>
          )}

          {STROKE_TOOLS.includes(activeTool) && (
            <>
              <span className="tool-options-bar__label">Size:</span>
              {STROKE_SIZES.map(s => (
                <button
                  key={s}
                  className={`size-btn${annotationSize === s ? ' size-btn--active' : ''}`}
                  onClick={() => onSizeChange?.(s)}
                >
                  {s}px
                </button>
              ))}
            </>
          )}

          {activeTool === 'redact' && (
            <>
              <span className="tool-options-bar__label" style={{ color: '#c62828' }}>
                Drag over content to mark it. Marks are only burned in when you apply.
              </span>
              <button
                className="btn btn-primary"
                style={{ marginLeft: 'auto', background: '#c62828', borderColor: '#c62828', fontSize: 11, padding: '3px 12px' }}
                disabled={!redactCount}
                onClick={onApplyRedactions}
              >
                Apply Redactions{redactCount ? ` (${redactCount})` : ''}
              </button>
            </>
          )}
        </div>
      )}
    </>
  );
}
