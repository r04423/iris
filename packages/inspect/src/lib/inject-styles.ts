// ============================================================================
// CSS Injection
// ============================================================================

/**
 * Injects a `<style>` tag into the given shadow root with the given CSS.
 * Returns a cleanup function that removes the tag.
 *
 * @internal
 */
export function injectStyles(shadowRoot: ShadowRoot, css: string): () => void {
  const style = document.createElement("style");
  style.textContent = css;
  shadowRoot.appendChild(style);

  return () => {
    style.remove();
  };
}
