# Bar chart navigation

Charts built with `BarScrollable` include a draggable horizontal scrollbar
directly below the x-axis whenever the loaded domain is wider than the current
window. The scrollbar aligns with the plot and its thumb represents the visible
fraction of the domain. The existing numeric **Scroll** and **Bar Width** fields
remain available.

Dragging updates the current offset and redraws the existing bars. Editing
**Scroll** updates the scrollbar in return. Charts that already share a scroll
store keep moving together. Moving right follows increasing x-axis values:

- Left-aligned distributions start at the left and move toward larger values.
- Right-aligned charts start at the right. Moving left shows earlier buckets;
  moving right returns to the latest window.

The focused scrollbar supports the browser's native keyboard controls: arrow
keys move one source bucket, and Home/End reach either end. Its accessible name
is **Scroll x-axis**, with a tooltip explaining the controls. It is omitted
from printed output.

## Domain and grouping

The visible width remains `bins × binSize` source buckets. Scrolling changes
the offset, not the bar width or aggregation method. Grouped counts, ratios,
means, medians, cumulative values, trend ranges, tooltips, and bar-click actions
continue through the same calculation path as numeric scrolling.

Left-aligned charts use their existing populated end, excluding trailing empty
buckets. Numeric axes keep their zero origin. Date axes omit empty padding
before the first review while retaining intervening gaps and quiet days up to
the end of the loaded history. Date axes are identified by `trend_date_axis` or
the shared `barDateLabeler`. Other right-aligned axes retain their full loaded
bucket domain.

The scrollbar covers the loaded domain only and does not request additional
history. The numeric field retains its previous behavior, including negative
offsets interpreted by magnitude and manually entered offsets beyond the data.
For such values, the scrollbar's displayed position is clamped to its nearest
end; dragging it chooses an offset within its available range. A range that fits
the entire window has no scrollbar.

No configuration setting, persisted data, database operation, dependency, or
prediction request is added. Standalone bars and candlestick charts keep their
existing navigation.

## Verification

`test/barScrollable.test.ts` covers distribution bounds, date padding, empty
data, retained gaps, and offset conversion in both directions. The Svelte UI
smoke flow checks numeric/shared-offset synchronization, grouped totals, click
targets, short ranges, and date navigation. A browser check verifies pointer
dragging, arrow keys, Home/End, and plot alignment.

Build with `npm run build`, package with `./package.sh`, and install with
`./copy_to_anki.sh`. Reopening Statistics loads the updated frontend.
