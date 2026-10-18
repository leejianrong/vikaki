import { describe, expect, it } from "vitest";
import { chosenDtype, DEFAULT_DTYPE, MODEL_FILES } from "../src/kokoro-defaults.mjs";

describe("which Kokoro weights run", () => {
  it("are the full-precision ones unless told otherwise, because the 8-bit ones were three times slower to first audio (VIK-116)", () => {
    expect(DEFAULT_DTYPE).toBe("fp32");
    expect(chosenDtype({})).toBe("fp32");
  });

  it("can be set to a known precision with VIKAKI_KOKORO_DTYPE, and an unknown one is ignored", () => {
    expect(chosenDtype({ VIKAKI_KOKORO_DTYPE: "q8" })).toBe("q8");
    expect(chosenDtype({ VIKAKI_KOKORO_DTYPE: "fp16" })).toBe("fp16");
    expect(chosenDtype({ VIKAKI_KOKORO_DTYPE: "banana" })).toBe("fp32");
    expect(chosenDtype({ VIKAKI_KOKORO_DTYPE: "toString" })).toBe("fp32"); // not a key of the table
  });

  it("knows the cached file of each precision", () => {
    expect(MODEL_FILES.fp32).toBe("model.onnx");
    expect(MODEL_FILES.q8).toBe("model_quantized.onnx");
  });
});
