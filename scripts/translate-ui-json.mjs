#!/usr/bin/env node

import { readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const workspace = join(root, "..");
const enPath = join(workspace, "TeXisStudio", "texis-app", "src", "i18n", "locales", "en.json");
const esPath = join(workspace, "TeXisStudio", "texis-app", "src", "i18n", "locales", "es.json");
const bundledDir = join(workspace, "TeXisStudio", "texis-app", "src", "i18n", "locales");
const catalogPath = join(root, "catalog.json");

const BUNDLED_TRANSLATABLE = ["de", "fr", "ja", "pt-BR", "zh"];

const GOOGLE_TARGETS = {
  "pt-BR": "pt",
  he: "iw",
  nah: "nhe",
  tzh: "tzo",
};

const UNSUPPORTED_BY_AUTOMATIC_MT = new Set([
  "nah",
  "yua",
  "tzh",
  "mix",
  "zap",
]);

const PROTECTED_PATTERNS = [
  /\{\{[^}]+\}\}/g,
  /\{[A-Za-z_][A-Za-z0-9_.-]*\}/g,
  /<\/?[A-Za-z][^>]*>/g,
  /\\[A-Za-z]+\*?/g,
  /https?:\/\/[^\s]+/g,
  /\.[A-Za-z0-9_-]+/g,
  /\bTeXisStudio\b/g,
  /\bLaTeX\b/g,
  /\bXeLaTeX\b/g,
  /\bLuaLaTeX\b/g,
  /\bpdfLaTeX\b/g,
  /\bTectonic\b/g,
  /\bMiKTeX\b/g,
  /\bTeX Live\b/g,
  /\bBibTeX\b/g,
  /\bBiber\b/g,
  /\bamsmath\b/g,
  /\bbiblatex\b/g,
  /\bcircuitikz\b/g,
  /\blatexmk\b/g,
  /\bmhchem\b/g,
  /\bpgfplots\b/g,
  /\bTikZ\b/g,
  /\bxcolor\b/g,
  /\bCSL\b/g,
  /\bJSON\b/g,
  /\bYAML\b/g,
  /\bPDFs?\b/g,
  /\bDOI\b/g,
  /\bISBN\b/g,
  /\bURL\b/g,
  /\bGitHub\b/g,
  /\bHunspell\b/g,
  /\bLanguageTool\b/g,
  /\bAPA\b/g,
  /\bIEEE\b/g,
  /\bVancouver\b/g,
  /\bChicago\b/g,
  /\bMLA\b/g,
];

function flatten(value, prefix = "") {
  if (value && typeof value === "object") {
    return Object.entries(value).flatMap(([key, child]) =>
      flatten(child, prefix ? `${prefix}.${key}` : key),
    );
  }
  return [[prefix, value]];
}

function setPath(target, path, value) {
  const parts = path.split(".");
  let cursor = target;
  for (let index = 0; index < parts.length - 1; index++) {
    const part = parts[index];
    const nextPart = parts[index + 1];
    cursor[part] ??= /^\d+$/.test(nextPart) ? [] : {};
    cursor = cursor[part];
  }
  cursor[parts.at(-1)] = value;
}

function getPath(target, path) {
  return path.split(".").reduce((value, part) => value?.[part], target);
}

function selectPathsBySuffix(source, suffixes) {
  if (!suffixes.length) return source;
  const selected = {};
  for (const [path, value] of flatten(source)) {
    if (suffixes.some((suffix) => path === suffix || path.endsWith(`.${suffix}`))) {
      setPath(selected, path, value);
    }
  }
  return selected;
}

function placeholderSet(value) {
  if (typeof value !== "string") return [];
  return [...value.matchAll(/\{\{[^}]+\}\}/g)]
    .map((match) => match[0])
    .sort();
}

function assertPlaceholders(path, source, translated, target) {
  const expected = placeholderSet(source);
  const actual = placeholderSet(translated);
  if (JSON.stringify(expected) !== JSON.stringify(actual)) {
    throw new Error(`${target}:${path}: placeholder mismatch (${expected.join(", ")} != ${actual.join(", ")})`);
  }
}

function matchingBrace(text, start) {
  let depth = 0;
  let quoted = false;
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') quoted = false;
      continue;
    }
    if (ch === '"') quoted = true;
    else if (ch === "{") depth++;
    else if (ch === "}" && --depth === 0) return i;
  }
  throw new Error("Unmatched JSON object");
}

