# 🚀 DTCG Auto-Import pro Figmu

Tento lokální Figma plugin automatizuje import design tokenů ve standardizovaném formátu **DTCG (Design Tokens Community Group)** přímo do lokálních proměnných (Figma Variables).

Plugin ušetří hodiny manuální práce – automaticky zakládá kolekce, vytváří proměnné pro světlý i tmavý režim a prolinkovává mezi sebou aliasy.

## ✨ Co plugin umí
* **Automatická tvorba kolekcí:** Rozřadí tokeny do kolekcí `Palette`, `Radius`, `Spacing` a `Theme`.
* **Podpora režimů (Modes):** V kolekci `Theme` automaticky zakládá a plní sloupce pro `Light` a `Dark` mode.
* **Chytré propojování (Aliasing):** Pokud token odkazuje na jiný token (např. sémantická barva na paletu), plugin ve Figmě nevloží jen HEX kód, ale vytvoří skutečný **Variable Alias**.
* **Nativní Figma UI:** Okno pluginu plně respektuje váš aktuální motiv ve Figmě (Světlý/Tmavý).

---

## 📂 Jaké soubory plugin očekává?
Plugin vyžaduje složku, ve které se nacházejí přesně tyto tři JSON soubory (založené na DTCG specifikaci):

1. `theme.dtcg.json` (Základní definice, palety, radiusy, mezery)
2. `light.dtcg.json` (Sémantické hodnoty pro světlý režim)
3. `dark.dtcg.json` (Sémantické hodnoty pro tmavý režim)

---

## 🛠 Jak plugin nainstalovat (Lokálně)
Jelikož je plugin distribuován jako lokální složka (nebo ZIP archiv), pro jeho přidání do Figmy postupujte takto:

1. **Rozbalte složku s pluginem** na svém počítači (pokud jste ji dostali v `.zip`).
2. Otevřete desktopovou aplikaci **Figma** a otevřete libovolný Design file.
3. Klikněte kamkoliv na plátno **pravým tlačítkem myši**.
4. Zvolte **Plugins** ➔ **Development** ➔ **Import plugin from manifest...**
5. Najděte rozbalenou složku a vyberte v ní soubor `manifest.json`.

*Hotovo! Plugin máte nyní nainstalovaný u sebe ve Figmě.*

---

## 💻 Jak plugin používat
1. Spusťte plugin přes pravé tlačítko myši na plátně: **Plugins** ➔ **Development** ➔ **DTCG Importer**.
2. V okně pluginu klikněte na oblast **📁 Vybrat složku s tokeny**.
3. Vyberte složku ve vašem počítači, která obsahuje zmíněné 3 JSON soubory.
4. Pokud plugin soubory úspěšně detekuje, zobrazí se zelené odškrtnutí a objeví se tlačítko **Spustit import**.
5. Klikněte na tlačítko a počkejte. Během pár sekund Figma vygeneruje všechny Variables a vypíše zprávu o dokončení.

---

## 👨‍💻 Pro vývojáře (Úprava kódu)
Plugin se skládá z následujících souborů:
* `ui.html` – Uživatelské rozhraní pluginu (HTML/CSS/JS).
* `code.ts` – Hlavní logika pluginu komunikující s Figma API (zde se odehrává parsování a tvorba Variables).
* `code.js` – Zkompilovaný kód z TypeScriptu. **Toto je soubor, který Figma reálně spouští.**
* `manifest.json` – Konfigurační soubor pro Figmu.

Pokud budete upravovat logiku v `code.ts`, nezapomeňte kód před spuštěním zkompilovat do `code.js` (např. pomocí příkazu `tsc`).