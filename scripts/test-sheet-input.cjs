const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),ts=require('typescript');
let effect,queue=[],events={},observer,scrolls=[];
class HTMLElement {matches(){return true;}getBoundingClientRect(){return this.box;}}
const field=new HTMLElement();field.box={top:700,bottom:820,height:120};
const viewport={offsetTop:0,height:600,addEventListener(k,f){events[k]=f;},removeEventListener(k){delete events[k];}};
const body={contains:e=>e===field,getBoundingClientRect:()=>({top:200,bottom:560}),scrollBy:x=>scrolls.push(x.top),addEventListener(k,f){events[k]=f;},removeEventListener(k){delete events[k];}};
const document={activeElement:field};const exportsObj={};
vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/hooks/use-visible-sheet-input.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports:exportsObj,require:()=>({useEffect:f=>effect=f}),HTMLElement,document,window:{visualViewport:viewport},requestAnimationFrame:f=>{queue.push(f);return queue.length;},cancelAnimationFrame:()=>{},ResizeObserver:class{constructor(f){observer=f;}observe(){}disconnect(){}}});
exportsObj.useVisibleSheetInput(true,body);const cleanup=effect();
const flush=()=>{while(queue.length)queue.shift()();};flush();assert.equal(scrolls.pop(),272);
field.box={top:250,bottom:370,height:120};events.resize();flush();assert.equal(scrolls.length,0);
viewport.height=320;events.resize();flush();assert.equal(scrolls.pop(),38);
document.activeElement=new HTMLElement();observer();flush();assert.equal(scrolls.length,0);
cleanup();assert.equal(Object.keys(events).length,0);
console.log('PASS: keyboard-covered field scrolls inside sheet, visible field stays still, viewport shrink rechecks, outside focus ignored, listeners cleaned up.');

