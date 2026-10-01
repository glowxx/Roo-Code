# Guardrail i Stop — audyt 2026-10-01

Źródła: bieżący kod i Git (`36fe00fc8`, `ddcc4d9e7`, `6c7392933`, `854cbcc77`, `f3c3248a3`), graf `graphify-out/graph.json`, oraz odczytane bez zmian `C:\Users\Kamil\.roo-desktop-data\global-storage`. Nie odczytywano pliku `secrets.json` ani nie kopiowano promptów.

## Pięć najnowszych incydentów

Wszystkie pięć wpisów ma `actionType=execute_command`, `fastPath=false`, `evaluatorModel=none`, `finalDecision=MANUAL_APPROVAL` i w `ui_messages.json` stan `USER_DECISION_REQUIRED`. Identyfikator zadania jest identyfikatorem chatu. W zapisanych logach nie ma historycznej migawki TaskContract, jawnych zakresów, początkowej decyzji Auto Approve, czasu kolejki, czasu żądania, liczby prób ani długości promptu; nie przypisujemy im wymyślonych wartości. Bieżące persisted `allowedCommands` i `deniedCommands` są puste. W AUTO nie ma osobnego wstępnego `checkAutoApproval` dla komend.

| Czas CEST | Task ID | Klasa i skrót akcji | Dlaczego AI / wynik | Timeout / cooldown |
| --- | --- | --- | --- | --- |
| 23:08:31 | `01a0ef29-4a83-71ca-99e3-c3b06d31aabd` | `PROCESS / SYSTEM_MUTATION`, `Get-Process … | Stop-Process` | Brak bezpiecznej klasyfikacji. Weryfikacja zakończyła się ręczną decyzją; komenda nie powinna dostać AUTO. | ostatnia próba 9483 ms; cooldown niezgłoszony |
| 23:07:05 | `01a0f93b-82fc-772b-be13-28eb0c89af25` | `WRITE_WORKSPACE / DISCARD`, `git checkout -- app/settings.env` | Brak bezpiecznej klasyfikacji. Ręczna decyzja jest uzasadniona. | 9488 ms; cooldown niezgłoszony |
| 22:57:00 | `01a0ef29-4a83-71ca-99e3-c3b06d31aabd` | `PROCESS_READ + FORMAT_OUTPUT`, `Get-Process … | Select-Object` | Parser nie znał odczytu metadanych procesu i pozycyjnej listy właściwości. Niepotrzebne AI → ręczna decyzja. | 9493 ms; cooldown niezgłoszony |
| 22:05:54 | `01a0ef29-4a83-71ca-99e3-c3b06d31aabd` | `READ_ONLY_FS + SEARCH + FORMAT_OUTPUT`, `Get-ChildItem … | Select-String … | Select-Object … | ForEach-Object` | Uruchomiony wtedy runtime nie klasyfikował całego pipeline deterministycznie; ręczna decyzja. Bieżący kod i test replay klasyfikują go jako bezpieczny. | cooldown zgłoszony; próbę AI pominięto |
| 22:05:28 | `01a0ef29-4a83-71ca-99e3-c3b06d31aabd` | `TYPECHECK`, `npm run typecheck` | Uruchomiony wtedy runtime wysłał komendę do AI, mimo że aktualny fast path klasyfikuje ją lokalnie; ręczna decyzja. | 9478 ms; cooldown niezgłoszony |

History items obu tasków wskazują workspace `C:\Users\Kamil\Documents\antigravity\mysterious-pythagoras`, tryb `code`, worker xKiro. Brak pliku `.vscode/settings.json` w tym workspace. Aktualne źródło daje budżet weryfikatora 25 000 ms i do dwóch prób dla kandydata; około 9,5 s w komunikacie opisuje ostatnią próbę, nie całkowity czas. Historyczne `queueWaitMs`, `requestMs`, `retryCount` i `APPROVAL_PROMPT_APPROX_TOKENS` nie były zapisywane w `decision_log.jsonl`. Dodano przybliżoną liczbę tokenów do nowych wpisów audytu, bez treści promptu.

