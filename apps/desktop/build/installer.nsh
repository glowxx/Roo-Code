; ==============================================================================
; Roo Code Desktop - Advanced Windows NSIS Installer Configuration
;
; Key Features:
; 1. Windows Registry Detection of Existing Installations & Update Mode ("Zaktualizuj" / "Update")
; 2. Multi-Language Support (Polish - 1045 as default/system, English - 1033 fallback)
; 3. Interactive Desktop Shortcut Selection (Checkbox)
; 4. Zero Data Loss Protection for %APPDATA%\Roo Code and user profiles
; 5. Automatic termination of running Roo Code.exe processes to prevent file lock
; ==============================================================================

!include "LogicLib.nsh"
!include "WinMessages.nsh"

; ------------------------------------------------------------------------------
; Localization Strings (Polish: 1045, English: 1033)
; ------------------------------------------------------------------------------

; Update Mode Strings
LangString updateHeader 1045 "Aktualizacja Roo Code"
LangString updateHeader 1033 "Update Roo Code"

LangString updateSubHeader 1045 "Wykryto zainstalowaną wersję Roo Code. Kreator zaktualizuje aplikację do najnowszej wersji."
LangString updateSubHeader 1033 "Previous installation detected. Setup will update the application to the latest version."

LangString updateTitleText 1045 "Wykryto poprzednią instalację Roo Code w systemie."
LangString updateTitleText 1033 "A previous installation of Roo Code was detected."

LangString updateDetailsText 1045 "Kreator zaktualizuje aplikację do najnowszej wersji. Wszystkie Twoje dane, konfiguracje, historia zadań oraz klucze API zostaną nienaruszone."
LangString updateDetailsText 1033 "Setup will update the application to the latest version. All your data, configurations, task history, and API keys will be strictly preserved."

LangString updateVersionLabel 1045 "Zainstalowana wersja:"
LangString updateVersionLabel 1033 "Currently installed version:"

LangString updateLocationLabel 1045 "Katalog instalacji:"
LangString updateLocationLabel 1033 "Installation folder:"

; Fresh Install Strings
LangString installHeader 1045 "Podsumowanie instalacji"
LangString installHeader 1033 "Installation Summary"

LangString installSubHeader 1045 "Kreator jest gotowy do rozpoczęcia instalacji aplikacji Roo Code."
LangString installSubHeader 1033 "Setup is ready to begin installing Roo Code."

LangString installTitleText 1045 "Gotowy do instalacji Roo Code."
LangString installTitleText 1033 "Ready to install Roo Code."

LangString installDetailsText 1045 "Kreator posiada wszystkie niezbędne informacje do zainstalowania aplikacji Roo Code na Twoim komputerze."
LangString installDetailsText 1033 "Setup has gathered all required information and is ready to install Roo Code on your computer."

LangString installLocationLabel 1045 "Katalog docelowy:"
LangString installLocationLabel 1033 "Destination folder:"

; Action Buttons
LangString buttonUpdate 1045 "Zaktualizuj"
LangString buttonUpdate 1033 "Update"

LangString buttonInstall 1045 "Zainstaluj"
LangString buttonInstall 1033 "Install"

; Desktop Shortcut Checkbox
LangString checkboxDesktopShortcut 1045 "Utwórz skrót na Pulpicie"
LangString checkboxDesktopShortcut 1033 "Create Desktop Shortcut"

; Closing running app notification
LangString closingRunningProcesses 1045 "Zamykanie działających procesów Roo Code..."
LangString closingRunningProcesses 1033 "Closing running Roo Code processes..."

; ------------------------------------------------------------------------------
; Installer-only logic & variables
; ------------------------------------------------------------------------------
!ifndef BUILD_UNINSTALLER

!include "MUI2.nsh"
!include "nsDialogs.nsh"

; Global Variables
Var isExistingInstallation
Var existingVersion
Var existingInstallDir
Var CheckboxDesktopShortcut
Var CheckboxDesktopShortcutState
Var SummaryDialog
Var LabelSummaryTitle
Var LabelSummaryDetails
Var LabelSummaryDir

