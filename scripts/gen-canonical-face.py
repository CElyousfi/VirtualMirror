"""Regenerate packages/widget/src/canonical-face.ts from MediaPipe's canonical_face_model.obj.
Usage: python3 scripts/gen-canonical-face.py path/to/canonical_face_model.obj
Source: https://github.com/google-ai-edge/mediapipe/blob/master/mediapipe/modules/face_geometry/data/canonical_face_model.obj (Apache-2.0)
"""
import json, sys
verts, faces = [], []
for line in open(sys.argv[1]):
    p = line.split()
    if p and p[0] == "v": verts.append([float(x) for x in p[1:4]])
    elif p and p[0] == "f": faces.append([int(t.split("/")[0]) - 1 for t in p[1:4]])
assert len(verts) == 468 and len(faces) == 898, (len(verts), len(faces))
header = """// GENERATED from mediapipe/modules/face_geometry/data/canonical_face_model.obj
// Copyright 2020 The MediaPipe Authors. Licensed under the Apache License, Version 2.0.
// https://github.com/google-ai-edge/mediapipe/blob/master/LICENSE
// 468 vertices in FACE space (centimetres), 898 triangles. Used as a depth-only
// occluder so frame parts behind the face are hidden. Regenerate with
// scripts/gen-canonical-face.py; do not edit by hand.
"""
out = header + "\nexport const CANONICAL_FACE_POSITIONS_CM = new Float32Array(%s);\n\nexport const CANONICAL_FACE_INDICES = new Uint16Array(%s);\n" % (
    json.dumps([round(c, 4) for v in verts for c in v], separators=(",", ":")),
    json.dumps([i for f in faces for i in f], separators=(",", ":")),
)
open("packages/widget/src/canonical-face.ts", "w").write(out)
print("wrote packages/widget/src/canonical-face.ts")
