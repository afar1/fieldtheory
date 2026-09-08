import { exportDrawing } from './utils/drawing';
import type { Stroke } from './vendor/drawesome';
export async function checkDrawingPixels(): Promise<string> {
  const background = document.createElement('canvas');
  background.width = background.height = 20;
  const bg = background.getContext('2d')!;
  bg.fillStyle = '#ff0000'; bg.fillRect(0, 0, 20, 20);
  const strokes: Stroke[] = [
    { id: 1, pen: 'pen', color: '#000000', size: 5, opacity: 1, points: [[43, 50, .5], [57, 50, .5]] },
    { id: 2, pen: 'pen', color: '#000000', size: 40, opacity: 1, erase: true, points: [[40, 50, .5], [60, 50, .5]] },
  ];
  for (const scale of [1, 2]) {
    const result = await exportDrawing(strokes, {w:100,h:100}, '#ffffff', {dataUrl:background.toDataURL(),x:40,y:40,width:20,height:20}, scale);
    if (result.width !== 116 * scale || result.height !== 116 * scale) throw new Error(`Wrong crop/padding at ${scale}x: ${result.width}×${result.height}`);
    const image = new Image();
    await new Promise<void>((resolve,reject) => {image.onload=()=>resolve();image.onerror=reject;image.src=result.dataUrl;});
    const canvas = document.createElement('canvas'); canvas.width=result.width;canvas.height=result.height;
    const ctx=canvas.getContext('2d')!;ctx.drawImage(image,0,0);
    const center=Array.from(ctx.getImageData(58*scale,58*scale,1,1).data);
    const corner=Array.from(ctx.getImageData(0,0,1,1).data);
    if (center.join()!=='255,0,0,255') throw new Error(`Eraser damaged background: ${center}`);
    if (corner.join()!=='255,255,255,255') throw new Error(`Wrong paper: ${corner}`);
  }
  const highlight = await exportDrawing([{ ...strokes[0], pen: 'highlighter', color: '#ffff00', opacity: 1, size: 3 }], {w:100,h:100}, '#fff', {dataUrl:background.toDataURL(),x:40,y:40,width:20,height:20}, 1);
  const hi = new Image();
  await new Promise<void>((resolve,reject)=>{hi.onload=()=>resolve();hi.onerror=reject;hi.src=highlight.dataUrl;});
  const hc=document.createElement('canvas');hc.width=highlight.width;hc.height=highlight.height;
  const hx=hc.getContext('2d')!;hx.drawImage(hi,0,0);
  const mixed=Array.from(hx.getImageData(58,58,1,1).data);
  if (mixed.join()!=='255,0,0,255') throw new Error(`Highlighter must multiply over background: ${mixed}`);
  let emptyRejected=false;
  try {await exportDrawing(strokes,{w:100,h:100},'#fff',null,1);} catch {emptyRejected=true;}
  if (!emptyRejected) throw new Error('Fully erased drawing must be rejected');
  return 'PASS: 1×/2× PNG dimensions, 48px padding, background survives erasing, paper pixels, highlighter blending, empty export rejection';
}
