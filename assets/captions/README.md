# Video captions (WebVTT)

One `.vtt` per self-hosted video, named after the video file:
`assets/captions/<blog-post-slug>.vtt` for blog posts (picked up automatically
by `layouts/blog-post.njk` when the file exists) and the three homepage clips
(wired via `data-captions` in `index.njk`).

Source (2026-09-14): YouTube's auto-generated English captions for the same
segment — KATU Lifestyle's uploads of the AM Northwest segments, and the
original uploads of the homepage clips. Our files are KATU's web cut, which
starts 0–10s earlier/later than the YouTube upload, so each caption file was
shifted by an offset found by cross-correlating the captions' word timings
against speech energy in our own video (checked separately on each half of
the video to rule out mid-segment edits). Auto-captions contain occasional
mis-hearings; they are not hand-checked.

AM Northwest segments with no YouTube upload (no captions yet):
a-250k-music-collection-tips-for-appraising-your-collections,
a-chinese-snuff-bottle-and-jade-collection, antique-maps-and-telescopes,
clearing-out-your-parents-home, how-to-barter-like-a-pro,
how-to-find-value-in-vintage-clothing,
how-to-maximize-your-donations-of-goods-to-charities,
how-to-spot-authentic-art, local-estate-sale-treasures,
oscar-winner-s-memorabilia, owning-and-selling-ivory-laws-you-need-to-know,
valuable-oregon-art, what-are-your-heirlooms-really-worth,
what-to-look-for-in-estate-silver, and
what-your-vintage-holiday-d-cor-is-worth (a YouTube upload exists but is a
different edit that wouldn't align).
