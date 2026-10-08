import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { decodeWav, spectrogramPng } from "../src/server.ts";

describe("spectrogram picture", () => {
  it("draws a valid PNG whose width follows the duration", () => {
    const { samples, sampleRate } = decodeWav(readFileSync(new URL("../../audio/test/fixtures/kokoro-good-morning.wav", import.meta.url)));
    const png = spectrogramPng(samples, sampleRate);
    expect([...png.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    expect(png.readUInt32BE(16)).toBeGreaterThan(300); // width
    expect(png.readUInt32BE(20)).toBeGreaterThan(100); // height
  });
});
