# Zooming time-axis graphs

Drag horizontally across a plot to zoom into that range. A shaded rectangle
previews the selection; releasing the primary mouse button applies it. Either
drag direction works, and endpoints outside the plot clamp to its edges. Press
Escape before releasing to cancel. **Reset zoom** restores the original view;
further drags can narrow the range again.

This applies to all add-on calendar-axis line graphs (including Memorised,
Net Memorised per 100 Reviews, load history and daily maturation), their
candlestick Trend views, daily
FSRS/RWKV Recall Gap and Surprise, date-axis scrollable bars, Future Due, and
the hourly intraday Due and daily hourly breakdown charts. Numeric distributions and Anki's built-in charts
retain their existing interactions.

Ordinary clicks still open a bar's cards or select trend endpoints. A six-pixel
horizontal movement distinguishes a drag from a click. The release click is
suppressed after a drag so it cannot open the Browser or anchor a trend.
Dragging an existing trend's endpoint keeps editing that trend. Hover tooltips
and trend previews pause during a zoom drag. Drawn trends are retained when
zooming and resetting, including trends outside the visible range.

## Display and calculation boundaries

Zoom is local to the graph and the current mounted view; it adds no saved
configuration and does not request additional history. Other charts sharing
the usual Scroll store do not move when this graph is zoomed or panned inside
its zoom. Reset returns to the current unzoomed navigation values.

Line graphs crop the visible calendar domain and fit the vertical axis to
the visible data. Maturation's existing percentile setting still applies to
visible selected curves. Memorised, maturation, and daily prediction moving
averages are calculated before cropping, so history preceding the selected dates
continues to contribute. Missing daily
predictions remain gaps, including a zoom consisting entirely of missing days.
Both model series use the same selected domain while retaining their own
samples and tooltips.

Net Memorised per 100 Reviews also calculates its rolling ratio before zooming.
Its signed vertical axis includes a stronger zero reference so days where
collection-wide forgetting outweighed gains remain visible. With its moving
average enabled, the vertical axis follows the colored rolling-ratio series;
the grey raw series remains hoverable without expanding the scale. Disabling
the average restores raw-value scaling.

Bar and candlestick selections snap to whole displayed buckets and keep the
current Bar Width and aggregation method. Zooming reduces the visible bucket
count. Scroll fields and date-bar scrollbars then navigate that smaller window;
the scrollbar thumb reflects the new visible fraction. Counts, ratios, means,
medians, cumulative values, trend date ranges and bar-click queries use the
same aggregation path as before. Candlesticks adjust their starting cumulative
total when the window changes. The intraday Now marker is omitted when its
hour is outside the selected window.

## Verification

`test/dragZoom.test.ts` covers range selection, grouping, cumulative baselines,
both drag directions, click preservation, release-click suppression, trend
handles, Escape, clamping and listener cleanup. Renderer tests cover date
cropping, vertical rescaling, model alignment, missing days, and moving averages
using history before the zoom. The Svelte UI smoke checks Memorised Total and
Trend, retained trends, local bar zoom/pan/reset, grouped click targets, daily
smoothing controls, hourly bars, and numeric-axis exclusion. A browser smoke
checks the gesture with scaled SVG coordinates and Reset zoom.

Build with `npm run build`, package with `./package.sh`, and install with
`./copy_to_anki.sh`. Reopen Statistics to load this frontend change.
