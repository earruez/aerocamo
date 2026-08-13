const ALLOWED_IMAGE_MIME_TYPES = ['image/png', 'image/jpeg'] as const;

export type AllowedImageMimeType = (typeof ALLOWED_IMAGE_MIME_TYPES)[number];

export function isAllowedImageMimeType(mimeType: string): mimeType is AllowedImageMimeType {
  return (ALLOWED_IMAGE_MIME_TYPES as readonly string[]).includes(mimeType);
}

export function bufferToDataUri(buffer: Buffer, mimeType: AllowedImageMimeType): string {
  return `data:${mimeType};base64,${buffer.toString('base64')}`;
}

/** Inverso de bufferToDataUri — usado al incrustar la imagen en un PDF con pdfkit. */
export function dataUriToBuffer(dataUri: string): Buffer {
  const base64 = dataUri.slice(dataUri.indexOf(',') + 1);
  return Buffer.from(base64, 'base64');
}
