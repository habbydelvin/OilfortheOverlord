/**
 * Background thread for matchSaltToSand (models.js): recolours a Wasteland ground texture's salt to sand off
 * the main thread, so loading the pieces during the intro doesn't freeze the game. Gets an ImageBitmap,
 * sends back the result as an ImageBitmap (both transferred, not copied) with the sand colour and salt share.
 */
import { recolourSalt } from './saltRecolour.js';

self.onmessage = ({ data: { id, bitmap } }) => {
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close();
  const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const { ref, share } = recolourSalt(image.data, canvas.width);
  if (share > 0.02) ctx.putImageData(image, 0, 0);
  const out = canvas.transferToImageBitmap();
  self.postMessage({ id, bitmap: out, ref, share }, [out]);
};
