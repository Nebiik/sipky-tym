# Šipkový tým

Web pro šipkový tým: události (trénink, zápas, akce) s hlasováním Můžu/Nemůžu,
členové týmu a role. Statická stránka (GitHub Pages) plus Firebase (přihlášení a databáze).

Hotové: přihlášení, schvalování členů, události a hlasování.
Plánované: zápis zápasů, losování turnaje, tabulka ligy.

## 1. Nový projekt ve Firebase

1. Na https://console.firebase.google.com vytvoř **nový projekt** (Analytics nepotřebuješ).
2. **Authentication > Sign-in method**: zapni **Google** a **E-mail/heslo**.
3. **Firestore Database > Create database**: region `eur3 (europe-west)`, začni v produkčním režimu.
4. **Firestore Database > Rules**: vlož celý obsah souboru `firestore.rules` a dej **Publish**.
5. **Project settings > Your apps > Web (`</>`)**: zaregistruj appku a zkopíruj `firebaseConfig`.
6. Hodnoty vlož do `js/firebase-config.js`. Nastav tam i `TEAM_NAME`.

## 2. Vyzkoušení na počítači

Moduly nefungují přes `file://`, spusť malý server:

    cd sipky-tym
    python3 -m http.server 8000

Otevři http://localhost:8000. Doména `localhost` je ve Firebase povolená automaticky.

## 3. První správce

Každý nový člověk se založí jako **čekající**. Prvního správce musíš nastavit ručně:

1. Přihlas se do appky (založí se tvůj záznam).
2. Ve Firebase konzoli otevři **Firestore > users > (tvůj dokument)**.
3. Pole `role` změň z `pending` na `admin`.

Dál už členy schvaluješ přímo v appce, v záložce **Tým**.

## 4. GitHub Pages

1. Nahraj složku do GitHub repozitáře.
2. **Settings > Pages**: zdroj `Deploy from a branch`, větev `main`, složka `/ (root)`.
3. Ve Firebase v **Authentication > Settings > Authorized domains** přidej `tvojejmeno.github.io`.

## Poznámky

- `firebaseConfig` je veřejný, to je v pořádku. Data chrání `firestore.rules`.
- Jakmile pravidla změníš, znovu je zveřejni v konzoli.
- Nepřihlášení a neschválení lidé nevidí žádná data. Schválení členové vidí všechny události,
  hlasování i seznam jmen členů.
- E-maily jsou uložené zvlášť v kolekci `userPrivate`. Čte je jen jejich majitel a správce.

## Aplikace na ploše iPhonu

1. Otevři stránku v **Safari** (ne v jiném prohlížeči).
2. Klepni na **Sdílet** (čtvereček se šipkou) a vyber **Přidat na plochu**.
3. Název „Podchod R“ nech nebo uprav a potvrď. Na ploše se objeví ikonka s terčem a písmenem R.

Aplikace z plochy má vlastní úložiště, takže se v ní musíš **přihlásit znovu**. Google okno se tu
často nepovede, použij **e-mail a heslo**. Máš účet přes Google? V přihlášení napiš e-mail a zkus
„Zapomenuté heslo“, přijde odkaz na nastavení hesla.

Po nahrání nové verze na GitHub se ikonka a název na ploše nemění. Kdyby se ikonka někdy měnila,
smaž aplikaci z plochy a přidej ji znovu.

## Jak je aplikace složená (pro úpravy kódu)

- `js/app.js`, `js/changelog.js` a další soubory ve složce `js` jsou zdrojový kód.
- `js/bundle.js` je z nich automaticky sestavený jediný soubor, který stránka skutečně načítá
  (obsahuje i Firebase, takže se nic nestahuje z cizích serverů a start je rychlý).
- Po každé změně zdrojového kódu se `js/bundle.js` musí sestavit znovu. Když budeš měnit kód ručně,
  změna se v appce neprojeví, dokud se bundle nepřegeneruje.
- `js/firebase-config.js` je záměrně mimo bundle, takže se tvoje Firebase údaje nepřepisují.

## Liga ze sipky.org

Tabulka a rozpis ligy se berou z veřejných stránek Unie šipkových organizací (sipky.org, systém Leguan).

- Úloha `.github/workflows/liga.yml` ji 4× denně spustí a skript `scripts/fetch-liga.mjs` uloží
  tabulku družstev a rozpis do `data/liga.json`. Aplikace čte jen tenhle soubor.
- Stahují se **jen týmová tabulka a rozpis**, žádné statistiky jednotlivých hráčů.
- Na jedno spuštění jsou 2 požadavky na web ligy a skript se představuje jako `PodchodKlubR-liga`.
- Nastavení je v `scripts/liga.config.json`: `group` je začátek názvu skupiny (třeba `2. liga C`)
  a `team` je přesný název týmu na sipky.org (`Klub R Podchod Brno`). Po začátku nové sezóny
  tady bude potřeba upravit skupinu.
- Ruční spuštění: na GitHubu záložka **Actions**, **Liga ze sipky.org**, **Run workflow**.
- Když úloha selže, v aplikaci zůstanou poslední data. Důvod je v logu úlohy (nenalezená skupina,
  změněná struktura stránky, nebo odmítnutí webem ligy).
- GitHub u veřejných repozitářů po 60 dnech bez aktivity naplánované úlohy vypne. Stačí je znovu
  zapnout v záložce Actions.

### Přesné spouštění přes cron-job.org (volitelné)

Naplánované úlohy na GitHubu se někdy opozdí, protože GitHub je spouští podle vytížení svých serverů.
Chceš-li přesné časy, nech úlohu spouštět cron-job.org a GitHub ať zůstane jen jako záloha.

1. Na GitHubu: **Settings > Developer settings > Personal access tokens > Fine-grained tokens > Generate new token**.
   Repozitář vyber jen tenhle (**Only select repositories**), v oprávnění repozitáře dej **Actions: Read and write**
   a ostatní nech bez přístupu. Token si zkopíruj a nikomu ho neposílej.
2. V cron-job.org založ nový cronjob:
   - URL: `https://api.github.com/repos/TVOJEJMENO/NAZEV-REPOZITARE/actions/workflows/liga.yml/dispatches`
   - Metoda **POST**, tělo `{"ref":"main"}`
   - Hlavičky: `Authorization: Bearer TVŮJ_TOKEN`, `Accept: application/vnd.github+json`,
     `X-GitHub-Api-Version: 2022-11-28`, `Content-Type: application/json`
   - Časování třeba 4:05, 10:05, 16:05 a 22:05 (časové pásmo Europe/Prague)
3. Správná odpověď je **HTTP 204**. Běh se pak objeví v záložce Actions.
4. V souboru `.github/workflows/liga.yml` můžeš naplánovanou úlohu zřídkavit na jednou denně
   (řádek `cron:`), aby sloužila jen jako záloha.
