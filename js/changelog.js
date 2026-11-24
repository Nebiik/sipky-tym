// Přehled verzí. Novou verzi přidej úplně nahoru a zvyš VERSION.
export const VERSION = "0.20";

export const CHANGELOG = [
  {
    version: "0.20",
    date: "24. 11. 2026",
    changes: [
      "Statistiky zápasů: dlaždice Kola a Zápasy teď berou skutečnou bilanci za celou sezónu z tabulky ligy (Kola v lize a Zápasy v lize), takže počítají i kola odehraná před zavedením aplikace.",
      "Dlaždice Průměr týmu ukazuje, kdo má nejlepší průměr (🥇), a dlaždice Naše křížky, kdo jich má nejvíc. Nejlepší průměr se vybírá z hráčů s aspoň dvěma zapsanými zápasy. Při shodě se vypíšou všichni, u víc než tří jen jejich počet.",
      "Dlaždice Křížky soupeřů je pryč. Betony zůstaly.",
      "Pod dlaždicemi je vysvětleno, odkud čísla jsou: kola a zápasy z ligy, průměr, křížky a betony ze zápasů zapsaných v aplikaci."
    ]
  },
  {
    version: "0.19",
    date: "23. 11. 2026",
    changes: [
      "Při zápisu zápasu je vlevo ten, kdo začíná leg, stejně jako budík na automatu. V dalším legu se strany obrátí. Mezi legy je vlevo ten, kdo má podle střídání začínat.",
      "Stejně se řadí i sloupce v tabulce kol (u každého legu je vlevo začínající hráč) a hlavičky sloupců mají barvu strany."
    ]
  },
  {
    version: "0.18",
    date: "23. 11. 2026",
    changes: [
      "Komentáře k události místo poznámek k hlasování: ukazují se přímo na kartě události se jménem autora, jeho barevným kolečkem a časem (dnes, včera, nebo datum). Komentář může přidat kdokoli, i bez hlasování, a víckrát.",
      "Vlastní komentář jde upravit (pak se u něj ukáže upraveno) a smazat. Správce a autor události může smazat i cizí komentář. Cizí komentář upravit nejde.",
      "Zobrazují se poslední tři komentáře, starší se rozbalí odkazem Starší komentáře.",
      "Dřívější poznámky k hlasování se nezahodily: ukazují se jako komentáře svých autorů a autor je může smazat. Dřív byly vidět jen po rozkliknutí Kdo přesně.",
      "Smazáním události se smažou i její komentáře."
    ]
  },
  {
    version: "0.17",
    date: "23. 11. 2026",
    changes: [
      "V Lize je u našeho utkání (jen pro správce) tlačítko Založit událost. Otevře formulář předvyplněný z rozpisu: Zápas, název Zápas s (soupeř), datum a čas, místo, číslo kola a skupina v poznámce.",
      "Domácí zápas se zaškrtne jen tehdy, když je náš tým v rozpisu uveden jako domácí. Když hraje doma A tým a my jsme v rozpisu hosté, zůstane zápas jako venkovní, i když se hraje ve stejné hospodě.",
      "Když už událost Zápas ve stejný den existuje, nabídne se místo toho Upravit událost, takže se zápas nezaloží dvakrát.",
      "Při zakládání zápasu v kole zmizela volba, na kolik vítězných legů se hraje. V lize se vždy hraje na dva vítězné legy."
    ]
  },
  {
    version: "0.16",
    date: "23. 11. 2026",
    changes: [
      "Náš hráč se při zápisu zadává stejně jako soupeř: napíšeš, kolik mu po kole zbývá. Body za kolo, průměr a křížky se dopočítají. Šipky se už nezadávají.",
      "Betony se zadávají ručně tlačítky 1× až 4× nad klávesnicí (v jednom kole jich je nejvýš 4). Automatické počítání betonů a otázka Bylo to zavírání jsou pryč. Nezavřený leg na středy dál dává 1 beton navíc.",
      "Při zavření našeho hráče jde zvolit, kolik šipek na to použil (výchozí jsou 3), aby seděl průměr.",
      "Panel zápisu je barevně rozlišený: zelený pro našeho hráče a červený pro soupeře, stejně jako zvýraznění strany na tabuli.",
      "Starší zápasy zapsané po šipkách se zobrazují beze změny a jdou dohrát novým zápisem."
    ]
  },
  {
    version: "0.15.1",
    date: "23. 11. 2026",
    changes: [
      "Oprava stahování ligy: když stránka ligy obsahuje i jinou tabulku se sloupci Domácí a Hosté (třeba výsledky), skript už kvůli tomu nepadá a vezme správný rozpis. Tabulka družstev se aktualizuje vždy.",
      "Když se rozpis utkání nepodaří přečíst, ponechá se poslední známý a v Lize se to napíše.",
      "V Lize se ukazují jen utkání od dneška dál."
    ]
  },
  {
    version: "0.15",
    date: "22. 11. 2026",
    changes: [
      "Výhra, prohra nebo remíza kola je vidět na kartě kola i v jeho detailu: u výhry zlatý 🏆 Výhra, zlaté skóre a nápis Vyhráli jsme.",
      "V detailu kola jsou součty nahoře i dole: v tabulce našich hráčů řádek Celkem a nová tabulka Hráči soupeře (H1, H2…) s jejich zápasy, legy a křížky 95+, 133+ a 170+ a taky s řádkem Celkem.",
      "V záložce Zápasy je nový přepínač Statistiky za všechna kola: bilance kol, skóre zápasů, průměr týmu, naše křížky a křížky soupeřů, betony a pokuty a tabulka hráčů, kterou jde řadit podle výher, průměru, křížků nebo betonů.",
      "Přepínač v Zápasech má tři položky (Zápisy, Liga, Statistiky)."
    ]
  },
  {
    version: "0.14.1",
    date: "22. 11. 2026",
    changes: [
      "Opraveno datum u verzí 0.13 a 0.14 v přehledu změn."
    ]
  },
  {
    version: "0.14",
    date: "22. 11. 2026",
    changes: [
      "U události typu Zápas jde vybrat základní sestavu (nejvýš 4 hráči) a náhradníky (libovolný počet) ze všech členů týmu. Hráč je buď v sestavě, nebo mezi náhradníky.",
      "U zápasu jde zaškrtnout Domácí zápas a vybrat, kdo dělá občerstvení. U jmen je vidět, kolikrát už je na občerstvení zapsaný, aby se šlo spravedlivě střídat.",
      "Sestava, náhradníci a občerstvení jsou vidět na kartě události. U každého hráče je značka, jak hlasoval (✓ můžu, ✗ nemůžu, ? nehlasoval).",
      "Když z ligového rozpisu zakládáš kolo k utkání a ve stejný den je událost Zápas, hráči kola se předvyplní ze sestavy a náhradníků."
    ]
  },
  {
    version: "0.13",
    date: "listopad 2026",
    changes: [
      "V seznamu turnajů je u dokončeného turnaje vidět vítěz s pohárem a barvou jeho kolečka. Při shodě na prvním místě jsou uvedeni všichni.",
      "Turnaje jsou rozdělené na probíhající a dokončené.",
      "Nový přepínač Turnaje a Statistiky. Statistiky mají žebříček (vyhrané turnaje, odehrané turnaje, výhry a prohry v zápasech, úspěšnost) a vzájemné skóre dvou hráčů přes všechny turnaje se seznamem zápasů.",
      "Statistiky počítají jen členy týmu. Hosté bez účtu se v nich neobjevují."
    ]
  },
  {
    version: "0.12",
    date: "20. 11. 2026",
    changes: [
      "Liga ze sipky.org: v záložce Zápasy je nový přepínač Zápisy a Liga. V Lize je tabulka vaší skupiny se zvýrazněným naším týmem, naše pozice a naše další utkání.",
      "Data se stahují automaticky čtyřikrát denně úlohou na GitHubu. Stahuje se jen týmová tabulka a rozpis, ne statistiky jednotlivých hráčů.",
      "U našeho utkání je tlačítko Založit kolo, které předvyplní soupeře a datum. Když kolo už existuje, nabídne jeho otevření."
    ]
  },
  {
    version: "0.11",
    date: "20. 11. 2026",
    changes: [
      "Každý si může vybrat barvu svého kolečka z osmi barev. Barvu vidí všichni v týmu, v turnajích i u zápasů.",
      "Profil (jméno a barva) se otevírá tlačítkem Upravit profil v záložce Tým, nebo klepnutím na své kolečko nahoře.",
      "Kdo si barvu nevybere, má dál barvu podle jména."
    ]
  },
  {
    version: "0.10",
    date: "20. 11. 2026",
    changes: [
      "Betony se počítají přesně podle pravidel: 1 beton za kolo s méně než 20 body a 1 beton za každou šipku vedle. Obojí se sčítá, takže kolo vedle, 8, 8 jsou 2 betony.",
      "Při zavírání se nepočítá nic. Aplikace pozná, jestli se zbytek dal zavřít šipkami, které v kole zbývaly, a v tom případě se zeptá, jestli to bylo zavírání.",
      "V tabulce kol je u betonu vidět jejich počet (beton, beton ×2).",
      "Za nezavřený leg (hod na středy) je jeden beton navíc."
    ]
  },
  {
    version: "0.9",
    date: "20. 11. 2026",
    changes: [
      "Betony: kolo s méně než 20 body se počítá jako beton, pokuta je 5 Kč. Při zavírání se beton nepočítá.",
      "Když zbytek šel zavřít a kolo bylo slabé, aplikace se zeptá, jestli to bylo zavírání. Jinak se beton pozná sám.",
      "Za nezavřený leg (hod na středy) je jeden beton navíc.",
      "Betony a pokuta jsou v přehledu zápasu i v souhrnu našich hráčů v kole.",
      "U soupeře se sledují jen křížky a výsledek. Průměr, šipky a dotaz na počet šipek při zavření zmizely."
    ]
  },
  {
    version: "0.8",
    date: "20. 11. 2026",
    changes: [
      "Nová záložka Zápasy: ligové kolo se soupeřem, datem, našimi hráči a hráči soupeře a seznamem 18 zápasů. Týmovka a kriket se zapisují jen výsledkem v legách.",
      "Zápis zápasu šipku po šipce (single, double, triple, bull, bullseye, vedle) se zbývajícími body, pravidly double out, přehozením a hodem na středy po 15 kolech.",
      "U soupeře se zadává jen to, kolik mu zbývá. Body za kolo a křížky se dopočítají samy.",
      "Po zápase výsledek, průměr, počet šipek, nejlepší leg, nejvyšší kolo a zavření, 180 a křížky 95+, 133+ a 170+ pro obě strany.",
      "V kole souhrn našich hráčů a přehled křížků všech zápasů pro zadání do ligy. Zápis jde vrátit krok po kroku."
    ]
  },
  {
    version: "0.7",
    date: "20. 11. 2026",
    changes: [
      "Po nalosování turnaje je rozpis jen seznam zápasů jeden za druhým, bez kol.",
      "Zápas se zapisuje jedním klepnutím na vítěze. Legy jsou pryč.",
      "Při shodě bodů v tabulce rozhoduje vzájemný zápas. Když ani ten nerozhodne, mají hráči stejné místo.",
      "Zápasy jsou seřazené tak, aby při šesti a více hráčích nikdo nehrál dva zápasy hned po sobě.",
      "Opraveno pole pro datum při zakládání turnaje a události na iPhonu (bylo posunuté a příliš široké). Nové zaškrtávátko u odvety."
    ]
  },
  {
    version: "0.6",
    date: "20. 11. 2026",
    changes: [
      "Nová záložka Turnaje: založení turnaje, výběr hráčů (členové i hosté bez účtu) a hry (501 DO, 501 DI/DO, 301 DO, 301 DI/DO, Kriket).",
      "Losování každý s každým po kolech, volitelně s odvetou. Při lichém počtu hráčů má v každém kole někdo volno.",
      "Zadání vítěze zápasu (počet legů je nepovinný) a průběžná tabulka s body, výhrami a skóre legů.",
      "Po odehrání všech zápasů se ukáže vítěz turnaje."
    ]
  },
  {
    version: "0.5",
    date: "20. 11. 2026",
    changes: [
      "Rychlejší spuštění: písma i všechny skripty jsou přímo z webu v jednom souboru, nic se nečeká na cizí servery.",
      "Data se ukládají i do telefonu, takže se při dalším spuštění ukážou hned a pak se jen dorovnají.",
      "Úvodní obrazovka se ukáže okamžitě, ještě než se aplikace načte.",
      "Stavový řádek iPhonu (čas, baterie) je plný a obsah pod něj nezasahuje, takže horní okraj nemůže být rozmazaný."
    ]
  },
  {
    version: "0.4",
    date: "20. 11. 2026",
    changes: [
      "Horní okraj na iPhonu už není rozmazaný, hlavička i spodní lišta jsou plné.",
      "V záložce Tým je přehled verzí a změn."
    ]
  },
  {
    version: "0.3",
    date: "listopad 2026",
    changes: [
      "Nový vzhled v barvách terče, odpočet u nejbližší události a spodní lišta.",
      "Avatary s iniciálami, barevný proužek podle druhu události, přehled hlasování jako proužek.",
      "Ikonka Podchod Klub R (terč, písmeno R a šipka).",
      "Aplikaci jde přidat na plochu iPhonu. V ní se přihlašuje e-mailem a heslem."
    ]
  },
  {
    version: "0.2",
    date: "listopad 2026",
    changes: [
      "E-maily členů už nevidí ostatní hráči. Jsou uložené zvlášť a čte je jen majitel a správce."
    ]
  },
  {
    version: "0.1",
    date: "listopad 2026",
    changes: [
      "První verze: přihlášení přes Google nebo e-mail a schvalování nových členů správcem.",
      "Události (trénink, zápas, akce, jiné) s datem, místem a poznámkou.",
      "Hlasování Můžu/Nemůžu s poznámkou a přehledem, kdo přesně.",
      "Záložka Tým se seznamem členů a rolemi (člen, správce)."
    ]
  }
];
