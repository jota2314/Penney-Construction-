import * as THREE from "three";
import type { TileTextureResult } from "./tile-texture";

/** Four 3-inch boards over a six-foot module, with staggered joints and deterministic grain. */
export function buildWoodTexture(base: string): TileTextureResult {
  const canvas=document.createElement('canvas');canvas.width=384;canvas.height=1536;
  const ctx=canvas.getContext('2d')!;
  let seed=1977;
  const rand=()=>{seed=(seed*1664525+1013904223)>>>0;return seed/4294967296;};
  const color=new THREE.Color(base);color.convertLinearToSRGB();
  const rgb=[color.r*255,color.g*255,color.b*255];
  for(let board=0;board<4;board++){
    const tone=.82+rand()*.18,x=board*96;
    ctx.fillStyle=`rgb(${rgb.map(v=>Math.round(v*tone)).join(',')})`;ctx.fillRect(x,0,96,1536);
    ctx.strokeStyle='rgba(55,35,17,.26)';ctx.lineWidth=1.5;ctx.beginPath();ctx.moveTo(x+.5,0);ctx.lineTo(x+.5,1536);ctx.stroke();
    const joint=[330,930,620,1190][board];ctx.fillStyle='rgba(65,40,20,.3)';ctx.fillRect(x,joint,96,1.5);
    ctx.save();ctx.beginPath();ctx.rect(x+1,0,94,1536);ctx.clip();
    for(let line=0;line<90;line++){
      const bx=x+rand()*96,phase=rand()*6.28,amplitude=rand()*3;
      ctx.strokeStyle=`rgba(64,36,15,${.025+rand()*.08})`;ctx.lineWidth=.3+rand()*.7;ctx.beginPath();
      for(let yy=0;yy<=1536;yy+=12){const xx=bx+Math.sin(yy/130+phase)*amplitude;if(yy===0)ctx.moveTo(xx,yy);else ctx.lineTo(xx,yy);}ctx.stroke();
    }
    ctx.restore();
  }
  const map=new THREE.CanvasTexture(canvas);map.colorSpace=THREE.SRGBColorSpace;map.wrapS=map.wrapT=THREE.RepeatWrapping;map.anisotropy=8;
  return {map,moduleWidthIn:12,moduleHeightIn:72};
}
