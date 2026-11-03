# Widget smoke test (headless Chromium, fake camera)

Runs the built widget bundle end to end: fake camera -> WebGL -> MediaPipe -> 3D frame,
and checks lazy loading, variant handling, close behaviour and session stats.

It needs three local inputs that are deliberately not committed:

1. A face video as `.y4m` (Chromium's fake-camera format). Make one from any frontal
   face photo you have rights to use:
   `ffmpeg -loop 1 -i face.jpg -t 6 -r 30 -vf "scale=-2:720,pad=1280:720:(ow-iw)/2:0,format=yuv420p" -f yuv4mpegpipe face.y4m`
2. `face_landmarker.task` (Apache-2.0) from
   https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task
3. MediaPipe WASM files: copied automatically from `node_modules/@mediapipe/tasks-vision/wasm`.

```bash
pnpm build:widget && pnpm demo:frame
node scripts/smoke/run.cjs --video face.y4m --model face_landmarker.task
```

Headless Chromium renders WebGL in software, so its frame rate says nothing about
real devices. Device performance comes only from real-hardware sessions
(see docs/QUALITY_BENCHMARKS.md).
