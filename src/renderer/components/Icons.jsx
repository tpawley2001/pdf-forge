import React from 'react';

/* SVG Icon Components — all inline, no icon library */

export const IconNewFile = (props) => (
  <svg viewBox="0 0 24 24" {...props}>
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6zm-1 2l5 5h-5V4zM6 20V4h5v7h7v9H6z"/>
  </svg>
);

export const IconOpen = (props) => (
  <svg viewBox="0 0 24 24" {...props}>
    <path d="M20 6h-8l-2-2H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2zm0 12H4V6h5.17l2 2H20v10z"/>
  </svg>
);

export const IconSave = (props) => (
  <svg viewBox="0 0 24 24" {...props}>
    <path d="M17 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V7l-4-4zm-5 16c-1.66 0-3-1.34-3-3s1.34-3 3-3 3 1.34 3 3-1.34 3-3 3zm3-10H5V5h10v4z"/>
  </svg>
);

export const IconSaveAs = (props) => (
  <svg viewBox="0 0 24 24" {...props}>
    <path d="M19 12v7H5v-7H3v7a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7h-2zm-6 .67l2.59-2.58L17 11.5l-5 5-5-5 1.41-1.41L11 12.67V3h2v9.67z"/>
  </svg>
);

export const IconPrint = (props) => (
  <svg viewBox="0 0 24 24" {...props}>
    <path d="M19 8H5c-1.66 0-3 1.34-3 3v6h4v4h12v-4h4v-6c0-1.66-1.34-3-3-3zm-3 11H8v-5h8v5zm3-7c-.55 0-1-.45-1-1s.45-1 1-1 1 .45 1 1-.45 1-1 1zm-1-9H6v4h12V3z"/>
  </svg>
);

export const IconUndo = (props) => (
  <svg viewBox="0 0 24 24" {...props}>
    <path d="M12.5 8c-2.65 0-5.05.99-6.9 2.6L2 7v9h9l-3.62-3.62c1.39-1.16 3.16-1.88 5.12-1.88 3.54 0 6.55 2.31 7.6 5.5l2.37-.78C21.08 11.03 17.15 8 12.5 8z"/>
  </svg>
);

export const IconRedo = (props) => (
  <svg viewBox="0 0 24 24" {...props}>
    <path d="M18.4 10.6C16.55 8.99 14.15 8 11.5 8c-4.65 0-8.58 3.03-9.96 7.22L3.9 16c1.05-3.19 4.05-5.5 7.6-5.5 1.95 0 3.73.72 5.12 1.88L13 16h9V7l-3.6 3.6z"/>
  </svg>
);

export const IconZoomIn = (props) => (
  <svg viewBox="0 0 24 24" {...props}>
    <path d="M15.5 14h-.79l-.28-.27A6.471 6.471 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14zM12 10h-2v2H9v-2H7V9h2V7h1v2h2v1z"/>
  </svg>
);

export const IconZoomOut = (props) => (
  <svg viewBox="0 0 24 24" {...props}>
    <path d="M15.5 14h-.79l-.28-.27A6.471 6.471 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14zM7 9h5v1H7V9z"/>
  </svg>
);

export const IconFitPage = (props) => (
  <svg viewBox="0 0 24 24" {...props}>
    <path d="M3 5v4h2V5h4V3H5a2 2 0 0 0-2 2zm2 10H3v4a2 2 0 0 0 2 2h4v-2H5v-4zm14 4h-4v2h4a2 2 0 0 0 2-2v-4h-2v4zm0-16h-4v2h4v4h2V5a2 2 0 0 0-2-2z"/>
  </svg>
);

export const IconFitWidth = (props) => (
  <svg viewBox="0 0 24 24" {...props}>
    <path d="M20 4H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2zm0 14H4V6h16v12zM8 9H5v6h3V9z"/>
  </svg>
);

export const IconRotateCW = (props) => (
  <svg viewBox="0 0 24 24" {...props}>
    <path d="M15.55 5.55L11 1v3.07C7.06 4.56 4 7.92 4 12s3.05 7.44 7 7.93v-2.02c-2.84-.48-5-2.94-5-5.91s2.16-5.43 5-5.91V10l4.55-4.45zM19.93 11a7.906 7.906 0 0 0-1.62-3.89l-1.42 1.42c.54.75.88 1.6 1.02 2.47h2.02zM13 17.9v2.02c1.39-.17 2.74-.71 3.9-1.61l-1.44-1.44c-.75.54-1.59.89-2.46 1.03zm3.89-2.42l1.42 1.41c.9-1.16 1.45-2.5 1.62-3.89h-2.02c-.14.87-.48 1.72-1.02 2.48z"/>
  </svg>
);