function childObjectStart(text, objectStart, key) {
  const end = matchingBrace(text, objectStart);
  let depth = 0;
  let quoted = false;
  let escaped = false;
  for (let i = objectStart + 1; i < end; i++) {
    const ch = text[i];
    if (quoted) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') quoted = false;
      continue;
    }
    if (ch === '"') {
      if (depth === 0) {
        const keyEnd = text.indexOf('"', i + 1);
        const candidate = JSON.parse(text.slice(i, keyEnd + 1));
        let colon = keyEnd + 1;
        while (/\s/.test(text[colon])) colon++;
        if (text[colon] === ":" && candidate === key) {
          colon++;
          while (/\s/.test(text[colon])) colon++;
          if (text[colon] !== "{") throw new Error(`${key} is not an object`);
          return colon;
        }
      }
      quoted = true;
    } else if (ch === "{" || ch === "[") depth++;
    else if (ch === "}" || ch === "]") depth--;
  }
  throw new Error(`Object key not found: ${key}`);
}

function appendObjectEntries(text, path, additions) {
  let start = text.indexOf("{");
  for (const key of path) start = childObjectStart(text, start, key);
  const close = matchingBrace(text, start);
  let insertion = close;
  while (insertion > start + 1 && /\s/.test(text[insertion - 1])) insertion--;
  const closingIndent = text.slice(text.lastIndexOf("\n", close) + 1, close);
  const inner = JSON.stringify(additions, null, 2).slice(2, -2);
  const adjusted = inner.split("\n").map((line) => closingIndent + line).join("\n");
  const comma = text.slice(start + 1, insertion).trim() ? "," : "";
  return `${text.slice(0, insertion)}${comma}\n${adjusted}\n${closingIndent}${text.slice(close)}`;
}

function mergeMissingText(text, existing, additions) {
  const groups = new Map();
  for (const [pathString, value] of flatten(additions)) {
    const path = pathString.split(".");
    let baseLength = path.length - 1;
    while (baseLength > 0) {
      const candidate = getPath(existing, path.slice(0, baseLength).join("."));
      if (candidate && typeof candidate === "object" && !Array.isArray(candidate)) break;
      baseLength--;
    }
    const base = path.slice(0, baseLength);
    const relativePath = path.slice(baseLength).join(".");
    const key = base.join(".");
    if (!groups.has(key)) groups.set(key, { base, additions: {} });
    setPath(groups.get(key).additions, relativePath, value);
  }
  let output = text.trimEnd();
  for (const group of [...groups.values()].sort((a, b) => b.base.length - a.base.length)) {
    output = appendObjectEntries(output, group.base, group.additions);
  }
  return `${output}\n`;
}

function protect(text) {
  const saved = [];
  let value = text;
  for (const pattern of PROTECTED_PATTERNS) {
    value = value.replace(pattern, (match) => {
      const token = `ZXQ${saved.length}QXZ`;
      saved.push(match);
      return token;
    });
  }
  return { value, saved };
}

function restore(text, saved) {
  let value = text;
  saved.forEach((original, index) => {
    value = value.replaceAll(`ZXQ${index}QXZ`, original);
    value = value.replaceAll(`ZXQ ${index} QXZ`, original);
  });
  return value;
}

async function fetchTranslation(value, target) {
  const params = new URLSearchParams({
    client: "gtx",
    sl: "en",
    tl: GOOGLE_TARGETS[target] ?? target,
    dt: "t",
    q: value,
  });
  const url = `https://translate.googleapis.com/translate_a/single?${params}`;
  const res = await fetch(url, {
    headers: {
      "User-Agent": "TeXisStudio-Languages-i18n/1.0",
    },
  });
  if (!res.ok) {
    throw new Error(`${target}: translation failed with ${res.status} ${res.statusText}`);
  }

  const json = await res.json();
  return Array.isArray(json?.[0])
    ? json[0].map((part) => part?.[0] ?? "").join("")
    : value;
}

async function translateOne(text, target) {
  if (!text.trim()) return text;

  const { value, saved } = protect(text);
  const translated = await fetchTranslation(value, target);
  return restore(translated, saved);
}

