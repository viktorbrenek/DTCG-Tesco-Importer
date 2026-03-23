console.clear();

// =====================================================
// KONFIGURACE KOLEKCÍ
// =====================================================
const COLLECTIONS = {
  PALETTE: "Palette",
  RADIUS: "Radius",
  SPACING: "Spacing",
  THEME: "Theme",
};

// =====================================================
// =====================================================
// MANUÁLNÍ DOPLŇKY -> NYNÍ AUTOMATIZOVANÉ
// =====================================================

type ManualValue =
  | { alias: string }
  | { hex: string }
  | { float: number };

type ManualOverride = {
  collection: string;
  name: string;
  resolvedType: VariableResolvedDataType;
  values: { [modeName: string]: ManualValue };
};

function aliasCandidates(aliasName: string): string[] {
  const candidates: string[] = [aliasName];

  // Some text palette refs come as text/text-foo, while imported vars are text/foo.
  if (aliasName.indexOf("text/text-") === 0) {
    candidates.push(`text/${aliasName.slice("text/text-".length)}`);
  }

  // Some functional refs point to *-disabled variants that are not present in light/dark sources.
  // Fallback to the base token name to keep alias linking instead of leaving hardcoded values.
  if (aliasName.endsWith("-disabled")) {
    candidates.push(aliasName.slice(0, -"-disabled".length));
  }

  const uniq: string[] = [];
  for (let i = 0; i < candidates.length; i++) {
    if (uniq.indexOf(candidates[i]) === -1) uniq.push(candidates[i]);
  }
  return uniq;
}

function findAliasTargetByName(aliasName: string, byName: { [name: string]: Variable }): Variable | null {
  const candidates = aliasCandidates(aliasName);
  for (let i = 0; i < candidates.length; i++) {
    const target = byName[candidates[i]];
    if (target) return target;
  }
  return null;
}

// NOVÁ FUNKCE: Automaticky vygeneruje seznam overridů podle obsahu DTCG JSONu,
// takže už to nikdy nemusíš psát ručně.
function generateOverridesFromJSON(definitionsData: any): ManualOverride[] {
  const overrides: ManualOverride[] = [];
  const flatTokens: any[] = [];
  flattenTokens(definitionsData, [], flatTokens);

  // Zajímají nás jen ty "functional" skupiny
  const allowedRoots = ["surfaces-functional", "text-colors-functional"];

  for (const token of flatTokens) {
    if (token.type !== "color") continue;
    
    const root = token.rawPath[0];
    let isAllowed = false;
    for (let i = 0; i < allowedRoots.length; i++) {
      if (root.indexOf(allowedRoots[i]) === 0) {
        isAllowed = true;
        break;
      }
    }
    if (!isAllowed) continue;

    // Využijeme tvou vlastní transformační logiku k vytvoření názvu (např. surface/brand/primary-subtle-hover)
    const varName = transformName(token.rawPath, "theme");
    const val = token.value;

    let manualVal: ManualValue | null = null;

    if (typeof val === "string" && val.indexOf("{") === 0) {
      // Je to alias na jinou barvu (z JSONu, např. {surfaces.palette.purpleheart.subtle.hover})
      const ref = resolveRefName(val);
      manualVal = { alias: ref };
    } else if (typeof val === "string" && (val.startsWith("#") || val.length === 7 || val.length === 9)) {
      // Je to tvrdá hex hodnota
      manualVal = { hex: val };
    }

    if (manualVal) {
      overrides.push({
        collection: COLLECTIONS.THEME,
        name: varName,
        resolvedType: "COLOR",
        values: {
          Light: manualVal,
          Dark: manualVal
        }
      });
    }
  }

  return overrides;
}

