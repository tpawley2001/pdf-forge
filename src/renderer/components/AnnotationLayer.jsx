import React, { useState, useCallback, useEffect, useRef } from 'react';

export default function AnnotationLayer({ pageNum, annotations, scale, selectedId, onSelect, onDelete }) {
  const [contextMenu, setContextMenu] = useState(null); // { x, y, annotationId }
  const menuRef = useRef(null);

  const handleContextMenu = useCallback((e, id) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({ x: e.clientX, y: e.clientY, annotationId: id });
    if (onSelect) onSelect(id);
  }, [onSelect]);

  const closeMenu = useCallback(() => setContextMenu(null), []);

  useEffect(() => {
    if (!contextMenu) return;
    const handler = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) closeMenu();
    };
    window.addEventListener('mousedown', handler);
    return () => window.removeEventListener('mousedown', handler);
  }, [contextMenu, closeMenu]);

  if (!annotations || annotations.length === 0) return null;

  return (
    <>
      <svg
        style={{
          position: 'absolute', top: 0, left: 0,
          width: '100%', height: '100%',
          pointerEvents: 'none',
          overflow: 'visible',
        }}
      >
        {annotations.map(ann => (
          <AnnotationMark
            key={ann.id}
            annotation={ann}
            scale={scale}
            isSelected={ann.id === selectedId}
            onClick={(e) => { e.stopPropagation(); onSelect && onSelect(ann.id); }}
            onContextMenu={(e) => handleContextMenu(e, ann.id)}
          />
        ))}
      </svg>

      {contextMenu && (
        <div
          ref={menuRef}
          style={{
            position: 'fixed',
            top: contextMenu.y,
            left: contextMenu.x,
            background: 'var(--bg-dropdown)',
            border: '1px solid var(--border-color)',
            borderRadius: 4,
            boxShadow: 'var(--shadow-dropdown)',
            zIndex: 9999,
            minWidth: 140,
            padding: '4px 0',
          }}
        >
          <button
            onClick={() => { if (onDelete) onDelete(contextMenu.annotationId); closeMenu(); }}
            style={{
              display: 'block', width: '100%', textAlign: 'left',
              padding: '6px 12px', background: 'none', border: 'none',
              color: 'var(--danger)', cursor: 'pointer', fontSize: 12,
            }}
            onMouseEnter={e => e.currentTarget.style.background = 'rgba(244,71,71,0.1)'}
            onMouseLeave={e => e.currentTarget.style.background = 'none'}
          >
            🗑 Delete Annotation
          </button>
          <button
            onClick={() => { if (onSelect) onSelect(null); closeMenu(); }}
            style={{
              display: 'block', width: '100%', textAlign: 'left',
              padding: '6px 12px', background: 'none', border: 'none',
              color: 'var(--text-secondary)', cursor: 'pointer', fontSize: 12,
            }}
            onMouseEnter={e => e.currentTarget.style.background = 'var(--bg-hover)'}
            onMouseLeave={e => e.currentTarget.style.background = 'none'}
          >
            Deselect
          </button>
        </div>
      )}
    </>
  );
}

