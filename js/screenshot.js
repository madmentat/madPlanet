/* ============ скриншот ============ */
const shotEl = document.getElementById('shot');
let shotBlob = null;
let dlCap = null;   /* capability `downloads` в песочнице артефакта */
if(window.claude && window.claude.use){
  window.claude.use('downloads').then(v => { dlCap = v; }).catch(() => {});
}
document.getElementById('shotBtn').addEventListener('click', takeShot);
document.getElementById('shotSave').addEventListener('click', e => {
  if(dlCap && shotBlob){
    e.preventDefault();
    dlCap.save({filename: 'planeta-'+state.seed+'.png', data: shotBlob}).catch(() => {});
  }
});
document.getElementById('shotClose').addEventListener('click', () => {
  shotEl.classList.remove('on');
  const img = document.getElementById('shotImg');
  if(img.src) URL.revokeObjectURL(img.src);
});
function takeShot(){
  const cw = canvas.clientWidth, ch = canvas.clientHeight;
  const mult = Math.min(2.5, 4096/Math.max(cw,ch));
  const W = Math.round(cw*mult), H = Math.round(ch*mult);
  const oldW = canvas.width, oldH = canvas.height;
  canvas.width = W; canvas.height = H;
  gl.viewport(0, 0, W, H);
  drawFrame(lastNow);
  const px = new Uint8Array(W*H*4);
  gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, px);
  canvas.width = oldW; canvas.height = oldH;
  gl.viewport(0, 0, oldW, oldH);
  const c2 = document.createElement('canvas'); c2.width = W; c2.height = H;
  const ctx = c2.getContext('2d');
  const img = ctx.createImageData(W, H);
  const rowB = W*4;
  for(let y=0; y<H; y++)
    img.data.set(px.subarray(y*rowB, y*rowB+rowB), (H-1-y)*rowB);
  ctx.putImageData(img, 0, 0);
  /* Силовые линии рисуются отдельным прозрачным canvas; включаем их и в PNG. */
  if((state.fieldLinesOn || state.auroraFootpoints) && magCanvas.width > 0){
    ctx.drawImage(magCanvas, 0, 0, W, H);
  }
  c2.toBlob(b => {
    shotBlob = b;
    const url = URL.createObjectURL(b);
    const im = document.getElementById('shotImg');
    im.src = url;
    const a = document.getElementById('shotSave');
    a.href = url; a.download = 'planeta-'+state.seed+'.png';
    shotEl.classList.add('on');
  }, 'image/png');
}
