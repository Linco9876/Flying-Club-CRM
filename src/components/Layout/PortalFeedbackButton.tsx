import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  Bug,
  Camera,
  Check,
  CheckCircle2,
  Crop,
  Eraser,
  Image as ImageIcon,
  Lightbulb,
  Loader2,
  MessageSquarePlus,
  MousePointer2,
  Palette,
  Pencil,
  RefreshCw,
  Send,
  ShieldCheck,
  Undo2,
  Upload,
  X,
} from 'lucide-react';
import { useLocation } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { supabase } from '../../lib/supabase';
import { getSupabaseFunctionErrorMessage } from '../../lib/supabaseFunctionErrors';
import {
  PORTAL_FEEDBACK_MAX_COMMENT_LENGTH,
  PORTAL_FEEDBACK_MAX_SCREENSHOT_BYTES,
  PORTAL_FEEDBACK_RECIPIENT_LABEL,
  PortalFeedbackCategory,
  canAccessPortalFeedback,
  createPortalFeedbackSubmissionId,
  estimateDataUrlBytes,
  formatFeedbackFileSize,
  validatePortalFeedbackComment,
} from '../../utils/portalFeedback';

type Point = { x: number; y: number };
type Selection = { x: number; y: number; width: number; height: number };
type Stroke = { points: Point[]; color: string; width: number };

interface FeedbackCapture {
  dataUrl: string;
  width: number;
  height: number;
  displaySurface: string;
}

const PEN_COLOURS = [
  { value: '#ef4444', label: 'Red' },
  { value: '#facc15', label: 'Yellow' },
  { value: '#2563eb', label: 'Blue' },
  { value: '#111827', label: 'Black' },
];

const CATEGORY_OPTIONS: Array<{
  value: PortalFeedbackCategory;
  label: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
}> = [
  { value: 'bug', label: 'Bug', description: 'Something is broken', icon: Bug },
  { value: 'improvement', label: 'Improvement', description: 'Something could work better', icon: Lightbulb },
  { value: 'other', label: 'Other', description: 'General portal feedback', icon: MessageSquarePlus },
];

const MAX_SCREENSHOT_SOURCE_BYTES = 20 * 1024 * 1024;
const SCREENSHOT_FILE_TYPES = ['image/png', 'image/jpeg', 'image/webp'];

const waitForPaint = () => new Promise<void>(resolve => {
  requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
});

const delay = (milliseconds: number) => new Promise(resolve => setTimeout(resolve, milliseconds));

const normaliseSelection = (start: Point, end: Point): Selection => ({
  x: Math.min(start.x, end.x),
  y: Math.min(start.y, end.y),
  width: Math.abs(end.x - start.x),
  height: Math.abs(end.y - start.y),
});

const drawStroke = (context: CanvasRenderingContext2D, stroke: Stroke) => {
  if (!stroke.points.length) return;
  context.save();
  context.strokeStyle = stroke.color;
  context.fillStyle = stroke.color;
  context.lineWidth = stroke.width;
  context.lineCap = 'round';
  context.lineJoin = 'round';
  if (stroke.points.length === 1) {
    context.beginPath();
    context.arc(stroke.points[0].x, stroke.points[0].y, stroke.width / 2, 0, Math.PI * 2);
    context.fill();
  } else {
    context.beginPath();
    context.moveTo(stroke.points[0].x, stroke.points[0].y);
    stroke.points.slice(1).forEach(point => context.lineTo(point.x, point.y));
    context.stroke();
  }
  context.restore();
};

const drawCapture = (
  canvas: HTMLCanvasElement,
  image: HTMLImageElement,
  strokes: Stroke[],
  selection?: Selection | null,
) => {
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('The screenshot editor is not available in this browser.');
  context.drawImage(image, 0, 0);
  strokes.forEach(stroke => drawStroke(context, stroke));
  if (selection && selection.width > 0 && selection.height > 0) {
    context.save();
    context.fillStyle = 'rgba(15, 23, 42, 0.54)';
    context.beginPath();
    context.rect(0, 0, canvas.width, canvas.height);
    context.rect(selection.x, selection.y, selection.width, selection.height);
    context.fill('evenodd');
    context.strokeStyle = '#ffffff';
    context.lineWidth = Math.max(2, canvas.width / 900);
    context.setLineDash([Math.max(8, canvas.width / 180), Math.max(5, canvas.width / 280)]);
    context.strokeRect(selection.x, selection.y, selection.width, selection.height);
    context.restore();
  }
};

const loadImage = (source: string) => new Promise<HTMLImageElement>((resolve, reject) => {
  const image = new Image();
  image.onload = () => resolve(image);
  image.onerror = () => reject(new Error('The captured screenshot could not be opened. Please capture it again.'));
  image.src = source;
});

