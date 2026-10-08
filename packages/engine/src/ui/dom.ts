/** Create an element, set properties, append children. Properties not attributes, so custom elements get real values. */
export function el<K extends keyof HTMLElementTagNameMap>(tag: K, props?: Record<string, unknown>, ...kids: (Node | string)[]): HTMLElementTagNameMap[K];
export function el(tag: string, props?: Record<string, unknown>, ...kids: (Node | string)[]): HTMLElement;
export function el(tag: string, props: Record<string, unknown> = {}, ...kids: (Node | string)[]): HTMLElement {
  const e = document.createElement(tag);
  Object.assign(e, props);
  e.append(...kids);
  return e;
}

/** Set attributes on a custom element (some Material properties are attribute-reflected only). */
export function attrs<T extends HTMLElement>(e: T, a: Record<string, string>): T {
  for (const [k, v] of Object.entries(a)) e.setAttribute(k, v);
  return e;
}