async function translatePreservingPlaceholders(text, target) {
  const parts = text.split(/(\{\{[^}]+\}\})/g);
  const translated = [];
  for (const part of parts) {
    translated.push(part.startsWith("{{") && part.endsWith("}}")
      ? part
      : await translateOne(part, target));
  }
  return translated.join("");
}

async function translateBatch(items, target) {
  const protectedItems = items.map(({ value }) => protect(value));
  const joined = protectedItems.map((item) => item.value).join("\n");
  const translated = await fetchTranslation(joined, target);
  const lines = translated.split(/\n/);

  if (lines.length !== items.length) {
    const fallback = [];
    for (const item of items) {
      fallback.push(await translateOne(item.value, target));
    }
    return fallback;
  }

  return lines.map((line, index) => restore(line, protectedItems[index].saved));
}

function needsRefresh(
  path,
  sourceValue,
  existingValue,
  refreshMatchingPrefixes,
  refreshAllMatching,
  repairPlaceholders,
) {
  if (existingValue === undefined) return true;
  if (
    (refreshAllMatching || refreshMatchingPrefixes.some((prefix) => path === prefix || path.startsWith(`${prefix}.`)))
    && existingValue === sourceValue
  ) return true;
  if (
    repairPlaceholders
    && typeof sourceValue === "string"
    && typeof existingValue === "string"
    && JSON.stringify(placeholderSet(sourceValue)) !== JSON.stringify(placeholderSet(existingValue))
  ) return true;
  return false;
}

async function translateMissing(
  en,
  existing,
  target,
  refreshMatchingPrefixes,
  refreshAllMatching,
  repairPlaceholders,
) {
  const out = {};
  const entries = flatten(en);
  const pending = [];
  let done = 0;
  let changed = 0;

  for (const [path, value] of entries) {
    if (!needsRefresh(
      path,
      value,
      getPath(existing, path),
      refreshMatchingPrefixes,
      refreshAllMatching,
      repairPlaceholders,
    )) continue;
    changed++;
    if (typeof value === "string") {
      pending.push({ path, value });
    } else {
      setPath(out, path, value);
    }
  }

  for (let start = 0; start < pending.length; start += 40) {
    const batch = pending.slice(start, start + 40);
    const translated = await translateBatch(batch, target);
    for (let index = 0; index < batch.length; index++) {
      const item = batch[index];
      let value = translated[index];
      if (JSON.stringify(placeholderSet(item.value)) !== JSON.stringify(placeholderSet(value))) {
        value = await translatePreservingPlaceholders(item.value, target);
      }
      assertPlaceholders(item.path, item.value, value, target);
      setPath(out, item.path, value);
    }
    done += batch.length;
    if (done % 100 === 0) {
      console.log(`${target}: ${done}/${pending.length}`);
    }
  }

  return { additions: out, count: changed };
}

async function updateLocale(
  en,
  target,
  uiPath,
  refreshMatchingPrefixes,
  refreshAllMatching,
  repairPlaceholders,
) {
  const existingText = await readFile(uiPath, "utf8");
  const existing = JSON.parse(existingText);
  const { additions, count } = await translateMissing(
    en,
    existing,
    target,
    refreshMatchingPrefixes,
    refreshAllMatching,
    repairPlaceholders,
  );
  if (count) {
    for (const [path, value] of flatten(additions)) setPath(existing, path, value);
    await writeFile(uiPath, `${JSON.stringify(existing, null, 2)}\n`);
  }
  console.log(`${target}: synchronized ${count} keys in ${uiPath}`);
}

async function updateLocaleFromFallback(
  en,
  fallback,
  target,
  uiPath,
  refreshMatchingPrefixes,
  refreshAllMatching,
  repairPlaceholders,
) {
  const existingText = await readFile(uiPath, "utf8");
  const existing = JSON.parse(existingText);
  const additions = {};
  let count = 0;
  for (const [path, sourceValue] of flatten(en)) {
    if (!needsRefresh(
      path,
      sourceValue,
      getPath(existing, path),
      refreshMatchingPrefixes,
      refreshAllMatching,
      repairPlaceholders,
    )) continue;
    const fallbackValue = getPath(fallback, path);
    if (fallbackValue === undefined) throw new Error(`${target}:${path}: missing from fallback locale`);
    if (typeof sourceValue === "string" && typeof fallbackValue === "string") {
      assertPlaceholders(path, sourceValue, fallbackValue, target);
    }
    setPath(additions, path, fallbackValue);
    count++;
  }
  if (count) {
    for (const [path, value] of flatten(additions)) setPath(existing, path, value);
    await writeFile(uiPath, `${JSON.stringify(existing, null, 2)}\n`);
  }
  console.log(`${target}: synchronized ${count} keys from Spanish fallback in ${uiPath}`);
}