; 1. PreInit Hook: OS Language Detection & Fallback
!macro preInit
  ; Detect OS UI Language: if Polish (1045), pre-select 1045, otherwise fallback to English (1033)
  System::Call 'kernel32::GetUserDefaultUILanguage() i .r0'
  ${If} $0 == 1045
    StrCpy $LANGUAGE 1045
  ${Else}
    StrCpy $LANGUAGE 1033
  ${EndIf}
!macroend

; 2. CustomInit Hook: Native Windows Registry Detection of Existing Installation
!macro customInit
  StrCpy $isExistingInstallation "0"
  StrCpy $existingVersion ""
  StrCpy $existingInstallDir ""
  ; Default desktop shortcut checkbox to checked (BST_CHECKED = 1)
  StrCpy $CheckboxDesktopShortcutState 1

  ; Check HKCU Uninstall registry key
  ReadRegStr $0 HKCU "${UNINSTALL_REGISTRY_KEY}" "InstallLocation"
  ReadRegStr $1 HKCU "${UNINSTALL_REGISTRY_KEY}" "DisplayVersion"
  ReadRegStr $2 HKCU "${UNINSTALL_REGISTRY_KEY}" "UninstallString"

  ; Check HKCU App Guid key if InstallLocation not in Uninstall key
  ${If} $0 == ""
    ReadRegStr $0 HKCU "${INSTALL_REGISTRY_KEY}" "InstallLocation"
  ${EndIf}

  ; Check HKLM Uninstall registry key (machine-wide install fallback)
  ${If} $0 == ""
    ReadRegStr $0 HKLM "${UNINSTALL_REGISTRY_KEY}" "InstallLocation"
  ${EndIf}
  ${If} $1 == ""
    ReadRegStr $1 HKLM "${UNINSTALL_REGISTRY_KEY}" "DisplayVersion"
  ${EndIf}
  ${If} $2 == ""
    ReadRegStr $2 HKLM "${UNINSTALL_REGISTRY_KEY}" "UninstallString"
  ${EndIf}

  ; Check HKLM App Guid key
  ${If} $0 == ""
    ReadRegStr $0 HKLM "${INSTALL_REGISTRY_KEY}" "InstallLocation"
  ${EndIf}

  ; If any registry marker is found or previous per-user/machine installation detected:
  ${If} $0 != ""
  ${OrIf} $1 != ""
  ${OrIf} $2 != ""
  ${OrIf} $hasPerUserInstallation == "1"
  ${OrIf} $hasPerMachineInstallation == "1"
    StrCpy $isExistingInstallation "1"
    StrCpy $existingVersion $1
    StrCpy $existingInstallDir $0
    ${If} $existingInstallDir != ""
      StrCpy $INSTDIR $existingInstallDir
    ${EndIf}
  ${EndIf}
!macroend

; 3. CustomInstallMode Hook: Automatically preserve previous install scope
!macro customInstallmode
  ${If} $isExistingInstallation == "1"
    ${If} $hasPerMachineInstallation == "1"
      StrCpy $isForceMachineInstall "1"
    ${Else}
      StrCpy $isForceCurrentInstall "1"
    ${EndIf}
  ${EndIf}
!macroend

; 4. Custom Page After Change Dir: Summary Screen & Desktop Shortcut Option
!macro customPageAfterChangeDir
  Page custom RooSummaryPageCreate RooSummaryPageLeave
!macroend

