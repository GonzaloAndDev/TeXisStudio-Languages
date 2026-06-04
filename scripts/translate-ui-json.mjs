#!/usr/bin/env node

import { readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const workspace = join(root, "..");
const enPath = join(workspace, "TeXisStudio", "texis-app", "src", "i18n", "locales", "en.json");
const catalogPath = join(root, "catalog.json");

const LOCAL_BUNDLED = new Set(["es", "en", "fr", "de", "ja", "zh"]);

const GOOGLE_TARGETS = {
  "pt-BR": "pt",
  he: "iw",
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

async function translateLocale(en, target) {
  const out = {};
  const entries = flatten(en);
  const pending = [];
  let done = 0;

  for (const [path, value] of entries) {
    if (typeof value === "string") {
      pending.push({ path, value });
    } else {
      setPath(out, path, value);
    }
  }

  for (let start = 0; start < pending.length; start += 40) {
    const batch = pending.slice(start, start + 40);
    const translated = await translateBatch(batch, target);
    batch.forEach((item, index) => setPath(out, item.path, translated[index]));
    done += batch.length;
    if (done % 100 === 0) {
      console.log(`${target}: ${done}/${pending.length}`);
    }
  }

  return out;
}

async function main() {
  const includeExperimental = process.argv.includes("--include-experimental");
  const requested = process.argv.slice(2).filter((arg) => arg !== "--include-experimental");
  const en = JSON.parse(await readFile(enPath, "utf8"));
  const catalog = JSON.parse(await readFile(catalogPath, "utf8"));
  const remoteIds = catalog.packages
    .map((pkg) => pkg.id)
    .filter((id) => !LOCAL_BUNDLED.has(id));
  const ids = requested.length ? requested : remoteIds;

  for (const id of ids) {
    if (!remoteIds.includes(id)) {
      console.warn(`${id}: skipped; not a remote language in catalog.json`);
      continue;
    }
    if (UNSUPPORTED_BY_AUTOMATIC_MT.has(id) && !includeExperimental) {
      console.warn(`${id}: skipped; automatic translation support is not reliable for this language`);
      continue;
    }

    const locale = await translateLocale(en, id);
    const uiPath = join(root, "packs", id, "ui.json");
    await writeFile(uiPath, `${JSON.stringify(locale, null, 2)}\n`);
    console.log(`${id}: wrote ${uiPath}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
