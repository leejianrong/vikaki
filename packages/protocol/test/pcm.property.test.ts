import fc from "fast-check";
import { describe, it } from "vitest";
import { decodePcm16, encodePcm16 } from "../src/index.ts";

const samples = fc.float32Array({ maxLength: 3000, noNaN: true, min: -1, max: 1, noDefaultInfinity: true });

describe("PCM over the wire", () => {
  it("round-trips with the length kept and an error under one 16-bit step", () => {
    fc.assert(
      fc.property(samples, (x) => {
        const y = decodePcm16(encodePcm16(x));
        return y.length === x.length && x.every((v, i) => Math.abs(v - y[i]!) <= 1 / 32767 + 1e-7);
      }),
    );
  });

  it("clamps what is out of range instead of wrapping", () => {
    fc.assert(
      fc.property(fc.float32Array({ maxLength: 500, noNaN: true, min: -50, max: 50 }), (x) => {
        const y = decodePcm16(encodePcm16(x));
        return y.every((v, i) => Math.abs(v - Math.max(-1, Math.min(1, x[i]!))) <= 1 / 32767 + 1e-7);
      }),
    );
  });
});
