const startBtn = document.getElementById('startRecording');
const stopBtn = document.getElementById('stopRecording');
const loadImslpUrlBtn = document.getElementById('loadImslpUrl');

const micStatus = document.getElementById('micStatus');
const imslpStatus = document.getElementById('imslpStatus');
const resultEl = document.getElementById('result');
const imslpUrlInput = document.getElementById('imslpUrl');
const imslpFileInput = document.getElementById('imslpFile');
const micPlayback = document.getElementById('micPlayback');
const imslpPlayback = document.getElementById('imslpPlayback');

const LIVE_INTERVAL_MS = 100;
const TARGET_SAMPLE_RATE = 16000;

let mediaRecorder;
let chunks = [];
let micBlob = null;
let imslpBlob = null;
let referenceAnalysis = null;

let activeStream = null;
let micAudioContext = null;
let micAnalyser = null;
let analysisTimer = null;
let micLiveEnvelope = [];

startBtn.addEventListener('click', async () => {
  if (!referenceAnalysis) {
    resultEl.textContent =
      'Load an IMSLP reference recording first. Live analysis needs a target audio to compare against.';
    return;
  }

  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    activeStream = stream;
    chunks = [];
    micLiveEnvelope = [];

    mediaRecorder = new MediaRecorder(stream);
    mediaRecorder.ondataavailable = (event) => {
      if (event.data.size > 0) chunks.push(event.data);
    };

    mediaRecorder.onstop = () => {
      micBlob = new Blob(chunks, { type: mediaRecorder.mimeType || 'audio/webm' });
      micPlayback.src = URL.createObjectURL(micBlob);
      micStatus.textContent = `Microphone status: captured ${Math.round(micBlob.size / 1024)} KB`;
    };

    micAudioContext = new AudioContext();
    const source = micAudioContext.createMediaStreamSource(stream);
    micAnalyser = micAudioContext.createAnalyser();
    micAnalyser.fftSize = 2048;
    source.connect(micAnalyser);

    analysisTimer = setInterval(runLiveAnalysisTick, LIVE_INTERVAL_MS);

    mediaRecorder.start(250);
    micStatus.textContent = 'Microphone status: recording + live analysis...';
    resultEl.textContent = 'Live comparison running...';
    startBtn.disabled = true;
    stopBtn.disabled = false;
  } catch (error) {
    micStatus.textContent = `Microphone error: ${error.message}`;
  }
});

stopBtn.addEventListener('click', async () => {
  if (analysisTimer) {
    clearInterval(analysisTimer);
    analysisTimer = null;
  }

  if (mediaRecorder && mediaRecorder.state !== 'inactive') {
    mediaRecorder.stop();
  }

  if (activeStream) {
    activeStream.getTracks().forEach((track) => track.stop());
    activeStream = null;
  }

  if (micAudioContext) {
    await micAudioContext.close();
    micAudioContext = null;
    micAnalyser = null;
  }

  startBtn.disabled = false;
  stopBtn.disabled = true;

  resultEl.textContent += '\n\nRecording stopped. Final live metrics shown above.';
});

loadImslpUrlBtn.addEventListener('click', async () => {
  const url = imslpUrlInput.value.trim();
  if (!url) {
    imslpStatus.textContent = 'IMSLP source: please enter a URL.';
    return;
  }

  imslpStatus.textContent = 'IMSLP source: loading from URL...';

  try {
    const response = await fetch(`/api/imslp-audio?url=${encodeURIComponent(url)}`);
    if (!response.ok) {
      const details = await response.json().catch(() => ({}));
      throw new Error(details.error || `Request failed (${response.status})`);
    }

    const type = response.headers.get('Content-Type') || 'audio/mpeg';
    imslpBlob = await response.blob();
    imslpBlob = new Blob([imslpBlob], { type });
    imslpPlayback.src = URL.createObjectURL(imslpBlob);

    await prepareReferenceAnalysis(imslpBlob);

    imslpStatus.textContent =
      `IMSLP source: loaded from URL (${Math.round(imslpBlob.size / 1024)} KB), ` +
      `reference envelope frames: ${referenceAnalysis.envelope.length}`;
    resultEl.textContent = 'Reference loaded. Start recording to see live similarity updates.';
  } catch (error) {
    imslpStatus.textContent = `IMSLP source error: ${error.message}`;
  }
});

imslpFileInput.addEventListener('change', async () => {
  const [file] = imslpFileInput.files;
  if (!file) return;

  try {
    imslpBlob = file;
    imslpPlayback.src = URL.createObjectURL(file);

    await prepareReferenceAnalysis(file);

    imslpStatus.textContent =
      `IMSLP source: local file ${file.name} (${Math.round(file.size / 1024)} KB), ` +
      `reference envelope frames: ${referenceAnalysis.envelope.length}`;
    resultEl.textContent = 'Reference loaded. Start recording to see live similarity updates.';
  } catch (error) {
    imslpStatus.textContent = `IMSLP source error: ${error.message}`;
  }
});

