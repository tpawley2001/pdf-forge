import React, { useState } from 'react';
import { IconClose, IconSearch } from './Icons';

export default function SearchPanel({ query, onQueryChange, results, onResultClick, onClose }) {
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [wholeWord, setWholeWord] = useState(false);

  return (
    <div className="sidebar" style={{ borderLeft: '1px solid var(--border-color)', borderRight: 'none' }}>
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '8px 12px', borderBottom: '1px solid var(--border-color)',
        fontSize: 14, fontWeight: 600,
      }}>
        Search
        <button
          onClick={onClose}
          style={{
            background: 'none', border: 'none', color: 'var(--text-secondary)',
            cursor: 'pointer', width: 24, height: 24, display: 'flex',
            alignItems: 'center', justifyContent: 'center',
          }}
        >
          <IconClose />
        </button>
      </div>

      <div style={{ padding: 12 }}>
        {/* Search input */}
        <div style={{
          display: 'flex', gap: 6, background: 'var(--bg-input)',
          border: '1px solid var(--border-input)', borderRadius: 4,
          padding: '6px 10px', marginBottom: 10,
        }}>
          <IconSearch />
          <input
            type="text"
            value={query}
            onChange={e => onQueryChange(e.target.value)}
            placeholder="Find in document..."
            autoFocus
            style={{
              background: 'none', border: 'none', outline: 'none',
              color: 'var(--text-primary)', fontSize: 13, flex: 1,
            }}
          />
        </div>

        {/* Options */}
        <div style={{ display: 'flex', gap: 12, marginBottom: 12, fontSize: 11 }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 4, color: 'var(--text-secondary)', cursor: 'pointer' }}>
            <input type="checkbox" checked={caseSensitive} onChange={e => setCaseSensitive(e.target.checked)} />
            Aa
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 4, color: 'var(--text-secondary)', cursor: 'pointer' }}>
            <input type="checkbox" checked={wholeWord} onChange={e => setWholeWord(e.target.checked)} />
            Whole word
          </label>
        </div>

        {/* Results */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {results.length === 0 && query && (
            <div style={{ padding: 20, textAlign: 'center', color: 'var(--text-muted)', fontSize: 12 }}>
              No matches found
            </div>
          )}
          {results.map((r, i) => (
            <div
              key={i}
              onClick={() => onResultClick(r.page + 1)}
              style={{
                padding: '8px 10px', borderRadius: 4, cursor: 'pointer',
                background: 'var(--bg-input)', fontSize: 12,
              }}
            >
              <div style={{ color: 'var(--text-secondary)', fontSize: 10 }}>
                Page {r.page + 1}
              </div>
              <div>{typeof r === 'string' ? r : r.text || JSON.stringify(r)}</div>
            </div>
          ))}
        </div>

        {query && (
          <div style={{ marginTop: 8, fontSize: 11, color: 'var(--text-muted)' }}>
            {results.length} result{results.length !== 1 ? 's' : ''}
          </div>
        )}
      </div>
    </div>
  );
}
