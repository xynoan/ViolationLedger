import * as ort from 'onnxruntime-web';

const MODEL_URL =
  'https://huggingface.co/deepghs/yolo-face/resolve/main/yolov8n-face/model.onnx';
const INPUT_SIZE = 640;
const CONF_THRESH = 0.5;
const IOU_THRESH = 0.45;

export interface FaceDetection {
  bbox: number[];
  class_name: string;
  confidence: number;
}

let session: ort.InferenceSession | null = null;

async function getSession(): Promise<ort.InferenceSession> {
  if (session) return session;
  ort.env.wasm.wasmPaths = 'https://cdn.jsdelivr.net/npm/onnxruntime-web/dist/';
  session = await ort.InferenceSession.create(MODEL_URL, {
    executionProviders: ['wasm'],
    graphOptimizationLevel: 'all',
  });
  return session;
}

function letterbox(
  sourceCtx: CanvasRenderingContext2D,
  sw: number,
  sh: number
): { data: Float32Array; scale: number; padX: number; padY: number } {
  const scale = Math.min(INPUT_SIZE / sw, INPUT_SIZE / sh);
  const nw = Math.round(sw * scale);
  const nh = Math.round(sh * scale);
  const padX = (INPUT_SIZE - nw) / 2;
  const padY = (INPUT_SIZE - nh) / 2;

  const canvas = document.createElement('canvas');
  canvas.width = INPUT_SIZE;
  canvas.height = INPUT_SIZE;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Could not get canvas context');

  ctx.fillStyle = '#114';
  ctx.fillRect(0, 0, INPUT_SIZE, INPUT_SIZE);
  ctx.drawImage(
    sourceCtx.canvas,
    0,
    0,
    sw,
    sh,
    padX,
    padY,
    nw,
    nh
  );

  const imageData = ctx.getImageData(0, 0, INPUT_SIZE, INPUT_SIZE);
  const data = new Float32Array(1 * 3 * INPUT_SIZE * INPUT_SIZE);
  for (let i = 0; i < INPUT_SIZE * INPUT_SIZE; i++) {
    data[i] = imageData.data[i * 4] / 255;
    data[INPUT_SIZE * INPUT_SIZE + i] = imageData.data[i * 4 + 1] / 255;
    data[INPUT_SIZE * INPUT_SIZE * 2 + i] = imageData.data[i * 4 + 2] / 255;
  }
  return { data, scale, padX, padY };
}

function iou(box1: number[], box2: number[]): number {
  const x1 = Math.max(box1[0], box2[0]);
  const y1 = Math.max(box1[1], box2[1]);
  const x2 = Math.min(box1[2], box2[2]);
  const y2 = Math.min(box1[3], box2[3]);
  const inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  const area1 = (box1[2] - box1[0]) * (box1[3] - box1[1]);
  const area2 = (box2[2] - box2[0]) * (box2[3] - box2[1]);
  return inter / (area1 + area2 - inter);
}

function nms(boxes: FaceDetection[], iouThresh: number): FaceDetection[] {
  const sorted = [...boxes].sort((a, b) => b.confidence - a.confidence);
  const kept: FaceDetection[] = [];
  for (const box of sorted) {
    let overlap = false;
    for (const k of kept) {
      if (iou(box.bbox, k.bbox) > iouThresh) {
        overlap = true;
        break;
      }
    }
    if (!overlap) kept.push(box);
  }
  return kept;
}

export async function detectFaces(
  video: HTMLVideoElement
): Promise<FaceDetection[]> {
  const w = video.videoWidth || 640;
  const h = video.videoHeight || 480;
  if (w === 0 || h === 0) return [];

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) return [];
  ctx.drawImage(video, 0, 0, w, h);

  const { data, scale, padX, padY } = letterbox(ctx, w, h);
  const sess = await getSession();
  const inputName = sess.inputNames[0];
  const tensor = new ort.Tensor('float32', data, [1, 3, INPUT_SIZE, INPUT_SIZE]);
  const feeds: Record<string, ort.Tensor> = { [inputName]: tensor };
  const results = await sess.run(feeds);
  const out = results[sess.outputNames[0]];
  const outData = out.data as Float32Array;
  const outDims = out.dims;
  // YOLOv8 face: (1, 5, 8400) or (1, 8400, 5)
  const [, dim1, dim2] = outDims;
  const numProposals = dim1 === 5 ? dim2 : dim1;
  const numRows = dim1 === 5 ? dim1 : dim2;
  const stride = numProposals * numRows;
  const get = (row: number, i: number) =>
    dim1 === 5 ? outData[row * numProposals + i] : outData[i * numRows + row];

  const detections: FaceDetection[] = [];
  for (let i = 0; i < numProposals; i++) {
    const conf = get(4, i);
    if (conf < CONF_THRESH) continue;

    const cx = get(0, i);
    const cy = get(1, i);
    const rw = get(2, i);
    const rh = get(3, i);

    const x1 = (cx - rw / 2 - padX) / scale;
    const y1 = (cy - rh / 2 - padY) / scale;
    const x2 = (cx + rw / 2 - padX) / scale;
    const y2 = (cy + rh / 2 - padY) / scale;

    detections.push({
      bbox: [
        Math.max(0, x1),
        Math.max(0, y1),
        Math.min(w, x2),
        Math.min(h, y2),
      ],
      class_name: 'face',
      confidence: conf,
    });
  }

  return nms(detections, IOU_THRESH);
}
