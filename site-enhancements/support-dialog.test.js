import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import test from 'node:test';

const source=fs.readFileSync(new URL('./site-experience.php',import.meta.url),'utf8');
const script=source.match(/<script id="pv-site-experience-js">([\s\S]*?)<\/script>/)[1];
function boot({storage=new Map(),blocked=false,en=false}={}) {
  let now=0,interval;
  const events={},elements={};
  const element=()=>({open:false,addEventListener(name,fn){(this.handlers ||= {})[name]=fn;},setAttribute(){},querySelector(selector){return elements[selector] ||= element();},querySelectorAll(){return [];},showModal(){this.open=true;this.shown=(this.shown||0)+1;},close(){this.open=false;},focus(){}});
  const dialog=element();
  const document={hidden:false,activeElement:element(),getElementById(){return null;},querySelectorAll(){return [];},querySelector(){return null;},createElement(){return dialog;},body:{appendChild(){}},documentElement:{classList:{add(){},remove(){}}},addEventListener(name,fn){events[name]=fn;}};
  const c={brand:en?'GreenBetTips.com':'PariuVerde.ro',youtube:'https://www.youtube.com/@pontverde',facebook:'https://www.facebook.com/',instagram:'https://www.instagram.com/',tiktok:'https://www.tiktok.com/',telegram:'https://t.me/pariuverde'};
  vm.runInNewContext(script.replace('<?php echo $json; ?>',JSON.stringify(c)),{document,window:{addEventListener(name,fn){events[name]=fn;}},location:{hostname:en?'greenbettips.com':'pariuverde.ro'},URL,URLSearchParams,performance:{now:()=>now},sessionStorage:{getItem(k){if(blocked)throw Error();return storage.get(k)||null;},setItem(k,v){if(blocked)throw Error();storage.set(k,v);}},setInterval(fn){interval=fn;}});
  return {dialog,storage,advance(ms){now+=ms;interval();},visibility(hidden){document.hidden=hidden;events.visibilitychange();},pagehide(){events.pagehide();}};
}
test('exact 5/15/30 minute thresholds, no fourth splash',()=>{
  const b=boot();
  b.advance(299999);assert.equal(b.dialog.open,false);
  b.advance(1);assert.equal(b.dialog.shown,1);b.dialog.close();
  b.advance(599999);assert.equal(b.dialog.open,false);
  b.advance(1);assert.equal(b.dialog.shown,2);b.dialog.close();
  b.advance(900000);assert.equal(b.dialog.shown,3);b.dialog.close();
  b.advance(3600000);assert.equal(b.dialog.shown,3);
});
test('navigation preserves elapsed time and milestones',()=>{
  const a=boot();a.advance(240000);a.pagehide();
  const b=boot({storage:a.storage});b.advance(60000);assert.equal(b.dialog.shown,1);
  const c=boot({storage:b.storage});c.advance(1000);assert.equal(c.dialog.open,false);
});
test('hidden tabs do not accumulate browsing time',()=>{
  const b=boot();b.advance(60000);b.visibility(true);b.advance(3600000);b.visibility(false);
  assert.equal(b.dialog.open,false);b.advance(240000);assert.equal(b.dialog.shown,1);
});
test('storage failures do not break support links or timers; both languages render',()=>{
  for(const en of [false,true]) {
    const b=boot({blocked:true,en});b.advance(300000);assert.equal(b.dialog.open,true);
    assert.match(b.dialog.innerHTML,/business=radujit%40hotmail.com/);
    assert.match(b.dialog.innerHTML,en?/Donate with PayPal/:/Donează prin PayPal/);
    assert.match(b.dialog.innerHTML,/currency_code=EUR/);
  }
});
test('a dialog left open does not stack overdue prompts',()=>{
  const b=boot();b.advance(300000);b.advance(1800000);assert.equal(b.dialog.shown,1);
  b.dialog.close();b.advance(1000);assert.equal(b.dialog.shown,2);
  b.dialog.close();b.advance(1000);assert.equal(b.dialog.shown,2);
});