function AnnotationMark({ annotation, scale, isSelected, onClick, onContextMenu }) {
  const { type, color } = annotation;
  const s = scale;
  const strokeColor = color || '#e74c3c';

  const commonProps = {
    style: { pointerEvents: 'auto', cursor: 'pointer' },
    onClick,
    onContextMenu,
  };

  switch (type) {
    case 'redact': {
      const r = annotation.rect || { x: 0, y: 0, width: 100, height: 14 };
      return (
        <g {...commonProps}>
          <rect
            x={r.x * s} y={r.y * s} width={r.width * s} height={r.height * s}
            fill={isSelected ? 'rgba(0,0,0,0.85)' : 'rgba(0,0,0,0.15)'}
            stroke="#c62828" strokeWidth={1.5}
          />
          {!isSelected && r.width * s > 40 && r.height * s > 10 && (
            <text
              x={(r.x + r.width / 2) * s} y={(r.y + r.height / 2) * s + 3.5}
              textAnchor="middle" fontSize={Math.min(10, r.height * s * 0.6)}
              fill="#c62828" fontWeight="bold" style={{ pointerEvents: 'none', userSelect: 'none' }}
            >
              REDACT
            </text>
          )}
        </g>
      );
    }

    case 'highlight': {
      const r = annotation.rect || { x: 0, y: 0, width: 100, height: 14 };
      return (
        <rect
          x={r.x * s} y={r.y * s} width={r.width * s} height={r.height * s}
          fill={color || 'rgba(255, 255, 0, 0.35)'}
          stroke={isSelected ? '#1890ff' : 'none'}
          strokeWidth={isSelected ? 2 : 0}
          {...commonProps}
        />
      );
    }

    case 'underline': {
      const r = annotation.rect || { x: 0, y: 0, width: 100, height: 14 };
      return (
        <g {...commonProps}>
          {isSelected && <rect x={r.x * s} y={r.y * s} width={r.width * s} height={r.height * s} fill="rgba(24,144,255,0.08)" stroke="#1890ff" strokeWidth={1} />}
          <line
            x1={r.x * s} y1={(r.y + r.height) * s}
            x2={(r.x + r.width) * s} y2={(r.y + r.height) * s}
            stroke={strokeColor} strokeWidth={2}
          />
        </g>
      );
    }

    case 'strikethrough': {
      const r = annotation.rect || { x: 0, y: 0, width: 100, height: 14 };
      const midY = (r.y + r.height / 2) * s;
      return (
        <g {...commonProps}>
          {isSelected && <rect x={r.x * s} y={r.y * s} width={r.width * s} height={r.height * s} fill="rgba(24,144,255,0.08)" stroke="#1890ff" strokeWidth={1} />}
          <line
            x1={r.x * s} y1={midY} x2={(r.x + r.width) * s} y2={midY}
            stroke={strokeColor} strokeWidth={2}
          />
        </g>
      );
    }

    case 'freehand': {
      const path = annotation.path || [];
      if (path.length < 2) return null;
      const d = path.map((pt, i) => `${i === 0 ? 'M' : 'L'}${pt.x * s},${pt.y * s}`).join(' ');
      return (
        <path
          d={d} fill="none" stroke={strokeColor}
          strokeWidth={(annotation.width || 2)}
          strokeLinecap="round"
          filter={isSelected ? 'drop-shadow(0 0 3px #1890ff)' : undefined}
          {...commonProps}
        />
      );
    }

    case 'rectangle': {
      const r = annotation.rect || { x: annotation.x || 20, y: annotation.y || 20, width: annotation.width || 100, height: annotation.height || 80 };
      return (
        <rect
          x={r.x * s} y={r.y * s} width={r.width * s} height={r.height * s}
          fill="none" stroke={strokeColor}
          strokeWidth={annotation.borderWidth || 2}
          filter={isSelected ? 'drop-shadow(0 0 3px #1890ff)' : undefined}
          {...commonProps}
        />
      );
    }

    case 'ellipse': {
      const r = annotation.rect || { x: annotation.x || 20, y: annotation.y || 20, width: annotation.width || 100, height: annotation.height || 80 };
      return (
        <ellipse
          cx={(r.x + r.width / 2) * s} cy={(r.y + r.height / 2) * s}
          rx={(r.width / 2) * s} ry={(r.height / 2) * s}
          fill="none" stroke={strokeColor}
          strokeWidth={annotation.borderWidth || 2}
          filter={isSelected ? 'drop-shadow(0 0 3px #1890ff)' : undefined}
          {...commonProps}
        />
      );
    }

    case 'line': {
      const start = annotation.startPoint || { x: 20, y: 20 };
      const end = annotation.endPoint || { x: 120, y: 20 };
      return (
        <g {...commonProps}>
          {/* Fat invisible hit area */}
          <line x1={start.x * s} y1={start.y * s} x2={end.x * s} y2={end.y * s} stroke="transparent" strokeWidth={12} />
          <line
            x1={start.x * s} y1={start.y * s} x2={end.x * s} y2={end.y * s}
            stroke={strokeColor} strokeWidth={annotation.width || 2}
            filter={isSelected ? 'drop-shadow(0 0 3px #1890ff)' : undefined}
          />
        </g>
      );
    }

    case 'arrow': {
      const start = annotation.startPoint || { x: 20, y: 20 };
      const end = annotation.endPoint || { x: 120, y: 20 };
      const angle = Math.atan2(end.y - start.y, end.x - start.x);
      const headLen = 12;
      return (
        <g
          style={{ pointerEvents: 'auto', cursor: 'pointer' }}
          onClick={onClick} onContextMenu={onContextMenu}
          filter={isSelected ? 'drop-shadow(0 0 3px #1890ff)' : undefined}
        >
          <line x1={start.x * s} y1={start.y * s} x2={end.x * s} y2={end.y * s} stroke="transparent" strokeWidth={12} />
          <line x1={start.x * s} y1={start.y * s} x2={end.x * s} y2={end.y * s}
            stroke={strokeColor} strokeWidth={annotation.width || 2} />
          <line x1={end.x * s} y1={end.y * s}
            x2={(end.x - headLen * Math.cos(angle - Math.PI * 0.15)) * s}
            y2={(end.y - headLen * Math.sin(angle - Math.PI * 0.15)) * s}
            stroke={strokeColor} strokeWidth={annotation.width || 2} />
          <line x1={end.x * s} y1={end.y * s}
            x2={(end.x - headLen * Math.cos(angle + Math.PI * 0.15)) * s}
            y2={(end.y - headLen * Math.sin(angle + Math.PI * 0.15)) * s}
            stroke={strokeColor} strokeWidth={annotation.width || 2} />
        </g>
      );
    }

    case 'note': {
      const x = (annotation.x || 20) * s;
      const y = (annotation.y || 20) * s;
      const noteColor = color || '#fff59d';
      return (
        <g {...commonProps} filter={isSelected ? 'drop-shadow(0 0 4px #1890ff)' : undefined}>
          <rect x={x} y={y - 20 * s} width={20 * s} height={20 * s}
            fill={noteColor} stroke="#f9a825" strokeWidth={1.5} rx={2 * s} />
          <text x={x + 10 * s} y={y - 6 * s} textAnchor="middle" fontSize={10 * s}
            fill="#333" fontWeight="bold">N</text>
        </g>
      );
    }

    case 'textbox': {
      const r = annotation.rect || { x: annotation.x || 20, y: annotation.y || 20, width: annotation.width || 200, height: annotation.height || 60 };
      return (
        <g {...commonProps}>
          <rect x={r.x * s} y={r.y * s} width={r.width * s} height={r.height * s}
            fill="rgba(255,255,200,0.9)" stroke={isSelected ? '#1890ff' : '#aaa'} strokeWidth={isSelected ? 2 : 1} rx={2} />
          {annotation.text && (
            <foreignObject x={r.x * s + 4} y={r.y * s + 4} width={r.width * s - 8} height={r.height * s - 8}>
              <div xmlns="http://www.w3.org/1999/xhtml" style={{ fontSize: (annotation.fontSize || 13) * s, color: '#000', wordBreak: 'break-word', overflow: 'hidden' }}>
                {annotation.text}
              </div>
            </foreignObject>
          )}
        </g>
      );
    }

    case 'stamp': {
      const x = (annotation.x || 40) * s;
      const y = (annotation.y || 40) * s;
      const stampText = annotation.stampType || 'Approved';
      const stampMeta = STAMP_STYLES[stampText] || STAMP_STYLES['Approved'];
      return (
        <g {...commonProps} filter={isSelected ? 'drop-shadow(0 0 4px #1890ff)' : undefined}>
          <rect x={x} y={y - 32 * s} width={130 * s} height={32 * s}
            fill="none" stroke={stampMeta.color} strokeWidth={3} rx={6 * s} />
          <text x={x + 65 * s} y={y - 10 * s} textAnchor="middle" fontSize={14 * s}
            fill={stampMeta.color} fontWeight="bold">{stampText.toUpperCase()}</text>
        </g>
      );
    }

    case 'signature': {
      const x = (annotation.x || 20) * s;
      const y = (annotation.y || 20) * s;
      if (annotation.dataUrl && annotation.dataUrl.startsWith('data:image')) {
        const w = (annotation.width || 180) * s;
        return (
          <image
            href={annotation.dataUrl}
            x={x} y={y}
            width={w}
            filter={isSelected ? 'drop-shadow(0 0 4px #1890ff)' : undefined}
            {...commonProps}
          />
        );
      }
      return (
        <text x={x} y={y + 18 * s} fontSize={18 * s} fill="#1565C0" fontFamily="cursive"
          filter={isSelected ? 'drop-shadow(0 0 4px #1890ff)' : undefined}
          {...commonProps}>
          {annotation.dataUrl || '✍ Signature'}
        </text>
      );
    }

    default:
      return null;
  }
}

const STAMP_STYLES = {
  'Approved':     { color: '#e53935' },
  'Draft':        { color: '#1565C0' },
  'Confidential': { color: '#b71c1c' },
  'For Review':   { color: '#2e7d32' },
  'Void':         { color: '#6d4c41' },
  'Final':        { color: '#1b5e20' },
  'Expired':      { color: '#757575' },
  'Not Approved': { color: '#e53935' },
};
