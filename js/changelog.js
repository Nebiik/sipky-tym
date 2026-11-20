// Přehled verzí. Novou verzi přidej úplně nahoru a zvyš VERSION.
export const VERSION = "0.5";

export const CHANGELOG = [
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
