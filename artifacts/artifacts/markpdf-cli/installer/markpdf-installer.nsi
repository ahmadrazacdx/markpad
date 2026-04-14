!include "MUI2.nsh"

!ifndef APP_OUT_DIR
!define APP_OUT_DIR "..\out"
!endif

!ifndef OUTPUT_EXE
!define OUTPUT_EXE "..\out\markpad.exe"
!endif

!ifndef BRAND_ICON
!define BRAND_ICON "..\public\markpdf-installer.ico"
!endif

Name "MarkPDF CLI"
OutFile "${OUTPUT_EXE}"
Icon "${BRAND_ICON}"
UninstallIcon "${BRAND_ICON}"
InstallDir "$PROGRAMFILES\MarkPDF CLI"
InstallDirRegKey HKCU "Software\MarkPDF CLI" "InstallDir"
RequestExecutionLevel admin
Unicode True
SetCompressor /SOLID lzma

!define MUI_ABORTWARNING
!define MUI_ICON "${BRAND_ICON}"
!define MUI_UNICON "${BRAND_ICON}"

!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH

!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES

!insertmacro MUI_LANGUAGE "English"

Section "Install"
  SetOutPath "$INSTDIR"
  File "${APP_OUT_DIR}\markpdf.exe"
  File "${APP_OUT_DIR}\pandoc.exe"

  WriteUninstaller "$INSTDIR\Uninstall.exe"
  WriteRegStr HKCU "Software\MarkPDF CLI" "InstallDir" "$INSTDIR"

  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\MarkPDF CLI" "DisplayName" "MarkPDF CLI"
  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\MarkPDF CLI" "UninstallString" '"$INSTDIR\Uninstall.exe"'
  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\MarkPDF CLI" "DisplayIcon" "$INSTDIR\markpdf.exe"
  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\MarkPDF CLI" "Publisher" "MarkPDF"
  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\MarkPDF CLI" "DisplayVersion" "0.1.0"
  WriteRegDWORD HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\MarkPDF CLI" "NoModify" 1
  WriteRegDWORD HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\MarkPDF CLI" "NoRepair" 1

  CreateDirectory "$SMPROGRAMS\MarkPDF CLI"
  CreateShortcut "$SMPROGRAMS\MarkPDF CLI\MarkPDF CLI.lnk" "$INSTDIR\markpdf.exe"
  CreateShortcut "$SMPROGRAMS\MarkPDF CLI\Uninstall MarkPDF CLI.lnk" "$INSTDIR\Uninstall.exe"
SectionEnd

Section "Uninstall"
  Delete "$SMPROGRAMS\MarkPDF CLI\MarkPDF CLI.lnk"
  Delete "$SMPROGRAMS\MarkPDF CLI\Uninstall MarkPDF CLI.lnk"
  RMDir "$SMPROGRAMS\MarkPDF CLI"

  Delete "$INSTDIR\markpdf.exe"
  Delete "$INSTDIR\pandoc.exe"
  Delete "$INSTDIR\Uninstall.exe"
  RMDir "$INSTDIR"

  DeleteRegKey HKCU "Software\MarkPDF CLI"
  DeleteRegKey HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\MarkPDF CLI"
SectionEnd
