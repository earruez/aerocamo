import { dataUriToBuffer } from './dataUri';

/**
 * Dibuja el logo de la organización en un PDFDocument si existe.
 * Devuelve el ancho ocupado (0 si no hay logo) para que el texto que sigue
 * en el encabezado se corra a la derecha y no quede encima.
 */
export function drawOrganizationLogo(
  doc: PDFKit.PDFDocument,
  logoDataUri: string | null | undefined,
  x: number,
  y: number,
  size: number,
): number {
  if (!logoDataUri) return 0;
  try {
    doc.image(dataUriToBuffer(logoDataUri), x, y, { fit: [size, size], align: 'center', valign: 'center' });
    return size;
  } catch {
    // Un logo corrupto no debe romper la generación del documento.
    return 0;
  }
}