async function applyManualOverrides(overrides: ManualOverride[]) {
  const stats = { created: 0, updated: 0, linked: 0, errors: 0 };
  if (!overrides || overrides.length === 0) return stats;

  const cols = await figma.variables.getLocalVariableCollectionsAsync();
  const vars = await figma.variables.getLocalVariablesAsync();

  // map: variable name -> variable
  const byName: { [name: string]: Variable } = {};
  for (let i = 0; i < vars.length; i++) byName[vars[i].name] = vars[i];

  const getOrCreateCollection = (name: string): VariableCollection => {
    for (let i = 0; i < cols.length; i++) {
      if (cols[i].name === name) return cols[i];
    }
    const c = figma.variables.createVariableCollection(name);
    cols.push(c);
    return c;
  };

  const getModeId = (col: VariableCollection, modeName: string): string | null => {
    for (let i = 0; i < col.modes.length; i++) {
      if (col.modes[i].name === modeName) return col.modes[i].modeId;
    }
    return null;
  };

  const findVarInCollection = (name: string, collectionId: string): Variable | null => {
    for (let i = 0; i < vars.length; i++) {
      const v = vars[i];
      if (v.name === name && v.variableCollectionId === collectionId) return v;
    }
    return null;
  };

  for (let i = 0; i < overrides.length; i++) {
    const def = overrides[i];
    try {
      const col = getOrCreateCollection(def.collection);

      let v = findVarInCollection(def.name, col.id);
      if (!v) {
        v = figma.variables.createVariable(def.name, col, def.resolvedType);
        vars.push(v);
        byName[v.name] = v;
        stats.created++;
      } else {
        stats.updated++;
      }

      // per-mode values (bez iteraci přes klíče)
      for (const modeName in def.values) {
        if (!Object.prototype.hasOwnProperty.call(def.values, modeName)) continue;
        const val = def.values[modeName];

        let modeId = getModeId(col, modeName);

        // když mód neexistuje, zkusíme ho vytvořit (typicky u Theme "Dark")
        if (!modeId) {
          try {
            col.addMode(modeName);
            modeId = getModeId(col, modeName);
          } catch (e) {
            // některé kolekce/módy nepůjdou přidat — přeskočíme
            continue;
          }
        }
        if (!modeId) continue;

        if ("alias" in val) {
          const target = findAliasTargetByName(val.alias, byName);
          if (!target) {
            stats.errors++;
            continue;
          }
          if (target.resolvedType !== v.resolvedType) {
            stats.errors++;
            continue;
          }
          v.setValueForMode(modeId, figma.variables.createVariableAlias(target));
          stats.linked++;
          continue;
        }

        if ("hex" in val) {
          if (v.resolvedType !== "COLOR") {
            stats.errors++;
            continue;
          }
          v.setValueForMode(modeId, hexToRgb(val.hex));
          continue;
        }

        if ("float" in val) {
          if (v.resolvedType !== "FLOAT") {
            stats.errors++;
            continue;
          }
          v.setValueForMode(modeId, val.float);
          continue;
        }
      }
    } catch (e) {
      stats.errors++;
    }
  }

  return stats;
}

// POMOCNÉ FUNKCE
// =====================================================

function hexToRgb(hex: string) {
  if (!hex) return { r: 0, g: 0, b: 0, a: 1 };
  hex = hex.replace("#", "").trim();

  let a = 1;
  if (hex.length === 8) {
    a = parseInt(hex.slice(6, 8), 16) / 255;
    hex = hex.slice(0, 6);
  } else if (hex.length === 3) {
    hex = hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2];
  }

  const r = parseInt(hex.substring(0, 2), 16) / 255;
  const g = parseInt(hex.substring(2, 4), 16) / 255;
  const b = parseInt(hex.substring(4, 6), 16) / 255;

  if (isNaN(r)) return { r: 1, g: 0, b: 0, a: 1 };
  return { r, g, b, a };
}

// =====================================================
// HLAVNÍ LOGIKA TVORBY NÁZVŮ (TRANSFORMACE)
// =====================================================
function transformName(
  path: string[],
  type: "palette" | "theme" | "radius" | "spacing"
): string {
  
  // 1. PALETTE (zůstává stejné)
  if (type === "palette") {
    if (path[0] === "palette") return `${path[1]}-${path[2]}`;
    if (path[0] === "palette-functional") return `${path[1]}/${path[2]}-${path[3]}`;
    return path.join("/");
  }

  // 2. RADIUS & SPACING (zůstává stejné)
  if (type === "radius" || type === "spacing") {
    return path[path.length - 1];
  }

  // 3. THEME
  if (type === "theme") {
    const root = path[0]; 

    // --- A) SURFACES ---
    if (root.indexOf("surfaces") === 0) {
      const subGroups = ["brand", "status", "rights"];
      let foundGroup = "";
      for (let i = 0; i < subGroups.length; i++) {
        if (path.indexOf(subGroups[i]) !== -1) {
          foundGroup = subGroups[i];
          break;
        }
      }

      if (foundGroup) {
        const parts = path.filter(p => 
          p !== root && 
          p !== "functional" && 
          p !== "default" && 
          p !== foundGroup
        );
        return `surface/${foundGroup}/${parts.join("-")}`;
      } else {
        const parts = path.filter(p => 
          p !== root && 
          p !== "functional" && 
          p !== "neutral" && 
          p !== "palette" && 
          p !== "default"
        );
        return `surface/${parts.join("-")}`;
      }
    }

    // --- B) TEXT COLORS ---
    if (root.indexOf("text-colors") === 0) {
      if (path.indexOf("on-surface") !== -1) {
        const role = path[path.length - 1];
        const groupName = `${role}-on-surface`;
        const parts = path.filter(p => 
          p !== root && 
          p !== "functional" && 
          p !== "on-surface" && 
          p !== "palette" && 
          p !== role
        );
        return `text/${groupName}/${parts.join("-")}`;
      }

      const subGroups = ["brand", "status", "rights"];
      let foundGroup = "";
      for (let i = 0; i < subGroups.length; i++) {
        if (path.indexOf(subGroups[i]) !== -1) {
          foundGroup = subGroups[i];
          break;
        }
      }

      if (foundGroup) {
        const parts = path.filter(p => 
          p !== root && 
          p !== "functional" && 
          p !== "default" && 
          p !== foundGroup
        );
        return `text/${foundGroup}/${parts.join("-")}`;
      }

      const parts = path.filter(p => 
        p !== root && 
        p !== "neutral" && 
        p !== "palette" && 
        p !== "default"
      );
      return `text/${parts.join("-")}`;
    }

    // --- C) BORDERS ---
    if (root.indexOf("borders") === 0) {
      let name = path[1];
      if (name.indexOf("inverted") !== -1) name = name.replace("inverted", "reversed");
      return `border/${name}`;
    }

    // --- D) OVERLAYS ---
    if (root.indexOf("overlays") === 0) {
      const name = path[1] === "default" ? "" : path[1];
      return name ? `overlay/${name}` : `overlay`;
    }
  }

  // Fallback
  return path.join("/");
}

