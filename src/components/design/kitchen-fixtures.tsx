"use client";

import { Fragment, useMemo } from "react";
import * as THREE from "three";
import type { Fixture, RoomSpec } from "@/types/design";
import { findMaterial } from "@/types/design";

// All local geometry is in inches. One enclosing scale converts to the viewer's feet.
const STEEL = "#b5b9bc", BLACK = "#20272c";
function Part({ size, at = [0, 0, 0], color, metal = false, rough = .45 }: { size: [number, number, number]; at?: [number, number, number]; color: string; metal?: boolean; rough?: number }) {
  return <mesh position={at} castShadow receiveShadow><boxGeometry args={size}/><meshStandardMaterial color={color} metalness={metal ? .78 : 0} roughness={rough}/></mesh>;
}
function Pull({ x = 0, y, z, length = 6, vertical = false }: { x?: number; y: number; z: number; length?: number; vertical?: boolean }) {
  return <group position={[x, y, z]} rotation={[0, 0, vertical ? 0 : Math.PI / 2]}>
    <mesh castShadow position={[0,0,.9]}><cylinderGeometry args={[.19,.19,length,12]}/><meshStandardMaterial color={STEEL} metalness={.85} roughness={.22}/></mesh>
    {[-1,1].map(s=><Part key={s} size={[.35,.35,.9]} at={[0,s*(length/2-.4),.45]} color={STEEL} metal/>)}
  </group>;
}
function Front({ x=0, y, z, w, h, color, drawer=false }: { x?: number; y: number; z: number; w: number; h: number; color: string; drawer?: boolean }) {
  const rail=Math.min(2,w/5,h/4);
  return <group position={[x,y,z]}>
    <Part size={[w,h,.5]} color={color}/>
    {!drawer && <>{[-1,1].map(s=><Fragment key={s}><Part size={[rail,h,.3]} at={[s*(w-rail)/2,0,.4]} color={color}/><Part size={[w-2*rail,rail,.3]} at={[0,s*(h-rail)/2,.4]} color={color}/></Fragment>)}</>}
    <Pull y={drawer?0:h/2-4} z={.55} length={Math.min(6,w*.5)}/>
  </group>;
}
function Cabinet({f,color}:{f:Fixture;color:string}) {
  const w=f.widthIn,d=f.depthIn,h=f.heightIn,wall=(f.yIn??0)>40;
  const toe=wall?0:4,bodyH=h-toe,kind=String(f.options?.kitchenKind);
  const glass=kind==='glass_upper';
  const open=kind==='plate_rack'||kind==='open_upper'||glass;
  return <>
    {!wall&&<Part size={[w-.5,toe,d-3]} at={[0,toe/2,-1.5]} color="#958b77"/>}
    <Part size={[w,.75,d]} at={[0,toe+.375,0]} color={color}/>
    <Part size={[w,.75,d]} at={[0,h-.375,0]} color={color}/>
    <Part size={[w,bodyH,.6]} at={[0,toe+bodyH/2,-d/2+.3]} color={color}/>
    {[-1,1].map(s=><Part key={s} size={[.75,bodyH,d]} at={[s*(w-.75)/2,toe+bodyH/2,0]} color={color}/>)}
    {open ? Array.from({length:kind==='plate_rack'?7:glass?3:2},(_,i)=>{
      const count=kind==='plate_rack'?7:glass?4:2,step=(bodyH-1)/count,yy=toe+(glass?i+1:i)*step;
      return <group key={i}><Part size={[w-1.5,.65,d-.7]} at={[0,yy+.325,.1]} color={color}/>
        {kind==='plate_rack'&&<mesh position={[0,yy+step/2+.35,d/2-2]} rotation={[Math.PI/2,0,0]} castShadow><cylinderGeometry args={[Math.min(5,(w-3)/2),Math.min(4.6,(w-4)/2),.55,40]}/><meshStandardMaterial color="#fffdf6" roughness={.18}/></mesh>}
      </group>;
    }): kind==='drawers' ? [0,1,2].map(i=><Front key={i} y={toe+(i+.5)*bodyH/3} z={d/2-.25} w={w-.2} h={bodyH/3-.15} color={color} drawer/>): <>
      {Array.from({length:w>23&&kind!=='dishwasher'?2:1},(_,i)=>{
        const n=w>23&&kind!=='dishwasher'?2:1,fw=w/n;
        return <Front key={i} x={-w/2+fw*(i+.5)} y={toe+bodyH/2} z={d/2-.25} w={fw-.15} h={bodyH-.15} color={color}/>;
      })}
    </>}
    {glass&&<group position={[0,toe+bodyH/2,d/2]}>
      {[-1,1].map(s=><Fragment key={s}><Part size={[1.8,bodyH-.15,.7]} at={[s*(w-1.95)/2,0,0]} color={color}/><Part size={[w-3.6,1.8,.7]} at={[0,s*(bodyH-1.95)/2,0]} color={color}/></Fragment>)}
      <mesh><boxGeometry args={[w-3.7,bodyH-3.7,.12]}/><meshPhysicalMaterial color="#eaf5f3" transparent opacity={.18} roughness={.08} metalness={.05} depthWrite={false}/></mesh>
      <Pull x={w/2-3} y={-bodyH/2+5} z={.5} length={4} vertical/>
    </group>}
    {(wall||h>80)&&<>
      <Part size={[w,1,d+.4]} at={[0,h-.5,.2]} color={color}/>
      <Part size={[w+.5,1.3,d+1]} at={[0,h-1.65,.5]} color={color}/>
      <Part size={[w,1,d+.6]} at={[0,h-2.8,.3]} color={color}/>
    </>}
  </>;
}
function Range({f}:{f:Fixture}) {
  const w=f.widthIn,d=f.depthIn,h=f.heightIn;
  return <>
    <Part size={[w-.3,h-1,d-1]} at={[0,(h-1)/2,-.5]} color={STEEL} metal/>
    <Part size={[w-.3,.7,d-.3]} at={[0,h-.35,0]} color="#121a1e" rough={.12}/>
    {[[-w*.24,-d*.2,4.4],[w*.23,-d*.21,3.5],[-w*.24,d*.21,3.4],[w*.23,d*.19,4.7]].map(([x,z,r],i)=><mesh key={i} position={[x,h+.02,z]} rotation={[-Math.PI/2,0,0]}><ringGeometry args={[r-.06,r,48]}/><meshBasicMaterial color="#879098"/></mesh>)}
    <Part size={[w-2,4,.5]} at={[0,h-3,d/2]} color={STEEL} metal/>
    <Part size={[7,1.7,.12]} at={[0,h-3,d/2+.3]} color={BLACK} rough={.12}/>
    {[-.37,-.23,.23,.37].map(x=><mesh key={x} position={[w*x,h-3,d/2+.8]} rotation={[Math.PI/2,0,0]}><cylinderGeometry args={[.7,.7,.6,20]}/><meshStandardMaterial color={STEEL} metalness={.8} roughness={.2}/></mesh>)}
    <Part size={[w-3,h-10,.65]} at={[0,(h-10)/2+3,d/2]} color="#353b3e"/>
    <Part size={[w-7,h-18,.2]} at={[0,(h-10)/2+3,d/2+.4]} color="#17232a" rough={.13}/>
    <Pull y={h-8} z={d/2+.6} length={w-6}/>
    <Part size={[w-1,2,.6]} at={[0,1.5,d/2]} color="#33383a"/>
  </>;
}
function Microwave({f}:{f:Fixture}) {
  const w=f.widthIn,d=f.depthIn,h=f.heightIn;
  return <><Part size={[w,h,d]} at={[0,h/2,0]} color={STEEL} metal/>
    <Part size={[w-2,h-3,.25]} at={[0,h/2,d/2+.13]} color={BLACK} rough={.16}/>
    <Part size={[w-9,h-6,.15]} at={[-2,h/2,d/2+.3]} color="#28343a" rough={.2}/>
    <Pull x={w/2-6} y={h/2} z={d/2+.4} length={h-6} vertical/>
    <Part size={[3,1,.1]} at={[w/2-2.4,h-4,d/2+.4]} color="#83a7a1"/>
    {[0,1,2].map(i=><Part key={i} size={[w-3,.18,.2]} at={[0,h-1-i*.35,d/2+.2]} color="#343a3d"/>)}</>;
}
function Refrigerator({f}:{f:Fixture}) {
  const w=f.widthIn,d=f.depthIn,h=f.heightIn,split=h*.32;
  return <><Part size={[w-.2,h,d-.5]} at={[0,h/2,-.25]} color="#81878b" metal/>
    <Part size={[w-.35,h-split-.25,1.6]} at={[0,(h+split)/2,d/2-.8]} color={STEEL} metal rough={.3}/>
    <Part size={[w-.35,split-.4,1.6]} at={[0,split/2,d/2-.8]} color={STEEL} metal rough={.3}/>
    <Pull x={w/2-2.5} y={h*.65} z={d/2} length={h*.36} vertical/>
    <Pull y={split-3} z={d/2} length={w-6}/>
    <Part size={[w-2,1,.3]} at={[0,.6,d/2]} color="#34393a"/>
  </>;
}
function Sink({f}:{f:Fixture}) {
  const w=f.widthIn,d=f.depthIn,h=f.heightIn;
  const curve=useMemo(()=>new THREE.CatmullRomCurve3([new THREE.Vector3(0,h,-d/2+1),new THREE.Vector3(0,h+10,-d/2+1),new THREE.Vector3(0,h+14,-d/2+5),new THREE.Vector3(0,h+10,-d/2+9)]),[d,h]);
  return <>
    <Part size={[w,h,.85]} at={[0,h/2,d/2-.425]} color="#f9f8f1" rough={.18}/>
    <Part size={[w,h,.85]} at={[0,h/2,-d/2+.425]} color="#f9f8f1" rough={.18}/>
    {[-1,1].map(s=><Part key={s} size={[.85,h,d]} at={[s*(w-.85)/2,h/2,0]} color="#f9f8f1" rough={.18}/>)}
    <Part size={[w-1,.7,d-1]} at={[0,.35,0]} color="#e4e4dc" rough={.2}/>
    <mesh position={[0,.76,0]} rotation={[-Math.PI/2,0,0]}><circleGeometry args={[1.65,24]}/><meshStandardMaterial color={STEEL} metalness={.8} roughness={.2}/></mesh>
    <mesh castShadow><tubeGeometry args={[curve,40,.38,12,false]}/><meshStandardMaterial color={STEEL} metalness={.9} roughness={.18}/></mesh>
    <Pull x={2} y={h+2} z={-d/2+1} length={3} vertical/>
  </>;
}
export function KitchenFixture({f,spec}:{f:Fixture;spec:RoomSpec}) {
  const kind=String(f.options?.kitchenKind),color=findMaterial(spec,f.materialId)?.baseColor??'#e7e0d1';
  return <group scale={1/12}>
    {kind==='beadboard'?<>
      <Part size={[f.widthIn,f.heightIn,f.depthIn]} at={[0,f.heightIn/2,0]} color={color}/>
      {Array.from({length:Math.floor(f.widthIn/2.5)},(_,i)=><Part key={i} size={[.055,f.heightIn,.06]} at={[-f.widthIn/2+(i+1)*2.5,f.heightIn/2,f.depthIn/2+.02]} color="#b5b0a5"/>)}
    </>:kind==='range'?<Range f={f}/>:kind==='microwave'?<Microwave f={f}/>:kind==='refrigerator'?<Refrigerator f={f}/>:kind==='sink'?<Sink f={f}/>:<Cabinet f={f} color={color}/>}
  </group>;
}

