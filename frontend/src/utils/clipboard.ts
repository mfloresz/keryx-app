/**
 * Robust clipboard copy with fallback for non-secure contexts.
 *
 * `navigator.clipboard.writeText()` is only available in secure contexts
 * (https, localhost). When the app is served over plain http (e.g. LAN IP),
 * `navigator.clipboard` is undefined and the call throws, making copy
 * buttons look dead. This helper falls back to the legacy
 * textarea + `document.execCommand('copy')` path in that case.
 *
 * @returns true when the text was copied, false otherwise.
 */
export async function copyTextToClipboard(text: string): Promise<boolean> {
  if (!text) return false

  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
      return true
    }

    // Fallback for non-secure contexts where the Clipboard API is unavailable.
    const textarea = document.createElement('textarea')
    textarea.value = text
    textarea.style.position = 'fixed'
    textarea.style.opacity = '0'
    document.body.appendChild(textarea)
    textarea.select()
    const copied = document.execCommand('copy')
    document.body.removeChild(textarea)
    return copied
  } catch (err) {
    if (import.meta.env.DEV) {
      console.error('Copy to clipboard failed:', err)
    }
    return false
  }
}
