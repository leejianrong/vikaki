/**
 * Open the default microphone and return it as a Web Audio source. Audio never leaves the
 * page (R6). Auto gain is off so room noise is not boosted into mouth movement.
 */
export async function openMic(ctx: AudioContext): Promise<{ source: MediaStreamAudioSourceNode; stop(): void }> {
  if (!navigator.mediaDevices?.getUserMedia) throw new Error("microphone access is not available in this context");
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: false },
  });
  return {
    source: ctx.createMediaStreamSource(stream),
    stop: () => stream.getTracks().forEach((t) => t.stop()),
  };
}
