!include "MUI2.nsh"
!include "WinMessages.nsh"

!ifndef APP_OUT_DIR
!define APP_OUT_DIR "..\out"
!endif

!ifndef OUTPUT_EXE
!define OUTPUT_EXE "..\out\markpdf.exe"
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

Function AddToUserPath
  Exch $0
  ReadRegStr $1 HKCU "Environment" "Path"

  StrCmp $1 "" 0 +2
  StrCpy $1 ""

  StrCpy $2 "$1;"
  StrCpy $3 "$0;"
  StrLen $4 $2
  loop_check_add:
    StrCmp $4 0 add_path
    StrCpy $5 $2 $4
    StrCmp $5 $3 done_add
    IntOp $4 $4 - 1
    Goto loop_check_add

  add_path:
    StrCmp $1 "" 0 +2
    StrCpy $1 "$0"
    StrCmp $1 "$0" write_path
    StrCpy $1 "$1;$0"

  write_path:
    WriteRegExpandStr HKCU "Environment" "Path" $1
    System::Call 'Kernel32::SetEnvironmentVariable(t, t)i("PATH", "$1")'
    System::Call 'User32::SendMessageTimeout(p, i, p, p, i, i, *p) p(0xffff, ${WM_SETTINGCHANGE}, 0, "STR:Environment", 0, 5000, .r0)'

  done_add:
  Pop $5
  Pop $4
  Pop $3
  Pop $2
  Pop $1
  Pop $0
FunctionEnd

Function AddToMachinePath
  Exch $0
  ReadRegStr $1 HKLM "SYSTEM\CurrentControlSet\Control\Session Manager\Environment" "Path"

  StrCmp $1 "" 0 +2
  StrCpy $1 ""

  StrCpy $2 "$1;"
  StrCpy $3 "$0;"
  StrLen $4 $2
  loop_check_add_machine:
    StrCmp $4 0 add_path_machine
    StrCpy $5 $2 $4
    StrCmp $5 $3 done_add_machine
    IntOp $4 $4 - 1
    Goto loop_check_add_machine

  add_path_machine:
    StrCmp $1 "" 0 +2
    StrCpy $1 "$0"
    StrCmp $1 "$0" write_path_machine
    StrCpy $1 "$1;$0"

  write_path_machine:
    WriteRegExpandStr HKLM "SYSTEM\CurrentControlSet\Control\Session Manager\Environment" "Path" $1
    System::Call 'Kernel32::SetEnvironmentVariable(t, t)i("PATH", "$1")'
    System::Call 'User32::SendMessageTimeout(p, i, p, p, i, i, *p) p(0xffff, ${WM_SETTINGCHANGE}, 0, "STR:Environment", 0, 5000, .r0)'

  done_add_machine:
  Pop $5
  Pop $4
  Pop $3
  Pop $2
  Pop $1
  Pop $0
FunctionEnd

Function un.RemoveFromUserPath
  Exch $0
  ReadRegStr $1 HKCU "Environment" "Path"
  StrCmp $1 "" done_remove

  StrCpy $2 "$1"
  StrCpy $3 "$0;"
  StrLen $4 $2

  loop_remove:
    StrCmp $4 0 try_exact
    StrCpy $5 $2 $4
    StrCmp $5 $3 found_remove
    IntOp $4 $4 - 1
    Goto loop_remove

  try_exact:
    StrCmp $2 $0 remove_exact done_remove

  found_remove:
    StrLen $6 $3
    StrLen $7 $2
    IntOp $8 $7 - $6
    StrCpy $9 $2 $4
    StrCpy $R0 $2 $8 $6
    StrCmp $9 "" 0 +2
    StrCpy $9 ""
    StrCmp $R0 "" 0 +2
    StrCpy $R0 ""
    StrCmp $9 "" 0 +2
    StrCpy $1 $R0
    StrCmp $R0 "" 0 +2
    StrCpy $1 $9
    StrCmp $9 "" +2
    StrCmp $R0 "" +2
    StrCpy $1 "$9$R0"
    Goto write_remove

  remove_exact:
    StrCpy $1 ""

  write_remove:
    WriteRegExpandStr HKCU "Environment" "Path" $1
    System::Call 'Kernel32::SetEnvironmentVariable(t, t)i("PATH", "$1")'
    System::Call 'User32::SendMessageTimeout(p, i, p, p, i, i, *p) p(0xffff, ${WM_SETTINGCHANGE}, 0, "STR:Environment", 0, 5000, .r0)'

  done_remove:
  Pop $R0
  Pop $9
  Pop $8
  Pop $7
  Pop $6
  Pop $5
  Pop $4
  Pop $3
  Pop $2
  Pop $1
  Pop $0
FunctionEnd

Function un.RemoveFromMachinePath
  Exch $0
  ReadRegStr $1 HKLM "SYSTEM\CurrentControlSet\Control\Session Manager\Environment" "Path"
  StrCmp $1 "" done_remove_machine

  StrCpy $2 "$1"
  StrCpy $3 "$0;"
  StrLen $4 $2

  loop_remove_machine:
    StrCmp $4 0 try_exact_machine
    StrCpy $5 $2 $4
    StrCmp $5 $3 found_remove_machine
    IntOp $4 $4 - 1
    Goto loop_remove_machine

  try_exact_machine:
    StrCmp $2 $0 remove_exact_machine done_remove_machine

  found_remove_machine:
    StrLen $6 $3
    StrLen $7 $2
    IntOp $8 $7 - $6
    StrCpy $9 $2 $4
    StrCpy $R0 $2 $8 $6
    StrCmp $9 "" 0 +2
    StrCpy $9 ""
    StrCmp $R0 "" 0 +2
    StrCpy $R0 ""
    StrCmp $9 "" 0 +2
    StrCpy $1 $R0
    StrCmp $R0 "" 0 +2
    StrCpy $1 $9
    StrCmp $9 "" +2
    StrCmp $R0 "" +2
    StrCpy $1 "$9$R0"
    Goto write_remove_machine

  remove_exact_machine:
    StrCpy $1 ""

  write_remove_machine:
    WriteRegExpandStr HKLM "SYSTEM\CurrentControlSet\Control\Session Manager\Environment" "Path" $1
    System::Call 'Kernel32::SetEnvironmentVariable(t, t)i("PATH", "$1")'
    System::Call 'User32::SendMessageTimeout(p, i, p, p, i, i, *p) p(0xffff, ${WM_SETTINGCHANGE}, 0, "STR:Environment", 0, 5000, .r0)'

  done_remove_machine:
  Pop $R0
  Pop $9
  Pop $8
  Pop $7
  Pop $6
  Pop $5
  Pop $4
  Pop $3
  Pop $2
  Pop $1
  Pop $0
FunctionEnd

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

  Push "$INSTDIR"
  Call AddToMachinePath

  Push "$INSTDIR"
  Call AddToUserPath

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
  Push "$INSTDIR"
  Call un.RemoveFromMachinePath

  Push "$INSTDIR"
  Call un.RemoveFromUserPath
SectionEnd
