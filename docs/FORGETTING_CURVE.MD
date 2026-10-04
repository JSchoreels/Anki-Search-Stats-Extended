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

FSRS-7 parameter arrays (length `34`) use upstream's dual-trace curve. Each rating's fitted first-review state uses that rating's initial difficulty and the model's initialized fast/slow stability ratio. Fitting scales both traces together; it does not use the evolved state of an existing learned card.

## Short-term Curve Model

- Output key: `forgetting_curve_decay`
- The first short-term graph uses the same selected/averaged preset model as the long-term graph, with averaged decay as the fallback.
- Its samples and displayed fitted stability are in minutes. Model evaluation converts both elapsed time and fitted stability to days, preserving the FSRS-7 first-review trace ratio and rating-specific difficulty.
- Curve fitting, RMSE calculation, and rendered prediction lines share the same evaluator and time-unit conversion.
