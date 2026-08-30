const baseAwareUrl = (path: string) =>
  new URL(`${import.meta.env.BASE_URL}${path}`, document.baseURI).toString();

export const mediapipeWasmDirectory = () =>
  baseAwareUrl('vendor/mediapipe/wasm').replace(/\/$/, '');

export const faceLandmarkerModelUrl = () =>
  baseAwareUrl('vendor/mediapipe/models/face_landmarker.task');
