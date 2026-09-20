# Roo Code Desktop

<p align="center">
  <strong>Natywna, samodzielna aplikacja desktopowa AI dla programistów na system Windows</strong>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/License-Apache_2.0-blue.svg" alt="License">
  <img src="https://img.shields.io/badge/Platform-Windows%2010%2F11%20x64%20(Standalone)-0078D6.svg?logo=windows&logoColor=white" alt="Windows Standalone">
  <img src="https://img.shields.io/badge/Node.js-%3E%3D%2020-68a063.svg?logo=node.js&logoColor=white" alt="Node.js">
  <img src="https://img.shields.io/badge/pnpm-%3E%3D%209-orange.svg?logo=pnpm&logoColor=white" alt="pnpm">
  <img src="https://img.shields.io/badge/Architecture-Electron%20%2B%20%40roo--code%2Fvscode--shim-61DAFB.svg" alt="Architecture">
</p>

---

## 🌟 Wprowadzenie / Overview

**Roo Code Desktop** to samodzielna aplikacja AI Desktop dla programistów na system Windows, oparta o **Electron** oraz pakiet **`@roo-code/vscode-shim`**. Działa w pełni autonomicznie, **bez wymogu posiadania VS Code**, dostarczając zaawansowane środowisko asystenta i agenta AI bezpośrednio na pulpicie.

Roo Code Desktop operuje bezpośrednio na Twoim lokalnym systemie plików: analizuje kod, edytuje i tworzy pliki, zarządza terminalem, diagnozuje błędy kompilacji oraz wykonuje złożone zadania programistyczne w bezpieczny, izolowany i powtarzalny sposób.

---

## ⚡ Kluczowe możliwości / Key Features

- 🚀 **Wbudowany provider modeli xKiro**:
  - Bezpośrednia integracja z gatewayem xKiro oraz wiodącymi modelami AI (m.in. DeepSeek V3/R1, Claude 3.7 Sonnet, GPT-4o, Gemini 2.5 Pro).
  - Dynamiczne pobieranie aktualnej listy modeli z API endpointu `/models`.
  - Semantyczne wersjonowanie modeli i automatyczna promocja modeli flagowych do najwyższych tierów.

- 🌳 **Architektura Directory-First (BFS) drzewa plików**:
  - Wierne odzwierciedlenie struktury katalogów Windows 1:1 z natywnym przeszukiwaniem wszerz (Breadth-First Search).
  - Pełna obsługa pustych folderów, dysków wirtualnych `subst` oraz linków symbolicznych/junctions.
  - Zoptymalizowany limit do 25 000 plików gwarantujący błyskawiczne indeksowanie i responsywność interfejsu.

- 🗜️ **Silnik kondensacji kontekstu `/compact`**:
  - Dedykowana komenda slash do inteligentnej redukcji rozmiaru historii konwersacji.
  - Ochrona pamięci roboczej agenta przed przepełnieniem okna kontekstowego modelu.
  - Automatyczne scalanie ról i pełna integracja z `AbortController` (bezpieczne anulowanie operacji w dowolnym momencie).

- 🛡️ **Pełna izolacja przestrzeni roboczych (Workspace Isolation)**:
  - Odseparowane magazyny stanu per-katalog projektu (odrębna historia zadań, pamięć podręczna i konfiguracje).
  - Automatyczne czyszczenie terminali, procesów potomnych oraz serwerów MCP przy zmianie aktywnego projektu.

- ⚡ **Optymalizacje Webview**:
  - Ultralekki wirtualizator **Virtuoso** do płynnego renderowania długich wątków konwersacji.
  - Eliminacja kaskadowych re-renderów podczas streamingu odpowiedzi token-po-tokenie.
  - Dedykowany komponent **`CrashBoundary`** chroniący przed czarnym ekranem i awariami renderera.

- 🔒 **Utwardzone bezpieczeństwo**:
  - Atomowy zapis `SecretStorage` z automatycznym mechanizmem tworzenia kopii zapasowej `.bak`.
  - Bezpieczne uruchamianie procesów (brak luk Command Injection w powłoce systemowej).
  - Szczelne i wydajne reguły `.rooignore` zapobiegające wyciekom poufnych danych do kontekstu AI.

---

## 📋 Wymagania środowiskowe / System Requirements

- **System operacyjny**: Windows 10 / Windows 11 x64
- **Node.js**: `>= 20`
- **pnpm**: `>= 9`

---

## 🛠️ Środowisko deweloperskie / Development Setup

### 1. Klonowanie i instalacja

```powershell
# Klonowanie repozytorium
git clone https://github.com/RooCodeInc/Roo-Code.git
cd Roo-Code

# Instalacja zależności w monorepo
pnpm install
```

### 2. Uruchomienie deweloperskie

Zalecanym i najprostszym sposobem uruchomienia środowiska deweloperskiego na systemie Windows jest interaktywny skrypt wsadowy:

```cmd
run.bat
```

Wybierz opcję:
- **`[1] Native Electron Desktop Application (Recommended)`** — kompiluje pakiety składowe i uruchamia natywne okno aplikacji Electron Desktop.

Alternatywnie z poziomu terminala:
```bash
# Kompilacja pakietów bazowych
pnpm build

# Uruchomienie aplikacji Electron Desktop
pnpm desktop
```

---

## 📦 Generowanie instalatora produkcyjnego / Production Build

Roo Code Desktop zawiera kompletny, zautomatyzowany skrypt do budowania produkcyjnego instalatora NSIS dla systemu Windows:

```cmd
build_win_installer.bat
```

Skrypt automatycznie weryfikuje środowisko, buduje wszystkie pakiety składowe (`@roo-code/build`, `@roo-code/types`, `@roo-code/vscode-shim`, Core Engine oraz aplikację Desktop) i generuje plik instalatora w lokalizacji:
```
apps/desktop/release/Roo-Code-Setup-*.exe
```

---

## 🏗️ Architektura repozytorium / Monorepo Architecture

Projekt jest zorganizowany w zwięzłą i modułową strukturę monorepo:

```
Roo-Code/
├── apps/
│   └── desktop/             # Samodzielna aplikacja Electron Desktop (proces główny, preload, okno aplikacji)
├── packages/
│   ├── vscode-shim/         # Warstwa emulacji VS Code API (@roo-code/vscode-shim - workspace, secret storage, terminal)
│   └── types/               # Współdzielone definicje typów TypeScript, schematy konfiguracji i modeli
├── src/                     # Rdzenna logika Roo Code (pętla agenta, silnik /compact, .rooignore, provider xKiro)
├── webview-ui/              # Nowoczesny interfejs użytkownika (React 18, Tailwind CSS, Vite, Virtuoso)
├── run.bat                  # Interaktywny skrypt startowy Windows (opcja [1] Electron Desktop)
└── build_win_installer.bat  # Zautomatyzowany skrypt budowy instalatora produkcyjnego NSIS (.exe)
```

---

## 📜 Licencja / License

Projekt dystrybuowany na licencji [Apache 2.0](LICENSE) © Roo Code Contributors.
