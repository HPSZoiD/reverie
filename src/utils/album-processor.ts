export interface ProcessedArt {
  dataUrl: string;
  cssClass: string;
}

const albumCache = new Map<string, ProcessedArt>();

export async function processAlbumArt(
  imageUrl: string,
  targetSize: number = 300,
  style: 'cinematic' | 'clean' | 'warm' = 'clean'
): Promise<ProcessedArt> {
  const img = new Image();
  // Ensure we can load cross-origin images to draw to canvas safely
  img.crossOrigin = 'anonymous';
  img.src = imageUrl;
  
  await new Promise((resolve, reject) => {
    img.onload = resolve;
    img.onerror = reject;
  });

  const canvas = document.createElement('canvas');
  canvas.width = targetSize;
  canvas.height = targetSize;
  const ctx = canvas.getContext('2d')!;

  // High-quality bicubic upscale
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, 0, 0, targetSize, targetSize);

  // Lightweight unsharp mask (edge definition only)
  const imageData = ctx.getImageData(0, 0, targetSize, targetSize);
  const data = imageData.data;
  const copy = new Uint8ClampedArray(data);
  const strength = 0.25; // Subtle, avoids crunch

  for (let y = 1; y < targetSize - 1; y++) {
    for (let x = 1; x < targetSize - 1; x++) {
      const idx = (y * targetSize + x) * 4;
      for (let c = 0; c < 3; c++) {
        const center = copy[idx + c];
        const neighbors = (
          copy[((y-1)*targetSize+x-1)*4+c] + copy[((y-1)*targetSize+x)*4+c] + copy[((y-1)*targetSize+x+1)*4+c] +
          copy[(y*targetSize+x-1)*4+c] +                             copy[(y*targetSize+x+1)*4+c] +
          copy[((y+1)*targetSize+x-1)*4+c] + copy[((y+1)*targetSize+x)*4+c] + copy[((y+1)*targetSize+x+1)*4+c]
        ) / 8;
        data[idx + c] = Math.min(255, Math.max(0, center + (center - neighbors) * strength));
      }
    }
  }
  ctx.putImageData(imageData, 0, 0);

  // Cache-friendly output
  const dataUrl = canvas.toDataURL('image/webp', 0.85);
  
  const styleMap = {
    cinematic: 'art-cinematic',
    clean: 'art-clean',
    warm: 'art-warm'
  };

  return { dataUrl, cssClass: styleMap[style] };
}

export async function getCachedAlbumArt(url: string, style: 'cinematic' | 'clean' | 'warm' = 'clean'): Promise<ProcessedArt> {
  if (albumCache.has(url)) return albumCache.get(url)!;
  
  try {
    const processed = await processAlbumArt(url, 300, style);
    albumCache.set(url, processed);
    
    // Optional: persist to localStorage for offline
    try {
      localStorage.setItem(`reverie_art_${btoa(url)}`, processed.dataUrl);
    } catch {}
    
    return processed;
  } catch (err) {
    console.error("Failed to process album art:", err);
    // Fallback to original image if tainted canvas or other error occurs
    const styleMap = { cinematic: 'art-cinematic', clean: 'art-clean', warm: 'art-warm' };
    return { dataUrl: url, cssClass: styleMap[style] };
  }
}