export const IconRotateCCW = (props) => (
  <svg viewBox="0 0 24 24" {...props}>
    <path d="M8.45 5.55L13 1v3.07C16.94 4.56 20 7.92 20 12s-3.05 7.44-7 7.93v-2.02c2.84-.48 5-2.94 5-5.91s-2.16-5.43-5-5.91V10L8.45 5.55zM4.07 11a7.906 7.906 0 0 1 1.62-3.89l1.42 1.42A5.95 5.95 0 0 0 6.09 11h2.02zM11 17.9v2.02a7.92 7.92 0 0 1-3.9-1.61l1.44-1.44c.75.54 1.59.89 2.46 1.03zm-3.89-2.42l-1.42 1.41A7.906 7.906 0 0 1 4.07 13h2.02c.14.87.48 1.72 1.02 2.48z"/>
  </svg>
);

export const IconSelect = (props) => (
  <svg viewBox="0 0 24 24" {...props}>
    <path d="M4 4h7v7H4V4zm2 2v3h3V6H6zm7-2h7v7h-7V4zm2 2v3h3V6h-3zM4 13h7v7H4v-7zm2 2v3h3v-3H6zm11-2h3v2h-3v-2zm0 3h3v2h-3v-2zm-2 1h2v3h-2v-3zm3 0h2v2h-2v-2z"/>
  </svg>
);

export const IconHand = (props) => (
  <svg viewBox="0 0 24 24" {...props}>
    <path d="M18 13v1.5a2.5 2.5 0 0 1-5 0V10c0-.55-.45-1-1-1s-1 .45-1 1v5c0 .55-.45 1-1 1s-1-.45-1-1V8c0-.55-.45-1-1-1s-1 .45-1 1v6a4 4 0 0 0 8 0v-2h2v1zm-4-8c-.55 0-1 .45-1 1v4h-2V6c0-1.66 1.34-3 3-3s3 1.34 3 3v6.5a4.5 4.5 0 0 1-9 0V9h2v3.5a2.5 2.5 0 0 0 5 0V6c0-.55-.45-1-1-1z"/>
  </svg>
);

export const IconHighlight = (props) => (
  <svg viewBox="0 0 24 24" {...props}>
    <path d="M6 14l3 3 8-8-3-3-8 8zm9.17-9.17L17.59 3 21 6.41l-2.42 2.42-3.41-3.42zM3 21h18v-2H3v2z"/>
  </svg>
);

export const IconUnderline = (props) => (
  <svg viewBox="0 0 24 24" {...props}>
    <path d="M12 17c3.31 0 6-2.69 6-6V3h-2.5v8c0 1.93-1.57 3.5-3.5 3.5S8.5 12.93 8.5 11V3H6v8c0 3.31 2.69 6 6 6zm-7 2v2h14v-2H5z"/>
  </svg>
);

export const IconStrikethrough = (props) => (
  <svg viewBox="0 0 24 24" {...props}>
    <path d="M12 19c-2.21 0-4-1.79-4-4h2c0 1.1.9 2 2 2s2-.9 2-2c0-1.5-1.2-2.3-2.9-2.8L9.5 11.4c-2-.6-3.5-2-3.5-4.4 0-2.76 2.24-5 5-5s5 2.24 5 5h-2c0-1.66-1.34-3-3-3S8 5.34 8 7c0 1.5 1.2 2.2 2.9 2.7l1.6.6c2 .7 3.5 2.1 3.5 4.7 0 2.76-2.24 5-5 5zM3 11h18v2H3v-2z"/>
  </svg>
);

export const IconPen = (props) => (
  <svg viewBox="0 0 24 24" {...props}>
    <path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04a.996.996 0 0 0 0-1.41l-2.34-2.34a.996.996 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/>
  </svg>
);

export const IconRectangle = (props) => (
  <svg viewBox="0 0 24 24" {...props}>
    <path d="M4 6h16v12H4V6zm2 2v8h12V8H6z"/>
  </svg>
);

export const IconEllipse = (props) => (
  <svg viewBox="0 0 24 24" {...props}>
    <path d="M12 20c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8zm0-14c-3.31 0-6 2.69-6 6s2.69 6 6 6 6-2.69 6-6-2.69-6-6-6z"/>
  </svg>
);

