# Testovací data

Zdroje testovacích dat a požadavky na testovací sadu. Zpět na hlavní dokumentaci: [CLAUDE.md](../CLAUDE.md)

---

## Veřejně dostupné zdroje středověkých dokumentů

Pro vývoj a testování použij tyto veřejně dostupné zdroje středověkých dokumentů:

- **Manuscriptorium** (manuscriptorium.com) – česká digitální knihovna rukopisů
- **Bayerische Staatsbibliothek** (digitale-sammlungen.de) – bavorské sbírky, fraktura
- **e-codices** (e-codices.unifr.ch) – švýcarské středověké rukopisy
- **Gallica** (gallica.bnf.fr) – francouzská národní knihovna
- **Wiktenauer** (wiktenauer.com) – středověké bojové příručky, fraktura + rukopisy,
  německé a latinské texty s existujícími transkripcemi (výborné pro validaci OCR)

## Složení testovací sady

Vytvoř složku `test-data/` s 5–10 obrázky různých typů:
- 2× tištěná fraktura (16.–17. století)
- 2× staročeský rukopis (bastarda, 14.–15. století)
- 2× latinský rukopis
- 2× dokument se složitým layoutem (glosy, víceúrovňový komentář)
- 1× smíšený text (latina + němčina)
- Ke každému obrázku přidej ground truth přepis (pokud existuje) pro měření přesnosti
