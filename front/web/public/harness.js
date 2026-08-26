// DOTCADE — 게임팩 하네스 (프론트/공유 플레이어 공용)
// window.buildGameSrcdoc(code, {mode:'play'|'bot', seed, bot:{strategy,aggression,intervalMs,holdMs,durationMs}})
;(function () {
  function buildGameSrcdoc(code, opts) {
    opts = opts || {}
    var token = opts.token || ('gp' + Math.floor(Math.random() * 1e9))
    var mode = opts.mode || 'play'
    var seed = opts.seed || Math.floor(Math.random() * 2147483647)
    var botSeed = opts.botSeed || ((seed ^ 0x9e3779b9) >>> 0)
    var bot = JSON.stringify(opts.bot || null)
    var quality = !!opts.quality
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
  var TOKEN=${JSON.stringify(token)}, MODE=${JSON.stringify(mode)}, BOT=${bot}, QUALITY=${JSON.stringify(quality)};
  var GAME_SEED=${seed}, BOT_SEED=${botSeed};
  var send=function(type,data){ try{ parent.postMessage(Object.assign({gp:TOKEN,type:type},data||{}), '*') }catch(e){} }
  var score=0, over=false, started=Date.now(), presses=0, errors=[], botRuntime=null;
  var semanticEvents=[], observations=[], lastObservation=null, lastObservationSent=0;
  var qualityCanvas=null, qualityCtx=null;
  var qualityState={
    text:{samples:0,seen:{},clipped:[],unsafe:[],squashed:[]},
    screens:{samples:[]}
  };
  var _seed=GAME_SEED, _botSeed=BOT_SEED;
  function elapsed(){ return Date.now()-started }
  function botRng(){ _botSeed=(_botSeed*1103515245+12345)>>>0; return _botSeed/4294967296 }
  function clean(value,depth){
    depth=depth||0;
    if(value==null||typeof value==='number'||typeof value==='boolean') return value;
    if(typeof value==='string') return value.slice(0,180);
    if(depth>=2) return String(value).slice(0,100);
    if(Array.isArray(value)) return value.slice(0,10).map(function(v){return clean(v,depth+1)});
    if(typeof value==='object'){
      var out={}; Object.keys(value).slice(0,14).forEach(function(k){out[String(k).slice(0,40)]=clean(value[k],depth+1)}); return out;
    }
    return String(value).slice(0,100);
  }
  function finite(n){ return typeof n==='number'&&isFinite(n) }
  function pushUnique(list,item,key){
    if(list.length>=10)return;
    for(var i=0;i<list.length;i++)if(list[i].key===key)return;
    item.key=key; list.push(item);
  }
  function textBounds(ctx,text,x,y,maxWidth){
    var metric=ctx.measureText(text), fontMatch=String(ctx.font||'10px sans-serif').match(/([0-9.]+)px/i);
    var fontPx=fontMatch?Number(fontMatch[1]):10, naturalWidth=Number(metric.width)||0, width=naturalWidth;
    if(finite(maxWidth)&&maxWidth>0)width=Math.min(width,maxWidth);
    var transform=ctx.getTransform?ctx.getTransform():{a:1,b:0,c:0,d:1,e:0,f:0};
    var px=transform.a*x+transform.c*y+transform.e, py=transform.b*x+transform.d*y+transform.f;
    var scaleX=Math.sqrt(transform.a*transform.a+transform.b*transform.b)||1;
    var scaleY=Math.sqrt(transform.c*transform.c+transform.d*transform.d)||1;
    width*=scaleX; fontPx*=scaleY;
    var left=px, align=ctx.textAlign||'start';
    if(align==='center')left-=width/2; else if(align==='right'||align==='end')left-=width;
    var ascent=finite(metric.actualBoundingBoxAscent)?metric.actualBoundingBoxAscent*scaleY:fontPx*.8;
    var descent=finite(metric.actualBoundingBoxDescent)?metric.actualBoundingBoxDescent*scaleY:fontPx*.2;
    var top=py-ascent, bottom=py+descent, baseline=ctx.textBaseline||'alphabetic';
    if(baseline==='top'||baseline==='hanging'){top=py;bottom=py+fontPx}
    else if(baseline==='middle'){top=py-fontPx/2;bottom=py+fontPx/2}
    else if(baseline==='bottom'||baseline==='ideographic'){top=py-fontPx;bottom=py}
    return {left:left,right:left+width,top:top,bottom:bottom,width:width,naturalWidth:naturalWidth*scaleX,fontPx:fontPx};
  }
  function instrumentText(ctx,c){
    if(!QUALITY||ctx.__gpQualityText)return; ctx.__gpQualityText=true;
    ['fillText','strokeText'].forEach(function(method){
      var original=ctx[method]; if(typeof original!=='function')return;
      ctx[method]=function(value,x,y,maxWidth){
        try{
          var text=String(value==null?'':value), b=textBounds(ctx,text,Number(x)||0,Number(y)||0,maxWidth);
          var key=text.slice(0,80)+'|'+Math.round(b.left)+'|'+Math.round(b.top)+'|'+Math.round(b.width)+'|'+String(ctx.font);
          if(!qualityState.text.seen[key]&&qualityState.text.samples<600){
            qualityState.text.seen[key]=1; qualityState.text.samples++;
            var detail={text:text.slice(0,80),left:Math.round(b.left),right:Math.round(b.right),top:Math.round(b.top),bottom:Math.round(b.bottom),width:Math.round(b.width),naturalWidth:Math.round(b.naturalWidth)};
            if(b.left<0||b.right>c.width||b.top<0||b.bottom>c.height)pushUnique(qualityState.text.clipped,detail,key);
            if(text.trim().length>=2&&b.fontPx>=9&&(b.left<12||b.right>c.width-12||b.top<12||b.bottom>c.height-12))pushUnique(qualityState.text.unsafe,detail,key);
            if(text.trim().length>=4&&b.naturalWidth>0&&b.width/b.naturalWidth<.68)pushUnique(qualityState.text.squashed,detail,key);
          }
        }catch(e){}
        return original.apply(ctx,arguments);
      };
    });
  }
  function frameSignature(){
    if(!qualityCanvas||!qualityCtx)return [];
    try{
      var cols=8,rows=6,out=[];
      for(var gy=0;gy<rows;gy++)for(var gx=0;gx<cols;gx++){
        var x=Math.min(qualityCanvas.width-1,Math.floor((gx+.5)*qualityCanvas.width/cols));
        var y=Math.min(qualityCanvas.height-1,Math.floor((gy+.5)*qualityCanvas.height/rows));
        var p=qualityCtx.getImageData(Math.max(0,x-2),Math.max(0,y-2),5,5).data;
        var r=0,g=0,b=0,count=Math.max(1,p.length/4);
        for(var i=0;i<p.length;i+=4){r+=p[i];g+=p[i+1];b+=p[i+2]}
        out.push((r/count)>>4,(g/count)>>4,(b/count)>>4);
      }
      return out;
    }catch(e){return []}
  }
  function qualityReport(){
    return {
      text:{samples:qualityState.text.samples,clipped:qualityState.text.clipped.slice(),unsafe:qualityState.text.unsafe.slice(),squashed:qualityState.text.squashed.slice()},
      screens:{samples:qualityState.screens.samples.slice()}
    };
  }
  function sendQuality(){ if(QUALITY)send('qualitycheck',{quality:qualityReport()}) }
  function recordScreen(payload){
    if(!QUALITY)return;
    var id=String(payload&&((payload.id||payload.screen||payload.state))||'').trim().toLowerCase().replace(/[^a-z0-9\uac00-\ud7a3]+/g,'-');
    if(!id)return;
    setTimeout(function(){
      qualityState.screens.samples.push({id:id,ms:elapsed(),signature:frameSignature()});
      if(qualityState.screens.samples.length>20)qualityState.screens.samples.shift();
      sendQuality();
    },90);
  }
  function collectEvent(type,payload){
    var ev={ms:elapsed(),type:String(type||'event').slice(0,40),payload:clean(payload||{}),action:botRuntime&&botRuntime.lastAction||null};
    semanticEvents.push(ev); if(semanticEvents.length>36) semanticEvents.shift();
    if(botRuntime) botRuntime.onEvent(ev);
    send('game-event',{event:ev});
    if(String(type||'').toLowerCase()==='screen')recordScreen(payload||{});
  }
  var api={
    reportScore:function(n){
      var prev=score; score=Number(n)||0;
      if(botRuntime) botRuntime.onScore(score,prev);
      send('score',{score:score});
    },
    gameOver:function(n){
      if(over)return; over=true; if(n!=null)score=Number(n)||score;
      var base={score:score,ms:elapsed(),presses:presses,errors:errors.length};
      sendQuality();
      send('over',Object.assign(base,botRuntime?botRuntime.finish('game over'):{}));
    },
    rng:function(){ _seed=(_seed*1664525+1013904223)>>>0; return _seed/4294967296 },
    // Optional semantic instrumentation. Existing games do not need to call either method.
    emit:function(type,payload){ collectEvent(type,payload) },
    observe:function(payload){
      lastObservation={ms:elapsed(),payload:clean(payload||{})};
      observations.push(lastObservation); if(observations.length>24) observations.shift();
      if(botRuntime) botRuntime.onObservation(lastObservation);
      if(elapsed()-lastObservationSent>420){ lastObservationSent=elapsed(); send('observation',{observation:lastObservation}) }
    }
  };
  window.addEventListener('error',function(e){
    errors.push(String(e.message));
    if(botRuntime) botRuntime.onError(String(e.message));
    send('error',{message:String(e.message),line:e.lineno||0});
  });
  function codeToKey(c){ if(c==='Space')return ' '; if(c&&c.indexOf('Arrow')===0)return c.slice(5); if(c&&c.indexOf('Key')===0)return c.slice(3).toLowerCase(); return c }
  function dispatchKey(code,down){
    presses+=down?1:0;
    var ev=new KeyboardEvent(down?'keydown':'keyup',{code:code,key:codeToKey(code),bubbles:true,cancelable:true});
    window.dispatchEvent(ev); document.dispatchEvent(ev);
  }
  window.addEventListener('message',function(ev){
    var d=ev.data||{}; if(d.gp!==TOKEN)return;
    if(d.type==='key') dispatchKey(d.code,d.down);
    if(d.type==='stop'){ try{ window.game&&window.game.stop&&window.game.stop() }catch(e){} }
  });
  window.addEventListener('keydown',function(e){ if(['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Space'].indexOf(e.code)>=0)e.preventDefault() },{passive:false});
  function boot(){
    try{
      if(!window.game||typeof window.game.start!=='function') throw new Error('window.game.start 미정의 — 게임팩 계약 위반');
      var meta=window.game.meta||{};
      var c=document.getElementById('__gp_canvas');
      c.width=(meta.viewport&&meta.viewport.w)||360; c.height=(meta.viewport&&meta.viewport.h)||480;
      qualityCanvas=c; qualityCtx=c.getContext('2d'); instrumentText(qualityCtx,c);
      var fit=function(){ var s=Math.min((innerWidth-8)/c.width,(innerHeight-8)/c.height); s=Math.min(s,3);
        c.style.width=Math.floor(c.width*s)+'px'; c.style.height=Math.floor(c.height*s)+'px' };
      fit(); window.addEventListener('resize',fit);
      window.game.start(c,api);
      send('ready',{meta:{
        title:meta.title||'무제',desc:meta.desc||'',controls:meta.controls||[],
        viewport:meta.viewport||null,visual:meta.visual||null,
        reference:meta.reference||null,designContract:meta.designContract||null
      },seed:GAME_SEED});
      setTimeout(function(){
        try{
          var ctx=c.getContext('2d'),img=ctx.getImageData(0,0,c.width,c.height),px=img.data;
          var lit=0,regions=[0,0,0],colors={};
          for(var y=0;y<c.height;y+=4) for(var x=0;x<c.width;x+=4){
            var i=(y*c.width+x)*4,r=px[i],g=px[i+1],b=px[i+2];
            if(r>16||g>16||b>16){lit++;regions[Math.min(2,Math.floor(y/c.height*3))]++}
            colors[(r>>5)+'-'+(g>>5)+'-'+(b>>5)]=1;
          }
          send('drawcheck',{lit:lit,regions:regions,colors:Object.keys(colors).length});
          sendQuality();
        }catch(err){ send('drawcheck',{lit:-1}) }
      },1600);
      if(MODE==='bot'&&!over) {
        if(QUALITY)runQualityProbe(meta,function(){if(!over)runBot(meta)});
        else runBot(meta);
      }
    }catch(err){ send('fatal',{message:String(err&&err.message||err)}) }
  }
  function tapKey(code,next){
    dispatchKey(code,true); setTimeout(function(){dispatchKey(code,false);setTimeout(next||function(){},55)},55);
  }
  // 새 게임의 표준 타이틀 내비게이션을 실제로 밟는다. 선언된 보조 화면을
  // 순서대로 열고 Escape로 복귀한 뒤 gameplay를 시작하므로 renderer 토큰만
  // 존재하는 죽은 화면은 품질 게이트를 통과할 수 없다.
  function runQualityProbe(meta,done){
    var screens=meta&&meta.visual&&Array.isArray(meta.visual.screens)?meta.visual.screens:[];
    var aux=screens.filter(function(id){return ['title','gameplay','result'].indexOf(String(id).toLowerCase())<0}).slice(0,4);
    var index=0;
    function openNext(){
      if(index>=aux.length){ tapKey('Space',function(){setTimeout(done,180)}); return }
      var downs=index+1,step=0;
      function down(){
        if(step++<downs){tapKey('ArrowDown',down);return}
        tapKey('Space',function(){setTimeout(function(){tapKey('Escape',function(){index++;setTimeout(openNext,100)})},180)});
      }
      down();
    }
    setTimeout(openNext,220);
  }
  function runBot(meta){
    var controls=(meta.controls&&meta.controls.length?meta.controls.slice():['Space','ArrowLeft','ArrowRight','ArrowUp','ArrowDown'])
      .filter(function(k){return typeof k==='string'&&k!=='Enter'&&k!=='Escape'});
    if(!controls.length) controls=['Space','ArrowLeft','ArrowRight','ArrowUp','ArrowDown'];
    var B=BOT||{strategy:{key:'explorer',label:'Explorer',icon:'🧭',goal:'조작 탐색'},aggression:0.55,intervalMs:150,holdMs:140,durationMs:15000};
    var strategy=B.strategy||{key:'explorer',label:'Explorer',icon:'🧭',goal:'조작 탐색'};
    var key=strategy.key||'explorer', end=Date.now()+(B.durationMs||15000), duration=B.durationMs||15000;
    var singles=controls.map(function(k){return [k]}), combos=[];
    var opposite={ArrowLeft:'ArrowRight',ArrowRight:'ArrowLeft',ArrowUp:'ArrowDown',ArrowDown:'ArrowUp'};
    for(var ci=0;ci<controls.length;ci++) for(var cj=ci+1;cj<controls.length;cj++){
      if(combos.length<10) combos.push([controls[ci],controls[cj]]);
    }
    var stats={}, actionCounts={}, held={}, recent=[], evidence=[], highlights=[], scoreTimeline=[];
    var lastStateSent=0, lastAction=null, lastActionAt=0, lastScoreAt=0, actionN=0, observationN=0;
    var phase='준비', bestAction=null, lastSuggested=[], lastAvoid=[];
    controls.forEach(function(k){actionCounts[k]=0});
    function signature(action){return action.join('+')}
    function stat(sig){return stats[sig]||(stats[sig]={tries:0,reward:0,positive:0})}
    function reward(sig,amount){ if(!sig||!isFinite(amount))return; var s=stat(sig); s.reward+=amount; if(amount>0)s.positive++ }
    function best(actions){
      var list=(actions&&actions.length?actions:singles), winner=list[0], value=-Infinity;
      list.forEach(function(a){var s=stat(signature(a));var v=s.reward/(s.tries||1)+s.positive*.08-s.tries*.002;if(v>value){value=v;winner=a}});
      return winner;
    }
    function leastTried(actions){
      var list=actions&&actions.length?actions:singles, min=Math.min.apply(null,list.map(function(a){return stat(signature(a)).tries}));
      var pool=list.filter(function(a){return stat(signature(a)).tries===min}); return pool[Math.floor(botRng()*pool.length)];
    }
    function addEvidence(type,label,extra){
      var ev=Object.assign({ms:elapsed(),type:type,label:String(label).slice(0,120),action:lastAction,score:score},extra||{});
      evidence.push(ev); if(evidence.length>28)evidence.shift();
      highlights.push(ev.label); if(highlights.length>8)highlights.shift();
      send('agent-event',{event:ev});
    }
    function rate(){var sec=Math.max(1,elapsed()/1000);return +(score/sec).toFixed(2)}
    function emitState(force,highlight){
      if(!force&&elapsed()-lastStateSent<420)return; lastStateSent=elapsed();
      send('agent-state',{
        strategy:strategy,goal:strategy.goal||'',phase:phase,action:lastAction||'게임 관찰 중',bestAction:bestAction,
        score:score,scoreRate:rate(),presses:presses,actionCounts:Object.assign({},actionCounts),
        uniqueActions:Object.keys(stats).filter(function(k){return stats[k].tries>0}).length,
        highlight:highlight||highlights[highlights.length-1]||'',seed:GAME_SEED,botSeed:BOT_SEED
      });
    }
    function updateBest(){
      var next=signature(best(singles.concat(combos)));
      if(next&&next!==bestAction&&stat(next).reward>0){ bestAction=next; addEvidence('learning','고효율 행동 발견: '+next,{reward:+stat(next).reward.toFixed(2)}) }
      else bestAction=next;
    }
    function scoreChanged(next,prev){
      var delta=next-prev, sig=recent.length?recent[recent.length-1].sig:lastAction;
      reward(sig,delta); if(delta>0)lastScoreAt=elapsed();
      if(!scoreTimeline.length||elapsed()-scoreTimeline[scoreTimeline.length-1].ms>320||delta<0){
        scoreTimeline.push({ms:elapsed(),score:next,delta:delta,action:sig}); if(scoreTimeline.length>48)scoreTimeline.shift();
      }
      updateBest(); emitState(delta!==0,delta>0?'점수 +'+delta:null);
    }
    function eventReward(ev){
      var p=ev.payload||{}; if(isFinite(Number(p.reward)))return Number(p.reward);
      if(isFinite(Number(p.value))&&/collect|combo|bonus|reward|score/i.test(ev.type))return Number(p.value);
      if(/collect|combo|level|checkpoint|success|reward/i.test(ev.type))return 2;
      if(/hit|damage|death|miss|fail|error/i.test(ev.type))return -2;
      return 0;
    }
    function semantic(ev){
      var amount=eventReward(ev); reward(ev.action||lastAction,amount);
      if(amount!==0)addEvidence(amount>0?'reward':'risk',(amount>0?'보상 이벤트 ':'위험 이벤트 ')+ev.type,{semantic:true,reward:amount});
      updateBest(); emitState(true);
    }
    function observed(obs){
      observationN++;
      var p=obs.payload||{};
      lastSuggested=(Array.isArray(p.suggestedActions)?p.suggestedActions:[]).filter(function(k){return controls.indexOf(k)>=0}).slice(0,2);
      lastAvoid=(Array.isArray(p.avoidActions)?p.avoidActions:[]).filter(function(k){return controls.indexOf(k)>=0}).slice(0,3);
      if(p.danger!=null&&Number(p.danger)>.7&&key==='survivor')phase='위험 감지 · 안전 행동 선택';
    }
    function chooseAction(progress){
      var allowed=singles.filter(function(a){return lastAvoid.indexOf(a[0])<0}); if(!allowed.length)allowed=singles;
      if(lastSuggested.length&&key!=='bugBreaker'&&botRng()<.68)return [lastSuggested[Math.floor(botRng()*lastSuggested.length)]];
      if(key==='bugBreaker'){
        phase=combos.length&&botRng()<.7?'동시·반대 입력 압박':'고속 연타 테스트';
        return combos.length&&botRng()<.72?combos[Math.floor(botRng()*combos.length)]:singles[Math.floor(botRng()*singles.length)];
      }
      if(key==='survivor'){
        phase='안전 패턴 유지';
        var safe=allowed.filter(function(a){return !(lastAction&&opposite[lastAction]===a[0])}); if(!safe.length)safe=allowed;
        return lastAction&&controls.indexOf(lastAction)>=0&&botRng()<.55?[lastAction]:(botRng()<.72?best(safe):leastTried(safe));
      }
      if(key==='scoreHunter'){
        phase=progress<.22?'득점 행동 스캔':'고득점 패턴 반복';
        return progress<.22?leastTried(allowed):(botRng()<.18||elapsed()-lastScoreAt>2200?leastTried(allowed):best(singles.concat(combos.length?combos:[])));
      }
      if(key==='learner'){
        phase=progress<.42?'학습 1단계 · 탐색':'학습 2단계 · 활용';
        return progress<.42?leastTried(singles.concat(combos.slice(0,3))):(botRng()<.2?leastTried(allowed):best(singles.concat(combos)));
      }
      phase='조작 공간 탐색';
      return botRng()<.28&&combos.length?leastTried(combos):leastTried(allowed);
    }
    function holdFor(action){
      var base=B.holdMs||140;
      if(key==='survivor')return base*(1.5+botRng());
      if(key==='bugBreaker')return botRng()<.25?base*(2+botRng()*2):35+botRng()*90;
      if(key==='scoreHunter'&&signature(action)===bestAction)return base*(1.15+botRng());
      return 45+botRng()*base;
    }
    function intervalFor(){
      var mul={explorer:.8,scoreHunter:.82,survivor:1.3,bugBreaker:.42,learner:.9}[key]||1;
      if(elapsed()-lastScoreAt>2400&&key!=='survivor')mul*=.72;
      return Math.max(38,(B.intervalMs||150)*mul*(.72+botRng()*.56));
    }
    function act(action){
      action=action.filter(function(k,i,a){return controls.indexOf(k)>=0&&a.indexOf(k)===i}); if(!action.length)return;
      var sig=signature(action), token=String(elapsed())+'-'+String(actionN++), hold=holdFor(action);
      lastAction=sig; lastActionAt=elapsed(); stat(sig).tries++;
      recent.push({ms:lastActionAt,sig:sig}); if(recent.length>10)recent.shift();
      action.forEach(function(k){actionCounts[k]=(actionCounts[k]||0)+1;held[k]=token;dispatchKey(k,true)});
      setTimeout(function(){action.forEach(function(k){if(held[k]===token){dispatchKey(k,false);delete held[k]}})},hold);
      if(action.length>1&&key==='bugBreaker'&&actionN%4===0)addEvidence('probe','동시 입력 테스트: '+sig);
      emitState(false);
    }
    function releaseAll(){Object.keys(held).forEach(function(k){dispatchKey(k,false)});held={}}
    function summary(reason){
      if(!scoreTimeline.length||scoreTimeline[scoreTimeline.length-1].score!==score)scoreTimeline.push({ms:elapsed(),score:score,delta:0,action:lastAction});
      return {
        strategy:strategy,seed:GAME_SEED,botSeed:BOT_SEED,phase:phase,currentAction:lastAction,bestAction:bestAction,
        scoreTimeline:scoreTimeline.slice(),actionCounts:Object.assign({},actionCounts),scoreRate:rate(),
        uniqueActions:Object.keys(stats).filter(function(k){return stats[k].tries>0}).length,
        events:semanticEvents.slice(),observations:observations.slice(),observationCount:observationN,
        evidence:evidence.slice(),highlights:highlights.slice(),finishReason:reason
      };
    }
    botRuntime={
      get lastAction(){return lastAction},onScore:scoreChanged,onEvent:semantic,onObservation:observed,
      onError:function(message){addEvidence('error','런타임 오류: '+String(message).slice(0,80));emitState(true)},
      finish:function(reason){releaseAll();addEvidence('finish',(reason==='game over'?'게임오버 도달':'테스트 시간 종료')+' · '+score+'점');emitState(true);return summary(reason)}
    };
    addEvidence('start',(strategy.icon||'🤖')+' '+(strategy.label||key)+' 정책 시작 · 환경 seed '+GAME_SEED);
    emitState(true);
    (function tick(){
      if(over)return;
      if(Date.now()>end){
        over=true;
        var base={score:score,ms:elapsed(),presses:presses,errors:errors.length};
        sendQuality();
        send('timeout',Object.assign(base,botRuntime.finish('timeout')));
        try{window.game&&window.game.stop&&window.game.stop()}catch(e){} return;
      }
      var progress=Math.max(0,Math.min(1,(Date.now()-(end-duration))/duration));
      var chance=Math.min(.98,Math.max(.2,(B.aggression==null?.55:B.aggression)+(key==='bugBreaker'?.16:0)));
      if(botRng()<chance)act(chooseAction(progress));
      setTimeout(tick,intervalFor());
    })();
  }
  if(document.readyState==='complete'||document.readyState==='interactive')setTimeout(boot,0);
  else document.addEventListener('DOMContentLoaded',boot);
})();
<\/script>
<script>
try{
${code}
}catch(__e){parent.postMessage({gp:${JSON.stringify(token)},type:'fatal',message:'구문 오류: '+String(__e&&__e.message||__e)},'*')}
<\/script>
</body></html>`
    return { srcdoc: harness, token: token }
  }
  if (typeof window !== 'undefined') window.buildGameSrcdoc = buildGameSrcdoc
})()
