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
  hlasování i seznam členů.
