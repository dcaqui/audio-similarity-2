const startBtn = document.getElementById('startRecording');
const stopBtn = document.getElementById('stopRecording');
const compareBtn = document.getElementById('compareButton');
const loadImslpUrlBtn = document.getElementById('loadImslpUrl');

const micStatus = document.getElementById('micStatus');
const imslpStatus = document.getElementById('imslpStatus');
const resultEl = document.getElementById('result');
const imslpUrlInput = document.getElementById('imslpUrl');
const imslpFileInput = document.getElementById('imslpFile');
const micPlayback = document.getElementById('micPlayback');
const imslpPlayback = document.getElementById('imslpPlayback');

let mediaRecorder;
let chunks = [];
let micBlob = null;
let imslpBlob = null;

startBtn.addEventListener('click', async () => {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    chunks = [];
    mediaRecorder = new MediaRecorder(stream);

    mediaRecorder.ondataavailable = (event) => {
      if (event.data.size > 0) chunks.push(event.data);
    };

    mediaRecorder.onstop = () => {
      micBlob = new Blob(chunks, { type: mediaRecorder.mimeType || 'audio/webm' });
      const url = URL.createObjectURL(micBlob);
      micPlayback.src = url;
      micStatus.textContent = `Microphone status: captured ${Math.round(micBlob.size / 1024)} KB`;
      stream.getTracks().forEach((track) => track.stop());
    };

    mediaRecorder.start();
    micStatus.textContent = 'Microphone status: recording...';
    startBtn.disabled = true;
    stopBtn.disabled = false;
  } catch (error) {
    micStatus.textContent = `Microphone error: ${error.message}`;
  }
});

stopBtn.addEventListener('click', () => {
  if (mediaRecorder && mediaRecorder.state !== 'inactive') {
    mediaRecorder.stop();
  }
  startBtn.disabled = false;
  stopBtn.disabled = true;
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
    imslpStatus.textContent = `IMSLP source: loaded from URL (${Math.round(imslpBlob.size / 1024)} KB)`;
  } catch (error) {
    imslpStatus.textContent = `IMSLP source error: ${error.message}`;
  }
});

imslpFileInput.addEventListener('change', () => {
  const [file] = imslpFileInput.files;
  if (!file) return;

  imslpBlob = file;
  imslpPlayback.src = URL.createObjectURL(file);
  imslpStatus.textContent = `IMSLP source: local file ${file.name} (${Math.round(file.size / 1024)} KB)`;
});

compareBtn.addEventListener('click', async () => {
  if (!micBlob) {
    resultEl.textContent = 'Please record microphone audio first.';
    return;
  }

  if (!imslpBlob) {
    resultEl.textContent = 'Please load an IMSLP recording first (URL or file).';
    return;
  }

  resultEl.textContent = 'Comparing...';

  try {
    const [micPcm, imslpPcm] = await Promise.all([blobToPCM(micBlob), blobToPCM(imslpBlob)]);

    const alignedMic = normalizeAndResample(micPcm, 16000);
    const alignedImslp = normalizeAndResample(imslpPcm, 16000);

    const envelopeMic = buildEnergyEnvelope(alignedMic, 1024, 512);
    const envelopeImslp = buildEnergyEnvelope(alignedImslp, 1024, 512);

    const durationSimilarity = compareDurations(alignedMic.length, alignedImslp.length, 16000);
    const envelopeSimilarity = cosineSimilarity(envelopeMic, envelopeImslp);
    const onsetSimilarity = maxNormalizedCrossCorrelation(envelopeMic, envelopeImslp, 50);

    const combinedScore = Math.max(
      0,
      Math.min(1, durationSimilarity * 0.2 + envelopeSimilarity * 0.5 + onsetSimilarity * 0.3)
    );

    resultEl.textContent = [
      `Similarity score: ${(combinedScore * 100).toFixed(2)}%`,
      `Duration similarity: ${(durationSimilarity * 100).toFixed(2)}%`,
      `Energy-envelope similarity: ${(envelopeSimilarity * 100).toFixed(2)}%`,
      `Onset alignment similarity: ${(onsetSimilarity * 100).toFixed(2)}%`,
      '',
      'Notes:',
      '- This is a lightweight browser-side similarity metric using energy envelopes and alignment.',
      '- For high-precision music matching, replace this with MFCC/chroma + DTW on a backend pipeline.'
    ].join('\n');
  } catch (error) {
    resultEl.textContent = `Comparison failed: ${error.message}`;
  }
});

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

function buildEnergyEnvelope(samples, windowSize, hopSize) {
  if (samples.length < windowSize) return new Float32Array([0]);
  const frameCount = Math.floor((samples.length - windowSize) / hopSize) + 1;
  const envelope = new Float32Array(frameCount);

  for (let frame = 0; frame < frameCount; frame += 1) {
    const start = frame * hopSize;
    let sum = 0;
    for (let i = 0; i < windowSize; i += 1) {
      const x = samples[start + i];
      sum += x * x;
    }
    envelope[frame] = Math.sqrt(sum / windowSize);
  }

  return envelope;
}

function compareDurations(lenA, lenB, sampleRate) {
  const secA = lenA / sampleRate;
  const secB = lenB / sampleRate;
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
