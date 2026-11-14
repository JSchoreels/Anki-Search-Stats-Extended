# History graphs

Time Machine offers a pie chart for one day and a stacked bar chart across days.
Both count Mature, Young, Learning, Relearning, Suspended, and New cards. Learning
is part of the intraday count and is subtracted once when deriving New cards.
The total added count includes suspended cards. Bar legends hide or restore a
state; percentage mode divides by the total of the visible states.

Introduced cards shows an average per day for the displayed range. The average
includes days with zero introductions and follows the visible legend entries.

Load excludes cram reviews that do not reschedule the card. Such reviews leave
the preceding scheduled interval intact. An interval immediately followed by a
reset contributes no load until the card is introduced again. These rules also
apply to changes in daily load.

Lapses per 100 days divides each current card's stored lapse count by the
completed days since its latest introduction or reintroduction after Forget,
then multiplies by 100 and groups by the integer part. Cards introduced today,
awaiting reintroduction, or lacking an introduction in the loaded history have
no rate. The suspended-card control filters the same population as the other
lapse graphs. The result depends on the loaded history and current lapse count.

Average Load by Lapses and Average Load by Repetitions use the current load of
each reviewed card (`1 / interval`, or 1 for a non-positive interval). Wider
bars average the individual cards in the whole range instead of averaging
bucket averages. Average Repetitions by Lapses follows the same rule, with an
optional per-card repetitions / (lapses + 1) view. These averages use bars
because adding averages as pie slices would give misleading totals.

Custom trends remain visible when changing the Memorised graph's display mode
in the current session. Pinned trends keep their existing mode-specific storage
keys; switching modes does not migrate or delete saved pins.
