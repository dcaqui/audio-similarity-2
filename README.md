# IMSLP Audio Similarity Web App

This app captures microphone audio in the browser and compares it against an IMSLP recording.

## Features

- Microphone recording using `MediaRecorder`
- IMSLP recording ingestion by:
  - Direct IMSLP URL (`imslp.org` / `petruccimusiclibrary.org`) via server proxy
  - Local audio file upload
- Browser-side similarity analysis:
  - Duration similarity
  - Energy-envelope cosine similarity
  - Onset alignment via normalized cross-correlation
- Combined similarity score (0-100%)

## Run

```bash
node server.js
```

Then open: `http://localhost:3000`

## Notes

- The current comparison is a lightweight baseline that runs fully in-browser.
- For production-grade matching, upgrade to MFCC/chroma extraction + DTW on backend infrastructure.
