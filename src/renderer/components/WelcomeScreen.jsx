import React from 'react';

const TASKS = [
  {
    id: 'open',
    icon: '📂',
    title: 'Open PDF',
    desc: 'Browse your computer for a PDF file to edit',
    action: 'onOpen',
    primary: true,
  },
  {
    id: 'new',
    icon: '📄',
    title: 'Create Blank PDF',
    desc: 'Start with a new empty document',
    action: 'onNewFile',
  },
  {
    id: 'merge',
    icon: '🔗',
    title: 'Merge PDFs',
    desc: 'Combine multiple PDFs into one document',
    action: 'onOpen',
  },
  {
    id: 'compress',
    icon: '📦',
    title: 'Compress PDF',
    desc: 'Reduce file size for sharing',
    action: 'onOpen',
  },
  {
    id: 'fill',
    icon: '✍️',
    title: 'Fill & Sign',
    desc: 'Fill forms and add your signature',
    action: 'onOpen',
  },
  {
    id: 'export',
    icon: '🖼',
    title: 'Export to Image',
    desc: 'Convert PDF pages to images',
    action: 'onOpen',
  },
  {
    id: 'protect',
    icon: '🔒',
    title: 'Protect PDF',
    desc: 'Add password and permissions',
    action: 'onOpen',
  },
];

const RECENT_PLACEHOLDERS = [
  'No recent files',
  'Open a PDF to see it here',
];

export default function WelcomeScreen({ onOpen, onNewFile, isLoading }) {
  return (
    <div style={{
      flex: 1,
      overflow: 'auto',
      background: 'var(--bg-app)',
      display: 'flex',
      justifyContent: 'center',
      padding: '40px 20px',
    }}>
      <div style={{ maxWidth: 900, width: '100%' }}>

        {/* Hero */}
        <div style={{
          textAlign: 'center',
          marginBottom: 40,
        }}>
          <div style={{
            fontSize: 48, marginBottom: 8,
          }}>📄</div>
          <h1 style={{
            fontSize: 28, fontWeight: 700,
            color: 'var(--text-primary)',
            marginBottom: 8,
          }}>
            PDF Forge
          </h1>
          <p style={{
            color: 'var(--text-secondary)',
            fontSize: 14, maxWidth: 500, margin: '0 auto', lineHeight: 1.6,
          }}>
            Free, open-source PDF editor for Windows.
            Open a file to get started, or drag a PDF anywhere on this window.
          </p>
        </div>

        {/* Task Grid */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))',
          gap: 12,
          marginBottom: 32,
        }}>
          {TASKS.map((t) => (
            <button
              key={t.id}
              onClick={() => {
                if (t.action === 'onOpen') onOpen();
                else if (t.action === 'onNewFile') onNewFile();
              }}
              disabled={isLoading}
              style={{
                display: 'flex', alignItems: 'flex-start', gap: 14,
                padding: 18, borderRadius: 10,
                border: t.primary ? '2px solid var(--accent)' : '1px solid var(--border-color)',
                background: t.primary ? 'var(--accent-light)' : 'var(--bg-panel)',
                cursor: 'pointer', textAlign: 'left',
                transition: 'background 0.15s, transform 0.1s',
                color: 'var(--text-primary)',
                fontFamily: 'inherit',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = t.primary
                  ? 'var(--accent-light)'
                  : 'var(--bg-hover)';
                e.currentTarget.style.transform = 'translateY(-1px)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = t.primary
                  ? 'var(--accent-light)'
                  : 'var(--bg-panel)';
                e.currentTarget.style.transform = 'translateY(0)';
              }}
            >
              <span style={{ fontSize: 28, flexShrink: 0 }}>{t.icon}</span>
              <div>
                <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 2 }}>
                  {t.title}
                </div>
                <div style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.4 }}>
                  {t.desc}
                </div>
              </div>
            </button>
          ))}
        </div>

        {/* Recent Files */}
        <div>
          <h3 style={{
            fontSize: 13, fontWeight: 600,
            color: 'var(--text-secondary)',
            marginBottom: 12, textTransform: 'uppercase', letterSpacing: 0.5,
          }}>
            Recent Files
          </h3>
          <div style={{
            border: '1px dashed var(--border-color)',
            borderRadius: 8, padding: 32,
            textAlign: 'center', color: 'var(--text-muted)', fontSize: 13,
          }}>
            <div>{RECENT_PLACEHOLDERS[0]}</div>
            <div style={{ fontSize: 11, marginTop: 4 }}>
              {RECENT_PLACEHOLDERS[1]}
            </div>
          </div>
        </div>

        {/* Drag hint */}
        <div style={{
          marginTop: 32, textAlign: 'center',
          color: 'var(--text-muted)', fontSize: 12,
        }}>
          Or drag and drop a PDF file anywhere on this window
        </div>
      </div>
    </div>
  );
}
