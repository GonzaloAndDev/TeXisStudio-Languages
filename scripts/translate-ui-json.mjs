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
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return Object.entries(value).flatMap(([key, child]) =>
      flatten(child, prefix ? `${prefix}.${key}` : key),
    );
  }
  return [[prefix, value]];
}

function setPath(target, path, value) {
  const parts = path.split(".");
  let cursor = target;
  for (const part of parts.slice(0, -1)) {
    cursor[part] ??= {};
    cursor = cursor[part];
  }
  cursor[parts.at(-1)] = value;
}

function getPath(target, path) {
  return path.split(".").reduce((value, part) => value?.[part], target);
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

async function translateMissing(en, existing, target) {
  const out = {};
  const entries = flatten(en);
  const pending = [];
  let done = 0;

  for (const [path, value] of entries) {
    if (getPath(existing, path) !== undefined) continue;
    if (typeof value === "string") {
      pending.push({ path, value });
    } else {
      setPath(out, path, value);
    }
  }

  for (let start = 0; start < pending.length; start += 40) {
    const batch = pending.slice(start, start + 40);
    const translated = await translateBatch(batch, target);
    batch.forEach((item, index) => {
      assertPlaceholders(item.path, item.value, translated[index], target);
      setPath(out, item.path, translated[index]);
    });
    done += batch.length;
    if (done % 100 === 0) {
      console.log(`${target}: ${done}/${pending.length}`);
    }
  }

  return { additions: out, count: pending.length };
}

async function updateLocale(en, target, uiPath) {
  const existingText = await readFile(uiPath, "utf8");
  const existing = JSON.parse(existingText);
  const { additions, count } = await translateMissing(en, existing, target);
  if (count) await writeFile(uiPath, mergeMissingText(existingText, existing, additions));
  console.log(`${target}: added ${count} missing keys in ${uiPath}`);
}

async function updateLocaleFromFallback(en, fallback, target, uiPath) {
  const existingText = await readFile(uiPath, "utf8");
  const existing = JSON.parse(existingText);
  const additions = {};
  let count = 0;
  for (const [path, sourceValue] of flatten(en)) {
    if (getPath(existing, path) !== undefined) continue;
    const fallbackValue = getPath(fallback, path);
    if (fallbackValue === undefined) throw new Error(`${target}:${path}: missing from fallback locale`);
    if (typeof sourceValue === "string" && typeof fallbackValue === "string") {
      assertPlaceholders(path, sourceValue, fallbackValue, target);
    }
    setPath(additions, path, fallbackValue);
    count++;
  }
  if (count) await writeFile(uiPath, mergeMissingText(existingText, existing, additions));
  console.log(`${target}: added ${count} missing keys from Spanish fallback in ${uiPath}`);
}

async function main() {
  const includeExperimental = process.argv.includes("--include-experimental");
  const updateBundled = process.argv.includes("--bundled");
  const spanishFallback = process.argv.includes("--spanish-fallback");
  const requested = process.argv.slice(2).filter((arg) => !arg.startsWith("--"));
  const en = JSON.parse(await readFile(enPath, "utf8"));
  const es = JSON.parse(await readFile(esPath, "utf8"));
  const catalog = JSON.parse(await readFile(catalogPath, "utf8"));
  const catalogIds = catalog.packages.map((pkg) => pkg.id);
  const ids = requested.length ? requested : catalogIds;

  if (updateBundled) {
    for (const id of BUNDLED_TRANSLATABLE) {
      await updateLocale(en, id, join(bundledDir, `${id}.json`));
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
    if (spanishFallback) await updateLocaleFromFallback(en, es, id, uiPath);
    else await updateLocale(en, id, uiPath);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
