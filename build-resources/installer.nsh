; Ghost Arcade Pro installer additions (electron-builder includes this file).
;
; Up to 2.1.2 this line installed as "Ghost Arcade", under the appId that
; Ghost Arcade Studio now keeps (live.ghostarcade.app). Pro has its own appId,
; so it installs beside that copy instead of replacing it. Remove the old copy
; when it is a 2.x build, so a 2.x user does not end up with two apps. An old
; 1.9 install is Studio's to upgrade, and Studio itself ("Ghost Arcade Studio
; ...") is never touched. Settings and projects stay: the uninstaller keeps
; app data, and Pro copies it on first launch.

!define OLD_GA_GUID "cc124a8e-15fa-59a5-87de-212f4e866a1a"
!define OLD_GA_UNINSTALL_KEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\${OLD_GA_GUID}"

!macro removeOldGhostArcade2 ROOT
  ReadRegStr $R1 ${ROOT} "${OLD_GA_UNINSTALL_KEY}" "DisplayName"
  StrCpy $R2 $R1 15
  ${if} $R2 == "Ghost Arcade 2."
    ReadRegStr $R3 ${ROOT} "Software\${OLD_GA_GUID}" "InstallLocation"
    ReadRegStr $R4 ${ROOT} "${OLD_GA_UNINSTALL_KEY}" "UninstallString"
    ${if} $R3 != ""
    ${andIf} $R4 != ""
      DetailPrint "Removing the previous Ghost Arcade ($R1)"
      ClearErrors
      ; A full uninstall (no --updated or --keep-shortcuts, which are for an
      ; in-place upgrade), so the old shortcuts go too. App data is kept.
      ExecWait '$R4 /S /KEEP_APP_DATA _?=$R3' $R5
      ${ifNot} ${errors}
        ; Run in place (_?=), the uninstaller cannot delete itself.
        Delete "$R3\Uninstall Ghost Arcade.exe"
        RMDir "$R3"
      ${endIf}
    ${endIf}
  ${endIf}
!macroend

!macro customInstall
  !insertmacro removeOldGhostArcade2 HKCU
  UserInfo::GetAccountType
  Pop $R6
  ${if} $R6 == "Admin"
    !insertmacro removeOldGhostArcade2 HKLM
  ${endIf}
!macroend
