# Video captions (WebVTT)

One `.vtt` per self-hosted video, named after the video file:
`assets/captions/<blog-post-slug>.vtt` for blog posts (picked up automatically
by `layouts/blog-post.njk` when the file exists) and the three homepage clips
(wired via `data-captions` in `index.njk`).

All 36 AM Northwest segments, plus the 3 homepage clips, now have captions.
Two sources, both disclosed in each file's own VTT `NOTE`:

**21 segments + the 3 homepage clips (2026-09-14):** YouTube's auto-generated
English captions for the same segment — KATU Lifestyle's uploads of the AM
Northwest segments, and the original uploads of the homepage clips. Our files
are KATU's web cut, which starts 0–10s earlier/later than the YouTube upload,
so each caption file was shifted by an offset found by cross-correlating the
captions' word timings against speech energy in our own video (checked
separately on each half of the video to rule out mid-segment edits).

**15 segments with no matching YouTube upload (2026-09-14):** transcribed
locally from the video's own audio with Whisper (large-v3, run via
mlx-whisper — nothing left this machine). The medium.en model produced
corrupted, content-dropping transcripts on several files (a decoding defect,
not an audio problem — confirmed by re-transcribing the same audio in
isolation); large-v3 was used for all 15 for consistency. Three of the
fifteen (`how-to-spot-authentic-art`, `a-chinese-snuff-bottle-and-jade-
collection`, `local-estate-sale-treasures`) still hit brief hallucination/
repetition-loop stretches even on large-v3; those spans were re-transcribed
in isolation (which breaks the runaway decoding context) and spliced back in
by hand — every file was then re-verified for dropped content, garbled
non-English fragments, and timing gaps before being converted to VTT.

Both sources are auto-generated and not hand-checked line-by-line; expect
occasional mis-hearings in either.
