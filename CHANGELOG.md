# Přehled verzí

Nejnovější je nahoře. Stejný přehled je v aplikaci v záložce Tým.


## Verze 0.13 (20. 11. 2026)

- V seznamu turnajů je u dokončeného turnaje vidět vítěz s pohárem a barvou jeho kolečka. Při shodě na prvním místě jsou uvedeni všichni.
- Turnaje jsou rozdělené na probíhající a dokončené.
- Nový přepínač Turnaje a Statistiky. Statistiky mají žebříček (vyhrané turnaje, odehrané turnaje, výhry a prohry v zápasech, úspěšnost) a vzájemné skóre dvou hráčů přes všechny turnaje se seznamem zápasů.
- Statistiky počítají jen členy týmu. Hosté bez účtu se v nich neobjevují.

## Verze 0.12 (20. 11. 2026)

- Liga ze sipky.org: v záložce Zápasy je nový přepínač Zápisy a Liga. V Lize je tabulka vaší skupiny se zvýrazněným naším týmem, naše pozice a naše další utkání.
- Data se stahují automaticky čtyřikrát denně úlohou na GitHubu. Stahuje se jen týmová tabulka a rozpis, ne statistiky jednotlivých hráčů.
- U našeho utkání je tlačítko Založit kolo, které předvyplní soupeře a datum. Když kolo už existuje, nabídne jeho otevření.

## Verze 0.11 (20. 11. 2026)

- Každý si může vybrat barvu svého kolečka z osmi barev. Barvu vidí všichni v týmu, v turnajích i u zápasů.
- Profil (jméno a barva) se otevírá tlačítkem Upravit profil v záložce Tým, nebo klepnutím na své kolečko nahoře.
- Kdo si barvu nevybere, má dál barvu podle jména.

## Verze 0.10 (20. 11. 2026)

- Betony se počítají přesně podle pravidel: 1 beton za kolo s méně než 20 body a 1 beton za každou šipku vedle. Obojí se sčítá, takže kolo vedle, 8, 8 jsou 2 betony.
- Při zavírání se nepočítá nic. Aplikace pozná, jestli se zbytek dal zavřít šipkami, které v kole zbývaly, a v tom případě se zeptá, jestli to bylo zavírání.
- V tabulce kol je u betonu vidět jejich počet (beton, beton ×2).
- Za nezavřený leg (hod na středy) je jeden beton navíc.

## Verze 0.9 (20. 11. 2026)

- Betony: kolo s méně než 20 body se počítá jako beton, pokuta je 5 Kč. Při zavírání se beton nepočítá.
- Když zbytek šel zavřít a kolo bylo slabé, aplikace se zeptá, jestli to bylo zavírání. Jinak se beton pozná sám.
- Za nezavřený leg (hod na středy) je jeden beton navíc.
- Betony a pokuta jsou v přehledu zápasu i v souhrnu našich hráčů v kole.
- U soupeře se sledují jen křížky a výsledek. Průměr, šipky a dotaz na počet šipek při zavření zmizely.

## Verze 0.8 (20. 11. 2026)

- Nová záložka Zápasy: ligové kolo se soupeřem, datem, našimi hráči a hráči soupeře a seznamem 18 zápasů. Týmovka a kriket se zapisují jen výsledkem v legách.
- Zápis zápasu šipku po šipce (single, double, triple, bull, bullseye, vedle) se zbývajícími body, pravidly double out, přehozením a hodem na středy po 15 kolech.
- U soupeře se zadává jen to, kolik mu zbývá. Body za kolo a křížky se dopočítají samy.
- Po zápase výsledek, průměr, počet šipek, nejlepší leg, nejvyšší kolo a zavření, 180 a křížky 95+, 133+ a 170+ pro obě strany.
- V kole souhrn našich hráčů a přehled křížků všech zápasů pro zadání do ligy. Zápis jde vrátit krok po kroku.

## Verze 0.7 (20. 11. 2026)

- Po nalosování turnaje je rozpis jen seznam zápasů jeden za druhým, bez kol.
- Zápas se zapisuje jedním klepnutím na vítěze. Legy jsou pryč.
- Při shodě bodů v tabulce rozhoduje vzájemný zápas. Když ani ten nerozhodne, mají hráči stejné místo.
- Zápasy jsou seřazené tak, aby při šesti a více hráčích nikdo nehrál dva zápasy hned po sobě.
- Opraveno pole pro datum při zakládání turnaje a události na iPhonu (bylo posunuté a příliš široké). Nové zaškrtávátko u odvety.

## Verze 0.6 (20. 11. 2026)

- Nová záložka Turnaje: založení turnaje, výběr hráčů (členové i hosté bez účtu) a hry (501 DO, 501 DI/DO, 301 DO, 301 DI/DO, Kriket).
- Losování každý s každým po kolech, volitelně s odvetou. Při lichém počtu hráčů má v každém kole někdo volno.
- Zadání vítěze zápasu (počet legů je nepovinný) a průběžná tabulka s body, výhrami a skóre legů.
- Po odehrání všech zápasů se ukáže vítěz turnaje.

## Verze 0.5 (20. 11. 2026)

- Rychlejší spuštění: písma i všechny skripty jsou přímo z webu v jednom souboru, nic se nečeká na cizí servery.
- Data se ukládají i do telefonu, takže se při dalším spuštění ukážou hned a pak se jen dorovnají.
- Úvodní obrazovka se ukáže okamžitě, ještě než se aplikace načte.
- Stavový řádek iPhonu (čas, baterie) je plný a obsah pod něj nezasahuje, takže horní okraj nemůže být rozmazaný.

## Verze 0.4 (20. 11. 2026)

- Horní okraj na iPhonu už není rozmazaný, hlavička i spodní lišta jsou plné.
- V záložce Tým je přehled verzí a změn.

## Verze 0.3 (listopad 2026)

- Nový vzhled v barvách terče, odpočet u nejbližší události a spodní lišta.
- Avatary s iniciálami, barevný proužek podle druhu události, přehled hlasování jako proužek.
- Ikonka Podchod Klub R (terč, písmeno R a šipka).
- Aplikaci jde přidat na plochu iPhonu. V ní se přihlašuje e-mailem a heslem.

## Verze 0.2 (listopad 2026)

- E-maily členů už nevidí ostatní hráči. Jsou uložené zvlášť a čte je jen majitel a správce.

## Verze 0.1 (listopad 2026)

- První verze: přihlášení přes Google nebo e-mail a schvalování nových členů správcem.
- Události (trénink, zápas, akce, jiné) s datem, místem a poznámkou.
- Hlasování Můžu/Nemůžu s poznámkou a přehledem, kdo přesně.
- Záložka Tým se seznamem členů a rolemi (člen, správce).