Function RooSummaryPageCreate
  ${If} $isExistingInstallation == "1"
    !insertmacro MUI_HEADER_TEXT "$(updateHeader)" "$(updateSubHeader)"
  ${Else}
    !insertmacro MUI_HEADER_TEXT "$(installHeader)" "$(installSubHeader)"
  ${EndIf}

  nsDialogs::Create 1018
  Pop $SummaryDialog
  ${If} $SummaryDialog == error
    Abort
  ${EndIf}

  ${If} $isExistingInstallation == "1"
    ; Title
    ${NSD_CreateLabel} 0 0 100% 12u "$(updateTitleText)"
    Pop $LabelSummaryTitle

    ; Description
    ${NSD_CreateLabel} 0 16u 100% 30u "$(updateDetailsText)"
    Pop $LabelSummaryDetails

    ; Version & Folder info
    ${If} $existingVersion != ""
      ${NSD_CreateLabel} 0 50u 100% 12u "$(updateVersionLabel) $existingVersion"
      Pop $0
    ${EndIf}

    ${NSD_CreateLabel} 0 64u 100% 14u "$(updateLocationLabel) $INSTDIR"
    Pop $LabelSummaryDir

    ; Desktop shortcut checkbox
    ${NSD_CreateCheckbox} 0 88u 100% 14u "$(checkboxDesktopShortcut)"
    Pop $CheckboxDesktopShortcut
    ${NSD_SetState} $CheckboxDesktopShortcut $CheckboxDesktopShortcutState

    ; Set Next button to "Zaktualizuj" / "Update"
    GetDlgItem $0 $HWNDPARENT 1
    SendMessage $0 ${WM_SETTEXT} 0 "STR:$(buttonUpdate)"

    ; Disable Back button on update
    GetDlgItem $1 $HWNDPARENT 3
    EnableWindow $1 0
  ${Else}
    ; Fresh Install Title
    ${NSD_CreateLabel} 0 0 100% 12u "$(installTitleText)"
    Pop $LabelSummaryTitle

    ; Description
    ${NSD_CreateLabel} 0 16u 100% 30u "$(installDetailsText)"
    Pop $LabelSummaryDetails

    ; Folder info
    ${NSD_CreateLabel} 0 56u 100% 14u "$(installLocationLabel) $INSTDIR"
    Pop $LabelSummaryDir

    ; Desktop shortcut checkbox
    ${NSD_CreateCheckbox} 0 88u 100% 14u "$(checkboxDesktopShortcut)"
    Pop $CheckboxDesktopShortcut
    ${NSD_SetState} $CheckboxDesktopShortcut $CheckboxDesktopShortcutState

    ; Set Next button to "Zainstaluj" / "Install"
    GetDlgItem $0 $HWNDPARENT 1
    SendMessage $0 ${WM_SETTEXT} 0 "STR:$(buttonInstall)"

    ; Enable Back button
    GetDlgItem $1 $HWNDPARENT 3
    EnableWindow $1 1
  ${EndIf}

  nsDialogs::Show
FunctionEnd

Function RooSummaryPageLeave
  ; Save checkbox state
  ${NSD_GetState} $CheckboxDesktopShortcut $CheckboxDesktopShortcutState

  ; Terminate any running Roo Code.exe instances before replacing binary files
  DetailPrint "$(closingRunningProcesses)"
  nsExec::Exec 'taskkill /F /IM "Roo Code.exe" /T'
  Sleep 500
FunctionEnd

; 5. CustomInstall Hook: Create Desktop Shortcut ONLY if checked
!macro customInstall
  ${If} $CheckboxDesktopShortcutState == 1
    CreateShortCut "$newDesktopLink" "$appExe" "" "$appExe" 0 "" ""
    ClearErrors
    WinShell::SetLnkAUMI "$newDesktopLink" "${APP_ID}"
    System::Call 'Shell32::SHChangeNotify(i 0x8000000, i 0, i 0, i 0)'
  ${Else}
    ${If} ${FileExists} "$newDesktopLink"
      Delete "$newDesktopLink"
      System::Call 'Shell32::SHChangeNotify(i 0x8000000, i 0, i 0, i 0)'
    ${EndIf}
  ${EndIf}
!macroend

!endif ; !ifndef BUILD_UNINSTALLER

; ------------------------------------------------------------------------------
; 6. CustomUnInstall Hook: Zero Data Loss Protection Assurance
; ------------------------------------------------------------------------------
!macro customUnInstall
  ; Zero Data Loss Protection Guarantee:
  ; %APPDATA%\Roo Code (including desktop-config.json, window bounds, recent projects),
  ; %APPDATA%\Code\User\globalStorage\rooveterinaryinc.roo-cline,
  ; and %USERPROFILE%\.roo-desktop-data are strictly preserved and never modified or deleted.
!macroend
