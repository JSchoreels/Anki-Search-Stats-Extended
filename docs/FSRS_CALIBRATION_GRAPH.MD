# FSRS Calibration Graph Data Path

This document describes how FSRS parameters are read for graph computations, and the current compatibility constraint.

## Source Data

- Deck config data is read from Anki in [`__init__.py`](/Users/jschoreels/workspace/Anki-Search-Stats-Extended/__init__.py) through:
  - `mw.col.decks.all_config()`
  - injected as `SSEother.deck_configs`

## Parameter Selection Used By Graphs

- Shared selector: [`src/ts/fsrsParams.ts`](/Users/jschoreels/workspace/Anki-Search-Stats-Extended/src/ts/fsrsParams.ts)
- Used by:
  - [`src/ts/MemorisedBar.ts`](/Users/jschoreels/workspace/Anki-Search-Stats-Extended/src/ts/MemorisedBar.ts)
  - [`src/ts/revlogGraphs.ts`](/Users/jschoreels/workspace/Anki-Search-Stats-Extended/src/ts/revlogGraphs.ts)

Selection order:

1. `fsrsParams7`
2. `fsrsParams6`
3. `fsrsParams5`
4. `fsrsParams4`
5. `fsrsWeights`
6. `ts-fsrs` default parameters

Accepted parameter lengths are `17`, `19`, `21`, and `35`.

## FSRS7 Support

- This addon is wired to a local `ts-fsrs` fork that includes FSRS7 (35-parameter) support.
- FSRS7 parameter arrays from Anki (`fsrsParams7` length `35`) are now consumed directly by graph calculations.
