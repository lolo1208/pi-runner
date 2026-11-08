; 使用支持 amd64 的 NSIS 编译器，应用与外层启动程序均为 x64。
Target amd64-unicode
Unicode true
!ifndef PORTABLE
  !include "MUI2.nsh"
!endif
!include "FileFunc.nsh"

Name "${APP_NAME}"
OutFile "${OUTPUT_FILE}"
Icon "${APP_ICON}"
RequestExecutionLevel user
SetCompress off
VIProductVersion "${APP_VERSION}.0"
VIAddVersionKey "ProductName" "${APP_NAME}"
VIAddVersionKey "FileDescription" "${APP_NAME}"
VIAddVersionKey "FileVersion" "${APP_VERSION}"
VIAddVersionKey "LegalCopyright" "Pi Runner"

; 载荷已由多线程 LZMA2 压缩，外层直接嵌入，避免再次单线程压缩。
!macro ExtractPayload DESTINATION
  InitPluginsDir
  SetOutPath "$PLUGINSDIR\7zip"
  File "${SEVEN_ZIP_DIR}\7z.exe"
  File "${SEVEN_ZIP_DIR}\7z.dll"
  File "${SEVEN_ZIP_DIR}\License.txt"
  File /oname=app.7z "${PAYLOAD_FILE}"
  nsExec::Exec '"$PLUGINSDIR\7zip\7z.exe" x -y -bd -bso0 -bsp0 "-o${DESTINATION}" "$PLUGINSDIR\7zip\app.7z"'
  Pop $2
  StrCmp $2 0 extract_done
    MessageBox MB_ICONSTOP "应用文件解压失败，请检查磁盘空间并重新运行。"
    SetErrorLevel 1
    Quit
  extract_done:
  Delete "$PLUGINSDIR\7zip\app.7z"
  SetOutPath "${DESTINATION}"
!macroend

!ifdef PORTABLE
  SilentInstall silent
  AutoCloseWindow true
  Section
    !insertmacro ExtractPayload "$PLUGINSDIR\app"
    System::Call 'kernel32::SetEnvironmentVariableW(w "PORTABLE_EXECUTABLE_DIR", w "$EXEDIR")i'
    System::Call 'kernel32::SetEnvironmentVariableW(w "PORTABLE_EXECUTABLE_FILE", w "$EXEPATH")i'
    System::Call 'kernel32::SetEnvironmentVariableW(w "PORTABLE_EXECUTABLE_APP_FILENAME", w "${APP_NAME}")i'
    ${GetParameters} $0
    ClearErrors
    ExecWait '"$PLUGINSDIR\app\${APP_EXE}" $0' $1
    IfErrors launch_failed
    SetErrorLevel $1
    Goto finished
    launch_failed:
      MessageBox MB_ICONSTOP "程序启动失败，请重新导出便携版后重试。"
      SetErrorLevel 1
    finished:
      ; 离开应用目录，便于 NSIS 自动清理临时文件。
      SetOutPath "$TEMP"
  SectionEnd
!else
  InstallDir "$LOCALAPPDATA\Programs\${APP_DIRECTORY_NAME}"
  InstallDirRegKey HKCU "Software\PiRunner" "InstallDir"
  !define MUI_ICON "${APP_ICON}"
  !define MUI_UNICON "${APP_ICON}"
  !define MUI_ABORTWARNING
  !define MUI_FINISHPAGE_RUN "$INSTDIR\${APP_EXE}"
  !insertmacro MUI_PAGE_DIRECTORY
  !insertmacro MUI_PAGE_INSTFILES
  !insertmacro MUI_PAGE_FINISH
  !insertmacro MUI_UNPAGE_CONFIRM
  !insertmacro MUI_UNPAGE_INSTFILES
  !insertmacro MUI_LANGUAGE "SimpChinese"

  Section "安装"
    SetRegView 64
    SetShellVarContext current
    !insertmacro ExtractPayload "$INSTDIR"
    WriteUninstaller "$INSTDIR\Uninstall.exe"
    WriteRegStr HKCU "Software\PiRunner" "InstallDir" "$INSTDIR"
    WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\PiRunner" "DisplayName" "${APP_NAME}"
    WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\PiRunner" "DisplayVersion" "${APP_VERSION}"
    WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\PiRunner" "Publisher" "Pi Runner"
    WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\PiRunner" "DisplayIcon" "$INSTDIR\${APP_EXE}"
    WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\PiRunner" "UninstallString" '$\"$INSTDIR\Uninstall.exe$\"'
    WriteRegDWORD HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\PiRunner" "NoModify" 1
    WriteRegDWORD HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\PiRunner" "NoRepair" 1
    CreateShortcut "$DESKTOP\${APP_NAME}.lnk" "$INSTDIR\${APP_EXE}"
    CreateShortcut "$SMPROGRAMS\${APP_NAME}.lnk" "$INSTDIR\${APP_EXE}"
  SectionEnd

  Section "Uninstall"
    SetRegView 64
    SetShellVarContext current
    ; 只删除已登记的应用目录，避免误删其他位置。
    ReadRegStr $0 HKCU "Software\PiRunner" "InstallDir"
    StrCmp $0 "$INSTDIR" 0 unsafe_path
    Delete "$DESKTOP\${APP_NAME}.lnk"
    Delete "$SMPROGRAMS\${APP_NAME}.lnk"
    DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\PiRunner"
    DeleteRegKey HKCU "Software\PiRunner"
    ; 按构建清单删除应用文件，保留用户另外放入的文件。
    !include "${UNINSTALL_FILES}"
    Delete "$INSTDIR\Uninstall.exe"
    RMDir "$INSTDIR"
    Goto uninstall_done
    unsafe_path:
      MessageBox MB_ICONSTOP "安装目录校验失败，已停止卸载。"
      SetErrorLevel 1
    uninstall_done:
  SectionEnd
!endif
