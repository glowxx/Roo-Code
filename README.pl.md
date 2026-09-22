[English (Wersja Angielska)](README.md) | [Polski]

# Roo Code Desktop

<p align="center">
  <strong>Autonomiczny Inżynier Oprogramowania AI w Niezależnym, Natywnym Środowisku Desktopowym</strong>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Platforma-Windows%2010%2F11%20x64%20(Standalone)-0078D6.svg?logo=windows&logoColor=white" alt="Platforma">
  <img src="https://img.shields.io/badge/Electron-Desktop-47848F.svg?logo=electron&logoColor=white" alt="Electron">
  <img src="https://img.shields.io/badge/Node.js-%3E%3D%2020-68a063.svg?logo=node.js&logoColor=white" alt="Node.js">
  <img src="https://img.shields.io/badge/pnpm-%3E%3D%209-orange.svg?logo=pnpm&logoColor=white" alt="pnpm">
  <img src="https://img.shields.io/badge/Licencja-Apache_2.0-blue.svg" alt="Licencja">
  <img src="https://img.shields.io/badge/TypeScript-5.x-3178C6.svg?logo=typescript&logoColor=white" alt="TypeScript">
</p>

---

## 🌟 Wprowadzenie

**Roo Code Desktop** to autonomiczna, w pełni samodzielna aplikacja desktopowa dla programistów na system Windows. Zbudowana na fundamencie **Electron** i napędzana przez `@roo-code/vscode-shim`, działa całkowicie niezależnie — **bez konieczności posiadania VS Code ani jakiegokolwiek zewnętrznego środowiska IDE**.

Roo Code Desktop operuje bezpośrednio na Twojej lokalnej przestrzeni roboczej: analizuje architekturę repozytoriów, planuje i wdraża zmiany wieloplikowe, wykonuje polecenia terminala pod nadzorem autonomicznych barier bezpieczeństwa, weryfikuje diffy, diagnozuje błędy kompilatorów i linterów oraz współpracuje z wiodącymi modelami wnioskującymi (reasoning models) — a wszystko to z poziomu spójnego, wysoce wydajnego interfejsu desktopowego.

---

## ⚡ Kluczowe Wyróżniki Architektoniczne

### 1. 🛡️ Autonomiczny Mechanizm Bezpieczeństwa Poleceń Terminala (Command Safety Guardrail)
- **Weryfikacja Pre-Execution przez Model Audytujący**: Każde polecenie terminala przed uruchomieniem trafia do silnika oceny bezpieczeństwa zasilanego przez dedykowany model audytora.
- **Architektura Fail-Closed (Domyślna Blokada)**: Zabezpieczenie zaprojektowano z myślą o zachowaniu defensywnym. Jeżeli weryfikacja przekroczy limit czasu (timeout), wystąpi błąd sieciowy lub model zwróci niepoprawny format danych, system blokuje samoczynne wykonanie i wymaga jednoznacznej, ręcznej akceptacji użytkownika.
- **Deterministyczny Lokalny Mechanizm Fast-Path**: Rutynowe i nieinwazyjne operacje (np. `git diff`, `git status`, `ls`, `dir`, `echo`, `cat`, `node`, `pnpm test`, `jest`) omijają model audytujący dzięki błyskawicznemu dopasowaniu wyrażeń regularnych (zerowa latencja), zapewniając płynność pracy agenta.
- **Przejrzysta Klasyfikacja Ryzyka**: Każde polecenie oceniane przez sędziego bezpieczeństwa otrzymuje ustrukturyzowany poziom ryzyka (`safe`, `low`, `medium`, `high`, `critical`) wraz z czytelnym wyjaśnieniem potencjalnych zagrożeń (np. nieodwracalne usunięcie plików, pobieranie i uruchamianie zdalnych skryptów czy eskalacja uprawnień).

### 2. 🧠 Dynamiczne Okno Kontekstowe i Precyzyjne Metryki
- **Obsługa Modeli od 200k do ponad 1M Tokenów**: Dynamiczne wykrywanie limitów obsługuje modele nowej generacji, w tym `gpt-6-astra` z xKiro (1M tokenów), Google Gemini 1.5/2.0/2.5 Pro (1M–2M tokenów), OpenAI seria o / GPT-5 (200k tokenów) oraz Claude 3.7 Sonnet (200k tokenów).
- **Eliminacja Sztywnych Fallbacków**: Usunięto przestarzałe, sztywne ograniczenia do 128k tokenów. Limity kontekstu są odpytywane dynamicznie z endpointów dostawców lub wnioskowane z unikalnych wzorców identyfikatorów modeli.
- **Trwałe Metadane Zachowywane Przy Zimnym Starcie**: Właściwości modeli, limity okna kontekstowego oraz budżety tokenów są bezpiecznie buforowane w lokalnym magazynie stanu, eliminując opóźnienia i gwarantując poprawność metryk natychmiast po uruchomieniu aplikacji.
- **Precyzyjna Księgowość Tokenów**: Dokładny monitoring w czasie rzeczywistym zużycia tokenów wejściowych, odczytanych/zapisanych w cache, tokenów wyjściowych oraz szacunkowych kosztów finansowych w trakcie długich zadań.

