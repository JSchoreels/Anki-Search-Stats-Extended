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