async function main() {
  const includeExperimental = process.argv.includes("--include-experimental");
  const updateBundled = process.argv.includes("--bundled");
  const spanishFallback = process.argv.includes("--spanish-fallback");
  const repairPlaceholders = process.argv.includes("--repair-placeholders");
  const refreshAllMatching = process.argv.includes("--refresh-all-matching");
  const refreshMatchingPrefixes = process.argv
    .filter((arg) => arg.startsWith("--refresh-matching="))
    .map((arg) => arg.slice("--refresh-matching=".length));
  const sourceFileArg = process.argv.find((arg) => arg.startsWith("--source-file="));
  const targetDirArg = process.argv.find((arg) => arg.startsWith("--target-dir="));
  const fallbackFileArg = process.argv.find((arg) => arg.startsWith("--fallback-file="));
  const onlySuffixes = process.argv
    .filter((arg) => arg.startsWith("--only-suffix="))
    .map((arg) => arg.slice("--only-suffix=".length));
  const requested = process.argv.slice(2).filter((arg) => !arg.startsWith("--"));

  if (sourceFileArg || targetDirArg) {
    if (!sourceFileArg || !targetDirArg) {
      throw new Error("--source-file and --target-dir must be used together");
    }
    const sourcePath = sourceFileArg.slice("--source-file=".length);
    const targetDir = targetDirArg.slice("--target-dir=".length);
    const source = selectPathsBySuffix(
      JSON.parse(await readFile(sourcePath, "utf8")),
      onlySuffixes,
    );
    const fallback = fallbackFileArg
      ? selectPathsBySuffix(
          JSON.parse(await readFile(fallbackFileArg.slice("--fallback-file=".length), "utf8")),
          onlySuffixes,
        )
      : null;
    const ids = requested.length
      ? requested
      : (await import("node:fs/promises")).readdir(targetDir)
          .then((files) => files.filter((file) => file.endsWith(".json")).map((file) => file.slice(0, -5)));

    for (const id of await ids) {
      const targetPath = join(targetDir, `${id}.json`);
      if (fallback) {
        await updateLocaleFromFallback(
          source,
          fallback,
          id,
          targetPath,
          refreshMatchingPrefixes,
          refreshAllMatching,
          repairPlaceholders,
        );
      } else {
        await updateLocale(
          source,
          id,
          targetPath,
          refreshMatchingPrefixes,
          refreshAllMatching,
          repairPlaceholders,
        );
      }
    }
    return;
  }

  const en = JSON.parse(await readFile(enPath, "utf8"));
  const es = JSON.parse(await readFile(esPath, "utf8"));
  const catalog = JSON.parse(await readFile(catalogPath, "utf8"));
  const catalogIds = catalog.packages.map((pkg) => pkg.id);
  const ids = requested.length ? requested : catalogIds;

  if (updateBundled) {
    for (const id of BUNDLED_TRANSLATABLE) {
      await updateLocale(
        en,
        id,
        join(bundledDir, `${id}.json`),
        refreshMatchingPrefixes,
        refreshAllMatching,
        repairPlaceholders,
      );
    }
  }

  for (const id of ids) {
    if (!catalogIds.includes(id)) {
      console.warn(`${id}: skipped; not present in catalog.json`);
      continue;
    }
    if (UNSUPPORTED_BY_AUTOMATIC_MT.has(id) && !includeExperimental) {
      console.warn(`${id}: skipped; automatic translation support is not reliable for this language`);
      continue;
    }

    const uiPath = join(root, "packs", id, "ui.json");
    if (spanishFallback) {
      await updateLocaleFromFallback(
        en,
        es,
        id,
        uiPath,
        refreshMatchingPrefixes,
        refreshAllMatching,
        repairPlaceholders,
      );
    } else {
      await updateLocale(
        en,
        id,
        uiPath,
        refreshMatchingPrefixes,
        refreshAllMatching,
        repairPlaceholders,
      );
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