const resizeCanvas = (source: HTMLCanvasElement, maximumDimension: number) => {
  const scale = Math.min(1, maximumDimension / Math.max(source.width, source.height));
  if (scale === 1) return source;
  const resized = document.createElement('canvas');
  resized.width = Math.max(1, Math.round(source.width * scale));
  resized.height = Math.max(1, Math.round(source.height * scale));
  const context = resized.getContext('2d');
  if (!context) throw new Error('The screenshot could not be resized.');
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';
  context.drawImage(source, 0, 0, resized.width, resized.height);
  return resized;
};

const encodeScreenshot = (source: HTMLCanvasElement, maximumDimension = 2200) => {
  let output = resizeCanvas(source, maximumDimension);
  const qualities = [0.9, 0.82, 0.74, 0.66];
  let dataUrl = '';
  for (const quality of qualities) {
    dataUrl = output.toDataURL('image/jpeg', quality);
    if (estimateDataUrlBytes(dataUrl) <= PORTAL_FEEDBACK_MAX_SCREENSHOT_BYTES) break;
  }
  if (estimateDataUrlBytes(dataUrl) > PORTAL_FEEDBACK_MAX_SCREENSHOT_BYTES) {
    output = resizeCanvas(output, 1600);
    dataUrl = output.toDataURL('image/jpeg', 0.68);
  }
  const bytes = estimateDataUrlBytes(dataUrl);
  if (!bytes || bytes > PORTAL_FEEDBACK_MAX_SCREENSHOT_BYTES) {
    throw new Error('The screenshot is still too large to send. Crop it to the relevant area and try again.');
  }
  return { dataUrl, width: output.width, height: output.height, bytes };
};

const displayCaptureAllowedByPolicy = () => {
  const policyDocument = document as Document & {
    permissionsPolicy?: { allowsFeature: (feature: string) => boolean };
    featurePolicy?: { allowsFeature: (feature: string) => boolean };
  };
  const policy = policyDocument.permissionsPolicy || policyDocument.featurePolicy;
  if (!policy?.allowsFeature) return true;
  return policy.allowsFeature('display-capture');
};

const captureErrorMessage = (error: unknown, policyAllowsCapture = true) => {
  const name = error && typeof error === 'object' && 'name' in error
    ? String((error as { name?: unknown }).name || '')
    : '';
  if (!policyAllowsCapture || /security/i.test(name)) {
    return 'Screen sharing is blocked by this browser or device policy. Upload a screenshot instead.';
  }
  if (/notallowed/i.test(name)) {
    return 'The screen-sharing picker was dismissed or blocked. Try again and select a tab, window or screen, or upload a screenshot instead.';
  }
  if (/abort/i.test(name)) {
    return 'Screen sharing closed before a selection was completed. Try again or upload a screenshot instead.';
  }
  if (/notfound/i.test(name)) return 'No screen or browser tab was available to capture.';
  return error instanceof Error ? error.message : 'The screenshot could not be captured. Please try again.';
};

