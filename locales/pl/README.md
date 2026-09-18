# Roo Code

<p align="center">
  <strong>Autonomiczna Platforma Programistyczna AI — Samodzielna Aplikacja Desktop GUI & CLI</strong>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Licencja-Apache_2.0-blue.svg" alt="Licencja">
  <img src="https://img.shields.io/badge/Platforma-Windows%20|%20macOS%20|%20Linux-brightgreen.svg" alt="Platforma">
  <img src="https://img.shields.io/badge/Node.js-20+-68a063.svg" alt="Node.js">
  <img src="https://img.shields.io/badge/Modele_AI-xKiro%20|%20Claude%203.7%20|%20DeepSeek%20V3/R1%20|%20GPT--4o%20|%20Gemini%202.5-purple.svg" alt="Modele AI">
</p>

---

**Roo Code** to zaawansowany, autonomiczny asystent programistyczny AI działający bezpośrednio na Twoim komputerze. Pracując w Twoim lokalnym repozytorium kodu, Roo Code analizuje strukturę plików, planuje i realizuje zadania, uruchamia polecenia terminala, sprawdza błędy kompilacji oraz lintera i samodzielnie doprowadza zadania do końca.

Projekt został zbudowany jako wydajna, samodzielna aplikacja typu monorepo z **natywnym Desktop GUI (Electron oraz przeglądarkowy Web Desktop)** oraz interaktywnym **interfejsem wiersza poleceń (CLI)**.

---

## ⚡ Najważniejsze Funkcje i Możliwości

- 🤖 **Autonomiczna pętla programistyczna**: Czyta i modyfikuje pliki, wykonuje polecenia konsolowe, diagnozuje błędy i samoczynnie wprowadza poprawki.
- ⚡ **1-Kliknięciowy Wybór Modeli AI**: Błyskawiczna zmiana modelu z paska czatu lub górnego paska okna:
  - **API xKiro**: Szybki i ekonomiczny dostęp do **DeepSeek V3**, **DeepSeek R1 (Thinking)**, **Claude 3.7 Sonnet**, **GPT-4o**, **Gemini 2.5 Pro** oraz **Qwen 2.5 Coder**.
  - **Dostawcy bezpośredni**: Anthropic, OpenAI, Google Gemini, DeepSeek, OpenRouter, AWS Bedrock, GCP Vertex AI.
  - **Prywatność i lokalne LLM**: Pełna obsługa modeli lokalnych poprzez **Ollama** oraz **LM Studio**.
- 🖥️ **Samodzielna Aplikacja Desktop GUI**:
  - **Agent Chat**: Interaktywny czat z podglądem tokenów w czasie rzeczywistym, dołączaniem obrazów i kolejką zadań.
  - **Starter 1-Kliknięciem (`run.bat`)**: Wygodne menu startowe dla Windows (Aplikacja Desktopowa Electron, Web Desktop, Tryb Developerski, Budowanie Instalatora).
  - **Inspektor Zmian (Diffs)**: Wizualne porównanie zmian linijka po linijce (+/-) wprowadzonych przez agenta w kodzie.
  - **Dziennik Terminala**: Podgląd na żywo wszystkich procesów, narzędzi i poleceń systemowych uruchamianych przez Roo.
  - **Eksplorator Plików z Podglądem**: Przeglądanie struktury projektu z wyszukiwarką oraz podglądem składni dla wszystkich rozszerzeń i obrazów (`PNG`, `JPEG`, `WEBP`, `SVG`, `GIF`, `ICO`).
- 🎨 **Przyjazny dla Wzroku Jasny i Ciemny Motyw**: Dopracowany motyw ciemny oraz delikatny motyw jasny anti-glare (`#f1f3f6`), eliminujący rażące białe tła.
- 🧩 **Uproszczone Tryby Agenta**: Domyślny tryb **"Główny"** z możliwością tworzenia własnych wyspecjalizowanych person i wyborem spośród ponad 40 ikon Lucide.
- 🔌 **Protokół Kontekstu Modeli (MCP)**: Natywna integracja z zewnętrznymi serwerami MCP (bazy danych, automatyzacja przeglądarki, narzędzia developerskie).
- 🛡️ **Bezpieczeństwo i Prywatność**: Program działa w 100% lokalnie. Klucze API i kod nie przechodzą przez żadne serwery pośredniczące.

---

## 🚀 Szybki Start

### Wymagania wstępne

- **Node.js**: wersja `20.0.0` lub nowsza
- **pnpm**: wersja `10.0.0` lub nowsza

### Instalacja i Budowanie

```bash
# Sklonuj repozytorium
git clone https://github.com/RooCodeInc/Roo-Code.git
cd Roo-Code

# Zainstaluj zależności we wszystkich pakietach
pnpm install

# Zbuduj kompletną platformę
pnpm build
```

---

## 💻 Uruchamianie Programu

### Opcja A: Windows Launcher 1-Kliknięciem (Zalecane na Windows)

Uruchom plik `run.bat` (dwuklikiem w Eksploratorze lub w konsoli):

```cmd
run.bat
```

Wybierz tryb z menu:
- **[1] Natywna Aplikacja Desktopowa Electron** *(Zalecane)*
- **[2] Web Desktop** *(Uruchamia serwer lokalny i otwiera aplikację w przeglądarce)*
- **[3] Tryb Developerski** *(Hot-reload i szczegółowe logi)*
- **[4] Zbuduj Instalator Windows (`.exe`)**
- **[5] Wyjście**

---

### Opcja B: Polecenia NPM

#### 1. Desktop GUI (Electron)
```bash
pnpm desktop
```

#### 2. Web Desktop GUI (w przeglądarce)
```bash
pnpm desktop:web
```

#### 3. Interfejs Konsolowy (CLI)
```bash
# Sesja interaktywna
pnpm cli

# Lub bezpośrednie polecenie
roo "Przeprowadź refaktoryzację obsługi błędów w API"
```

---

## 🤖 Obsługiwane Modele i Dostawcy

| Dostawca | Polecane modele | Opis |
| :--- | :--- | :--- |
| **xKiro** | `DeepSeek V3`, `DeepSeek R1`, `Claude 3.7 Sonnet`, `GPT-4o`, `Gemini 2.5 Pro` | Tania i szybka bramka API z darmowymi tokenami na start. |
| **Anthropic** | `Claude 3.7 Sonnet`, `Claude 3.5 Sonnet`, `Claude 3.5 Haiku` | Wiodące modele do kodowania i wnioskowania logicznego. |
| **OpenAI** | `GPT-4o`, `GPT-4o Mini`, `o3-mini` | Flagowe modele architektur OpenAI. |
| **Google Gemini**| `Gemini 2.5 Pro`, `Gemini 2.5 Flash`, `Gemini 2.0 Flash` | Bardzo szybkie z dużym oknem kontekstu (1M+ tokenów). |
| **DeepSeek** | `DeepSeek-V3`, `DeepSeek-R1` | Rewolucyjne modele open-weights z głębokim myśleniem (Reasoning). |
| **OpenRouter** | Ponad 200 modeli | Uniwersalny agregator wielu dostawców. |
| **Ollama / LM Studio** | `Llama 3.1`, `Qwen 2.5 Coder`, `DeepSeek R1 8B` | Działanie w 100% offline bez wysyłania danych do sieci. |

---

## 📜 Licencja

[Apache 2.0](../../LICENSE) © Roo Code Contributors
