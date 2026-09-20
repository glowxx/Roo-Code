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

**Roo Code Desktop** to natywna, samodzielna aplikacja desktopowa AI dla programistów na system Windows, oparta o **Electron** oraz pakiet **`@roo-code/vscode-shim`**. Aplikacja działa całkowicie **bez zainstalowanego VS Code**, oferując pełnoprawne środowisko autonomicznego agenta AI bezpośrednio na pulpicie.

Roo Code Desktop operuje bezpośrednio na Twoim lokalnym systemie plików: analizuje kod, edytuje i tworzy pliki, zarządza terminalem, diagnozuje błędy kompilacji oraz wykonuje złożone zadania programistyczne w bezpieczny i powtarzalny sposób.

---

## ⚡ Kluczowe możliwości / Key Features

- 🚀 **Wbudowany, natywny provider modeli xKiro**:
  - Bezpośrednia integracja z gatewayem xKiro oraz wiodącymi modelami AI (m.in. DeepSeek V3/R1, Claude 3.7 Sonnet, GPT-4o, Gemini 2.5 Pro).
  - Dynamiczne pobieranie aktualnej listy modeli z API endpointu `/models`.
  - Zaawansowane parsowanie wersji semantycznych i automatyczna promocja flagowców do najwyższych tierów.

- 🗜️ **Silnik kondensacji kontekstu `/compact`**:
  - Dedykowana komenda slash do inteligentnej redukcji rozmiaru historii konwersacji.
  - Zintegrowana kontrola za pomocą `AbortController` (możliwość bezpiecznego anulowania operacji w dowolnym momencie).
  - Automatyczne scalanie ról i ochrona pamięci roboczej agenta przed przepełnieniem okna kontekstowego.

- 🛡️ **Bezpieczna, dynamiczna izolacja przestrzeni roboczych (Workspace Isolation)**:
  - Pełny, bezpieczny reset zadań, sesji terminali oraz procesów MCP przy przełączaniu projektów.
  - Całkowite rozdzielenie magazynu stanu per-ścieżka projektu (izolowane cache, historia zadań i konfiguracje).

- 📁 **Zintegrowany eksplorator plików i terminal**:
  - Zaawansowane drzewo katalogów w pełni odporne na specyfikę ścieżek Windows, dyski wirtualne `subst` oraz dowiązania symboliczne i junctions.
  - Wbudowany, natywny podgląd kodu ze składnią oraz przeglądarka zasobów multimedialnych.
  - Zintegrowany terminal z obsługą wieloprocesowości i natywnym streamingiem wejścia/wyjścia.

- 🔒 **Utwardzone bezpieczeństwo**:
  - Atomowy zapis `SecretStorage` z automatycznym mechanizmem tworzenia kopii zapasowej `.bak`.
  - Szczelny i szybki silnik `.rooignore` zabezpieczający poufne dane przed wczytaniem do promptu.
  - Rygorystyczna ochrona przed wyciekami tokenów i kluczy API w logach diagnostycznych.

---

## 📋 Wymagania systemowe / Prerequisites

- **System operacyjny**: Windows 10 / Windows 11 x64
- **Node.js**: `>= 20`
- **pnpm**: `>= 9`

---

## 🛠️ Uruchomienie deweloperskie / Development Setup

### 1. Przygotowanie repozytorium

```powershell
# Klonowanie repozytorium
git clone https://github.com/RooCodeInc/Roo-Code.git
cd Roo-Code

# Instalacja zależności w monorepo
pnpm install

# Kompilacja pakietów bazowych
pnpm build
```

### 2. Uruchomienie aplikacji

Zalecanym i najprostszym sposobem uruchomienia środowiska deweloperskiego na systemie Windows jest interaktywny skrypt wsadowy:

```cmd
run.bat
```

Wybierz opcję:
- **`[1] Desktop App`** — uruchamia natywne okno aplikacji Electron Desktop.

Alternatywnie z poziomu konsoli:
```bash
# Uruchomienie aplikacji Electron Desktop
pnpm desktop

# Uruchomienie w trybie developerskim z hot-reloadem
pnpm run dev
```

---

## 📦 Budowanie instalatora produkcyjnego / Production Build

Roo Code Desktop zawiera kompletny, zautomatyzowany proces budowania instalatora NSIS dla systemu Windows.

Aby wygenerować instalator produkcyjny `.exe`, uruchom:

```cmd
build_win_installer.bat
```

Skrypt weryfikuje środowisko, buduje wszystkie pakiety składowe oraz generuje plik instalacyjny NSIS w lokalizacji:
```
apps/desktop/release/Roo-Code-Setup-*.exe
```

---

## 🏗️ Architektura Monorepo

Projekt jest zorganizowany w zwięzłą i modułową strukturę monorepo:

```
Roo-Code/
├── apps/
│   └── desktop/             # Samodzielna aplikacja Electron Desktop (okno aplikacji, proces główny, preload)
├── packages/
│   ├── vscode-shim/         # Warstwa emulacji VS Code API (@roo-code/vscode-shim - workspace, secret storage, terminal)
│   └── types/               # Współdzielone definicje typów TypeScript, schematy konfiguracji i modeli
├── src/                     # Rdzenna logika Roo Code (pętla agenta, silnik /compact, .rooignore, provider xKiro)
├── webview-ui/              # Nowoczesny interfejs użytkownika (React 18, Tailwind CSS, Vite)
├── run.bat                  # Interaktywny skrypt startowy Windows (uruchamianie Desktop App)
└── build_win_installer.bat  # Zautomatyzowany skrypt generowania instalatora NSIS (.exe)
```

---

## 📜 Licencja / License

Projekt dystrybuowany na licencji [Apache 2.0](LICENSE) © Roo Code Contributors.
