# IMSLP Audio Similarity Web App

This app captures microphone audio in the browser and compares it against an IMSLP recording **live while recording**.

## Features

- Microphone recording using `MediaRecorder`
- Live similarity analysis updates during microphone capture
- IMSLP recording ingestion by:
  - Direct IMSLP URL (`imslp.org` / `petruccimusiclibrary.org`) via server proxy
  - Local audio file upload
- Browser-side similarity analysis:
  - Duration similarity
  - Energy-envelope cosine similarity
  - Onset alignment via normalized cross-correlation
- Combined live similarity score (0-100%)

## Run locally

```bash
node server.js
```

Then open: `http://localhost:3000`

You can also run:

```bash
npm start
```

## How to use

1. Load an IMSLP audio reference (URL or local file).
2. Click **Start Recording + Live Analysis**.
3. Speak/play/sing into your microphone.
4. Watch the live score update while recording.
5. Click **Stop Recording** when done.

## Notes

- Live scores fluctuate while recording and generally stabilize as more audio is analyzed.
- The current comparison is a lightweight baseline that runs fully in-browser.
- For production-grade matching, upgrade to MFCC/chroma extraction + DTW on backend infrastructure.