export const IconLine = (props) => (
  <svg viewBox="0 0 24 24" {...props}>
    <path d="M4 20L20 4l-2-2L2 18z"/>
  </svg>
);

export const IconArrow = (props) => (
  <svg viewBox="0 0 24 24" {...props}>
    <path d="M4 20L20 4m-7-1v12l5-5-5-5z"/>
  </svg>
);

export const IconText = (props) => (
  <svg viewBox="0 0 24 24" {...props}>
    <path d="M5 4v3h5.5v12h3V7H19V4H5z"/>
  </svg>
);

export const IconNote = (props) => (
  <svg viewBox="0 0 24 24" {...props}>
    <path d="M17 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2zm0 16H7V5h10v14zm-2-4H9v-2h6v2zm0-4H9V9h6v2z"/>
  </svg>
);

export const IconStamp = (props) => (
  <svg viewBox="0 0 24 24" {...props}>
    <path d="M5 17v2h14v-2H5zm4.5-6.2h5l.9 2.2h2.1L12.75 4h-1.5L6.5 13h2.1l.9-2.2zM12 5.98L13.87 11h-3.74L12 5.98z"/>
  </svg>
);

export const IconSignature = (props) => (
  <svg viewBox="0 0 24 24" {...props}>
    <path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM5.92 19H5v-.92l9.06-9.06.92.92L5.92 19zM20.71 5.63l-2.34-2.34a.996.996 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83a.996.996 0 0 0 0-1.41z"/>
  </svg>
);

export const IconEraser = (props) => (
  <svg viewBox="0 0 24 24" {...props}>
    <path d="M16.24 3.56l4.95 4.94c.78.79.78 2.05 0 2.84L12 20.53a4.008 4.008 0 0 1-5.66 0L2.81 17c-.78-.79-.78-2.05 0-2.84l10.6-10.6c.79-.78 2.05-.78 2.83 0zM4.22 15.58l3.54 3.54c.78.78 2.04.78 2.83 0l3.54-3.54-6.37-6.36-3.54 3.53v.83z"/>
  </svg>
);

export const IconColor = (props) => (
  <svg viewBox="0 0 24 24" {...props}>
    <path d="M12 3a9 9 0 0 0 0 18c.83 0 1.5-.67 1.5-1.5 0-.39-.15-.74-.39-1.01-.23-.26-.38-.61-.38-.99 0-.83.67-1.5 1.5-1.5H16c2.76 0 5-2.24 5-5 0-4.42-4.03-8-9-8zm-5.5 9c-.83 0-1.5-.67-1.5-1.5S5.67 9 6.5 9 8 9.67 8 10.5 7.33 12 6.5 12zm3-4C8.67 8 8 7.33 8 6.5S8.67 5 9.5 5s1.5.67 1.5 1.5S10.33 8 9.5 8zm5 0c-.83 0-1.5-.67-1.5-1.5S13.67 5 14.5 5s1.5.67 1.5 1.5S15.33 8 14.5 8zm3 4c-.83 0-1.5-.67-1.5-1.5S16.67 9 17.5 9s1.5.67 1.5 1.5-.67 1.5-1.5 1.5z"/>
  </svg>
);

export const IconDelete = (props) => (
  <svg viewBox="0 0 24 24" {...props}>
    <path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/>
  </svg>
);

export const IconSearch = (props) => (
  <svg viewBox="0 0 24 24" {...props}>
    <path d="M15.5 14h-.79l-.28-.27A6.471 6.471 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z"/>
  </svg>
);

export const IconClose = (props) => (
  <svg viewBox="0 0 24 24" {...props}>
    <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12 19 6.41z"/>
  </svg>
);

export const IconPages = (props) => (
  <svg viewBox="0 0 24 24" {...props}>
    <path d="M4 6H2v14a2 2 0 0 0 2 2h14v-2H4V6zm16-4H8a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2zm0 14H8V4h12v12z"/>
  </svg>
);

export const IconBookmark = (props) => (
  <svg viewBox="0 0 24 24" {...props}>
    <path d="M17 3H7a2 2 0 0 0-2 2v16l7-3 7 3V5a2 2 0 0 0-2-2z"/>
  </svg>
);