// Funkce pro řešení referencí (aliasů)
function resolveRefName(ref: string): string {
  const clean = ref.replace(/[{}]/g, "");
  const parts = clean.split(".");

  let type: "palette" | "theme" | "radius" | "spacing" = "theme";
  
  if (parts[0].indexOf("palette") !== -1) type = "palette";
  else if (parts[0] === "radius") type = "radius";
  else if (parts[0] === "spacing") type = "spacing";
  
  return transformName(parts, type);
}

function flattenTokens(node: any, path: string[], result: any[]) {
  for (const key in node) {
    const item = node[key];
    const newPath = [...path, key];
    if (item && typeof item === "object" && "$value" in item) {
      result.push({ rawPath: newPath, value: item.$value, type: item.$type });
    } else if (item && typeof item === "object" && !Array.isArray(item)) {
      flattenTokens(item, newPath, result);
    }
  }
}

// =====================================================
// IMPORTÉR
// =====================================================

async function importData(data: any, importMode: "definitions" | "light" | "dark") {
  const flatTokens: any[] = [];
  flattenTokens(data, [], flatTokens);

  const allLocalVars = await figma.variables.getLocalVariablesAsync();
  const globalVarMap = new Map(allLocalVars.map((v) => [v.name, v]));
  
  const rawToVarMap = new Map();
  allLocalVars.forEach((v) => {
    rawToVarMap.set(v.name, v);
    rawToVarMap.set(v.name.replace(/\//g, "."), v);
  });

  let stats = { created: 0, updated: 0, linked: 0, errors: 0 };

  const getCollection = async (name: string) => {
    const cols = await figma.variables.getLocalVariableCollectionsAsync();
    let c = cols.find((x) => x.name === name);
    if (!c) {
      c = figma.variables.createVariableCollection(name);
      c.renameMode(c.modes[0].modeId, name === COLLECTIONS.THEME ? "Light" : "Value");
    }
    return c;
  };

  if (importMode === "definitions") {
    for (const token of flatTokens) {
      const root = token.rawPath[0];
      let targetCol = "";
      let type: any = null;

      if (root.indexOf("palette") !== -1) { targetCol = COLLECTIONS.PALETTE; type = "palette"; }
      else if (root === "radius") { targetCol = COLLECTIONS.RADIUS; type = "radius"; }
      else if (root === "spacing") { targetCol = COLLECTIONS.SPACING; type = "spacing"; }
      else continue;

      if (token.type === "shadow") continue;

      const collection = await getCollection(targetCol);
      const modeId = collection.modes[0].modeId;
      const varName = transformName(token.rawPath, type);

      let variable = allLocalVars.find(v => v.name === varName && v.variableCollectionId === collection.id);
      
      if (!variable) {
        let varType: VariableResolvedDataType = token.type === "color" ? "COLOR" : "FLOAT";
        if (typeof token.value === "string" && token.value.indexOf("px") !== -1) varType = "FLOAT";
        
        try {
          variable = figma.variables.createVariable(varName, collection, varType);
          allLocalVars.push(variable);
          globalVarMap.set(varName, variable);
          stats.created++;
        } catch (e) { stats.errors++; continue; }
      } else { stats.updated++; }

      try {
        if (typeof token.value === "string" && token.value.indexOf("{") === 0) {
           const refName = resolveRefName(token.value);
           const refVar = globalVarMap.get(refName);
           if (refVar && variable.resolvedType === refVar.resolvedType) {
             variable.setValueForMode(modeId, figma.variables.createVariableAlias(refVar));
             stats.linked++;
           }
        } else {
           if (variable.resolvedType === "COLOR") variable.setValueForMode(modeId, hexToRgb(token.value));
           if (variable.resolvedType === "FLOAT") variable.setValueForMode(modeId, parseFloat(token.value));
        }
      } catch (e) {}
    }
  }
  else {
    const collection = await getCollection(COLLECTIONS.THEME);
    let modeId = "";
    
    if (importMode === "light") {
      const m = collection.modes.find((x) => x.name === "Light") || collection.modes[0];
      if (m.name !== "Light") collection.renameMode(m.modeId, "Light");
      modeId = m.modeId;
    } else {
      let m = collection.modes.find((x) => x.name === "Dark");
      if (!m) {
        try { collection.addMode("Dark"); m = collection.modes.find((x) => x.name === "Dark"); }
        catch (e) { figma.notify("Nelze přidat Dark mode"); return stats; }
      }
      modeId = m!.modeId;
    }

    const allowedRoots = ["surfaces", "surfaces-functional", "text-colors", "text-colors-functional", "borders", "overlays"];

    for (const token of flatTokens) {
      if (token.type === "shadow") continue;
      
      let isAllowed = false;
      for (const r of allowedRoots) {
        if (token.rawPath[0].indexOf(r) === 0) {
          isAllowed = true;
          break;
        }
      }
      if (!isAllowed) continue;

      const varName = transformName(token.rawPath, "theme");
      
      let variable = allLocalVars.find(v => v.name === varName && v.variableCollectionId === collection.id);
      
      if (!variable) {
        try {
          variable = figma.variables.createVariable(varName, collection, "COLOR");
          allLocalVars.push(variable);
          globalVarMap.set(varName, variable);
          stats.created++;
        } catch (e) { stats.errors++; continue; }
      } else { stats.updated++; }

      try {
        const val = token.value;
        if (typeof val === "string" && val.indexOf("{") === 0) {
          const refName = resolveRefName(val);
          let refVar: Variable | undefined;
          const refCandidates = aliasCandidates(refName);

          for (let i = 0; i < refCandidates.length; i++) {
            refVar = globalVarMap.get(refCandidates[i]);
            if (refVar) break;
          }
          
          if (!refVar) {
             const cleanRef = val.replace(/[{}]/g, "");
             refVar = rawToVarMap.get(cleanRef);
          }

          if (refVar) {
            variable.setValueForMode(modeId, figma.variables.createVariableAlias(refVar));
            stats.linked++;
          }
        } else {
          variable.setValueForMode(modeId, hexToRgb(val));
        }
      } catch (e) { stats.errors++; }
    }
  }

  return stats;
}

// =====================================================
// UI HANDLER
// =====================================================
figma.showUI(__html__, { width: 400, height: 330, themeColors: true });

figma.ui.onmessage = async (msg) => {
  if (msg.type === "run-automation") {
    const { definitions, light, dark } = msg.payload;
    const totalStats = { created: 0, updated: 0, linked: 0, errors: 0 };

    const addStats = (s: any) => {
      totalStats.created += s.created;
      totalStats.updated += s.updated;
      totalStats.linked += s.linked;
      totalStats.errors += s.errors;
    };

    if (definitions) {
      figma.ui.postMessage({ type: "status", message: "Importuji Definice..." });
      addStats(await importData(definitions, "definitions"));
    }

    if (light) {
      figma.ui.postMessage({ type: "status", message: "Importuji Light Mode..." });
      addStats(await importData(light, "light"));
    }

    if (dark) {
      figma.ui.postMessage({ type: "status", message: "Importuji Dark Mode..." });
      addStats(await importData(dark, "dark"));
    }

    // ZDE JE AUTOMATIZACE TOHO MANUÁLNÍHO KROKU
    if (definitions) {
      const generatedOverrides = generateOverridesFromJSON(definitions);
      if (generatedOverrides.length > 0) {
        figma.ui.postMessage({ type: "status", message: "Aplikuji automatizované doplňky z JSONu..." });
        addStats(await applyManualOverrides(generatedOverrides));
      }
    }

    figma.notify(`Hotovo! Vytvořeno: ${totalStats.created}, Propojeno: ${totalStats.linked}`);
    figma.ui.postMessage({ type: "complete", message: "Hotovo!" });
  }
};
