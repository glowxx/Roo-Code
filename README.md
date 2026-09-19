# Roo Code Desktop

<p align="center">
  <strong>Autonomous AI Developer Platform — Standalone Windows Desktop GUI & Interactive CLI</strong>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/License-Apache_2.0-blue.svg" alt="License">
  <img src="https://img.shields.io/badge/Platform-Windows%20(Standalone)-0078D6.svg?logo=windows&logoColor=white" alt="Windows Standalone">
  <img src="https://img.shields.io/badge/Node.js-20+-68a063.svg?logo=node.js&logoColor=white" alt="Node.js">
  <img src="https://img.shields.io/badge/Architecture-Electron%20%2B%20VS%20Code%20Shim-61DAFB.svg" alt="Architecture">
  <img src="https://img.shields.io/badge/AI_Models-xKiro%20|%20DeepSeek%20R1%2FV3%20|%20Claude%203.7%20|%20GPT--4o%20|%20Gemini%202.5-purple.svg" alt="AI Models">
</p>

---

## 🌟 O projekcie / Overview

**Roo Code Desktop** to w pełni autonomiczna platforma inżynierii oprogramowania oparta na sztucznej inteligencji, działająca jako **samodzielna aplikacja dla systemu Windows**. Dzięki wykorzystaniu zaawansowanej warstwy emulacyjnej **VS Code Shim** oraz środowiska **Electron**, Roo Code Desktop nie wymaga zainstalowanego ani uruchomionego edytora Visual Studio Code.

Aplikacja operuje bezpośrednio na Twoim lokalnym systemie plików: analizuje strukturę repozytorium, implementuje i modyfikuje kod, uruchamia komendy w dedykowanym terminalu, analizuje diagnostykę kompilatorów i linterów oraz iteracyjnie dąży do rozwiązania złożonych zadań programistycznych.

Dostępna w dwóch wariantach uruchomieniowych:
- **Desktop GUI (Electron & Web)**: Bogaty graficzny interfejs użytkownika z podglądem różnic (diffs), eksploratorem plików, terminalem i inspektorem zadań.
- **Interactive CLI**: Błyskawiczny agent konsolowy do pracy bezpośrednio w terminalu.

---

## ⚡ Kluczowe możliwości / Key Features

- 🤖 **Autonomiczna pętla wykonawcza (Agent Loop)**:
  - Samodzielna inspekcja, edycja i tworzenie plików w projekcie.
  - Wykonywanie poleceń powłoki w dedykowanym terminalu z natywnym streamingiem wyjścia.
  - Automatyczna analiza błędów lintera/kompilatora i samonaprawa kodu.

- 🚀 **Natywny provider xKiro z dynamicznym pobieraniem modeli**:
  - Wbudowany szybki i ekonomiczny gateway do najpotężniejszych modeli AI: **DeepSeek V3**, **DeepSeek R1 (Thinking)**, **Claude 3.7 Sonnet**, **GPT-4o**, **Gemini 2.5 Pro** oraz **Qwen 2.5 Coder**.
  - Dynamiczne pobieranie aktualnej listy dostępnych modeli z endpointu `/models`.
  - Inteligentny algorytm ekstrakcji wersji oraz automatycznego rankingu tierów modeli.

- 🗜️ **Komenda kondensacji kontekstu `/compact`**:
  - Dedykowana komenda slash umożliwiająca inteligentną kompresję historii konwersacji w aktywnym zadaniu.
  - Drastyczna redukcja zużycia tokenów przy pełnym zachowaniu kluczowych decyzji architektonicznych, zmienionych plików oraz stanu wykonanych narzędzi.

- 🛡️ **Pełna izolacja przestrzeni roboczych (Workspace Isolation)**:
  - Niezależny kontekst dla każdego otwartego projektu.
  - Izolowane magazyny stanu, bazy wektorowe (Qdrant/SQLite) oraz odrębne sesje terminala.
  - Bezpieczne przechowywanie kluczy API i poświadczeń w dedykowanym `SecretStorage`.

- 📁 **Dedykowany Eksplorator Plików i Terminal**:
  - Wbudowane drzewo plików z debounced search i natychmiastowym filtrowaniem.
  - Zintegrowane podglądy kodu ze składnią oraz interaktywny podgląd obrazów (`PNG`, `JPEG`, `WEBP`, `SVG`, `GIF`, `ICO`).
  - Terminal z obsługą wieloprocesowości i izolacją środowiska wykonawczego.

- 🎨 **Nowoczesny interfejs z efektem Frosted Glass**:
  - Półprzezroczyste, rozmyte nagłówki i paski narzędziowe (`backdrop-filter: blur(12px)`).
  - Wbudowany motyw ciemny oraz chroniący wzrok motyw jasny anti-glare (`#f1f3f6`).
  - Pełne wsparcie dla lokalizacji wielojęzycznej (Polski / Angielski).

---

## 📋 Wymagania systemowe / Prerequisites

- **System operacyjny**: Windows 10 / Windows 11 (64-bit)
- **Node.js**: `v20.0.0` lub nowszy
- **pnpm**: `v10.0.0` lub nowszy

---

## 🛠️ Instalacja i konfiguracja środowiska

