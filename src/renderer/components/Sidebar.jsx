import React from 'react';
import {
  IconThumbnails, IconBookmark, IconAnnotations, IconSearch, IconClose
} from './Icons';

const TABS = [
  { id: 'thumbnails', icon: IconThumbnails, label: 'Pages' },
  { id: 'bookmarks',  icon: IconBookmark,   label: 'Bookmarks' },
  { id: 'comments',   icon: IconAnnotations, label: 'Comments' },
  { id: 'search',     icon: IconSearch,      label: 'Search' },
];

export default function Sidebar({
  open, activeTab, onTabChange,
  pageCount, currentPage, onPageSelect,
  hasDocument, thumbnails,
  annotations, selectedAnnotationId, onAnnotationSelect, onAnnotationDelete,
  searchQuery, onSearchChange, searchResults, onSearchResultClick,
  outline,
}) {
  if (!open) return null;

  return (
    <div className="sidebar">
      <div className="sidebar__tabs">
        {TABS.map(t => (
          <div
            key={t.id}
            className={`sidebar__tab${activeTab === t.id ? ' sidebar__tab--active' : ''}`}
            title={t.label}
            onClick={() => onTabChange(t.id)}
          >
            <t.icon />
            {t.label}
          </div>
        ))}
      </div>

      <div className="sidebar__content">
        {activeTab === 'thumbnails' && (
          <ThumbnailList
            pageCount={pageCount}
            currentPage={currentPage}
            onPageSelect={onPageSelect}
            hasDocument={hasDocument}
            thumbnails={thumbnails}
          />
        )}
        {activeTab === 'bookmarks' && (
          <OutlineList outline={outline || []} onPageSelect={onPageSelect} />
        )}
        {activeTab === 'comments' && (
          <CommentList
            annotations={annotations}
            selectedId={selectedAnnotationId}
            onSelect={onAnnotationSelect}
            onDelete={onAnnotationDelete}
          />
        )}
        {activeTab === 'search' && (
          <SearchTab
            query={searchQuery}
            onQueryChange={onSearchChange}
            results={searchResults}
            onResultClick={onSearchResultClick}
          />
        )}
      </div>
    </div>
  );
}

// ── Thumbnails ──
function ThumbnailList({ pageCount, currentPage, onPageSelect, hasDocument, thumbnails }) {
  if (!hasDocument || pageCount === 0) {
    return (
      <div className="empty-state">
        <IconThumbnails />
        <div className="empty-state__text">No Pages</div>
      </div>
    );
  }

  return (
    <div className="thumb-list">
      {Array.from({ length: pageCount }, (_, i) => {
        const n   = i + 1;
        const url = thumbnails && thumbnails[n];
        return (
          <div
            key={n}
            className={`thumb-item${currentPage === n ? ' thumb-item--active' : ''}`}
            onClick={() => onPageSelect(n)}
            title={`Page ${n}`}
          >
            {url ? (
              <img
                src={url}
                alt={`Page ${n}`}
                style={{ display: 'block', maxWidth: 160 }}
              />
            ) : (
              <div className="thumb-item__placeholder">
                <span style={{ opacity: 0.4, fontSize: 11 }}>p.{n}</span>
              </div>
            )}
            <div className="thumb-item__label">{n}</div>
          </div>
        );
      })}
    </div>
  );
}

// ── Comments / Annotations ──
const TYPE_COLORS = {
  highlight: '#f1c40f', underline: '#3498db', strikethrough: '#e74c3c',
  freehand: '#e74c3c', rectangle: '#e74c3c', ellipse: '#e74c3c',
  line: '#555', arrow: '#555', text: '#f39c12', textbox: '#f39c12',
  note: '#f1c40f', stamp: '#e74c3c', signature: '#2980b9',
};

