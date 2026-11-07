/**
 * A round's one-line pitch lives in its metadataURI as a self-contained data URI,
 * so no server or storage service is needed. Remote URIs are never fetched.
 */
const PREFIX = 'data:application/json;base64,'

export function encodePitch(pitch: string): string {
  const bytes = new TextEncoder().encode(JSON.stringify({ pitch }))
  let binary = ''
  for (const b of bytes) binary += String.fromCharCode(b)
  return PREFIX + btoa(binary)
}

export function decodePitch(uri: string): string {
  if (!uri.startsWith(PREFIX)) return ''
  try {
    const binary = atob(uri.slice(PREFIX.length))
    const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0))
    const parsed: unknown = JSON.parse(new TextDecoder().decode(bytes))
    if (parsed && typeof parsed === 'object' && 'pitch' in parsed) {
      const pitch = (parsed).pitch
      return typeof pitch === 'string' ? pitch.slice(0, 280) : ''
    }
  } catch {
    // Malformed metadata is shown as having no pitch.
  }
  return ''
}