### 3. 🎛️ Interaktywna Kontrola Wysiłku Myślenia (Reasoning Effort)
- **Dedykowany Przełącznik na Pasku Narzędzi**: Selektor budżetu i wysiłku myślenia został zintegrowany bezpośrednio z paskiem narzędzi czatu, eliminując konieczność przeszukiwania rozbudowanych menu ustawień.
- **Stopniowane Poziomy Wysiłku**: Swobodny wybór pomiędzy poziomami `none`, `minimal`, `low`, `medium`, `high` i `xhigh`, pozwalający na precyzyjne wyważenie głębi myślenia (chain-of-thought) względem szybkości generowania i kosztu tokenów.
- **Automatyczne Przycinanie (Clamping) i Bezpieczny Fallback**: Jeżeli dany model lub dostawca obsługuje tylko wybrane poziomy wysiłku myślenia, środowisko automatycznie dostosowuje parametr do najbliższej poprawnej wartości. W przypadku modeli bez obsługi myślenia, parametr jest bezpiecznie pomijany bez wywoływania błędów API.

### 4. 🖥️ Niezależna Powłoka Desktopowa (Desktop Shell)
- **Brak Narzutu Środowiska VS Code**: Pełne uniezależnienie od procesu głównego i extension hosta VS Code; aplikacja działa jako lekki, responsywny i zoptymalizowany program Electron Desktop.
- **Zintegrowany Przełącznik Przestrzeni Roboczych (Workspace Switcher)**: Płynna zmiana aktywnego katalogu projektu. Przełączenie repozytorium automatycznie resetuje stan agenta, czyści aktywne terminale, zamyka powiązane procesy potomne w tle oraz bezpiecznie restartuje serwery MCP.
- **Modalne Ustawienia w Zakładkach i Zoptymalizowane Karty**: Konfiguracja i panele preferencji otwierają się jako nakładki wewnątrz bieżącej karty, nie naruszając aktywnego kontekstu rozmowy.
- **Wysoce Wydajny Interfejs**: Wykorzystanie wirtualizacji list (Virtuoso), renderowanie strumieniowe tokenów bez kaskadowych re-renderów oraz dedykowany komponent `CrashBoundary` chroniący przed awariami i białym/czarnym ekranem.

---

## 🏗️ Architektura Monorepo

Repozytorium zorganizowane jest w przejrzystą, modularną strukturę pnpm monorepo:

```
Roo-Code/
├── apps/
│   └── desktop/             # Powłoka Electron, okna natywne, mostki IPC i skrypty instalatora NSIS
├── packages/
│   ├── types/               # Współdzielone typy TypeScript, schematy modeli i walidatory Zod
│   └── vscode-shim/         # Warstwa emulacji VS Code API (workspace, SecretStorage, terminale)
├── src/                     # Rdzenny silnik agenta, pętla zadań, dostawcy API i sędzia bezpieczeństwa (CommandSafetyJudge)
├── webview-ui/              # Interfejs użytkownika w React 18, Vite i Tailwind CSS
├── run.bat                  # Interaktywny launcher środowiska na systemie Windows
└── build_win_installer.bat  # Zautomatyzowany skrypt kompilacji instalatora Windows NSIS
```

- **`apps/desktop/`**: Odpowiada za proces główny Electrona, bezpieczne konteksty preload, cykl życia okien natywnych oraz komunikację IPC.
- **`src/`**: Zawiera jądro agenta — planowanie zadań, budowanie promptów, silniki narzędzi (operacje na plikach, wykonywanie poleceń w powłoce, automatyzacja przeglądarki), integracje dostawców i Command Safety Judge.
- **`webview-ui/`**: Nowoczesny frontend React obsługujący czat, wizualny inspektor różnic (diff), zarządzanie serwerami MCP, eksplorator plików i system motywów.
- **`packages/types/`**: Pojedyncze źródło prawdy dla interfejsów, schematów konfiguracji, modeli i walidatorów runtime.
- **`packages/vscode-shim/`**: Natywna reimplementacja interfejsów VS Code w środowisku Node.js, umożliwiająca pracę silnika poza VS Code.

---

## 🚀 Szybki Start i Instalacja

### Opcja 1: Samodzielny Instalator Windows

