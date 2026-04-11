"use client";

export async function extractOcrText(dataUrl: string): Promise<string> {
  try {
    // Dynamic import to avoid increasing initial bundle size.
    const tesseract = await import("tesseract.js");
    const { createWorker } = tesseract;
    const worker = createWorker({
      logger: () => {
        /* minimal logging kept intentionally blank for production */
      },
    });

    await worker.load();
    await worker.loadLanguage("eng");
    await worker.initialize("eng");

    const { data } = await worker.recognize(dataUrl);
    await worker.terminate();

    return (data && data.text) ? data.text.trim() : "";
  } catch (err) {
    // Non-fatal: return empty string when OCR fails.
    // Caller should handle an empty OCR result gracefully.
    // eslint-disable-next-line no-console
    console.warn("OCR extraction failed:", err);
    return "";
  }
}
