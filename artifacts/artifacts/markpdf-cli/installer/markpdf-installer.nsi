!include "MUI2.nsh"
!include "WinMessages.nsh"
!include "StrFunc.nsh"

${StrStr}
${StrRep}
${UnStrRep}

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
  Push $1
  Push $2
  Push $3
  Push $4

  ReadRegStr $1 HKCU "Environment" "Path"
  StrCmp $1 "" 0 +3
    StrCpy $1 "$0"
    Goto write_user_path

  StrCpy $2 ";$1;"
  StrCpy $3 ";$0;"
  ${StrStr} $4 "$2" "$3"
  StrCmp $4 "" 0 done_add_user
  StrCpy $1 "$1;$0"

  write_user_path:
    WriteRegExpandStr HKCU "Environment" "Path" $1
    Call BroadcastEnvironmentChange

  done_add_user:
  Pop $4
  Pop $3
  Pop $2
  Pop $1
  Pop $0
FunctionEnd

Function AddToMachinePath
  Exch $0
  Push $1
  Push $2
  Push $3
  Push $4

  ReadRegStr $1 HKLM "SYSTEM\CurrentControlSet\Control\Session Manager\Environment" "Path"
  StrCmp $1 "" 0 +3
    StrCpy $1 "$0"
    Goto write_machine_path

  StrCpy $2 ";$1;"
  StrCpy $3 ";$0;"
  ${StrStr} $4 "$2" "$3"
  StrCmp $4 "" 0 done_add_machine
  StrCpy $1 "$1;$0"

  write_machine_path:
    WriteRegExpandStr HKLM "SYSTEM\CurrentControlSet\Control\Session Manager\Environment" "Path" $1
    Call BroadcastEnvironmentChange

  done_add_machine:
  Pop $4
  Pop $3
  Pop $2
  Pop $1
  Pop $0
FunctionEnd

Function un.RemoveFromUserPath
  Exch $0
  Push $1
  Push $2
  Push $3
  Push $4
  Push $5

  ReadRegStr $1 HKCU "Environment" "Path"
  StrCmp $1 "" done_remove_user

  StrCpy $2 ";$1;"
  StrCpy $3 ";$0;"
  ${UnStrRep} $2 "$2" "$3" ";"

  normalize_user_path:
    ${UnStrRep} $4 "$2" ";;" ";"
    StrCmp $4 "$2" trim_user_path
    StrCpy $2 "$4"
    Goto normalize_user_path

  trim_user_path:
    StrCpy $5 $2 1
    StrCmp $5 ";" 0 +2
    StrCpy $2 $2 "" 1

    StrCmp $2 "" write_remove_user
    StrLen $5 $2
    IntOp $5 $5 - 1
    StrCpy $4 $2 1 $5
    StrCmp $4 ";" 0 +2
    StrCpy $2 $2 $5

  write_remove_user:
    WriteRegExpandStr HKCU "Environment" "Path" $2
    Call un.BroadcastEnvironmentChange

  done_remove_user:
  Pop $5
  Pop $4
  Pop $3
  Pop $2
  Pop $1
  Pop $0
FunctionEnd

Function un.RemoveFromMachinePath
  Exch $0
  Push $1
  Push $2
  Push $3
  Push $4
  Push $5

  ReadRegStr $1 HKLM "SYSTEM\CurrentControlSet\Control\Session Manager\Environment" "Path"
  StrCmp $1 "" done_remove_machine

  StrCpy $2 ";$1;"
  StrCpy $3 ";$0;"
  ${UnStrRep} $2 "$2" "$3" ";"

  normalize_machine_path:
    ${UnStrRep} $4 "$2" ";;" ";"
    StrCmp $4 "$2" trim_machine_path
    StrCpy $2 "$4"
    Goto normalize_machine_path

  trim_machine_path:
    StrCpy $5 $2 1
    StrCmp $5 ";" 0 +2
    StrCpy $2 $2 "" 1

    StrCmp $2 "" write_remove_machine
    StrLen $5 $2
    IntOp $5 $5 - 1
    StrCpy $4 $2 1 $5
    StrCmp $4 ";" 0 +2
    StrCpy $2 $2 $5

  write_remove_machine:
    WriteRegExpandStr HKLM "SYSTEM\CurrentControlSet\Control\Session Manager\Environment" "Path" $2
    Call un.BroadcastEnvironmentChange

  done_remove_machine:
  Pop $5
  Pop $4
  Pop $3
  Pop $2
  Pop $1
  Pop $0
FunctionEnd

Function BroadcastEnvironmentChange
  System::Call 'User32::SendMessageTimeout(p, i, p, p, i, i, *p) p(0xffff, ${WM_SETTINGCHANGE}, 0, "STR:Environment", 0, 5000, .r0)'
FunctionEnd

Function un.BroadcastEnvironmentChange
  System::Call 'User32::SendMessageTimeout(p, i, p, p, i, i, *p) p(0xffff, ${WM_SETTINGCHANGE}, 0, "STR:Environment", 0, 5000, .r0)'
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
