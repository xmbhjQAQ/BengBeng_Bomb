import QRCode from 'qrcode';
import type { AggregateStats, VideoMetadata } from '../../shared/contracts';
import { assertShareableUrl } from '../../shared/domain/share';

export async function createShareCard(input:{url:string;video:VideoMetadata;heading:string;lines:string[];stats?:AggregateStats}):Promise<Blob>{
  assertShareableUrl(input.url);
  const canvas=document.createElement('canvas'); canvas.width=1200;canvas.height=1500;const ctx=canvas.getContext('2d');if(!ctx)throw new Error('浏览器不支持图片生成');
  const gradient=ctx.createLinearGradient(0,0,1200,1500);gradient.addColorStop(0,'#ff5d73');gradient.addColorStop(.5,'#872f62');gradient.addColorStop(1,'#171429');ctx.fillStyle=gradient;ctx.fillRect(0,0,1200,1500);
  ctx.fillStyle='rgba(255,255,255,.12)';ctx.beginPath();ctx.arc(1040,180,260,0,Math.PI*2);ctx.fill();ctx.fillStyle='#fff';ctx.font='800 82px system-ui';ctx.fillText(input.heading,80,160);ctx.font='700 48px system-ui';wrap(ctx,input.video.title,80,260,1040,60,2);ctx.font='30px system-ui';ctx.fillStyle='rgba(255,255,255,.78)';wrap(ctx,input.video.description||'一段等待你挑战的 B 站视频',80,385,1040,40,2);
  await drawCover(ctx,input.video.cover,80,480,1040,390);
  ctx.fillStyle='#fff';ctx.font='34px system-ui';input.lines.forEach((line,index)=>ctx.fillText(line,80,940+index*52));
  if(input.stats){ctx.fillStyle='rgba(0,0,0,.25)';roundRect(ctx,70,1100,680,130,28);ctx.fill();ctx.fillStyle='#fff';ctx.font='700 34px system-ui';ctx.fillText(`${input.stats.total} 次挑战 · ${(input.stats.failureRate*100).toFixed(0)}% 没绷住`,105,1178);}
  const qr=await QRCode.toDataURL(input.url,{width:300,margin:2,color:{dark:'#171429',light:'#ffffff'}});const image=new Image();await new Promise<void>((resolve,reject)=>{image.onload=()=>resolve();image.onerror=()=>reject(new Error('二维码生成失败'));image.src=qr;});ctx.drawImage(image,820,1060,300,300);ctx.font='30px system-ui';ctx.fillStyle='#fff';ctx.fillText('扫码接受挑战',80,1320);ctx.font='25px system-ui';ctx.fillStyle='rgba(255,255,255,.75)';ctx.fillText('摄像头画面仅在本地检测，不上传、不保存',80,1390);
  return new Promise((resolve,reject)=>canvas.toBlob((blob)=>blob?resolve(blob):reject(new Error('图片导出失败')),'image/png'));
}
async function drawCover(ctx:CanvasRenderingContext2D,url:string,x:number,y:number,width:number,height:number){ctx.save();roundRect(ctx,x,y,width,height,34);ctx.clip();ctx.fillStyle='rgba(0,0,0,.24)';ctx.fillRect(x,y,width,height);const image=await loadCover(url);if(image){const scale=Math.max(width/image.naturalWidth,height/image.naturalHeight);const drawnWidth=image.naturalWidth*scale;const drawnHeight=image.naturalHeight*scale;ctx.drawImage(image,x+(width-drawnWidth)/2,y+(height-drawnHeight)/2,drawnWidth,drawnHeight);}else{ctx.fillStyle='rgba(255,255,255,.72)';ctx.font='600 34px system-ui';ctx.fillText('视频封面暂时无法加载',x+48,y+height/2);}ctx.restore();}
async function loadCover(url:string){if(!url)return null;const image=new Image();image.crossOrigin='anonymous';image.referrerPolicy='no-referrer';return new Promise<HTMLImageElement|null>(resolve=>{image.onload=()=>resolve(image);image.onerror=()=>resolve(null);image.src=url;});}
function wrap(ctx:CanvasRenderingContext2D,text:string,x:number,y:number,width:number,lineHeight:number,max:number){let line='',lines=0;for(const character of text){if(ctx.measureText(line+character).width>width){ctx.fillText(line,x,y+lines*lineHeight);line=character;lines++;if(lines>=max)return;}else line+=character;}if(line&&lines<max)ctx.fillText(line,x,y+lines*lineHeight);}
function roundRect(ctx:CanvasRenderingContext2D,x:number,y:number,w:number,h:number,r:number){ctx.beginPath();ctx.roundRect(x,y,w,h,r);}
export function downloadBlob(blob:Blob,name:string){const link=document.createElement('a');link.href=URL.createObjectURL(blob);link.download=name;link.click();setTimeout(()=>URL.revokeObjectURL(link.href),1000);}
