// The bar across the top of the stage (VIK-138): which hand, the blinds, the street and the pot, where it can be read at a glance whatever the panel shows.
// It draws only what `table_state` carries; the blinds are the game's own words on the new hand's title card (`event.detail`).
import type { MessageOf } from "@vikaki/protocol";
import { chipIcon } from "./table-overlay.ts";
import { el } from "./ui/dom.ts";
import "./ui/table.css";

type State = MessageOf<"table_state">;

export class TopBar {
  readonly root = el("section", { className: "top-bar", ariaLabel: "Hand", hidden: true });
  private detail = "";

  setState(st: State): void {
    if (st.event?.kind === "new_hand") this.detail = st.event.detail ?? "";
    this.root.hidden = false;
    const kids: (Node | string)[] = [];
    if (st.hand_no !== undefined) kids.push(el("b", { className: "hand-no", textContent: `Hand ${st.hand_no}` }));
    if (this.detail) kids.push(el("span", { className: "blinds", textContent: this.detail }));
    if (st.street) kids.push(el("span", { className: "street", textContent: st.street }));
    kids.push(el("span", { className: "pot" }, `Pot: ${(st.pot ?? 0).toLocaleString("en-US")}`, chipIcon()));
    this.root.replaceChildren(...kids);
  }
}
