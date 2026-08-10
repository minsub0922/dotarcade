// DOTCADE — 게임팩 하네스 (프론트/공유 플레이어 공용)
// window.buildGameSrcdoc(code, {mode:'play'|'bot', token, seed, bot:{aggression,intervalMs,holdMs,durationMs}})
;(function () {
  function buildGameSrcdoc(code, opts) {
    opts = opts || {}
    var token = opts.token || ('gp' + Math.floor(Math.random() * 1e9))
    var mode = opts.mode || 'play'
    var seed = opts.seed || Math.floor(Math.random() * 2147483647)
    var bot = JSON.stringify(opts.bot || null)
    var harness = `
<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,user-scalable=no">
<style>
html,body{margin:0;height:100%;background:#0b0d16;overflow:hidden;display:flex;align-items:center;justify-content:center}
canvas{image-rendering:pixelated;image-rendering:crisp-edges;background:#000;box-shadow:0 0 0 3px #262b45,0 0 24px rgba(120,140,255,.25)}
</style></head><body>
<canvas id="__gp_canvas"></canvas>
<script>
(function(){
  var TOKEN=${JSON.stringify(token)}, MODE=${JSON.stringify(mode)}, BOT=${bot};
  var send=function(type,data){ try{ parent.postMessage(Object.assign({gp:TOKEN,type:type},data||{}), '*') }catch(e){} }
  var score=0, over=false, started=Date.now(), presses=0, errors=[];
  var _seed=${seed};
  var api={
    reportScore:function(n){ score=Number(n)||0; send('score',{score:score}) },
    gameOver:function(n){ if(over)return; over=true; if(n!=null)score=Number(n)||score;
      send('over',{score:score,ms:Date.now()-started,presses:presses,errors:errors.length}) },
    rng:function(){ _seed=(_seed*1664525+1013904223)>>>0; return _seed/4294967296 }
  };
  window.addEventListener('error',function(e){ errors.push(String(e.message)); send('error',{message:String(e.message),line:e.lineno||0}) });
  function codeToKey(c){ if(c==='Space')return ' '; if(c&&c.indexOf('Arrow')===0)return c.slice(5); if(c&&c.indexOf('Key')===0)return c.slice(3).toLowerCase(); return c }
  function dispatchKey(code,down){
    presses+=down?1:0;
    var ev=new KeyboardEvent(down?'keydown':'keyup',{code:code,key:codeToKey(code),bubbles:true,cancelable:true});
    window.dispatchEvent(ev); document.dispatchEvent(ev);
  }
  window.addEventListener('message',function(ev){
    var d=ev.data||{}; if(d.gp!==TOKEN)return;
    if(d.type==='key') dispatchKey(d.code, d.down);
    if(d.type==='stop'){ try{ window.game&&window.game.stop&&window.game.stop() }catch(e){} }
  });
  window.addEventListener('keydown',function(e){ if(['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Space'].indexOf(e.code)>=0) e.preventDefault() },{passive:false});
  function boot(){
    try{
      if(!window.game||typeof window.game.start!=='function') throw new Error('window.game.start 미정의 — 게임팩 계약 위반');
      var meta=window.game.meta||{};
      var c=document.getElementById('__gp_canvas');
      c.width=(meta.viewport&&meta.viewport.w)||360; c.height=(meta.viewport&&meta.viewport.h)||480;
      var fit=function(){ var s=Math.min((innerWidth-8)/c.width,(innerHeight-8)/c.height); s=Math.min(s,3);
        c.style.width=Math.floor(c.width*s)+'px'; c.style.height=Math.floor(c.height*s)+'px' };
      fit(); window.addEventListener('resize',fit);
      window.game.start(c,api);
      send('ready',{meta:{title:meta.title||'무제',desc:meta.desc||'',controls:meta.controls||[]}});
      setTimeout(function(){
        try{
          var ctx=c.getContext('2d'); var px=ctx.getImageData(0,0,c.width,c.height).data; var lit=0;
          for(var i=0;i<px.length;i+=173){ if(px[i]>16||px[i+1]>16||px[i+2]>16) lit++ }
          send('drawcheck',{lit:lit});
        }catch(err){ send('drawcheck',{lit:-1}) }
      },1600);
      if(MODE==='bot') runBot(meta);
    }catch(err){ send('fatal',{message:String(err&&err.message||err)}) }
  }
  function runBot(meta){
    var controls=(meta.controls&&meta.controls.length?meta.controls.slice():['Space','ArrowLeft','ArrowRight','ArrowUp','ArrowDown'])
      .filter(function(k){return k!=='Enter'&&k!=='Escape'});
    var B=BOT||{aggression:0.55,intervalMs:150,holdMs:140,durationMs:15000};
    var end=Date.now()+(B.durationMs||15000);
    var lastDir=null;
    (function tick(){
      if(over) return;
      if(Date.now()>end){ send('timeout',{score:score,ms:Date.now()-started,presses:presses,errors:errors.length});
        try{ window.game&&window.game.stop&&window.game.stop() }catch(e){} return }
      if(api.rng()<(B.aggression||0.55)){
        var k;
        if(lastDir&&api.rng()<0.35){ k=lastDir } else { k=controls[Math.floor(api.rng()*controls.length)]; lastDir=k }
        dispatchKey(k,true);
        (function(kk){ setTimeout(function(){ dispatchKey(kk,false) }, 50+api.rng()*(B.holdMs||140)) })(k);
      }
      setTimeout(tick,(B.intervalMs||150)*(0.6+api.rng()*0.8));
    })();
  }
  if(document.readyState==='complete'||document.readyState==='interactive') setTimeout(boot,0);
  else document.addEventListener('DOMContentLoaded',boot);
})();
<\/script>
<script>
try{
${code}
}catch(__e){ parent.postMessage({gp:${JSON.stringify(token)},type:'fatal',message:'구문 오류: '+String(__e&&__e.message||__e)},'*') }
<\/script>
</body></html>`
    return { srcdoc: harness, token: token }
  }
  if (typeof window !== 'undefined') window.buildGameSrcdoc = buildGameSrcdoc
})()