```powershell
# 1. Sklonuj repozytorium
git clone https://github.com/RooCodeInc/Roo-Code.git
cd Roo-Code

# 2. Zainstaluj zależności we wszystkich pakietach monorepo
pnpm install

# 3. Zbuduj pakiety bazowe (types, core, vscode-shim, webview)
pnpm build
```

---

## 🚀 Uruchamianie aplikacji / Running the App

### Opcja 1: Windows 1-Click Launcher (Zalecane)

Uruchom interaktywne menu startowe za pomocą pliku wsadowego:

```cmd
run.bat
```

Menu launchera udostępnia następujące opcje:
1. **[1] Native Electron Desktop Application** *(Natywne okno aplikacji desktopowej)*
2. **[2] Web Desktop** *(Uruchamia lokalny serwer na porcie `http://localhost:4500` i otwiera przeglądarkę)*
3. **[3] Development Mode** *(Tryb deweloperski z Hot Module Replacement i pełnymi logami)*
4. **[4] Build Windows Installer (`.exe`)** *(Kompilacja instalatora NSIS)*
5. **[5] Exit**

---

### Opcja 2: Polecenia deweloperskie (NPM / PNPM)

```bash
# Uruchomienie natywnej aplikacji Electron Desktop
pnpm desktop

# Uruchomienie wersji Web Desktop (dostępnej przez przeglądarkę)
pnpm desktop:web

# Uruchomienie trybu deweloperskiego z live reloadem
pnpm run dev

# Interaktywny agent CLI w konsoli
pnpm cli
```

---

## 📦 Budowanie instalatora Windows (NSIS Installer)

Roo Code Desktop posiada dedykowany skrypt automatyzujący tworzenie instalatora `.exe` w formacie NSIS:

```cmd
build_win_installer.bat
```

Skrypt przeprowadza pełną weryfikację środowiska, buduje wszystkie pakiety składowe (`packages/types`, `packages/vscode-shim`, `src`, `webview-ui`), a następnie wywołuje `electron-builder`.

Gotowy plik instalatora zostanie wygenerowany w katalogu:
```
apps/desktop/release/Roo-Code-Setup-*.exe
```

---

## 🏗️ Architektura Monorepo

Struktura projektu została zaprojektowana w sposób modułowy, umożliwiając całkowite uniezależnienie silnika agenta od VS Code:

```
Roo-Code/
├── apps/
│   ├── desktop/             # Samodzielna aplikacja Electron & serwer Web (Agent Host, Preload, Renderer)
│   ├── cli/                 # Interaktywny i skryptowy agent konsolowy CLI
│   └── docs/                # Dokumentacja projektu
├── packages/
│   ├── vscode-shim/         # Warstwa emulacji VS Code API (Workspace, SecretStorage, Window, Terminal)
│   ├── types/               # Współdzielone kontrakty TypeScript, schematy modeli i ustawień (xKiro, OpenAI itp.)
│   ├── core/                # Autonomiczny silnik agenta, narzędzia, prompty i zarządzanie zadaniami
│   ├── ipc/                 # Kanały komunikacji międzyprocesowej
│   ├── build/               # Współdzielone konfiguracje i skrypty budowania
│   ├── config-eslint/       # Wspólne reguły lintera ESLint
│   └── config-typescript/   # Wspólne konfiguracje TypeScript
├── src/                     # Główna logika Roo Code (Task execution, ContextCompactor, .rooignore, providers)
├── webview-ui/              # Nowoczesny interfejs użytkownika w React 18 + Vite + Tailwind CSS
├── run.bat                  # Interaktywny 1-Click launcher dla Windows
└── build_win_installer.bat  # Zautomatyzowany skrypt budowania instalatora NSIS
```

### Kluczowe komponenty architektoniczne:
- **`packages/vscode-shim`**: Zastępuje natywne środowisko VS Code, udostępniając implementacje interfejsów `vscode.workspace`, `vscode.window`, `SecretStorage` i `Terminal`. Dzięki temu rdzeń agenta działa w 100% bez instalacji VS Code.
- **`apps/desktop`**: Odpowiada za cykl życia okna aplikacji, lokalny serwer HTTP/WebSocket dla warstwy webview oraz izolację procesów agenta.
- **`src/core/context`**: Odpowiada za mechanizm kompresji i kondensacji kontekstu (`/compact`).
- **`src/core/ignore`**: Wieloplatformowy kontroler reguł ignorowania (`.rooignore`) zoptymalizowany pod specyfikę ścieżek Windows.

---

## 🛡️ Bezpieczeństwo i Prywatność / Security & Privacy

- **Lokalne wykonywanie**: Wszystkie operacje na plikach oraz wywołania narzędzi odbywają się w 100% lokalnie na Twojej maszynie.
- **Bezpieczny SecretStorage**: Klucze API i wrażliwe poświadczenia są zabezpieczone w lokalnym magazynie i nie trafiają do logów diagnostycznych.
- **Brak telemetrii kodu**: Twój kod źródłowy jest przesyłany wyłącznie do bezpośrednio wybranego dostawcy modeli AI (np. xKiro, Anthropic, OpenAI) lub przetwarzany lokalnie (Ollama / LM Studio).

---

## 📜 Licencja / License

Projekt dystrybuowany na licencji [Apache 2.0](LICENSE) © Roo Code Contributors.