1. Pobierz lub zlokalizuj najnowszy instalator dla systemu Windows:
   ```
   release/Roo Code Setup 1.0.0.exe
   ```
   *(lub `apps/desktop/release/Roo-Code-Setup-*.exe`)*
2. Uruchom plik instalacyjny. Instalator skonfiguruje program, powiązania plików oraz utworzy skróty na Pulpicie i w Menu Start.
3. Uruchom **Roo Code** i rozpocznij pracę.

---

### Opcja 2: Budowanie ze Źródeł

#### Wymagania wstępne
- **System operacyjny**: Windows 10 / Windows 11 x64
- **Node.js**: `>= 20.0.0`
- **pnpm**: `>= 9.0.0`
- **Git**

#### 1. Klonowanie i instalacja zależności
```powershell
# Klonowanie repozytorium
git clone https://github.com/RooCodeInc/Roo-Code.git
cd Roo-Code

# Instalacja zależności w monorepo
pnpm install
```

#### 2. Kompilacja pakietów bazowych
```powershell
# Zbudowanie pakietów wewnętrznych (@roo-code/build, @roo-code/types, @roo-code/vscode-shim, webview-ui)
pnpm build
```

#### 3. Uruchomienie w trybie deweloperskim
Najwygodniejszym sposobem uruchomienia na systemie Windows jest interaktywny skrypt:
```cmd
run.bat
```
Wybierz opcję z menu:
- **`[1] Native Electron Desktop Application (Recommended)`** — Kompiluje pakiety i uruchamia natywne okno Electron Desktop.
- **`[3] Development Mode`** — Uruchamia z aktywnym hot-reloadem, przeładowywaniem na żywo i szczegółowymi logami w konsoli.

Alternatywnie bezpośrednio z terminala:
```powershell
pnpm desktop
```

#### 4. Budowanie Instalatora Windows
Aby wygenerować produkcyjny instalator NSIS:
```cmd
build_win_installer.bat
```
*(lub wybierz opcję `[4]` w skrypcie `run.bat`)*

Gotowy instalator znajdziesz w:
```
release/Roo Code Setup 1.0.0.exe
apps/desktop/release/Roo-Code-Setup-*.exe
```

---

## ⚙️ Konfiguracja i Dostawcy Modeli

Roo Code Desktop oferuje pełne wsparcie dla wiodących dostawców komercyjnych, open-source oraz lokalnych:

| Dostawca | Obsługiwane Modele i Możliwości | Rozmiar Okna Kontekstu |
| :--- | :--- | :--- |
| **xKiro** | `gpt-6-astra`, `claude-3-7-sonnet`, `deepseek-v3`, `deepseek-r1`, `gpt-4o`, `gemini-2.5-pro` (Dynamiczne pobieranie `/models` i automatyczna promocja) | Do **1 000 000+** tokenów |
| **OpenAI** | `gpt-5`, `gpt-4o`, `o1`, `o3-mini`, `gpt-4o-mini` z regulowanym wysiłkiem myślenia i verbosity | Do **200 000** tokenów |
| **Anthropic** | `claude-3-7-sonnet`, `claude-3-5-sonnet`, `claude-3-5-haiku`, `claude-3-opus` z Extended Thinking i Prompt Caching | **200 000** tokenów |
| **OpenRouter** | Ogromny ekosystem modeli komercyjnych i open-source z przekazywaniem parametrów myślenia i śledzeniem kosztów | Zależne od modelu |
| **Modele Lokalne** | **Ollama** oraz **LM Studio** do w 100% prywatnej pracy bez połączenia z zewnętrznym API | Zależne od sprzętu |

### Konfiguracja Kluczy API
1. Otwórz Roo Code Desktop.
2. Kliknij ikonę **Ustawień** (koło zębate) na pasku narzędzi.
3. Wybierz żądanego dostawcę z listy rozwijanej **API Provider**.
4. Wklej swój klucz API i skonfiguruj opcje specyficzne dla modelu (np. wysiłek myślenia lub własny bazowy URL).
5. Kliknij **Zapisz (Save)**, aby zaszyfrować i zachować poświadczenia w lokalnym magazynie.

---

## 📜 Licencja i Społeczność

- **Licencja**: Projekt udostępniany na warunkach licencji Apache 2.0. Pełna treść licencji znajduje się w pliku [LICENSE](LICENSE).
- **Współpraca (Contributing)**: Chętnie przyjmujemy wkład społeczności! Przed zgłoszeniem Pull Requesta zapoznaj się z przewodnikiem [CONTRIBUTING.md](CONTRIBUTING.md).
- **Polityka Bezpieczeństwa**: Informacje o odpowiedzialnym zgłaszaniu luk w zabezpieczeniach znajdziesz w dokumencie [SECURITY.md](SECURITY.md).