function CommentList({ annotations, selectedId, onSelect, onDelete }) {
  if (!annotations || annotations.length === 0) {
    return (
      <div className="empty-state">
        <IconAnnotations />
        <div className="empty-state__text">No Comments</div>
        <div className="empty-state__hint">Annotations you add will appear here.</div>
      </div>
    );
  }

  return (
    <div>
      {annotations.map(a => (
        <div
          key={a.id}
          className={`ann-item${a.id === selectedId ? ' ann-item--selected' : ''}`}
          onClick={() => onSelect?.(a.id)}
        >
          <div className="ann-item__header">
            <span
              className="ann-item__type"
              style={{ borderLeft: `3px solid ${TYPE_COLORS[a.type] || '#888'}`, paddingLeft: 4 }}
            >
              {a.type}
            </span>
            <span className="ann-item__page">p.{a.page ?? '?'}</span>
            <button
              className="ann-item__delete"
              title="Delete"
              onClick={e => { e.stopPropagation(); onDelete?.(a.id); }}
            >
              ✕
            </button>
          </div>
          {(a.text || a.stampType) && (
            <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {a.text || a.stampType}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

// ── Search ──
function SearchTab({ query, onQueryChange, results, onResultClick }) {
  return (
    <div style={{ padding: 8 }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 6,
        background: 'var(--bg-input)', border: '1px solid var(--border-input)',
        borderRadius: 3, padding: '4px 8px', marginBottom: 8,
      }}>
        <IconSearch style={{ width: 13, height: 13, fill: 'var(--text-muted)', flexShrink: 0 }} />
        <input
          type="text"
          value={query}
          onChange={e => onQueryChange(e.target.value)}
          placeholder="Find in document..."
          autoFocus
          style={{ background: 'none', border: 'none', outline: 'none', color: 'var(--text-primary)', fontSize: 12, flex: 1 }}
        />
        {query && (
          <button
            onClick={() => onQueryChange('')}
            style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, display: 'flex', color: 'var(--text-muted)' }}
          >
            <IconClose style={{ width: 11, height: 11, fill: 'currentColor' }} />
          </button>
        )}
      </div>

      {query && results.length === 0 && (
        <div style={{ padding: '16px 0', textAlign: 'center', color: 'var(--text-muted)', fontSize: 11 }}>
          No results found
        </div>
      )}

      {results.map((r, i) => (
        <div key={i} className="search-result" onClick={() => onResultClick(r.page)}>
          <div className="search-result__page">Page {r.page}</div>
          <div className="search-result__text">{highlightMatch(r.text, query)}</div>
        </div>
      ))}

      {results.length > 0 && (
        <div style={{ padding: '6px 4px', fontSize: 10, color: 'var(--text-muted)' }}>
          {results.length} page{results.length !== 1 ? 's' : ''} with matches
        </div>
      )}
    </div>
  );
}

// ── Bookmarks / Outline ──
function OutlineList({ outline, onPageSelect }) {
  if (!outline || outline.length === 0) {
    return (
      <div className="empty-state">
        <IconBookmark />
        <div className="empty-state__text">No Bookmarks</div>
        <div className="empty-state__hint">Bookmarks appear when the PDF contains a table of contents.</div>
      </div>
    );
  }
  return (
    <div style={{ padding: '4px 0' }}>
      {outline.map((item, i) => (
        <OutlineItem key={i} item={item} depth={0} onPageSelect={onPageSelect} />
      ))}
    </div>
  );
}

function OutlineItem({ item, depth, onPageSelect }) {
  const [expanded, setExpanded] = React.useState(depth === 0);
  const hasChildren = item.items && item.items.length > 0;

  const handleClick = () => {
    if (item.dest) {
      // Destination can be a named dest string or array [pageRef, ...]
      // For simplicity we just navigate to the page number if available
      if (Array.isArray(item.dest) && item.dest[0]) {
        // item.dest[0] is a page ref object {num, gen} — we'd need pdfDoc to resolve
        // For now try to get the page number from the ref
        const pageNum = item.dest[0].num;
        if (typeof pageNum === 'number') onPageSelect(pageNum + 1);
      }
    }
    if (hasChildren) setExpanded(e => !e);
  };

  return (
    <div>
      <div
        onClick={handleClick}
        style={{
          display: 'flex', alignItems: 'center', gap: 4,
          padding: `3px 8px 3px ${8 + depth * 14}px`,
          cursor: 'pointer', fontSize: 12, color: 'var(--text-primary)',
          borderRadius: 3, userSelect: 'none',
        }}
        className="bookmark-item"
      >
        {hasChildren && (
          <span style={{ fontSize: 10, opacity: 0.6, width: 12, textAlign: 'center', flexShrink: 0 }}>
            {expanded ? '▾' : '▸'}
          </span>
        )}
        {!hasChildren && <span style={{ width: 12, flexShrink: 0 }} />}
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {item.title || 'Untitled'}
        </span>
      </div>
      {expanded && hasChildren && item.items.map((child, i) => (
        <OutlineItem key={i} item={child} depth={depth + 1} onPageSelect={onPageSelect} />
      ))}
    </div>
  );
}

function highlightMatch(text, query) {
  if (!query) return text;
  const idx = text.toLowerCase().indexOf(query.toLowerCase());
  if (idx === -1) return text;
  return (
    <>
      {text.slice(0, idx)}
      <span className="search-result__match">{text.slice(idx, idx + query.length)}</span>
      {text.slice(idx + query.length)}
    </>
  );
}
