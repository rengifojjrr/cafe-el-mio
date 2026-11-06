/** Descarga un texto como archivo (copias de seguridad en JSON). */
export function downloadText(fileName: string, text: string, mime = 'application/json'): void {
  const url = URL.createObjectURL(new Blob([text], { type: mime }));
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Safari necesita que la URL viva un momento después del clic.
  window.setTimeout(() => URL.revokeObjectURL(url), 1500);
}