export const IconAttach = (props) => (
  <svg viewBox="0 0 24 24" {...props}>
    <path d="M16.5 6v11.5c0 2.21-1.79 4-4 4s-4-1.79-4-4V5a2.5 2.5 0 0 1 5 0v10.5c0 .55-.45 1-1 1s-1-.45-1-1V6H10v9.5a2.5 2.5 0 0 0 5 0V5c0-2.21-1.79-4-4-4S7 2.79 7 5v12.5c0 3.04 2.46 5.5 5.5 5.5s5.5-2.46 5.5-5.5V6h-1.5z"/>
  </svg>
);

export const IconComment = (props) => (
  <svg viewBox="0 0 24 24" {...props}>
    <path d="M20 2H4a2 2 0 0 0-2 2v18l4-4h14a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2zm0 14H5.17L4 17.17V4h16v12z"/>
  </svg>
);

export const IconLeftPanel = (props) => (
  <svg viewBox="0 0 24 24" {...props}>
    <path d="M3 3h18v18H3V3zm2 2v14h5V5H5zm14 0h-7v14h7V5z"/>
  </svg>
);

export const IconRightPanel = (props) => (
  <svg viewBox="0 0 24 24" {...props}>
    <path d="M21 3H3v18h18V3zM5 5h7v14H5V5zm14 14h-5V5h5v14z"/>
  </svg>
);

export const IconChevronDown = (props) => (
  <svg viewBox="0 0 24 24" {...props}>
    <path d="M7.41 8.59L12 13.17l4.59-4.58L18 10l-6 6-6-6 1.41-1.41z"/>
  </svg>
);

export const IconChevronRight = (props) => (
  <svg viewBox="0 0 24 24" {...props}>
    <path d="M8.59 16.59L13.17 12 8.59 7.41 10 6l6 6-6 6-1.41-1.41z"/>
  </svg>
);

export const IconMore = (props) => (
  <svg viewBox="0 0 24 24" {...props}>
    <path d="M12 8c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm0 2c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm0 6c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2z"/>
  </svg>
);

export const IconFile = (props) => (
  <svg viewBox="0 0 24 24" {...props}>
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6zm-1 2l5 5h-5V4zM6 20V4h5v7h7v9H6z"/>
  </svg>
);

export const IconDownload = (props) => (
  <svg viewBox="0 0 24 24" {...props}>
    <path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"/>
  </svg>
);

export const IconImage = (props) => (
  <svg viewBox="0 0 24 24" {...props}>
    <path d="M21 19V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2zM8.5 13.5l2.5 3.01L14.5 12l4.5 6H5l3.5-4.5z"/>
  </svg>
);

export const IconList = (props) => (
  <svg viewBox="0 0 24 24" {...props}>
    <path d="M3 13h2v-2H3v2zm0 4h2v-2H3v2zm0-8h2V7H3v2zm4 4h14v-2H7v2zm0 4h14v-2H7v2zM7 7v2h14V7H7z"/>
  </svg>
);

export const IconLock = (props) => (
  <svg viewBox="0 0 24 24" {...props}>
    <path d="M18 8h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6v2H6a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V10a2 2 0 0 0-2-2zm-6 9c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2zm3.1-9H8.9V6c0-1.71 1.39-3.1 3.1-3.1s3.1 1.39 3.1 3.1v2z"/>
  </svg>
);

export const IconAdd = (props) => (
  <svg viewBox="0 0 24 24" {...props}>
    <path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/>
  </svg>
);

// Aliases
export const IconThumbnails    = IconPages;
export const IconAttachment    = IconAttach;
export const IconAnnotations   = IconList;

// OCR
export const IconOCR = (props) => (
  <svg viewBox="0 0 24 24" {...props}>
    <path d="M15.5 14h-.79l-.28-.27A6.471 6.471 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z"/>
  </svg>
);
// Redaction — black bar over a text line
export const IconRedact = (props) => (
  <svg viewBox="0 0 24 24" {...props}>
    <path d="M4 4h16a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1zm1 2v12h14V6H5zm2 3h10v3H7V9zm0 5h6v1.5H7V14z"/>
  </svg>
);

// Watermark — droplet over page
export const IconWatermark = (props) => (
  <svg viewBox="0 0 24 24" {...props}>
    <path d="M6 2h9l5 5v15a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1zm8 1.5V8h4.5L14 3.5zM12 11c1.8 2.2 3 3.9 3 5.3A3.1 3.1 0 0 1 12 19a3.1 3.1 0 0 1-3-2.7c0-1.4 1.2-3.1 3-5.3z"/>
  </svg>
);
