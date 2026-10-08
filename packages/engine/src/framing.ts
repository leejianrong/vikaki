export interface Framing {
  /** Camera height. Always the eye line, so the camera never looks up or down at the face. */
  y: number;
  /** Distance from the avatar so the head fits with some margin. */
  distance: number;
}

/**
 * Frame a head from the eye line. `headY` is the base of the skull, `topY` the top of the model,
 * `fovDegrees` the vertical field of view. The view is centred on the eyes, so it has to be tall
 * enough for the larger of "eyes to top" and "eyes to chin" (the chin is about as far below the
 * eyes as the head bone is).
 */
export function frameFromEyeLevel(eyeY: number, headY: number, topY: number, fovDegrees: number, margin = 1.45): Framing {
  const half = Math.max(topY - eyeY, eyeY - headY, 0.05) * margin;
  return { y: eyeY, distance: half / Math.tan((fovDegrees * Math.PI) / 360) };
}
