import "./theme.css";
import "./base.css";

/** Register the Material 3 components the demos use. Loaded only by the demo pages, so the plain avatar page stays light. */
export async function loadMaterial(): Promise<void> {
  await Promise.all([
    import("@material/web/button/filled-button.js"),
    import("@material/web/button/filled-tonal-button.js"),
    import("@material/web/button/outlined-button.js"),
    import("@material/web/textfield/outlined-text-field.js"),
    import("@material/web/chips/chip-set.js"),
    import("@material/web/chips/assist-chip.js"),
  ]);
}
