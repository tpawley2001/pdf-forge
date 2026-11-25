; PDF Forge — register as a PDF handler the Windows way (Open with list + Default Apps),
; without taking over .pdf: Windows keeps the user's choice until they pick PDF Forge.
; Included by electron-builder (nsis.include). SHCTX = HKLM for this per-machine install.

!define PF_PROGID "PDFForge.Document"

!macro customInstall
  ; ProgID: how PDF Forge opens a .pdf
  WriteRegStr SHCTX "Software\Classes\${PF_PROGID}" "" "PDF Document"
  WriteRegStr SHCTX "Software\Classes\${PF_PROGID}" "FriendlyTypeName" "PDF Document"
  WriteRegStr SHCTX "Software\Classes\${PF_PROGID}\DefaultIcon" "" "$INSTDIR\${APP_EXECUTABLE_FILENAME},0"
  WriteRegStr SHCTX "Software\Classes\${PF_PROGID}\shell" "" "open"
  WriteRegStr SHCTX "Software\Classes\${PF_PROGID}\shell\open" "" "Open with PDF Forge"
  WriteRegStr SHCTX "Software\Classes\${PF_PROGID}\shell\open\command" "" '"$INSTDIR\${APP_EXECUTABLE_FILENAME}" "%1"'
  ; Offer it in "Open with" for .pdf
  WriteRegStr SHCTX "Software\Classes\.pdf\OpenWithProgids" "${PF_PROGID}" ""
  WriteRegStr SHCTX "Software\Classes\Applications\${APP_EXECUTABLE_FILENAME}" "FriendlyAppName" "PDF Forge"
  WriteRegStr SHCTX "Software\Classes\Applications\${APP_EXECUTABLE_FILENAME}\shell\open\command" "" '"$INSTDIR\${APP_EXECUTABLE_FILENAME}" "%1"'
  WriteRegStr SHCTX "Software\Classes\Applications\${APP_EXECUTABLE_FILENAME}\SupportedTypes" ".pdf" ""
  ; Settings > Default apps
  WriteRegStr SHCTX "Software\PDF Forge\Capabilities" "ApplicationName" "PDF Forge"
  WriteRegStr SHCTX "Software\PDF Forge\Capabilities" "ApplicationDescription" "View, edit, sign and fill PDF files."
  WriteRegStr SHCTX "Software\PDF Forge\Capabilities\FileAssociations" ".pdf" "${PF_PROGID}"
  WriteRegStr SHCTX "Software\RegisteredApplications" "PDF Forge" "Software\PDF Forge\Capabilities"
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, p 0, p 0)'
!macroend

!macro customUnInstall
  DeleteRegKey SHCTX "Software\Classes\${PF_PROGID}"
  DeleteRegValue SHCTX "Software\Classes\.pdf\OpenWithProgids" "${PF_PROGID}"
  DeleteRegKey SHCTX "Software\Classes\Applications\${APP_EXECUTABLE_FILENAME}"
  DeleteRegValue SHCTX "Software\RegisteredApplications" "PDF Forge"
  DeleteRegKey SHCTX "Software\PDF Forge\Capabilities"
  DeleteRegKey /ifempty SHCTX "Software\PDF Forge"
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, p 0, p 0)'
!macroend