export const PortalFeedbackButton: React.FC = () => {
  const { user } = useAuth();
  const location = useLocation();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const screenshotInputRef = useRef<HTMLInputElement | null>(null);
  const pointerActiveRef = useRef(false);
  const cropAnchorRef = useRef<Point | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [isSampling, setIsSampling] = useState(false);
  const [isLoadingUpload, setIsLoadingUpload] = useState(false);
  const [capture, setCapture] = useState<FeedbackCapture | null>(null);
  const [imageReadyVersion, setImageReadyVersion] = useState(0);
  const [editorMode, setEditorMode] = useState<'draw' | 'crop'>('draw');
  const [strokes, setStrokes] = useState<Stroke[]>([]);
  const [cropSelection, setCropSelection] = useState<Selection | null>(null);
  const [penColour, setPenColour] = useState(PEN_COLOURS[0].value);
  const [penWidth, setPenWidth] = useState(6);
  const [category, setCategory] = useState<PortalFeedbackCategory>('bug');
  const [comment, setComment] = useState('');
  const [submissionId, setSubmissionId] = useState(createPortalFeedbackSubmissionId);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSent, setIsSent] = useState(false);

  const isAuthorised = canAccessPortalFeedback(user);
  const commentError = useMemo(() => validatePortalFeedbackComment(comment), [comment]);

  const resetDraft = useCallback(() => {
    setCapture(null);
    imageRef.current = null;
    setStrokes([]);
    setCropSelection(null);
    setEditorMode('draw');
    setPenColour(PEN_COLOURS[0].value);
    setPenWidth(6);
    setCategory('bug');
    setComment('');
    setSubmissionId(createPortalFeedbackSubmissionId());
    setError(null);
    setIsSent(false);
  }, []);

  const close = useCallback(() => {
    if (isSubmitting || isSampling || isLoadingUpload) return;
    setIsOpen(false);
    resetDraft();
  }, [isLoadingUpload, isSampling, isSubmitting, resetDraft]);

  useEffect(() => {
    if (!isOpen) return;
    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      document.body.style.overflow = originalOverflow;
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [close, isOpen]);

  useEffect(() => {
    if (isAuthorised || !isOpen) return;
    setIsOpen(false);
    resetDraft();
  }, [isAuthorised, isOpen, resetDraft]);

  useEffect(() => {
    if (!capture) return;
    let active = true;
    loadImage(capture.dataUrl)
      .then(image => {
        if (!active) return;
        imageRef.current = image;
        setImageReadyVersion(version => version + 1);
      })
      .catch(loadError => {
        if (active) setError(captureErrorMessage(loadError));
      });
    return () => {
      active = false;
    };
  }, [capture]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const image = imageRef.current;
    if (!canvas || !image || !capture) return;
    drawCapture(canvas, image, strokes, cropSelection);
  }, [capture, cropSelection, imageReadyVersion, strokes]);

  const makeFlattenedCanvas = useCallback(() => {
    const image = imageRef.current;
    if (!image) throw new Error('Wait for the screenshot to finish loading.');
    const flattened = document.createElement('canvas');
    drawCapture(flattened, image, strokes);
    return flattened;
  }, [strokes]);

  const captureScreen = async () => {
    const mediaDevices = navigator.mediaDevices as MediaDevices & {
      getDisplayMedia?: (constraints?: DisplayMediaStreamOptions) => Promise<MediaStream>;
    };
    if (!window.isSecureContext || !mediaDevices?.getDisplayMedia) {
      setError('Screen sharing is not supported here. Open the secure portal in a current Chrome, Edge or Firefox browser, or upload a screenshot instead.');
      return;
    }
    if (!displayCaptureAllowedByPolicy()) {
      setError('Screen sharing is blocked by this browser or device policy. Upload a screenshot instead.');
      return;
    }

    setError(null);
    setIsSampling(true);
    let stream: MediaStream | null = null;
    try {
      const constraints = {
        video: { frameRate: { ideal: 1, max: 5 } },
        audio: false,
        preferCurrentTab: true,
        selfBrowserSurface: 'include',
        surfaceSwitching: 'exclude',
        systemAudio: 'exclude',
      } as DisplayMediaStreamOptions;
      stream = await mediaDevices.getDisplayMedia(constraints);
      await waitForPaint();
      await delay(250);

      const video = document.createElement('video');
      video.srcObject = stream;
      video.muted = true;
      video.playsInline = true;
      await video.play();
      for (let attempt = 0; attempt < 20 && (!video.videoWidth || !video.videoHeight); attempt += 1) {
        await delay(100);
      }
      if (!video.videoWidth || !video.videoHeight) throw new Error('The selected screen did not provide an image.');

      const rawCanvas = document.createElement('canvas');
      rawCanvas.width = video.videoWidth;
      rawCanvas.height = video.videoHeight;
      const context = rawCanvas.getContext('2d');
      if (!context) throw new Error('The screenshot could not be prepared.');
      context.drawImage(video, 0, 0, rawCanvas.width, rawCanvas.height);
      const encoded = encodeScreenshot(rawCanvas, 2560);
      const trackSettings = stream.getVideoTracks()[0]?.getSettings() as MediaTrackSettings & { displaySurface?: string };
      setCapture({
        dataUrl: encoded.dataUrl,
        width: encoded.width,
        height: encoded.height,
        displaySurface: trackSettings?.displaySurface || 'screen',
      });
      setStrokes([]);
      setCropSelection(null);
      setEditorMode('crop');
    } catch (captureError) {
      setError(captureErrorMessage(captureError, displayCaptureAllowedByPolicy()));
    } finally {
      stream?.getTracks().forEach(track => track.stop());
      setIsSampling(false);
    }
  };

  const loadScreenshotFile = async (file: File | null | undefined) => {
    if (!file) return;
    if (!SCREENSHOT_FILE_TYPES.includes(file.type)) {
      setError('Choose a PNG, JPEG or WebP screenshot.');
      return;
    }
    if (file.size > MAX_SCREENSHOT_SOURCE_BYTES) {
      setError('That screenshot is larger than 20 MB. Choose a smaller image.');
      return;
    }

    const objectUrl = URL.createObjectURL(file);
    try {
      setError(null);
      setIsLoadingUpload(true);
      const image = await loadImage(objectUrl);
      const rawCanvas = document.createElement('canvas');
      rawCanvas.width = image.naturalWidth;
      rawCanvas.height = image.naturalHeight;
      const context = rawCanvas.getContext('2d');
      if (!context) throw new Error('The screenshot could not be prepared.');
      context.drawImage(image, 0, 0);
      const encoded = encodeScreenshot(rawCanvas, 2560);
      setCapture({
        dataUrl: encoded.dataUrl,
        width: encoded.width,
        height: encoded.height,
        displaySurface: 'uploaded-screenshot',
      });
      setStrokes([]);
      setCropSelection(null);
      setEditorMode('crop');
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : 'The screenshot could not be opened.');
    } finally {
      URL.revokeObjectURL(objectUrl);
      setIsLoadingUpload(false);
      if (screenshotInputRef.current) screenshotInputRef.current.value = '';
    }
  };

  const pointerPosition = (event: React.PointerEvent<HTMLCanvasElement>): Point => {
    const canvas = event.currentTarget;
    const bounds = canvas.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(canvas.width, (event.clientX - bounds.left) * canvas.width / bounds.width)),
      y: Math.max(0, Math.min(canvas.height, (event.clientY - bounds.top) * canvas.height / bounds.height)),
    };
  };

  const onPointerDown = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!capture || isSubmitting) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    const point = pointerPosition(event);
    pointerActiveRef.current = true;
    if (editorMode === 'crop') {
      cropAnchorRef.current = point;
      setCropSelection({ x: point.x, y: point.y, width: 0, height: 0 });
      return;
    }
    setStrokes(current => [...current, { points: [point], color: penColour, width: penWidth }]);
  };

  const onPointerMove = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!pointerActiveRef.current) return;
    event.preventDefault();
    const point = pointerPosition(event);
    if (editorMode === 'crop' && cropAnchorRef.current) {
      setCropSelection(normaliseSelection(cropAnchorRef.current, point));
      return;
    }
    setStrokes(current => {
      if (!current.length) return current;
      const next = [...current];
      const last = next[next.length - 1];
      next[next.length - 1] = { ...last, points: [...last.points, point] };
      return next;
    });
  };

  const onPointerEnd = (event: React.PointerEvent<HTMLCanvasElement>) => {
    pointerActiveRef.current = false;
    cropAnchorRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  const applyCrop = async () => {
    if (!capture || !cropSelection || cropSelection.width < 12 || cropSelection.height < 12) {
      setError('Drag over the part of the screenshot you want to keep.');
      return;
    }
    try {
      setError(null);
      const flattened = makeFlattenedCanvas();
      const x = Math.max(0, Math.floor(cropSelection.x));
      const y = Math.max(0, Math.floor(cropSelection.y));
      const width = Math.min(flattened.width - x, Math.max(1, Math.round(cropSelection.width)));
      const height = Math.min(flattened.height - y, Math.max(1, Math.round(cropSelection.height)));
      const cropped = document.createElement('canvas');
      cropped.width = width;
      cropped.height = height;
      const context = cropped.getContext('2d');
      if (!context) throw new Error('The screenshot could not be cropped.');
      context.drawImage(flattened, x, y, width, height, 0, 0, width, height);
      const encoded = encodeScreenshot(cropped, 2560);
      setCapture(current => current ? {
        ...current,
        dataUrl: encoded.dataUrl,
        width: encoded.width,
        height: encoded.height,
      } : null);
      setStrokes([]);
      setCropSelection(null);
      setEditorMode('draw');
    } catch (cropError) {
      setError(captureErrorMessage(cropError));
    }
  };

  const submit = async () => {
    if (!capture) {
      setError('Capture a screenshot before submitting feedback.');
      return;
    }
    if (commentError) {
      setError(commentError);
      return;
    }
    try {
      setIsSubmitting(true);
      setError(null);
      const flattened = makeFlattenedCanvas();
      const encoded = encodeScreenshot(flattened);
      const { data, error: functionError } = await supabase.functions.invoke('portal-feedback', {
        body: {
          submissionId,
          category,
          comment: comment.trim(),
          screenshotDataUrl: encoded.dataUrl,
          screenshotWidth: encoded.width,
          screenshotHeight: encoded.height,
          displaySurface: capture.displaySurface,
          pageUrl: window.location.href,
          route: `${location.pathname}${location.search}`,
          viewportWidth: window.innerWidth,
          viewportHeight: window.innerHeight,
          userAgent: navigator.userAgent,
          submittedAt: new Date().toISOString(),
        },
      });
      if (functionError) {
        throw new Error(await getSupabaseFunctionErrorMessage(functionError, 'Feedback could not be sent. Please try again.'));
      }
      if (data?.error) throw new Error(String(data.error));
      setIsSent(true);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'Feedback could not be sent. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!isAuthorised) return null;

  const captureBytes = capture ? estimateDataUrlBytes(capture.dataUrl) : 0;
  const selectedCategory = CATEGORY_OPTIONS.find(option => option.value === category) || CATEGORY_OPTIONS[0];

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setError(null);
          setIsOpen(true);
        }}
        className={`fixed bottom-5 left-5 z-[70] hidden items-center gap-2 rounded-full border border-white/25 bg-gradient-to-r from-violet-700 to-blue-700 px-4 py-3 text-sm font-semibold text-white shadow-[0_16px_40px_rgba(30,64,175,0.3)] transition hover:-translate-y-0.5 hover:shadow-[0_20px_46px_rgba(30,64,175,0.38)] focus:outline-none focus:ring-4 focus:ring-blue-300/60 lg:inline-flex ${isSampling ? 'invisible' : ''}`}
        aria-label="Report portal feedback"
        title="Report a bug or suggest an improvement"
      >
        <MessageSquarePlus className="h-4 w-4" />
        Feedback
      </button>

      {isOpen && (
        <div
          className={`fixed inset-0 z-[100] hidden items-center justify-center bg-slate-950/70 p-5 backdrop-blur-sm transition-opacity lg:flex ${isSampling ? 'pointer-events-none opacity-0' : 'opacity-100'}`}
          role="dialog"
          aria-modal="true"
          aria-labelledby="portal-feedback-title"
        >
          <div className="flex max-h-[94vh] w-full max-w-6xl flex-col overflow-hidden rounded-[28px] border border-white/20 bg-white shadow-2xl dark:border-slate-700 dark:bg-slate-900">
            <div className="flex items-start justify-between gap-4 border-b border-slate-200 px-6 py-5 dark:border-slate-700">
              <div className="flex min-w-0 items-start gap-3">
                <div className="mt-0.5 rounded-2xl bg-gradient-to-br from-violet-600 to-blue-700 p-2.5 text-white shadow-lg shadow-blue-700/20">
                  <MessageSquarePlus className="h-5 w-5" />
                </div>
                <div className="min-w-0">
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-blue-600 dark:text-blue-300">Portal preview feedback</p>
                  <h2 id="portal-feedback-title" className="mt-1 text-xl font-bold text-slate-950 dark:text-white">
                    {isSent ? 'Feedback sent' : capture ? 'Mark up and describe the issue' : 'Show us what you found'}
                  </h2>
                  {!isSent && <p className="mt-1 truncate text-sm text-slate-500 dark:text-slate-400">{location.pathname}</p>}
                </div>
              </div>
              <button
                type="button"
                onClick={close}
                disabled={isSubmitting}
                className="rounded-xl p-2 text-slate-500 transition hover:bg-slate-100 hover:text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50 dark:hover:bg-slate-800 dark:hover:text-white"
                aria-label="Close feedback"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {isSent ? (
              <div className="flex flex-1 flex-col items-center justify-center px-6 py-14 text-center">
                <div className="flex h-20 w-20 items-center justify-center rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300">
                  <CheckCircle2 className="h-11 w-11" />
                </div>
                <h3 className="mt-6 text-2xl font-bold text-slate-950 dark:text-white">Thanks — it’s with {PORTAL_FEEDBACK_RECIPIENT_LABEL}</h3>
                <p className="mt-2 max-w-lg text-sm leading-6 text-slate-600 dark:text-slate-300">
                  Your marked-up screenshot, comment and page details were emailed successfully. You can close this window or send another report.
                </p>
                <div className="mt-8 flex gap-3">
                  <button
                    type="button"
                    onClick={() => resetDraft()}
                    className="inline-flex items-center gap-2 rounded-xl border border-slate-300 px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800"
                  >
                    <MessageSquarePlus className="h-4 w-4" />
                    Send another
                  </button>
                  <button
                    type="button"
                    onClick={close}
                    className="rounded-xl bg-blue-700 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-blue-800 focus:outline-none focus:ring-4 focus:ring-blue-300/60"
                  >
                    Done
                  </button>
                </div>
              </div>
            ) : !capture ? (
              <div className="grid flex-1 gap-8 overflow-y-auto px-7 py-8 lg:grid-cols-[1.1fr_0.9fr]">
                <div className="rounded-3xl bg-gradient-to-br from-slate-950 via-blue-950 to-violet-950 p-8 text-white shadow-xl">
                  <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-white/10 ring-1 ring-white/20">
                    <Camera className="h-7 w-7" />
                  </div>
                  <h3 className="mt-6 text-2xl font-bold">Capture the page, window or screen</h3>
                  <p className="mt-3 max-w-xl text-sm leading-6 text-blue-100/85">
                    Your browser will open its screen-sharing picker. Select this browser tab when possible, or choose another window or your entire screen. You can crop it before anything is sent.
                  </p>
                  <div className="mt-7 flex flex-wrap gap-3">
                    <button
                      type="button"
                      autoFocus
                      onClick={captureScreen}
                      disabled={isLoadingUpload}
                      className="inline-flex items-center gap-2 rounded-xl bg-white px-5 py-3 text-sm font-bold text-blue-950 shadow-lg transition hover:-translate-y-0.5 hover:bg-blue-50 focus:outline-none focus:ring-4 focus:ring-white/30 disabled:cursor-wait disabled:opacity-60"
                    >
                      <Camera className="h-4 w-4" />
                      Choose what to capture
                    </button>
                    <input
                      ref={screenshotInputRef}
                      type="file"
                      accept="image/png,image/jpeg,image/webp"
                      className="sr-only"
                      onChange={event => void loadScreenshotFile(event.target.files?.[0])}
                    />
                    <button
                      type="button"
                      onClick={() => screenshotInputRef.current?.click()}
                      disabled={isLoadingUpload}
                      className="inline-flex items-center gap-2 rounded-xl border border-white/30 bg-white/10 px-5 py-3 text-sm font-bold text-white transition hover:-translate-y-0.5 hover:bg-white/15 focus:outline-none focus:ring-4 focus:ring-white/20 disabled:cursor-wait disabled:opacity-60"
                    >
                      {isLoadingUpload ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                      {isLoadingUpload ? 'Opening screenshot…' : 'Upload a screenshot'}
                    </button>
                  </div>
                  {error && (
                    <div className="mt-5 flex max-w-xl gap-2 rounded-2xl border border-red-300/30 bg-red-950/40 p-3.5 text-sm leading-5 text-red-100" role="alert">
                      <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                      <span>{error}</span>
                    </div>
                  )}
                </div>

                <div className="flex flex-col justify-center">
                  <div className="space-y-5">
                    <div className="flex gap-3">
                      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300"><MousePointer2 className="h-4 w-4" /></div>
                      <div><p className="font-semibold text-slate-900 dark:text-white">1. Select</p><p className="mt-1 text-sm leading-5 text-slate-500 dark:text-slate-400">Pick a tab, window or full screen in the secure browser prompt.</p></div>
                    </div>
                    <div className="flex gap-3">
                      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-violet-100 text-violet-700 dark:bg-violet-950 dark:text-violet-300"><Pencil className="h-4 w-4" /></div>
                      <div><p className="font-semibold text-slate-900 dark:text-white">2. Review and mark up</p><p className="mt-1 text-sm leading-5 text-slate-500 dark:text-slate-400">Crop private or irrelevant areas, then draw directly on the image.</p></div>
                    </div>
                    <div className="flex gap-3">
                      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300"><Send className="h-4 w-4" /></div>
                      <div><p className="font-semibold text-slate-900 dark:text-white">3. Explain and send</p><p className="mt-1 text-sm leading-5 text-slate-500 dark:text-slate-400">Add a comment. The screenshot and useful page/device details go only to {PORTAL_FEEDBACK_RECIPIENT_LABEL}.</p></div>
                    </div>
                  </div>
                  <div className="mt-7 flex gap-2 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm leading-5 text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-100">
                    <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" />
                    Review your screenshot before sending and crop out personal or sensitive information that is not relevant to the report.
                  </div>
                </div>
              </div>
            ) : (
              <div className="grid min-h-0 flex-1 overflow-y-auto lg:grid-cols-[minmax(0,1fr)_350px] lg:overflow-hidden">
                <div className="flex min-h-0 flex-col bg-slate-100 p-5 dark:bg-slate-950/70">
                  <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                    <div className="flex flex-wrap items-center gap-2" role="toolbar" aria-label="Screenshot tools">
                      <button
                        type="button"
                        onClick={() => {
                          setEditorMode('crop');
                          setCropSelection(null);
                        }}
                        className={`inline-flex items-center gap-2 rounded-xl px-3 py-2 text-xs font-semibold transition focus:outline-none focus:ring-2 focus:ring-blue-500 ${editorMode === 'crop' ? 'bg-blue-700 text-white' : 'bg-white text-slate-700 hover:bg-slate-50 dark:bg-slate-800 dark:text-slate-200'}`}
                      >
                        <Crop className="h-4 w-4" /> Crop
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setEditorMode('draw');
                          setCropSelection(null);
                        }}
                        className={`inline-flex items-center gap-2 rounded-xl px-3 py-2 text-xs font-semibold transition focus:outline-none focus:ring-2 focus:ring-blue-500 ${editorMode === 'draw' ? 'bg-blue-700 text-white' : 'bg-white text-slate-700 hover:bg-slate-50 dark:bg-slate-800 dark:text-slate-200'}`}
                      >
                        <Pencil className="h-4 w-4" /> Draw
                      </button>
                      {editorMode === 'draw' && (
                        <>
                          <div className="flex items-center gap-1 rounded-xl bg-white px-2 py-1.5 shadow-sm dark:bg-slate-800" aria-label="Pen colour">
                            <Palette className="mr-1 h-4 w-4 text-slate-400" />
                            {PEN_COLOURS.map(colour => (
                              <button
                                type="button"
                                key={colour.value}
                                onClick={() => setPenColour(colour.value)}
                                className={`h-5 w-5 rounded-full border-2 transition focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-1 ${penColour === colour.value ? 'scale-110 border-white ring-2 ring-slate-500' : 'border-white/70'}`}
                                style={{ backgroundColor: colour.value }}
                                aria-label={`${colour.label} pen`}
                                title={`${colour.label} pen`}
                              />
                            ))}
                          </div>
                          <div className="flex items-center gap-1 rounded-xl bg-white px-2 py-1.5 text-xs font-medium text-slate-500 shadow-sm dark:bg-slate-800 dark:text-slate-300" aria-label="Pen width">
                            <span className="px-1">Pen</span>
                            {[
                              { value: 3, label: 'Fine' },
                              { value: 6, label: 'Medium' },
                              { value: 10, label: 'Thick' },
                            ].map(option => (
                              <button
                                type="button"
                                key={option.value}
                                onClick={() => setPenWidth(option.value)}
                                className={`rounded-lg px-2 py-1 font-semibold transition focus:outline-none focus:ring-2 focus:ring-blue-500 ${penWidth === option.value ? 'bg-slate-900 text-white dark:bg-blue-700' : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-700'}`}
                                aria-pressed={penWidth === option.value}
                              >
                                {option.label}
                              </button>
                            ))}
                          </div>
                        </>
                      )}
                      <button
                        type="button"
                        onClick={() => setStrokes(current => current.slice(0, -1))}
                        disabled={!strokes.length}
                        className="rounded-xl bg-white p-2 text-slate-700 shadow-sm transition hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-slate-800 dark:text-slate-200"
                        aria-label="Undo last drawing"
                        title="Undo last drawing"
                      >
                        <Undo2 className="h-4 w-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => setStrokes([])}
                        disabled={!strokes.length}
                        className="rounded-xl bg-white p-2 text-slate-700 shadow-sm transition hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-slate-800 dark:text-slate-200"
                        aria-label="Clear all drawing"
                        title="Clear all drawing"
                      >
                        <Eraser className="h-4 w-4" />
                      </button>
                    </div>
                    <button
                      type="button"
                      onClick={captureScreen}
                      className="inline-flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 transition hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
                    >
                      <RefreshCw className="h-4 w-4" /> Re-capture
                    </button>
                  </div>

                  <div className="relative flex min-h-[340px] flex-1 items-center justify-center overflow-hidden rounded-2xl border border-slate-300 bg-[linear-gradient(45deg,#e2e8f0_25%,transparent_25%),linear-gradient(-45deg,#e2e8f0_25%,transparent_25%),linear-gradient(45deg,transparent_75%,#e2e8f0_75%),linear-gradient(-45deg,transparent_75%,#e2e8f0_75%)] bg-[length:20px_20px] bg-[position:0_0,0_10px,10px_-10px,-10px_0px] p-3 dark:border-slate-700 dark:bg-slate-900">
                    <canvas
                      ref={canvasRef}
                      onPointerDown={onPointerDown}
                      onPointerMove={onPointerMove}
                      onPointerUp={onPointerEnd}
                      onPointerCancel={onPointerEnd}
                      className={`max-h-[57vh] max-w-full touch-none rounded-lg bg-white shadow-xl ${editorMode === 'crop' ? 'cursor-crosshair' : 'cursor-cell'}`}
                      aria-label="Captured screenshot editor"
                    />
                    <div className="pointer-events-none absolute bottom-5 left-1/2 -translate-x-1/2 rounded-full bg-slate-950/80 px-3 py-1.5 text-xs font-medium text-white shadow-lg backdrop-blur">
                      {editorMode === 'crop' ? 'Drag to select the area to keep' : 'Draw on the screenshot to highlight the issue'}
                    </div>
                  </div>

                  <div className="mt-3 flex min-h-9 items-center justify-between gap-3">
                    <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                      <ImageIcon className="h-3.5 w-3.5" />
                      {capture.width} × {capture.height} · {formatFeedbackFileSize(captureBytes)} · {capture.displaySurface}
                    </div>
                    {editorMode === 'crop' && cropSelection && cropSelection.width >= 12 && cropSelection.height >= 12 && (
                      <div className="flex items-center gap-2">
                        <button type="button" onClick={() => setCropSelection(null)} className="rounded-lg px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 dark:text-slate-300 dark:hover:bg-slate-800">Cancel crop</button>
                        <button type="button" onClick={applyCrop} className="inline-flex items-center gap-1.5 rounded-lg bg-blue-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-800 focus:outline-none focus:ring-2 focus:ring-blue-500">
                          <Check className="h-3.5 w-3.5" /> Keep selection
                        </button>
                      </div>
                    )}
                  </div>
                </div>

                <aside className="flex min-h-0 flex-col border-l border-slate-200 bg-white p-5 dark:border-slate-700 dark:bg-slate-900">
                  <div>
                    <label className="text-sm font-semibold text-slate-900 dark:text-white">What kind of feedback is this?</label>
                    <div className="mt-3 grid grid-cols-3 gap-2 lg:grid-cols-1">
                      {CATEGORY_OPTIONS.map(option => {
                        const Icon = option.icon;
                        const selected = category === option.value;
                        return (
                          <button
                            type="button"
                            key={option.value}
                            onClick={() => setCategory(option.value)}
                            className={`flex items-center gap-3 rounded-xl border p-3 text-left transition focus:outline-none focus:ring-2 focus:ring-blue-500 ${selected ? 'border-blue-500 bg-blue-50 text-blue-950 dark:border-blue-500 dark:bg-blue-950/50 dark:text-blue-100' : 'border-slate-200 text-slate-700 hover:border-slate-300 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800'}`}
                          >
                            <div className={`rounded-lg p-2 ${selected ? 'bg-blue-700 text-white' : 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-300'}`}><Icon className="h-4 w-4" /></div>
                            <div className="min-w-0"><p className="text-sm font-semibold">{option.label}</p><p className="hidden text-xs text-slate-500 dark:text-slate-400 lg:block">{option.description}</p></div>
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  <div className="mt-5 flex min-h-0 flex-1 flex-col">
                    <div className="flex items-end justify-between gap-3">
                      <label htmlFor="portal-feedback-comment" className="text-sm font-semibold text-slate-900 dark:text-white">What happened, or what should improve?</label>
                      <span className={`text-xs ${comment.length > PORTAL_FEEDBACK_MAX_COMMENT_LENGTH ? 'text-red-600' : 'text-slate-400'}`}>{comment.length}/{PORTAL_FEEDBACK_MAX_COMMENT_LENGTH}</span>
                    </div>
                    <textarea
                      id="portal-feedback-comment"
                      value={comment}
                      onChange={event => {
                        setComment(event.target.value);
                        if (error) setError(null);
                      }}
                      rows={8}
                      maxLength={PORTAL_FEEDBACK_MAX_COMMENT_LENGTH + 100}
                      placeholder={category === 'bug' ? 'Tell us what you were doing, what you expected, and what went wrong…' : `Describe the ${selectedCategory.label.toLowerCase()} and why it would help…`}
                      className="mt-2 min-h-[150px] flex-1 resize-none rounded-2xl border border-slate-300 bg-white p-3.5 text-sm leading-6 text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-blue-500 focus:ring-4 focus:ring-blue-100 dark:border-slate-700 dark:bg-slate-950 dark:text-white dark:focus:ring-blue-950"
                    />
                    <p className="mt-2 text-xs leading-5 text-slate-500 dark:text-slate-400">Page address, browser, screen size and your signed-in name are included automatically.</p>
                  </div>

                  {error && (
                    <div className="mt-4 flex gap-2 rounded-xl border border-red-200 bg-red-50 p-3 text-sm leading-5 text-red-800 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-200" role="alert">
                      <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                      <span>{error}</span>
                    </div>
                  )}

                  <div className="mt-5 border-t border-slate-200 pt-4 dark:border-slate-700">
                    <button
                      type="button"
                      onClick={submit}
                      disabled={isSubmitting || Boolean(commentError)}
                      className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-violet-700 to-blue-700 px-5 py-3 text-sm font-bold text-white shadow-lg shadow-blue-700/20 transition hover:from-violet-800 hover:to-blue-800 focus:outline-none focus:ring-4 focus:ring-blue-300/60 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                      {isSubmitting ? 'Sending securely…' : `Send to ${PORTAL_FEEDBACK_RECIPIENT_LABEL}`}
                    </button>
                    <p className="mt-2 text-center text-[11px] text-slate-400">Only authenticated admins and instructors can submit.</p>
                  </div>
                </aside>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
};
