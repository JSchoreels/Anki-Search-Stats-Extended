# Forgetting Curve Data Path

This document describes how long-term and short-term forgetting curve models are sourced.

## Source Data

- Review/card data is processed in [`src/ts/revlogGraphs.ts`](/Users/jschoreels/workspace/Anki-Search-Stats-Extended/src/ts/revlogGraphs.ts).
- Deck FSRS parameters are selected with [`src/ts/fsrsParams.ts`](/Users/jschoreels/workspace/Anki-Search-Stats-Extended/src/ts/fsrsParams.ts).
- Selected deck context is injected as `SSEother.selected_deck_id` in [`__init__.py`](/Users/jschoreels/workspace/Anki-Search-Stats-Extended/__init__.py).

## Long-term Curve Model

- Output key: `forgetting_curve_long_term_model`
- Used by the first long-term forgetting curve in [`src/ts/categories/ForgettingCurveCategory.svelte`](/Users/jschoreels/workspace/Anki-Search-Stats-Extended/src/ts/categories/ForgettingCurveCategory.svelte).
- If `selected_deck_id` resolves to a preset, that preset's FSRS params are used directly for the long-term model.
- Otherwise, a fallback model is built from deck FSRS parameters for cards present in `forgetting_samples`.
- The dominant parameter-length group is averaged element-wise and used as the model.
- Fallback: average `card.data.decay` if no usable parameter group exists.

This allows FSRS7 parameter arrays (length `35`) to drive long-term curve predictions, including the FSRS7 dual-decay formula path in `ts-fsrs`.

## Short-term Curve Model

- Output key: `forgetting_curve_decay`
- Continues to use averaged per-card decay for existing short-term behavior.
