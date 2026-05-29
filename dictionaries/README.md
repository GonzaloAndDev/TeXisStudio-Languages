# TeXisStudio Official Dictionaries

This directory contains the official Hunspell dictionaries distributed by
`TeXisStudio-Languages` for native use inside TeXisStudio.

## Purpose

These files serve as the canonical spelling assets for:

- bundled app dictionaries already shipped in `TeXisStudio`
- downloadable spelling-only language packs
- full language packs that also include UI and LaTeX support

## Selection policy

The dictionaries vendored here must meet all of the following:

- open and redistributable source
- mature enough for academic writing
- compatible with Hunspell (`.aff` + `.dic`)
- stable URL or upstream package provenance

## Scope

Current coverage is intentionally focused on languages with mature Hunspell
resources and good value for academic writing:

- `en`, `es`, `fr`, `de`
- `pt-BR`, `ru`
- `it`, `nl`, `pl`, `cs`, `ro`, `tr`, `uk`, `sv`

## Non-Latin-script note

Some major languages remain outside this directory for now, even though they are
important globally, because TeXisStudio should not claim first-class Hunspell
support where tokenization, morphology, or upstream quality are still unclear:

- Chinese
- Japanese
- Hindi
- Thai
- indigenous Mexican languages

Those languages may still exist as UI/LaTeX packs, but not yet as official
Hunspell spelling packs.

## Provenance

Vendored dictionaries come from established open-source Hunspell-compatible
sources already used widely in the ecosystem. Upstream provenance is documented
in each language pack metadata and in the catalog entries that expose them.
