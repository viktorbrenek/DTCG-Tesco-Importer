// manual.overrides.ts
// -----------------------------------------------------
// TADY si ručně definuješ "doplněk" nad importem z JSONů.
// Všechny názvy používají stejný tvar jako ve Figmě: "group/subgroup/token-name".
//
// Podpora hodnot:
// - alias: { alias: "surface/blue-minimal" } (naváže na existující proměnnou dle jména)
// - přímá barva: { color: "#FF00AA" }
// - číslo (FLOAT): { number: 8 }  // např. spacing/radius
//
// values může být:
// - single (aplikuje se na všechny módy, které kolekce má)
// - perMode: { Light: ..., Dark: ... }  (nebo jiné názvy módů)
//
// Tip: Začni tímhle příkladem pro brand/status/rights mapování.

export type ManualValue =
  | { alias: string }
  | { color: string }
  | { number: number };

export type ManualToken = {
  collection: "Theme" | "Palette" | "Radius" | "Spacing" | "Typography" | "Effects";
  // název proměnné včetně "složek" oddělených lomítky
  name: string;
  // "COLOR" vytvoří color variable, "FLOAT" vytvoří number variable
  resolvedType: "COLOR" | "FLOAT";
  // buď jedna hodnota pro všechny módy, nebo per-mode mapování
  values: ManualValue | Record<string, ManualValue>;
};

// -----------------------------------------------------
// SEM PIŠ SVOJE DOPLŇKY
// -----------------------------------------------------
export const MANUAL_OVERRIDES: ManualToken[] = [
  // ✅ Ukázka: vytvoří Theme/surface/brand/primary-minimal jako alias na Theme/surface/blue-minimal v Light i Dark
  {
    collection: "Theme",
    name: "surface/brand/primary-minimal",
    resolvedType: "COLOR",
    values: {
      Light: { alias: "surface/blue-minimal" },
      Dark: { alias: "surface/blue-minimal" },
    },
  },

  // ✅ Ukázka: přímá barva (stejná pro všechny módy v kolekci)
  // {
  //   collection: "Theme",
  //   name: "border/shiny",
  //   resolvedType: "COLOR",
  //   values: { color: "#FFFFFF" },
  // },

  // ✅ Ukázka: FLOAT (např. spacing/radius)
  // {
  //   collection: "Spacing",
  //   name: "base-7",
  //   resolvedType: "FLOAT",
  //   values: { number: 28 },
  // },
];