function runLiveAnalysisTick() {
  if (!micAnalyser || !referenceAnalysis) return;

  const frame = new Float32Array(micAnalyser.fftSize);
  micAnalyser.getFloatTimeDomainData(frame);

  let sum = 0;
  for (let i = 0; i < frame.length; i += 1) {
    sum += frame[i] * frame[i];
  }
  const rms = Math.sqrt(sum / frame.length);
  micLiveEnvelope.push(rms);

  const durationSimilarity = compareDurationsBySeconds(
    micLiveEnvelope.length * (LIVE_INTERVAL_MS / 1000),
    referenceAnalysis.durationSec
  );
  const envelopeSimilarity = cosineSimilarity(micLiveEnvelope, referenceAnalysis.envelope);
  const onsetSimilarity = maxNormalizedCrossCorrelation(micLiveEnvelope, referenceAnalysis.envelope, 8);

  const combinedScore = Math.max(
    0,
    Math.min(1, durationSimilarity * 0.2 + envelopeSimilarity * 0.5 + onsetSimilarity * 0.3)
  );

  resultEl.textContent = [
    'LIVE ANALYSIS (updates during recording)',
    `Frames analyzed: ${micLiveEnvelope.length}`,
    `Live similarity score: ${(combinedScore * 100).toFixed(2)}%`,
    `Duration similarity: ${(durationSimilarity * 100).toFixed(2)}%`,
    `Energy-envelope similarity: ${(envelopeSimilarity * 100).toFixed(2)}%`,
    `Onset alignment similarity: ${(onsetSimilarity * 100).toFixed(2)}%`,
    '',
    'Notes:',
    '- This live score compares the running microphone envelope against the selected IMSLP envelope.',
    '- Scores can fluctuate while you are still recording and stabilize as more audio arrives.'
  ].join('\n');
}

async function prepareReferenceAnalysis(blob) {
  const decoded = await blobToPCM(blob);
  const normalized = normalizeAndResample(decoded, TARGET_SAMPLE_RATE);
  const envelope = buildEnvelopeByInterval(normalized, TARGET_SAMPLE_RATE, LIVE_INTERVAL_MS);

  referenceAnalysis = {
    envelope,
    durationSec: normalized.length / TARGET_SAMPLE_RATE
  };
}

async function blobToPCM(blob) {
  const arrayBuffer = await blob.arrayBuffer();
  const audioContext = new AudioContext();
  try {
    const audioBuffer = await audioContext.decodeAudioData(arrayBuffer.slice(0));
    const channelData = audioBuffer.getChannelData(0);
    return { samples: Float32Array.from(channelData), sampleRate: audioBuffer.sampleRate };
  } finally {
    await audioContext.close();
  }
}

function normalizeAndResample(audio, targetRate) {
  const ratio = audio.sampleRate / targetRate;
  const outLength = Math.max(1, Math.floor(audio.samples.length / ratio));
  const out = new Float32Array(outLength);

  for (let i = 0; i < outLength; i += 1) {
    const srcPos = i * ratio;
    const left = Math.floor(srcPos);
    const right = Math.min(audio.samples.length - 1, left + 1);
    const frac = srcPos - left;
    out[i] = audio.samples[left] * (1 - frac) + audio.samples[right] * frac;
  }

  let peak = 1e-9;
  for (let i = 0; i < out.length; i += 1) {
    peak = Math.max(peak, Math.abs(out[i]));
  }
  for (let i = 0; i < out.length; i += 1) {
    out[i] /= peak;
  }

  return out;
}

function buildEnvelopeByInterval(samples, sampleRate, intervalMs) {
  const chunkSize = Math.max(1, Math.floor((sampleRate * intervalMs) / 1000));
  const frameCount = Math.max(1, Math.floor(samples.length / chunkSize));
  const envelope = new Float32Array(frameCount);

  for (let frame = 0; frame < frameCount; frame += 1) {
    const start = frame * chunkSize;
    const end = Math.min(samples.length, start + chunkSize);

    let sum = 0;
    for (let i = start; i < end; i += 1) {
      sum += samples[i] * samples[i];
    }

    const len = Math.max(1, end - start);
    envelope[frame] = Math.sqrt(sum / len);
  }

  return envelope;
}

function compareDurationsBySeconds(secA, secB) {
  const maxSec = Math.max(secA, secB);
  if (maxSec < 0.001) return 0;
  return 1 - Math.abs(secA - secB) / maxSec;
}

function cosineSimilarity(a, b) {
  const len = Math.min(a.length, b.length);
  if (len === 0) return 0;

  let dot = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < len; i += 1) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  if (normA <= 1e-12 || normB <= 1e-12) return 0;
  return dot / Math.sqrt(normA * normB);
}

function maxNormalizedCrossCorrelation(a, b, maxLag) {
  const len = Math.min(a.length, b.length);
  if (len === 0) return 0;

  let best = -1;
  for (let lag = -maxLag; lag <= maxLag; lag += 1) {
    let dot = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < len; i += 1) {
      const j = i + lag;
      if (j < 0 || j >= len) continue;
      const x = a[i];
      const y = b[j];
      dot += x * y;
      normA += x * x;
      normB += y * y;
    }

    if (normA > 1e-12 && normB > 1e-12) {
      const corr = dot / Math.sqrt(normA * normB);
      if (corr > best) best = corr;
    }
  }

  return Math.max(0, best);
}