## Ustawienia i pipeline

| Pole | Zapisane | Domyślne / efektywne w bieżącym kodzie |
| --- | --- | --- |
| Tryb | `approvalMode=auto` | domyślnie `manual`; efektywnie AUTO |
| Auto Approve | `autoApprovalEnabled=true`, `alwaysAllowExecute=true` | przełącznik `alwaysAllowExecute` dotyczy ścieżki manualnej; w AUTO działa orkiestrator |
| Guardrail | `enabled=true`, provider `xkiro`, model `qwen/qwen3.8-omni-flash:free` | efektywny dla akcji niejednoznacznych; brak secondary; worker model jest inny |
| Reguły komend | globalne allow/deny puste; legacy `roo-cline.allowedCommands` i `roo-cline.deniedCommands` puste | przed poprawką UI łączył listy globalne z workspace, lecz `Task.ask` otrzymywał tylko globalne; teraz oba widzą te same efektywne listy, a jawny deny wyprzedza fast path |
| Timeout / retry / cooldown | brak kluczy w konfiguracji | kod: 25 s całkowitego budżetu, do dwóch prób na kandydata, osobna kolejka verifier, cooldown po awariach |
| Strict / `alwaysVerifyCommands` | brak zapisanych kluczy | brak ścieżki `alwaysVerifyCommands` w aktualnym schemacie |

Ścieżka AUTO: `Task.ask` → `buildApprovalRequest` (TaskContract i scope) → jawny deny → execution boundary → klasyfikacja deterministyczna → **końcowe** `ALLOW_AUTO` albo weryfikator → kolejka / timeout / cooldown → `MANUAL_APPROVAL` lub decyzja modelu → stan UI. Jedna akcja jest oceniana przez orkiestrator raz; model może mieć ponowienie tylko dla akcji niejednoznacznej. Odrębna ścieżka manualna używa `checkAutoApproval` i `CommandSafetyJudge.evaluateTwoStage`; samo ustawienie „Auto-approved commands” nie stanowi w niej końcowej decyzji bezpieczeństwa.

`Task.ask` przekazuje teraz do orkiestratora konfigurację modelu konkretnego tasku. Wcześniej pobierał bieżący globalny profil z `ClineProvider.getState()`, który mógł różnić się od modelu Workera w innym równoległym chacie; kontrola niezależności verifiera porównywała niewłaściwy model. Test obejmuje pole `xkiroModelId`, którego poprzednie porównanie `apiModelId` nie widziało.

## Stop i UI

Ścieżka Stop: `ChatView` wysyła jawny `taskId` i `requestId` → `webviewMessageHandler` → `ClineProvider.runningTasks.get(taskId)` → konkretny `Task.cancelCurrentRequest`, `abortCompaction`, `abortTask` → jego terminal i kolejka → `taskStopAcknowledged` dla tego żądania. Desktop `DesktopAgentHost.stopTask` również przekazuje ID. Poprzednio przekazywał obiekt; `cancelTask` nie znajdował go w mapie i przechodził na task pierwszoplanowy. Dodatkowo wcześniejsza ścieżka nie czekała na `abortTask()` i mogła sygnalizować zakończenie zbyt wcześnie.

Podświetlenie slash tagów jest lustrzaną warstwą nad `textarea`; zwykły padding przesuwałby tekst. Wyróżnienie dla komend z projektu/globalnych ma teraz własną klasę, `inline-flex`, `align-items:center` i wizualny padding przez `box-shadow`, z istniejącym tokenem koloru. Izolowany ciemny fixture przeglądarkowy dał identyczną wysokość pięciu tagów oraz odchylenie środka od tekstu 0,5 px (100%), 0,125 px (125%) i 0,25 px (150%). Działającego chatu w hostowanej aplikacji nie udało się otworzyć: sam Vite czekał na inicjalizację hosta.
