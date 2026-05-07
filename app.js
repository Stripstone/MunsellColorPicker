(() => {
  'use strict';

  const DEFAULT_RGB = [86, 70, 51];
  const DEFAULT_ADJUSTMENTS = { hue: 0, value: 0, chroma: 0 };
  const SAMPLE_RADIUS_CSS = 30;

  const HUE_FAMILIES = [
    { family: 'R', angle: 5 },
    { family: 'YR', angle: 35 },
    { family: 'Y', angle: 58 },
    { family: 'GY', angle: 90 },
    { family: 'G', angle: 125 },
    { family: 'BG', angle: 180 },
    { family: 'B', angle: 230 },
    { family: 'PB', angle: 260 },
    { family: 'P', angle: 292 },
    { family: 'RP', angle: 330 },
  ];

  const els = {
    liveModeBtn: document.getElementById('liveModeBtn'),
    photoModeBtn: document.getElementById('photoModeBtn'),
    clearAdjustmentsBtn: document.getElementById('clearAdjustmentsBtn'),
    videoPreview: document.getElementById('videoPreview'),
    photoPreview: document.getElementById('photoPreview'),
    scratchCanvas: document.getElementById('scratchCanvas'),
    cameraPanel: document.querySelector('.camera-panel'),
    cameraLabel: document.getElementById('cameraLabel'),
    cameraPlaceholder: document.getElementById('cameraPlaceholder'),
    sampleRing: document.getElementById('sampleRing'),
    sampleHelp: document.getElementById('sampleHelp'),
    photoInput: document.getElementById('photoInput'),
    munsellCode: document.getElementById('munsellCode'),
    munsellSubline: document.getElementById('munsellSubline'),
    sampleQuality: document.getElementById('sampleQuality'),
    sliderHeaderStatus: document.getElementById('sliderHeaderStatus'),
    hueSlider: document.getElementById('hueSlider'),
    valueSlider: document.getElementById('valueSlider'),
    chromaSlider: document.getElementById('chromaSlider'),
    hueValue: document.getElementById('hueValue'),
    valueValue: document.getElementById('valueValue'),
    chromaValue: document.getElementById('chromaValue'),
    hueHelper: document.getElementById('hueHelper'),
    valueHelper: document.getElementById('valueHelper'),
    chromaHelper: document.getElementById('chromaHelper'),
    clumpStopLight: document.getElementById('clumpStopLight'),
    clumpStopMid: document.getElementById('clumpStopMid'),
    clumpStopDark: document.getElementById('clumpStopDark'),
  };

  const state = {
    mode: 'Live',
    stream: null,
    photoObjectUrl: null,
    sampledRgb: null,
    rawSampleQuality: null,
    samplePoint: null,
    adjustments: { ...DEFAULT_ADJUSTMENTS },
  };

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function rgbToHsl(r, g, b) {
    r /= 255;
    g /= 255;
    b /= 255;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    let h = 0;
    let s = 0;
    const l = (max + min) / 2;

    if (max !== min) {
      const d = max - min;
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
      if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
      else if (max === g) h = (b - r) / d + 2;
      else h = (r - g) / d + 4;
      h *= 60;
    }

    return { h, s: s * 100, l: l * 100 };
  }

  function hslToRgb(h, s, l) {
    h = ((h % 360) + 360) % 360;
    s /= 100;
    l /= 100;
    const c = (1 - Math.abs(2 * l - 1)) * s;
    const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
    const m = l - c / 2;
    let r = 0;
    let g = 0;
    let b = 0;

    if (h < 60) [r, g, b] = [c, x, 0];
    else if (h < 120) [r, g, b] = [x, c, 0];
    else if (h < 180) [r, g, b] = [0, c, x];
    else if (h < 240) [r, g, b] = [0, x, c];
    else if (h < 300) [r, g, b] = [x, 0, c];
    else [r, g, b] = [c, 0, x];

    return [
      Math.round((r + m) * 255),
      Math.round((g + m) * 255),
      Math.round((b + m) * 255),
    ];
  }

  function hueDistance(a, b) {
    const diff = Math.abs(a - b) % 360;
    return Math.min(diff, 360 - diff);
  }

  function approximateMunsell(rgb, adjustments) {
    const base = rgbToHsl(rgb[0], rgb[1], rgb[2]);
    const h = (base.h + adjustments.hue + 360) % 360;
    const s = clamp(base.s + adjustments.chroma, 0, 100);
    const l = clamp(base.l + adjustments.value, 4, 92);

    const nearest = HUE_FAMILIES.reduce(
      (best, candidate) => {
        const distance = hueDistance(h, candidate.angle);
        return distance < best.distance ? { ...candidate, distance } : best;
      },
      { family: 'YR', angle: 35, distance: 999 }
    );

    const normalizedDelta = ((h - nearest.angle + 540) % 360) - 180;
    let hueStep = 10;
    if (normalizedDelta < -10) hueStep = 2.5;
    else if (normalizedDelta < -2) hueStep = 5;
    else if (normalizedDelta < 7) hueStep = 7.5;

    const value = clamp(Math.round((l / 100) * 8.5), 1, 8);
    const chroma = clamp(Math.round((s / 100) * 8.5), 0, 8);
    const adjustedRgb = hslToRgb(h, s, l);

    return {
      label: `${hueStep}${nearest.family} ${value}/${chroma}`,
      hue: `${hueStep}${nearest.family}`,
      value,
      chroma,
      adjustedRgb,
    };
  }

  function rgbCss(rgb) {
    return `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`;
  }

  function shade(rgb, delta) {
    return rgb.map((channel) => clamp(channel + delta, 0, 255));
  }

  function heavyCorrection(adjustments) {
    return Math.abs(adjustments.hue) > 18 || Math.abs(adjustments.value) > 16 || Math.abs(adjustments.chroma) > 18;
  }

  function sampleQualityFor(rgb, metrics, adjustments) {
    if (!rgb) return { label: 'no sample yet', tone: 'neutral' };
    const hsl = rgbToHsl(rgb[0], rgb[1], rgb[2]);
    if (hsl.l < 12) return { label: 'low-light sample', tone: 'warn' };
    if (hsl.l > 82) return { label: 'bright sample', tone: 'warn' };
    if (metrics?.variance > 38) return { label: 'mixed color area', tone: 'warn' };
    if (heavyCorrection(adjustments)) return { label: 'heavily adjusted', tone: 'warn' };
    return { label: 'sample selected', tone: 'neutral' };
  }

  function parsePointer(event) {
    const pointer = event.touches?.[0] || event.changedTouches?.[0] || event;
    return { clientX: pointer.clientX, clientY: pointer.clientY };
  }

  function setActiveMode(mode) {
    state.mode = mode;
    els.liveModeBtn.classList.toggle('active', mode === 'Live');
    els.photoModeBtn.classList.toggle('active', mode === 'Photo');
    els.videoPreview.classList.toggle('visible', mode === 'Live');
    els.photoPreview.classList.toggle('visible', mode === 'Photo' && Boolean(els.photoPreview.src));
    els.cameraLabel.textContent = mode === 'Live' ? 'Live camera · tap to collect color' : 'Temporary photo · tap to collect color';
    updatePlaceholder();
  }

  function updatePlaceholder() {
    const hasLive = state.mode === 'Live' && els.videoPreview.readyState >= 2;
    const hasPhoto = state.mode === 'Photo' && Boolean(els.photoPreview.src);
    els.cameraPlaceholder.classList.toggle('visible', !hasLive && !hasPhoto);
  }

  async function startCamera() {
    if (!navigator.mediaDevices?.getUserMedia) {
      setActiveMode('Photo');
      els.cameraPlaceholder.querySelector('strong').textContent = 'Camera unavailable';
      els.cameraPlaceholder.querySelector('span').textContent = 'This browser does not expose camera access. Choose Photo instead.';
      return;
    }

    try {
      stopCamera();
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: 'environment' },
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
        audio: false,
      });
      state.stream = stream;
      els.videoPreview.srcObject = stream;
      await els.videoPreview.play();
      setActiveMode('Live');
      updatePlaceholder();
    } catch (error) {
      console.warn('Camera start failed:', error);
      setActiveMode('Photo');
      els.cameraPlaceholder.querySelector('strong').textContent = 'Camera permission needed';
      els.cameraPlaceholder.querySelector('span').textContent = 'Use HTTPS/GitHub Pages and allow camera access, or choose Photo.';
      els.photoInput.click();
    }
  }

  function stopCamera() {
    if (state.stream) {
      for (const track of state.stream.getTracks()) track.stop();
      state.stream = null;
    }
    els.videoPreview.srcObject = null;
  }

  function loadPhoto(file) {
    if (!file) return;
    if (state.photoObjectUrl) URL.revokeObjectURL(state.photoObjectUrl);
    state.photoObjectUrl = URL.createObjectURL(file);
    els.photoPreview.onload = () => updatePlaceholder();
    els.photoPreview.src = state.photoObjectUrl;
    setActiveMode('Photo');
  }

  function getSourceElement() {
    if (state.mode === 'Live') return els.videoPreview;
    if (state.mode === 'Photo' && els.photoPreview.src) return els.photoPreview;
    return null;
  }

  function getMediaDimensions(element) {
    if (element === els.videoPreview) {
      return { width: element.videoWidth || 0, height: element.videoHeight || 0 };
    }
    return { width: element.naturalWidth || 0, height: element.naturalHeight || 0 };
  }

  function getSourceMapping(element, clientX, clientY) {
    const rect = els.cameraPanel.getBoundingClientRect();
    const dims = getMediaDimensions(element);
    if (!dims.width || !dims.height) return null;

    const scale = Math.max(rect.width / dims.width, rect.height / dims.height);
    const renderedWidth = dims.width * scale;
    const renderedHeight = dims.height * scale;
    const offsetX = (rect.width - renderedWidth) / 2;
    const offsetY = (rect.height - renderedHeight) / 2;
    const localX = clientX - rect.left;
    const localY = clientY - rect.top;
    const sourceX = (localX - offsetX) / scale;
    const sourceY = (localY - offsetY) / scale;

    return {
      sourceX: clamp(sourceX, 0, dims.width - 1),
      sourceY: clamp(sourceY, 0, dims.height - 1),
      sourceRadius: SAMPLE_RADIUS_CSS / scale,
      localX,
      localY,
      width: dims.width,
      height: dims.height,
    };
  }

  function collectSample(event) {
    const source = getSourceElement();
    if (!source) {
      if (state.mode === 'Photo') els.photoInput.click();
      return;
    }

    const point = parsePointer(event);
    const mapping = getSourceMapping(source, point.clientX, point.clientY);
    if (!mapping) return;

    const canvas = els.scratchCanvas;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    canvas.width = mapping.width;
    canvas.height = mapping.height;
    ctx.drawImage(source, 0, 0, mapping.width, mapping.height);

    const sample = sampleCircle(ctx, mapping.sourceX, mapping.sourceY, mapping.sourceRadius, mapping.width, mapping.height);
    if (!sample) return;

    state.sampledRgb = sample.rgb;
    state.rawSampleQuality = sample.metrics;
    state.samplePoint = { x: mapping.localX, y: mapping.localY };
    state.adjustments = { ...DEFAULT_ADJUSTMENTS };
    updateSliderValues();
    updateSampleRing();
    updateUi();
  }

  function sampleCircle(ctx, cx, cy, radius, width, height) {
    const x0 = Math.floor(clamp(cx - radius, 0, width - 1));
    const y0 = Math.floor(clamp(cy - radius, 0, height - 1));
    const x1 = Math.ceil(clamp(cx + radius, 0, width - 1));
    const y1 = Math.ceil(clamp(cy + radius, 0, height - 1));
    const boxW = Math.max(1, x1 - x0 + 1);
    const boxH = Math.max(1, y1 - y0 + 1);
    const imageData = ctx.getImageData(x0, y0, boxW, boxH);
    const pixels = [];
    const radiusSq = radius * radius;

    for (let y = 0; y < boxH; y += 1) {
      for (let x = 0; x < boxW; x += 1) {
        const sourceX = x0 + x;
        const sourceY = y0 + y;
        const dx = sourceX - cx;
        const dy = sourceY - cy;
        if (dx * dx + dy * dy > radiusSq) continue;

        const i = (y * boxW + x) * 4;
        const r = imageData.data[i];
        const g = imageData.data[i + 1];
        const b = imageData.data[i + 2];
        const a = imageData.data[i + 3];
        if (a < 255) continue;

        const hsl = rgbToHsl(r, g, b);
        // Remove obvious glare/black-edge outliers, but keep normal soil variation.
        if (hsl.l < 3 || hsl.l > 97) continue;
        pixels.push([r, g, b]);
      }
    }

    if (pixels.length < 10) return null;

    const mean = pixels.reduce((acc, pixel) => {
      acc[0] += pixel[0];
      acc[1] += pixel[1];
      acc[2] += pixel[2];
      return acc;
    }, [0, 0, 0]).map((total) => total / pixels.length);

    const distances = pixels.map((pixel) => Math.sqrt(
      Math.pow(pixel[0] - mean[0], 2) + Math.pow(pixel[1] - mean[1], 2) + Math.pow(pixel[2] - mean[2], 2)
    ));
    const variance = distances.reduce((sum, d) => sum + d, 0) / distances.length;

    // One pass of outlier rejection for mixed flecks/glare.
    const filtered = pixels.filter((_, index) => distances[index] <= variance * 1.65 + 8);
    const finalPixels = filtered.length >= 10 ? filtered : pixels;
    const finalMean = finalPixels.reduce((acc, pixel) => {
      acc[0] += pixel[0];
      acc[1] += pixel[1];
      acc[2] += pixel[2];
      return acc;
    }, [0, 0, 0]).map((total) => Math.round(total / finalPixels.length));

    return { rgb: finalMean, metrics: { variance, pixels: finalPixels.length } };
  }

  function updateSampleRing() {
    if (!state.samplePoint) {
      els.sampleRing.classList.remove('visible');
      return;
    }
    els.sampleRing.style.left = `${state.samplePoint.x}px`;
    els.sampleRing.style.top = `${state.samplePoint.y}px`;
    els.sampleRing.classList.add('visible');
  }

  function updateSliderValues() {
    els.hueSlider.value = String(state.adjustments.hue);
    els.valueSlider.value = String(state.adjustments.value);
    els.chromaSlider.value = String(state.adjustments.chroma);
  }

  function formatSliderValue(value) {
    const number = Number(value);
    return number > 0 ? `+${number}` : String(number);
  }

  function updateUi() {
    const rgb = state.sampledRgb || DEFAULT_RGB;
    const estimate = approximateMunsell(rgb, state.adjustments);
    const quality = sampleQualityFor(state.sampledRgb, state.rawSampleQuality, state.adjustments);

    els.munsellCode.textContent = state.sampledRgb ? estimate.label : '—';
    els.munsellSubline.textContent = state.sampledRgb ? 'approx camera color' : 'collect a color sample';
    els.sampleQuality.textContent = quality.label;
    els.sampleQuality.classList.toggle('warn', quality.tone === 'warn');
    els.sampleQuality.classList.toggle('neutral', quality.tone !== 'warn');
    els.sliderHeaderStatus.textContent = state.sampledRgb ? 'color estimate' : 'collect sample first';

    els.hueValue.textContent = formatSliderValue(state.adjustments.hue);
    els.valueValue.textContent = formatSliderValue(state.adjustments.value);
    els.chromaValue.textContent = formatSliderValue(state.adjustments.chroma);
    els.hueHelper.textContent = state.sampledRgb ? estimate.hue : '—';
    els.valueHelper.textContent = state.sampledRgb ? String(estimate.value) : '—';
    els.chromaHelper.textContent = state.sampledRgb ? `/${estimate.chroma}` : '—';

    updateClump(estimate.adjustedRgb);
  }

  function updateClump(rgb) {
    els.clumpStopLight.setAttribute('stop-color', rgbCss(shade(rgb, 36)));
    els.clumpStopMid.setAttribute('stop-color', rgbCss(rgb));
    els.clumpStopDark.setAttribute('stop-color', rgbCss(shade(rgb, -38)));
  }

  function clearAdjustments() {
    state.adjustments = { ...DEFAULT_ADJUSTMENTS };
    updateSliderValues();
    updateUi();
  }

  function bindEvents() {
    els.liveModeBtn.addEventListener('click', () => {
      setActiveMode('Live');
      startCamera();
    });

    els.photoModeBtn.addEventListener('click', () => {
      setActiveMode('Photo');
      els.photoInput.click();
    });

    els.clearAdjustmentsBtn.addEventListener('click', clearAdjustments);

    els.photoInput.addEventListener('change', (event) => {
      loadPhoto(event.target.files?.[0]);
      event.target.value = '';
    });

    els.cameraPanel.addEventListener('click', collectSample);
    els.cameraPanel.addEventListener('touchend', (event) => {
      event.preventDefault();
      collectSample(event);
    }, { passive: false });

    els.hueSlider.addEventListener('input', (event) => {
      state.adjustments.hue = Number(event.target.value);
      updateUi();
    });
    els.valueSlider.addEventListener('input', (event) => {
      state.adjustments.value = Number(event.target.value);
      updateUi();
    });
    els.chromaSlider.addEventListener('input', (event) => {
      state.adjustments.chroma = Number(event.target.value);
      updateUi();
    });

    els.videoPreview.addEventListener('loadedmetadata', updatePlaceholder);
    window.addEventListener('resize', updateSampleRing);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && state.mode === 'Live' && !state.stream) startCamera();
    });
  }

  function runSelfTests() {
    const checks = [];
    const add = (name, pass) => checks.push({ name, pass });
    add('clamp upper', clamp(12, 0, 10) === 10);
    add('clamp lower', clamp(-4, 0, 10) === 0);
    add('black HSL', JSON.stringify(rgbToHsl(0, 0, 0)) === JSON.stringify({ h: 0, s: 0, l: 0 }));
    add('valid RGB', hslToRgb(35, 30, 40).every((n) => Number.isInteger(n) && n >= 0 && n <= 255));
    add('Munsell label shape', /^\d+(\.5)?[A-Z]+ \d\/\d$/.test(approximateMunsell([86, 70, 51], DEFAULT_ADJUSTMENTS).label));
    add('quality warning for dark sample', sampleQualityFor([20, 18, 16], { variance: 3 }, DEFAULT_ADJUSTMENTS).tone === 'warn');
    const failing = checks.filter((check) => !check.pass);
    if (failing.length) console.warn('Self-tests failed:', failing);
    else console.info('Soil Color Sampler self-tests passed.');
  }

  bindEvents();
  runSelfTests();
  updateSliderValues();
  updateUi();
  startCamera();
})();
