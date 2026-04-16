"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
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
function buildContext() {
    return __awaiter(this, void 0, void 0, function* () {
        const allVars = yield figma.variables.getLocalVariablesAsync();
        const collections = yield figma.variables.getLocalVariableCollectionsAsync();
        const collectionsById = new Map(collections.map(c => [c.id, c]));
        const globalVarMap = new Map(allVars.map(v => [v.name, v]));
        const varByName = new Map();
        for (const v of allVars) {
            varByName.set(`${v.name}\0${v.variableCollectionId}`, v);
        }
        const paletteAliasCandidates = buildPaletteAliasCandidates(allVars, collectionsById);
        const rawToVarMap = new Map();
        for (const v of allVars) {
            rawToVarMap.set(v.name, v);
            rawToVarMap.set(v.name.replace(/\//g, "."), v);
        }
        return { collections, collectionsById, allVars, varByName, globalVarMap, paletteAliasCandidates, rawToVarMap };
    });
}
function registerVar(ctx, v) {
    ctx.allVars.push(v);
    ctx.globalVarMap.set(v.name, v);
    ctx.varByName.set(`${v.name}\0${v.variableCollectionId}`, v);
    ctx.rawToVarMap.set(v.name, v);
    ctx.rawToVarMap.set(v.name.replace(/\//g, "."), v);
}
function aliasCandidates(aliasName) {
    const candidates = [aliasName];
    // Some text palette refs come as text/text-foo, while imported vars are text/foo.
    if (aliasName.indexOf("text/text-") === 0) {
        candidates.push(`text/${aliasName.slice("text/text-".length)}`);
    }
    // Some functional refs point to *-disabled variants that are not present in light/dark sources.
    // Fallback to the base token name to keep alias linking instead of leaving hardcoded values.
    if (aliasName.endsWith("-disabled")) {
        candidates.push(aliasName.slice(0, -"-disabled".length));
    }
    if (aliasName.endsWith("/disabled")) {
        candidates.push(aliasName.slice(0, -"/disabled".length));
    }
    const uniq = [];
    for (let i = 0; i < candidates.length; i++) {
        if (uniq.indexOf(candidates[i]) === -1)
            uniq.push(candidates[i]);
    }
    return uniq;
}
function findAliasTargetByName(aliasName, globalVarMap) {
    const candidates = aliasCandidates(aliasName);
    for (let i = 0; i < candidates.length; i++) {
        const target = globalVarMap.get(candidates[i]);
        if (target)
            return { variable: target, wasFallback: i > 0 };
    }
    return null;
}
// NOVÁ FUNKCE: Automaticky vygeneruje seznam overridů podle obsahu DTCG JSONu,
// takže už to nikdy nemusíš psát ručně.
function generateOverridesFromJSON(definitionsData) {
    const overrides = [];
    const flatTokens = [];
    flattenTokens(definitionsData, [], flatTokens);
    // Zajímají nás jen ty "functional" skupiny
    const allowedRoots = ["surfaces-functional", "text-colors-functional"];
    for (const token of flatTokens) {
        if (token.type !== "color")
            continue;
        const root = token.rawPath[0];
        let isAllowed = false;
        for (let i = 0; i < allowedRoots.length; i++) {
            if (root.indexOf(allowedRoots[i]) === 0) {
                isAllowed = true;
                break;
            }
        }
        if (!isAllowed)
            continue;
        const varName = transformName(token.rawPath, "theme");
        const val = token.value;
        let manualVal = null;
        if (typeof val === "string" && val.indexOf("{") === 0) {
            const ref = resolveRefName(val);
            manualVal = { alias: ref };
        }
        else if (typeof val === "string" && (val.startsWith("#") || val.length === 7 || val.length === 9)) {
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
function applyManualOverrides(overrides, ctx) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a;
        const stats = { created: 0, updated: 0, linked: 0, errors: 0, fallbacks: 0 };
        if (!overrides || overrides.length === 0)
            return stats;
        const getOrCreateCollection = (name) => {
            for (let i = 0; i < ctx.collections.length; i++) {
                if (ctx.collections[i].name === name)
                    return ctx.collections[i];
            }
            const c = figma.variables.createVariableCollection(name);
            ctx.collections.push(c);
            ctx.collectionsById.set(c.id, c);
            return c;
        };
        for (let i = 0; i < overrides.length; i++) {
            const def = overrides[i];
            try {
                const col = getOrCreateCollection(def.collection);
                let v = (_a = ctx.varByName.get(`${def.name}\0${col.id}`)) !== null && _a !== void 0 ? _a : null;
                if (!v) {
                    v = figma.variables.createVariable(def.name, col, def.resolvedType);
                    registerVar(ctx, v);
                    stats.created++;
                }
                else {
                    stats.updated++;
                }
                for (const modeName in def.values) {
                    if (!Object.prototype.hasOwnProperty.call(def.values, modeName))
                        continue;
                    const val = def.values[modeName];
                    const modeId = getOrCreateModeId(col, modeName);
                    if (!modeId)
                        continue;
                    if ("alias" in val) {
                        const result = findAliasTargetByName(val.alias, ctx.globalVarMap);
                        if (!result) {
                            stats.errors++;
                            continue;
                        }
                        if (result.variable.resolvedType !== v.resolvedType) {
                            stats.errors++;
                            continue;
                        }
                        v.setValueForMode(modeId, figma.variables.createVariableAlias(result.variable));
                        stats.linked++;
                        if (result.wasFallback)
                            stats.fallbacks++;
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
            }
            catch (e) {
                stats.errors++;
            }
        }
        return stats;
    });
}
// POMOCNÉ FUNKCE
// =====================================================
function hexToRgb(hex) {
    if (!hex)
        return { r: 0, g: 0, b: 0, a: 1 };
    hex = hex.replace("#", "").trim();
    let a = 1;
    if (hex.length === 8) {
        a = parseInt(hex.slice(6, 8), 16) / 255;
        hex = hex.slice(0, 6);
    }
    else if (hex.length === 3) {
        hex = hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2];
    }
    const r = parseInt(hex.substring(0, 2), 16) / 255;
    const g = parseInt(hex.substring(2, 4), 16) / 255;
    const b = parseInt(hex.substring(4, 6), 16) / 255;
    if (isNaN(r))
        return { r: 1, g: 0, b: 0, a: 1 };
    return { r, g, b, a };
}
function rgbToHex(value) {
    const toByte = (channel) => {
        const clamped = Math.max(0, Math.min(1, channel));
        return Math.round(clamped * 255);
    };
    const toHex = (channel) => {
        const hex = toByte(channel).toString(16);
        return hex.length === 1 ? `0${hex}` : hex;
    };
    return `#${toHex(value.r)}${toHex(value.g)}${toHex(value.b)}`.toLowerCase();
}
function normalizeHexString(value) {
    return `#${value.replace("#", "").trim().slice(0, 6).toLowerCase()}`;
}
function buildPaletteAliasCandidates(vars, collectionsById) {
    var _a;
    const candidates = [];
    for (let i = 0; i < vars.length; i++) {
        const variable = vars[i];
        const collection = collectionsById.get(variable.variableCollectionId);
        if (!collection || collection.name !== COLLECTIONS.PALETTE)
            continue;
        if (variable.resolvedType !== "COLOR")
            continue;
        const modeId = (_a = collection.modes[0]) === null || _a === void 0 ? void 0 : _a.modeId;
        if (!modeId)
            continue;
        const value = variable.valuesByMode[modeId];
        if (!value || typeof value !== "object" || !("r" in value))
            continue;
        candidates.push({
            hex: rgbToHex(value),
            name: variable.name,
            variable
        });
    }
    return candidates;
}
function findPaletteAliasTarget(rawPath, hexValue, candidates) {
    if (rawPath.indexOf("palette") === -1)
        return null;
    const hex = normalizeHexString(hexValue);
    const matches = candidates.filter((candidate) => candidate.hex === hex);
    if (matches.length === 0)
        return null;
    if (matches.length === 1)
        return matches[0].variable;
    let colorHint = "";
    const paletteIndex = rawPath.indexOf("palette");
    if (paletteIndex !== -1 && rawPath[paletteIndex + 1]) {
        colorHint = rawPath[paletteIndex + 1];
    }
    if (colorHint) {
        for (let i = 0; i < matches.length; i++) {
            if (matches[i].name.indexOf(`${colorHint}-`) === 0) {
                return matches[i].variable;
            }
        }
    }
    return matches[0].variable;
}
// =====================================================
// HLAVNÍ LOGIKA TVORBY NÁZVŮ (TRANSFORMACE)
// =====================================================
function transformName(path, type) {
    // 1. PALETTE (zůstává stejné)
    if (type === "palette") {
        if (path[0] === "palette")
            return `${path[1]}-${path[2]}`;
        if (path[0] === "palette-functional")
            return `${path[1]}/${path[2]}-${path[3]}`;
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
                const parts = path.filter(p => p !== root &&
                    p !== "functional" &&
                    p !== "default" &&
                    p !== foundGroup);
                return `surface/${foundGroup}/${parts.join("-")}`;
            }
            else {
                const parts = path.filter(p => p !== root &&
                    p !== "functional" &&
                    p !== "neutral" &&
                    p !== "palette" &&
                    p !== "default");
                return `surface/${parts.join("-")}`;
            }
        }
        // --- B) TEXT COLORS ---
        if (root.indexOf("text-colors") === 0) {
            if (path.indexOf("on-surface") !== -1) {
                const role = path[path.length - 1];
                const groupName = `${role}-on-surface`;
                const parts = path.filter(p => p !== root &&
                    p !== "functional" &&
                    p !== "on-surface" &&
                    p !== "palette" &&
                    p !== role);
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
                const parts = path.filter(p => p !== root &&
                    p !== "functional" &&
                    p !== "default" &&
                    p !== foundGroup);
                return `text/${foundGroup}/${parts.join("-")}`;
            }
            const parts = path.filter(p => p !== root &&
                p !== "neutral" &&
                p !== "palette" &&
                p !== "default");
            return `text/${parts.join("-")}`;
        }
        // --- C) BORDERS ---
        if (root.indexOf("borders") === 0) {
            let name = path[1];
            if (name.indexOf("inverted") !== -1)
                name = name.replace("inverted", "reversed");
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
function resolveRefName(ref) {
    const clean = ref.replace(/[{}]/g, "");
    const parts = clean.split(".");
    let type = "theme";
    if (parts[0].indexOf("palette") !== -1)
        type = "palette";
    else if (parts[0] === "radius")
        type = "radius";
    else if (parts[0] === "spacing")
        type = "spacing";
    return transformName(parts, type);
}
// DTCG $type dědičnost — branch nody předávají $type dolů potomkům bez vlastního $type
function flattenTokens(node, path, result, inheritedType) {
    var _a, _b;
    for (const key in node) {
        const item = node[key];
        const newPath = [...path, key];
        if (item && typeof item === "object" && "$value" in item) {
            result.push({ rawPath: newPath, value: item.$value, type: (_a = item.$type) !== null && _a !== void 0 ? _a : inheritedType });
        }
        else if (item && typeof item === "object" && !Array.isArray(item)) {
            flattenTokens(item, newPath, result, (_b = item.$type) !== null && _b !== void 0 ? _b : inheritedType);
        }
    }
}
// Vrátí modeId pro daný mód, nebo se pokusí mód vytvořit. Vrací null při selhání.
function getOrCreateModeId(collection, modeName) {
    const existing = collection.modes.find(m => m.name === modeName);
    if (existing)
        return existing.modeId;
    try {
        collection.addMode(modeName);
        const m = collection.modes.find(m => m.name === modeName);
        return m ? m.modeId : null;
    }
    catch (e) {
        return null;
    }
}
// =====================================================
// IMPORTÉR
// =====================================================
function importData(data, importMode, ctx) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a, _b;
        const flatTokens = [];
        flattenTokens(data, [], flatTokens);
        let stats = { created: 0, updated: 0, linked: 0, errors: 0, fallbacks: 0 };
        const getCollection = (name) => {
            let c = ctx.collections.find(x => x.name === name);
            if (!c) {
                c = figma.variables.createVariableCollection(name);
                c.renameMode(c.modes[0].modeId, name === COLLECTIONS.THEME ? "Light" : "Value");
                ctx.collections.push(c);
                ctx.collectionsById.set(c.id, c);
            }
            return c;
        };
        if (importMode === "definitions") {
            for (const token of flatTokens) {
                const root = token.rawPath[0];
                let targetCol = "";
                let type = null;
                if (root.indexOf("palette") !== -1) {
                    targetCol = COLLECTIONS.PALETTE;
                    type = "palette";
                }
                else if (root === "radius") {
                    targetCol = COLLECTIONS.RADIUS;
                    type = "radius";
                }
                else if (root === "spacing") {
                    targetCol = COLLECTIONS.SPACING;
                    type = "spacing";
                }
                else
                    continue;
                if (token.type === "shadow")
                    continue;
                const collection = getCollection(targetCol);
                const modeId = collection.modes[0].modeId;
                const varName = transformName(token.rawPath, type);
                let variable = (_a = ctx.varByName.get(`${varName}\0${collection.id}`)) !== null && _a !== void 0 ? _a : null;
                if (!variable) {
                    let varType = token.type === "color" ? "COLOR" : "FLOAT";
                    if (typeof token.value === "string" && token.value.indexOf("px") !== -1)
                        varType = "FLOAT";
                    try {
                        variable = figma.variables.createVariable(varName, collection, varType);
                        registerVar(ctx, variable);
                        stats.created++;
                    }
                    catch (e) {
                        stats.errors++;
                        continue;
                    }
                }
                else {
                    stats.updated++;
                }
                try {
                    if (typeof token.value === "string" && token.value.indexOf("{") === 0) {
                        const refName = resolveRefName(token.value);
                        const result = findAliasTargetByName(refName, ctx.globalVarMap);
                        if (result && variable.resolvedType === result.variable.resolvedType) {
                            variable.setValueForMode(modeId, figma.variables.createVariableAlias(result.variable));
                            stats.linked++;
                            if (result.wasFallback)
                                stats.fallbacks++;
                        }
                    }
                    else {
                        if (variable.resolvedType === "COLOR")
                            variable.setValueForMode(modeId, hexToRgb(token.value));
                        if (variable.resolvedType === "FLOAT")
                            variable.setValueForMode(modeId, parseFloat(token.value));
                    }
                }
                catch (e) { }
            }
        }
        else {
            const collection = getCollection(COLLECTIONS.THEME);
            let modeId = null;
            if (importMode === "light") {
                const m = collection.modes.find((x) => x.name === "Light") || collection.modes[0];
                if (m.name !== "Light")
                    collection.renameMode(m.modeId, "Light");
                modeId = m.modeId;
            }
            else {
                modeId = getOrCreateModeId(collection, "Dark");
                if (!modeId) {
                    figma.notify("Nelze přidat Dark mode");
                    return stats;
                }
            }
            const allowedRoots = ["surfaces", "surfaces-functional", "text-colors", "text-colors-functional", "borders", "overlays"];
            for (const token of flatTokens) {
                if (token.type === "shadow")
                    continue;
                let isAllowed = false;
                for (const r of allowedRoots) {
                    if (token.rawPath[0].indexOf(r) === 0) {
                        isAllowed = true;
                        break;
                    }
                }
                if (!isAllowed)
                    continue;
                const varName = transformName(token.rawPath, "theme");
                let variable = (_b = ctx.varByName.get(`${varName}\0${collection.id}`)) !== null && _b !== void 0 ? _b : null;
                if (!variable) {
                    try {
                        variable = figma.variables.createVariable(varName, collection, "COLOR");
                        registerVar(ctx, variable);
                        stats.created++;
                    }
                    catch (e) {
                        stats.errors++;
                        continue;
                    }
                }
                else {
                    stats.updated++;
                }
                try {
                    const val = token.value;
                    if (typeof val === "string" && val.indexOf("{") === 0) {
                        const refName = resolveRefName(val);
                        const result = findAliasTargetByName(refName, ctx.globalVarMap);
                        if (!result) {
                            const cleanRef = val.replace(/[{}]/g, "");
                            const rawFallback = ctx.rawToVarMap.get(cleanRef);
                            if (rawFallback) {
                                variable.setValueForMode(modeId, figma.variables.createVariableAlias(rawFallback));
                                stats.linked++;
                                stats.fallbacks++;
                            }
                        }
                        else {
                            variable.setValueForMode(modeId, figma.variables.createVariableAlias(result.variable));
                            stats.linked++;
                            if (result.wasFallback)
                                stats.fallbacks++;
                        }
                    }
                    else {
                        const paletteAliasTarget = typeof val === "string"
                            ? findPaletteAliasTarget(token.rawPath, val, ctx.paletteAliasCandidates)
                            : null;
                        if (paletteAliasTarget) {
                            variable.setValueForMode(modeId, figma.variables.createVariableAlias(paletteAliasTarget));
                            stats.linked++;
                        }
                        else {
                            variable.setValueForMode(modeId, hexToRgb(val));
                        }
                    }
                }
                catch (e) {
                    stats.errors++;
                }
            }
        }
        return stats;
    });
}
// =====================================================
// UI HANDLER
// =====================================================
figma.showUI(__html__, { width: 400, height: 330, themeColors: true });
figma.ui.onmessage = (msg) => __awaiter(void 0, void 0, void 0, function* () {
    if (msg.type === "run-automation") {
        const { definitions, light, dark } = msg.payload;
        const totalStats = { created: 0, updated: 0, linked: 0, errors: 0, fallbacks: 0 };
        const addStats = (s) => {
            totalStats.created += s.created;
            totalStats.updated += s.updated;
            totalStats.linked += s.linked;
            totalStats.errors += s.errors;
            totalStats.fallbacks += s.fallbacks;
        };
        // Jeden fetch na celý import
        const ctx = yield buildContext();
        if (definitions) {
            figma.ui.postMessage({ type: "status", message: "Importuji Definice..." });
            addStats(yield importData(definitions, "definitions", ctx));
        }
        if (light) {
            figma.ui.postMessage({ type: "status", message: "Importuji Light Mode..." });
            addStats(yield importData(light, "light", ctx));
        }
        if (dark) {
            figma.ui.postMessage({ type: "status", message: "Importuji Dark Mode..." });
            addStats(yield importData(dark, "dark", ctx));
        }
        if (definitions) {
            const generatedOverrides = generateOverridesFromJSON(definitions);
            if (generatedOverrides.length > 0) {
                figma.ui.postMessage({ type: "status", message: "Aplikuji automatizované doplňky z JSONu..." });
                addStats(yield applyManualOverrides(generatedOverrides, ctx));
            }
        }
        const fallbackNote = totalStats.fallbacks > 0 ? `, Fallbacky: ${totalStats.fallbacks}` : "";
        figma.notify(`Hotovo! Vytvořeno: ${totalStats.created}, Propojeno: ${totalStats.linked}${fallbackNote}`);
        figma.ui.postMessage({ type: "complete", message: "Hotovo!" });
    }
});
