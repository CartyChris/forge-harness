// forge.apps — build, live-preview and iterate on web apps & games (A2)
const APPS_T = (() => {
  const shell = (title, css, body, js) => '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no"><title>' + title + '</title><style>*{box-sizing:border-box;margin:0;padding:0;-webkit-tap-highlight-color:transparent}html,body{height:100%}body{font-family:system-ui,-apple-system,Segoe UI,sans-serif;background:#0f1220;color:#e8ebf7;display:flex;flex-direction:column;align-items:center;user-select:none;touch-action:manipulation}h1{font-size:20px;margin:14px 0 6px;letter-spacing:.5px}.bar{display:flex;gap:14px;font-size:14px;color:#9aa3c7;margin-bottom:8px}.bar b{color:#fff}button{font:inherit;border:0;border-radius:12px;background:#262c4a;color:#e8ebf7;min-height:44px;padding:0 16px;cursor:pointer}button:active{transform:scale(.96)}.pri{background:linear-gradient(135deg,#7c5cff,#4fb3ff);color:#fff;font-weight:600}' + css + '</style></head><body>' + body + '<script>' + js + '<\/script></body></html>';
  const snake = () => shell('Snake', 'canvas{background:#151a30;border-radius:14px;box-shadow:0 10px 40px #0008;touch-action:none;max-width:94vw}.pad{display:grid;grid-template-columns:repeat(3,58px);gap:8px;margin:14px 0}.pad button{height:58px;font-size:22px}#ov{position:fixed;top:0;right:0;bottom:0;left:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;background:#0f1220cc}#ov.h{display:none}#ov h2{font-size:30px}',
    '<h1>🐍 Snake</h1><div class="bar">Score <b id="sc">0</b> · Best <b id="hi">0</b> · Speed <b id="sp">1</b></div><canvas id="c" width="320" height="320"></canvas><div class="pad"><span></span><button data-d="up">▲</button><span></span><button data-d="left">◀</button><button id="pp">❚❚</button><button data-d="right">▶</button><span></span><button data-d="down">▼</button><span></span></div><div id="ov"><h2 id="ot">Snake</h2><p id="om">Swipe, arrows or d-pad</p><button class="pri" id="go">Play</button></div>',
    `const N=16,S=20,c=document.getElementById('c'),x=c.getContext('2d');let sn,dir,nd,food,score=0,hi=0,tick=140,alive=false,paused=false,t=null;const $=i=>document.getElementById(i);
function place(){do{food={x:Math.random()*N|0,y:Math.random()*N|0}}while(sn.some(p=>p.x==food.x&&p.y==food.y))}
function start(){sn=[{x:8,y:8},{x:7,y:8},{x:6,y:8}];dir=nd={x:1,y:0};score=0;tick=140;alive=true;paused=false;place();$('ov').className='h';upd();loop()}
function loop(){clearTimeout(t);t=setTimeout(()=>{if(!paused)step();if(alive)loop()},tick)}
function upd(){$('sc').textContent=score;$('hi').textContent=hi;$('sp').textContent=Math.round((150-tick)/10)+1}
function step(){dir=nd;const h={x:(sn[0].x+dir.x+N)%N,y:(sn[0].y+dir.y+N)%N};if(sn.some(p=>p.x==h.x&&p.y==h.y))return over();sn.unshift(h);if(h.x==food.x&&h.y==food.y){score++;hi=Math.max(hi,score);tick=Math.max(60,tick-5);place();upd()}else sn.pop();draw()}
function over(){alive=false;$('ot').textContent='Game over';$('om').textContent='Score '+score+' · Best '+hi;$('go').textContent='Play again';$('ov').className=''}
function draw(){x.fillStyle='#151a30';x.fillRect(0,0,320,320);x.fillStyle='#1b2140';for(let i=0;i<N;i++)for(let j=0;j<N;j++)if((i+j)%2)x.fillRect(i*S,j*S,S,S);x.fillStyle='#ff5d7a';x.beginPath();x.arc(food.x*S+10,food.y*S+10,7,0,7);x.fill();sn.forEach((p,i)=>{x.fillStyle=i?'hsl('+(150+i*4)+',70%,55%)':'#7cffb2';x.beginPath();x.roundRect(p.x*S+1,p.y*S+1,S-2,S-2,6);x.fill()})}
function turn(d){const m={up:[0,-1],down:[0,1],left:[-1,0],right:[1,0]}[d];if(!m)return;if(m[0]==-dir.x&&m[1]==-dir.y)return;nd={x:m[0],y:m[1]}}
document.addEventListener('keydown',e=>{const k={ArrowUp:'up',ArrowDown:'down',ArrowLeft:'left',ArrowRight:'right',w:'up',s:'down',a:'left',d:'right'}[e.key];if(k){e.preventDefault();turn(k)}if(e.key==' ')paused=!paused});
document.querySelectorAll('[data-d]').forEach(b=>b.addEventListener('pointerdown',e=>{e.preventDefault();turn(b.dataset.d)}));
$('pp').onclick=()=>{paused=!paused;$('pp').textContent=paused?'▶':'❚❚'};$('go').onclick=start;
let sx,sy;document.addEventListener('touchstart',e=>{sx=e.touches[0].clientX;sy=e.touches[0].clientY},{passive:true});document.addEventListener('touchend',e=>{const dx=e.changedTouches[0].clientX-sx,dy=e.changedTouches[0].clientY-sy;if(Math.max(Math.abs(dx),Math.abs(dy))<24)return;turn(Math.abs(dx)>Math.abs(dy)?(dx>0?'right':'left'):(dy>0?'down':'up'))});
sn=[{x:8,y:8}];food={x:12,y:8};draw();window.__game={get score(){return score},get alive(){return alive},get len(){return sn.length},start,turn};`);
  const breakout = () => shell('Breakout', 'canvas{background:#151a30;border-radius:14px;touch-action:none;max-width:96vw}p{color:#9aa3c7;font-size:13px;margin:8px}',
    '<h1>🧱 Breakout</h1><div class="bar">Score <b id="sc">0</b> · Lives <b id="lv">3</b></div><canvas id="c" width="340" height="460"></canvas><p>Drag to move · tap to launch</p>',
    `const c=document.getElementById('c'),x=c.getContext('2d'),W=340,H=460;let px=W/2,b,bricks,score=0,lives=3,stuck=true;
function reset(){bricks=[];const cols=['#ff5d7a','#ffb84d','#ffe066','#7cffb2','#4fb3ff'];for(let r=0;r<5;r++)for(let i=0;i<7;i++)bricks.push({x:8+i*47,y:50+r*22,c:cols[r],on:1});serve()}
function serve(){stuck=true;b={x:px,y:H-46,vx:2.6,vy:-4}}
function frame(){x.clearRect(0,0,W,H);if(stuck){b.x=px;b.y=H-46}else{b.x+=b.vx;b.y+=b.vy;if(b.x<7||b.x>W-7)b.vx*=-1;if(b.y<7)b.vy*=-1;if(b.y>H-40&&b.y<H-28&&Math.abs(b.x-px)<40&&b.vy>0){b.vy=-Math.abs(b.vy);b.vx=(b.x-px)/9}if(b.y>H){lives--;if(lives<=0){lives=3;score=0;reset()}else serve()}for(const k of bricks)if(k.on&&b.x>k.x&&b.x<k.x+43&&b.y>k.y&&b.y<k.y+18){k.on=0;b.vy*=-1;score+=10;break}if(bricks.every(k=>!k.on))reset()}
for(const k of bricks)if(k.on){x.fillStyle=k.c;x.beginPath();x.roundRect(k.x,k.y,43,18,5);x.fill()}x.fillStyle='#e8ebf7';x.beginPath();x.roundRect(px-40,H-36,80,10,5);x.fill();x.fillStyle='#fff';x.beginPath();x.arc(b.x,b.y,7,0,7);x.fill();document.getElementById('sc').textContent=score;document.getElementById('lv').textContent=lives;requestAnimationFrame(frame)}
function mv(cx){const r=c.getBoundingClientRect();px=Math.max(40,Math.min(W-40,(cx-r.left)*W/r.width))}
c.addEventListener('pointermove',e=>mv(e.clientX));c.addEventListener('pointerdown',e=>{mv(e.clientX);stuck=false});document.addEventListener('keydown',e=>{if(e.key=='ArrowLeft')px=Math.max(40,px-24);if(e.key=='ArrowRight')px=Math.min(W-40,px+24);if(e.key==' ')stuck=false});reset();frame();window.__game={get score(){return score},launch(){stuck=false}};`);
  const ttt = () => shell('Tic-tac-toe', '.g{display:grid;grid-template-columns:repeat(3,96px);gap:8px;margin:16px}.g button{height:96px;font-size:44px;font-weight:700;border-radius:16px}.g button.w{background:#7c5cff}#st{margin:6px;font-size:16px;min-height:22px}',
    '<h1>❌⭕ Tic-tac-toe</h1><div class="bar">You <b id="a">0</b> · AI <b id="b">0</b> · Draw <b id="d">0</b></div><div id="st">Your move (X)</div><div class="g" id="g"></div><button class="pri" id="r">New game</button>',
    `const L=[[0,1,2],[3,4,5],[6,7,8],[0,3,6],[1,4,7],[2,5,8],[0,4,8],[2,4,6]];let bd,over,sc={a:0,b:0,d:0};const g=document.getElementById('g');
function win(s){for(const l of L)if(s[l[0]]&&s[l[0]]==s[l[1]]&&s[l[0]]==s[l[2]])return l;return null}
function mm(s,p){const w=win(s);if(w)return s[w[0]]=='O'?10:-10;if(s.every(Boolean))return 0;let best=p=='O'?-99:99;for(let i=0;i<9;i++)if(!s[i]){s[i]=p;const v=mm(s,p=='O'?'X':'O');s[i]='';best=p=='O'?Math.max(best,v):Math.min(best,v)}return best}
function ai(){let bi=-1,bv=-99;for(let i=0;i<9;i++)if(!bd[i]){bd[i]='O';const v=mm(bd,'X');bd[i]='';if(v>bv){bv=v;bi=i}}return bi}
function end(){const w=win(bd);if(w){over=1;w.forEach(i=>g.children[i].classList.add('w'));const k=bd[w[0]]=='X'?'a':'b';sc[k]++;st(k=='a'?'You win! 🎉':'AI wins 🤖')}else if(bd.every(Boolean)){over=1;sc.d++;st('Draw')}['a','b','d'].forEach(k=>document.getElementById(k).textContent=sc[k]);return over}
function st(t){document.getElementById('st').textContent=t}
function draw(){[...g.children].forEach((b,i)=>{b.textContent=bd[i];b.style.color=bd[i]=='X'?'#4fb3ff':'#ff5d7a'})}
function play(i){if(over||bd[i])return;bd[i]='X';draw();if(end())return;st('AI thinking…');setTimeout(()=>{bd[ai()]='O';draw();if(!end())st('Your move (X)')},250)}
function reset(){bd=Array(9).fill('');over=0;g.innerHTML='';for(let i=0;i<9;i++){const b=document.createElement('button');b.onclick=()=>play(i);g.appendChild(b)}st('Your move (X)')}
document.getElementById('r').onclick=reset;reset();window.__game={play,get board(){return bd.join(',')}};`);
  const todo = () => shell('Todo', '.w{width:min(440px,94vw)}form{display:flex;gap:8px;margin:10px 0}input{flex:1;font:inherit;min-height:46px;border-radius:12px;border:1px solid #2c3358;background:#151a30;color:#fff;padding:0 14px}ul{list-style:none}li{display:flex;align-items:center;gap:10px;background:#181d36;border-radius:12px;padding:8px 10px;margin:6px 0}li span{flex:1;word-break:break-word}li.d span{text-decoration:line-through;opacity:.5}li input{flex:none;width:22px;min-height:22px;accent-color:#7c5cff}li button{min-height:36px;background:none;color:#ff5d7a}.f{display:flex;gap:6px;justify-content:center}.f button.on{background:#7c5cff}.m{color:#9aa3c7;font-size:13px;text-align:center;margin:10px}',
    '<h1>✅ Todo</h1><div class="w"><form id="fm"><input id="in" placeholder="What needs doing?" autocomplete="off"><button class="pri">Add</button></form><div class="f"><button data-f="all" class="on">All</button><button data-f="act">Active</button><button data-f="done">Done</button></div><ul id="l"></ul><div class="m" id="m"></div></div>',
    `let items=[{t:'Try Forge apps',d:true},{t:'Build something fun',d:false}],f='all';const $=i=>document.getElementById(i);
function r(){const l=$('l');l.innerHTML='';items.forEach((it,i)=>{if(f=='act'&&it.d||f=='done'&&!it.d)return;const li=document.createElement('li');li.className=it.d?'d':'';li.innerHTML='<input type="checkbox"'+(it.d?' checked':'')+'><span></span><button aria-label="Delete">✕</button>';li.querySelector('span').textContent=it.t;li.querySelector('input').onchange=()=>{it.d=!it.d;r()};li.querySelector('button').onclick=()=>{items.splice(i,1);r()};l.appendChild(li)});const a=items.filter(i=>!i.d).length;$('m').textContent=a+' active · '+(items.length-a)+' done'}
$('fm').onsubmit=e=>{e.preventDefault();const v=$('in').value.trim();if(v){items.push({t:v,d:false});$('in').value='';r()}};document.querySelectorAll('[data-f]').forEach(b=>b.onclick=()=>{f=b.dataset.f;document.querySelectorAll('[data-f]').forEach(x=>x.classList.toggle('on',x==b));r()});r();window.__game={get count(){return items.length}};`);
  const calc = () => shell('Calculator', '.c{width:min(340px,94vw);margin-top:10px}#o{background:#151a30;border-radius:16px;padding:16px;text-align:right;margin-bottom:10px}#e{color:#9aa3c7;min-height:20px;font-size:14px;word-break:break-all}#v{font-size:40px;font-weight:600;word-break:break-all}.k{display:grid;grid-template-columns:repeat(4,1fr);gap:8px}.k button{height:64px;font-size:22px}.op{background:#33305a;color:#b9a8ff}.eq{grid-column:span 2}',
    '<h1>🧮 Calculator</h1><div class="c"><div id="o"><div id="e"></div><div id="v">0</div></div><div class="k" id="k"></div></div>',
    `let cur='0',expr='';const keys=['C','±','%','÷','7','8','9','×','4','5','6','−','1','2','3','+','0','.','='];const k=document.getElementById('k');
function show(){document.getElementById('v').textContent=cur;document.getElementById('e').textContent=expr}
function ev(s){const t=s.replace(/×/g,'*').replace(/÷/g,'/').replace(/−/g,'-');if(!/^[\\d.+\\-*/ ]+$/.test(t))return 'Error';const r=Function('return ('+t+')')();return isFinite(r)?String(+r.toFixed(10)):'Error'}
function press(c){if(/[0-9]/.test(c))cur=cur=='0'||cur=='Error'?c:cur+c;else if(c=='.'){if(!cur.includes('.'))cur+='.'}else if(c=='C'){cur='0';expr=''}else if(c=='±')cur=String(-cur);else if(c=='%')cur=String(cur/100);else if(c=='='){if(expr){cur=ev(expr+cur);expr=''}}else{expr+=cur+' '+c+' ';cur='0'}show()}
keys.forEach(c=>{const b=document.createElement('button');b.textContent=c;if('÷×−+'.includes(c))b.className='op';if(c=='=')b.className='pri eq';b.onclick=()=>press(c);k.appendChild(b)});document.addEventListener('keydown',e=>{const m={'*':'×','/':'÷','-':'−','+':'+',Enter:'=',Escape:'C'};const c=m[e.key]||e.key;if(keys.includes(c))press(c)});show();window.__game={press,get value(){return cur}};`);
  const draw = () => shell('Drawing pad', 'canvas{background:#fff;border-radius:14px;touch-action:none;width:min(360px,94vw);height:auto}.t{display:flex;gap:6px;flex-wrap:wrap;justify-content:center;margin:10px}.sw{width:40px;min-height:40px;padding:0;border-radius:50%;border:3px solid transparent}.sw.on{border-color:#fff}input[type=range]{width:110px}',
    '<h1>🎨 Drawing pad</h1><div class="t" id="cl"></div><canvas id="c" width="720" height="880"></canvas><div class="t"><input type="range" id="sz" min="2" max="40" value="8"><button id="un">↶ Undo</button><button id="cr">Clear</button><button class="pri" id="dl">⬇ PNG</button></div>',
    `const c=document.getElementById('c'),x=c.getContext('2d');let col='#111',hist=[],dn=false,last;x.lineCap=x.lineJoin='round';x.fillStyle='#fff';x.fillRect(0,0,c.width,c.height);
['#111','#ff5d7a','#ffb84d','#ffe066','#3ddc84','#4fb3ff','#7c5cff','#fff'].forEach((h,i)=>{const b=document.createElement('button');b.className='sw'+(i?'':' on');b.style.background=h;b.onclick=()=>{col=h;document.querySelectorAll('.sw').forEach(s=>s.classList.toggle('on',s==b))};document.getElementById('cl').appendChild(b)});
function pt(e){const r=c.getBoundingClientRect();return{x:(e.clientX-r.left)*c.width/r.width,y:(e.clientY-r.top)*c.height/r.height}}
c.addEventListener('pointerdown',e=>{hist.push(x.getImageData(0,0,c.width,c.height));if(hist.length>30)hist.shift();dn=true;last=pt(e);c.setPointerCapture(e.pointerId)});c.addEventListener('pointermove',e=>{if(!dn)return;const p=pt(e);x.strokeStyle=col;x.lineWidth=+document.getElementById('sz').value*2;x.beginPath();x.moveTo(last.x,last.y);x.lineTo(p.x,p.y);x.stroke();last=p});c.addEventListener('pointerup',()=>dn=false);
document.getElementById('un').onclick=()=>{const h=hist.pop();if(h)x.putImageData(h,0,0)};document.getElementById('cr').onclick=()=>{hist.push(x.getImageData(0,0,c.width,c.height));x.fillStyle='#fff';x.fillRect(0,0,c.width,c.height)};document.getElementById('dl').onclick=()=>{const a=document.createElement('a');a.download='drawing.png';a.href=c.toDataURL();a.click()};window.__game={get strokes(){return hist.length}};`);
  const timer = () => shell('Pomodoro', '.r{position:relative;width:240px;height:240px;margin:16px}svg{transform:rotate(-90deg)}#tm{position:absolute;top:0;right:0;bottom:0;left:0;display:flex;align-items:center;justify-content:center;font-size:48px;font-weight:600;font-variant-numeric:tabular-nums}.row{display:flex;gap:8px;margin:6px}.row button.on{background:#7c5cff}',
    '<h1>🍅 Pomodoro</h1><div class="row"><button data-m="25" class="on">Focus 25</button><button data-m="5">Break 5</button><button data-m="15">Long 15</button></div><div class="r"><svg width="240" height="240"><circle cx="120" cy="120" r="108" stroke="#262c4a" stroke-width="14" fill="none"/><circle id="ar" cx="120" cy="120" r="108" stroke="#7c5cff" stroke-width="14" fill="none" stroke-linecap="round" stroke-dasharray="678.6"/></svg><div id="tm">25:00</div></div><div class="row"><button class="pri" id="go">Start</button><button id="rs">Reset</button></div><div class="bar">Sessions <b id="n">0</b></div>',
    `let tot=1500,left=1500,run=false,iv,n=0;const $=i=>document.getElementById(i);
function show(){$('tm').textContent=String(left/60|0).padStart(2,'0')+':'+String(left%60).padStart(2,'0');$('ar').style.strokeDashoffset=678.6*(1-left/tot)}
function tick(){if(left>0){left--;show()}if(left==0){clearInterval(iv);run=false;n++;$('n').textContent=n;$('go').textContent='Start'}}
$('go').onclick=()=>{run=!run;$('go').textContent=run?'Pause':'Start';clearInterval(iv);if(run)iv=setInterval(tick,1000)};$('rs').onclick=()=>{left=tot;show()};
document.querySelectorAll('[data-m]').forEach(b=>b.onclick=()=>{tot=left=b.dataset.m*60;document.querySelectorAll('[data-m]').forEach(x=>x.classList.toggle('on',x==b));show()});show();window.__game={tick,get left(){return left}};`);
  const memory = () => shell('Memory', '.g{display:grid;grid-template-columns:repeat(4,72px);gap:8px;margin:14px}.g button{height:72px;font-size:34px;background:#262c4a;transition:transform .25s}.g button.u{background:#3a3270}.g button.m{background:#1f4a3a}',
    '<h1>🧠 Memory match</h1><div class="bar">Moves <b id="mv">0</b> · Pairs <b id="pr">0</b>/8</div><div class="g" id="g"></div><button class="pri" id="r">Shuffle</button>',
    `const E=['🍕','🚀','🐙','🎸','🌈','🍩','⚡','🦊'];let cards,open=[],mv=0,pr=0;const g=document.getElementById('g');
function deal(){cards=[...E,...E].sort(()=>Math.random()-.5).map(e=>({e,u:0,m:0}));mv=pr=0;open=[];r()}
function r(){g.innerHTML='';cards.forEach((c,i)=>{const b=document.createElement('button');b.className=c.m?'m':c.u?'u':'';b.textContent=c.u||c.m?c.e:'';b.onclick=()=>flip(i);g.appendChild(b)});document.getElementById('mv').textContent=mv;document.getElementById('pr').textContent=pr}
function flip(i){const c=cards[i];if(c.u||c.m||open.length>1)return;c.u=1;open.push(c);if(open.length==2){mv++;const[a,b]=open;if(a.e==b.e){a.m=b.m=1;pr++;open=[]}else setTimeout(()=>{a.u=b.u=0;open=[];r()},700)}r()}
document.getElementById('r').onclick=deal;deal();window.__game={flip,get moves(){return mv}};`);
  const generic = (idea) => { const t = String(idea).replace(/[<>&"]/g, '').slice(0, 60) || 'My app'; return shell(t, '.w{width:min(440px,94vw)}.card{background:#181d36;border-radius:16px;padding:16px;margin:10px 0}.big{font-size:44px;font-weight:700;text-align:center;margin:8px}.row{display:flex;gap:8px;justify-content:center}textarea{width:100%;min-height:80px;font:inherit;background:#151a30;color:#fff;border:1px solid #2c3358;border-radius:12px;padding:10px}',
    '<h1 id="h"></h1><div class="w"><div class="card"><p style="color:#9aa3c7">A starter built for your idea — edit index.html to grow it.</p></div><div class="card"><div class="big" id="n">0</div><div class="row"><button id="m">−</button><button class="pri" id="p">+</button><button id="z">Reset</button></div></div><div class="card"><textarea id="nt" placeholder="Notes…"></textarea></div></div>',
    `document.getElementById('h').textContent=${JSON.stringify(t)};let n=0;const s=()=>document.getElementById('n').textContent=n;document.getElementById('p').onclick=()=>{n++;s()};document.getElementById('m').onclick=()=>{n--;s()};document.getElementById('z').onclick=()=>{n=0;s()};window.__game={get n(){return n}};`); };
  return { snake, breakout, pong: breakout, ttt, todo, calc, draw, timer, memory, generic };
})();

DS.plugin({
  name: 'forge.apps', title: 'Apps & games', version: '1.0.0', tags: ['apps', 'games', 'preview'],
  description: 'Build, live-preview and iterate on web apps and games. Preview view with device frames, console and VFS asset inlining.',
  apply(ctx) {
    const U = DS.util, esc = U.esc;
    const slug = s => String(s || 'app').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'app';
    const st = { project: null, reload: null };
    ctx.effect(() => { const s = document.createElement('style'); s.textContent = `
.ap-card{border:1px solid var(--line);border-radius:var(--radius);overflow:hidden;background:var(--card);margin:8px 0}
.ap-head{display:flex;align-items:center;gap:6px;padding:6px 8px;background:var(--code-head);border-bottom:1px solid var(--line);flex-wrap:wrap}
.ap-head .t{flex:1;font-size:12px;color:var(--muted);font-family:var(--mono);min-width:60px}
.ap-stage{height:340px;background:#fff;position:relative}.ap-card pre{margin:0;max-height:340px;overflow:auto;padding:10px;font-family:var(--mono);font-size:12px;background:var(--code-bg)}
.ap-full{position:fixed!important;top:0;right:0;bottom:0;left:0;z-index:9999;height:auto!important}
.pv-bar{display:flex;gap:6px;padding:8px 16px;flex-wrap:wrap;align-items:center;border-bottom:1px solid var(--line)}
.pv-wrap{flex:1;min-height:0;display:flex;justify-content:center;align-items:flex-start;padding:10px;overflow:auto;background:var(--bg-2)}
.pv-dev{background:#fff;border-radius:18px;overflow:hidden;box-shadow:0 8px 30px #0004;border:6px solid var(--card-2);transition:width .2s}
.pv-con{max-height:30%;min-height:44px;overflow:auto;border-top:1px solid var(--line);font-family:var(--mono);font-size:12px;padding:6px 16px}
.pv-con .e{color:var(--danger)}.pv-con .w{color:var(--warn)}.pv-con div{padding:2px 0;border-bottom:1px dashed var(--line);white-space:pre-wrap;word-break:break-word}
.ap-inl{display:flex;gap:8px;align-items:center;margin-top:6px}.ap-thumb{width:120px;height:150px;border-radius:10px;overflow:hidden;border:1px solid var(--line);flex:none}
.ap-thumb iframe{width:390px!important;height:500px!important;transform:scale(.3077);transform-origin:0 0;pointer-events:none}`; document.head.appendChild(s); return () => s.remove(); });

    // console shim injected into previewed pages
    const SHIM = '<script>(function(){var P=function(l,a){try{parent.postMessage({__forge:1,level:l,msg:[].map.call(a,function(x){try{return typeof x=="object"?JSON.stringify(x):String(x)}catch(e){return String(x)}}).join(" ")},"*")}catch(e){}};["log","info","warn","error"].forEach(function(k){var o=console[k];console[k]=function(){P(k,arguments);o&&o.apply(console,arguments)}});window.onerror=function(m,s,l,c){P("error",[m+(l?" (line "+l+")":"")])};window.addEventListener("unhandledrejection",function(e){P("error",["Unhandled rejection: "+(e.reason&&e.reason.message||e.reason)])});})();<\/script>';
    const withShim = html => /<head[^>]*>/i.test(html) ? html.replace(/<head[^>]*>/i, m => m + SHIM) : SHIM + html;

    async function inlineAssets(html, base) {
      const dir = base.replace(/\/[^/]*$/, '') || '/';
      const rel = u => !u || /^(https?:|data:|blob:|\/\/|#|mailto:|javascript:)/i.test(u) ? null : DS.fs.norm(u.startsWith('/') ? u : dir + '/' + u);
      const get = async p => { try { return (await DS.fs.read(p)).content; } catch (_) { return null; } };
      const mime = p => ({ png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', svg: 'image/svg+xml', webp: 'image/webp', json: 'application/json', css: 'text/css', js: 'text/javascript', mp3: 'audio/mpeg', wav: 'audio/wav' })[(p.split('.').pop() || '').toLowerCase()] || 'text/plain';
      const asUrl = (p, c) => DS.fs.isBinary(c) ? c : 'data:' + mime(p) + ';charset=utf-8,' + encodeURIComponent(c);
      const reps = [];
      html.replace(/<script([^>]*?)\ssrc=["']([^"']+)["']([^>]*)>\s*<\/script>/gi, (m, a, u, b) => { reps.push({ m, u, f: c => '<script' + a + b + '>' + c.replace(/<\/script/gi, '<\\/script') + '<\/script>' }); });
      html.replace(/<link([^>]*?)rel=["']stylesheet["']([^>]*?)>/gi, m => { const h = (m.match(/href=["']([^"']+)["']/i) || [])[1]; if (h) reps.push({ m, u: h, f: c => '<style>' + c + '</style>' }); });
      html.replace(/\s(src|href|poster)=["']([^"']+)["']/gi, (m, k, u) => { if (/\.(png|jpe?g|gif|svg|webp|mp3|wav|json|ico)$/i.test(u)) reps.push({ m, u, f: (c, p) => ' ' + k + '="' + asUrl(p, c) + '"' }); });
      for (const r of reps) { const p = rel(r.u); if (!p) continue; const c = await get(p); if (c == null) continue; html = html.split(r.m).join(r.f(c, p)); }
      return html;
    }

    async function writeApp(thread, dir, files) {
      const out = [];
      for (const f of files) {
        const p = DS.fs.norm(dir + '/' + String(f.path || 'index.html').replace(/^\/+/, ''));
        let before = null; try { before = (await DS.fs.read(p)).content; } catch (_) {}
        if (thread) DS.agent.recordChange(thread, p, before);
        await DS.fs.write(p, String(f.content || '')); out.push(p);
      }
      return out;
    }
    function openPreview(path) { st.project = path; DS.shell.show('preview'); ctx.emit('apps:open', path); }

    // ---------- fence renderer ----------
    ctx.fence({ langs: ['html', 'app'], render(el, code, o) {
      if (!el._built) {
        el._built = 1; el.className = 'ap-card'; el._mode = 'preview';
        el.innerHTML = '<div class="ap-head"><span class="t">' + esc(o.lang) + ' · live</span><div class="seg"><button class="on" data-m="preview">Preview</button><button data-m="code">Code</button></div><button class="icon-btn" data-a="full" title="Fullscreen">' + DS.icon('expand') + '</button><button class="icon-btn" data-a="copy" title="Copy">' + DS.icon('copy') + '</button><button class="btn sm" data-a="save">' + DS.icon('download') + ' Save</button></div><div class="ap-stage"></div><pre hidden></pre>';
        const stage = el.querySelector('.ap-stage'), pre = el.querySelector('pre');
        el.querySelectorAll('[data-m]').forEach(b => b.onclick = () => { el._mode = b.dataset.m; el.querySelectorAll('[data-m]').forEach(x => x.classList.toggle('on', x === b)); stage.hidden = el._mode !== 'preview'; pre.hidden = !stage.hidden; });
        el.querySelector('[data-a=copy]').onclick = () => { U.copy(el._code); ctx.toast('Copied', 'ok'); };
        el.querySelector('[data-a=full]').onclick = () => { stage.classList.toggle('ap-full'); if (stage.classList.contains('ap-full') && !stage._x) { const x = U.el('button', { class: 'btn sm', style: 'position:absolute;top:8px;right:8px;z-index:2' }, 'Close'); x.onclick = () => { stage.classList.remove('ap-full'); x.remove(); stage._x = null; }; stage._x = x; stage.appendChild(x); } };
        el.querySelector('[data-a=save]').onclick = async () => {
          const t = (el._code.match(/<title>([^<]*)<\/title>/i) || [])[1];
          const name = await DS.ui.promptText('App name', slug(t || 'my-app')); if (!name) return;
          const dir = '/apps/' + slug(name); await writeApp(DS.store.activeThread(), dir, [{ path: 'index.html', content: el._code }]);
          DS.ui.sheet({ title: 'Saved ' + dir + '/index.html', html: '<p class="muted">Open it in Preview to run it full-size with the console.</p>', actions: [{ label: 'Close' }, { label: 'Open in Preview', primary: true, onClick: c => { c(); openPreview(dir + '/index.html'); } }] });
        };
        el._load = () => { const f = U.sandboxFrame(withShim(el._code)); stage.querySelector('iframe')?.remove(); stage.prepend(f); el._last = el._code; el._t = Date.now(); };
      }
      el._code = code; el.querySelector('pre').textContent = code;
      const now = Date.now();
      if (o.closed) { if (el._last !== code) el._load(); }
      else if (code !== el._last && now - (el._t || 0) > 1200 && code.length > 40) el._load();
    } });

    // ---------- preview view ----------
    DS.icons.play = DS.icons.play || DS.icons.game;
    async function listProjects() {
      const out = []; let ents = [];
      try { ents = await DS.fs.list('/apps'); } catch (_) { return out; }
      for (const e of ents) {
        const p = e.path || ('/apps/' + e.name);
        if (e.type === 'dir' || e.dir || e.isDir) { if (await DS.fs.exists(p + '/index.html')) out.push(p + '/index.html'); }
        else if (/\.html?$/i.test(p)) out.push(p);
      }
      return out;
    }
    if (ctx.rail) ctx.rail({ id: 'preview', icon: 'play', label: 'Preview — run your apps & games', group: 'top', order: 42, run: () => DS.shell.show('preview'), active: () => DS.shell.current === 'preview' });
    ctx.view({ id: 'preview', title: 'Preview', icon: 'play', order: 15, mount(el) {
      el.innerHTML = '<div class="vhead"><h2>Preview</h2></div><div class="pv-bar"><select class="sel grow" data-r="pick" style="min-width:0"></select><div class="seg" data-r="dev"><button data-d="390">📱</button><button data-d="768">Tablet</button><button data-d="0" class="on">Full</button></div><button class="icon-btn" data-r="reload" title="Reload">' + DS.icon('redo') + '</button><button class="icon-btn" data-r="full" title="Fullscreen">' + DS.icon('expand') + '</button></div><div class="pv-wrap"><div class="pv-dev" data-r="dev-box" style="width:100%;height:100%"></div></div><div class="pv-bar"><b class="sm">Console</b><span class="chip" data-r="cnt">0</span><span class="grow"></span><button class="btn sm" data-r="clr">Clear</button><button class="btn sm pri" data-r="send" disabled>Send errors to agent</button></div><div class="pv-con" data-r="con"><div class="muted">No output yet.</div></div>';
      const $ = r => el.querySelector('[data-r="' + r + '"]');
      const pick = $('pick'), box = $('dev-box'), con = $('con'); let logs = [], frame = null, dev = 0;
      const renderCon = () => { con.innerHTML = logs.length ? '' : '<div class="muted">No output yet.</div>'; logs.forEach(l => { const d = U.el('div', { class: l.level === 'error' ? 'e' : l.level === 'warn' ? 'w' : '' }); d.textContent = (l.level === 'error' ? '✖ ' : l.level === 'warn' ? '⚠ ' : '› ') + l.msg; con.appendChild(d); }); const errs = logs.filter(l => l.level === 'error').length; $('cnt').textContent = logs.length + (errs ? ' · ' + errs + ' err' : ''); $('cnt').className = 'chip' + (errs ? ' err' : ''); $('send').disabled = !errs; con.scrollTop = 1e9; };
      const onMsg = e => { if (!frame || e.source !== frame.contentWindow || !e.data || !e.data.__forge) return; logs.push({ level: e.data.level, msg: String(e.data.msg).slice(0, 2000) }); if (logs.length > 300) logs.shift(); renderCon(); };
      window.addEventListener('message', onMsg);
      const sizeDev = () => { box.style.width = dev ? Math.min(dev, el.clientWidth - 20) + 'px' : '100%'; box.style.height = dev ? (dev === 390 ? '700px' : '900px') : '100%'; box.style.flex = 'none'; };
      async function load() {
        const p = st.project; logs = []; renderCon(); box.innerHTML = '';
        if (!p) { box.innerHTML = '<div class="empty-v" style="padding:24px;color:#333">No app yet. Try <b>/app</b> or “build a snake game”.</div>'; return; }
        let html; try { html = (await DS.fs.read(p)).content; } catch (_) { box.innerHTML = '<div class="empty-v" style="padding:24px;color:#333">Not found: ' + esc(p) + '</div>'; return; }
        html = withShim(await inlineAssets(html, p)); frame = U.sandboxFrame(html); frame.dataset.path = p; box.appendChild(frame);
      }
      async function refreshPick() { const ps = await listProjects(); if (st.project && !ps.includes(st.project)) ps.unshift(st.project); if (!st.project && ps[0]) st.project = ps[0]; pick.innerHTML = ps.length ? ps.map(p => '<option' + (p === st.project ? ' selected' : '') + ' value="' + esc(p) + '">' + esc(p.replace(/^\/apps\//, '')) + '</option>').join('') : '<option>(no apps in /apps)</option>'; }
      pick.onchange = () => { st.project = pick.value; load(); };
      $('dev').querySelectorAll('button').forEach(b => b.onclick = () => { dev = +b.dataset.d; $('dev').querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b)); sizeDev(); });
      $('reload').onclick = load; $('clr').onclick = () => { logs = []; renderCon(); };
      $('full').onclick = () => { if (frame && frame.requestFullscreen) frame.requestFullscreen().catch(() => box.classList.toggle('ap-full')); };
      $('send').onclick = () => { const errs = logs.filter(l => l.level === 'error').map(l => '- ' + l.msg).join('\n'); DS.shell.show('thread'); DS.threadView.submit('Fix these errors in ' + st.project + ':\n' + errs); };
      st.reload = async () => { await refreshPick(); await load(); };
      const offFs = DS.bus.on ? DS.bus.on('fs:change', ev => { const p = ev && (ev.path || ev); const dir = st.project && st.project.replace(/\/[^/]*$/, ''); if (dir && typeof p === 'string' && p.startsWith(dir)) { clearTimeout(st._fsT); st._fsT = setTimeout(load, 250); } }) : null;
      const offOpen = ctx.on('apps:open', () => st.reload());
      st.reload();
      return () => { window.removeEventListener('message', onMsg); if (typeof offFs === 'function') offFs(); if (typeof offOpen === 'function') offOpen(); st.reload = null; };
    }, onShow() { st.reload && st.reload(); } });

    // ---------- tools ----------
    ctx.tool({ name: 'app_create', label: 'Create app', gate: 'write',
      description: 'Create a web app/game under /apps/<slug>/ and (with open:true) show it in Preview. Simplest: {"name":"snake","html":"<!doctype html>…complete single-file app…","open":true}. Or pass files:[{path,content}] for several files. Returns {dir, files, entry}.',
      parameters: { type: 'object', properties: { name: { type: 'string', description: 'short app name' }, html: { type: 'string', description: 'complete self-contained index.html (easiest)' }, files: { type: 'array', description: 'alternative to html: several files', items: { type: 'object', properties: { path: { type: 'string' }, content: { type: 'string' } }, required: ['path', 'content'] } }, open: { type: 'boolean', description: 'show in Preview (default true)' } }, required: ['name'] },
      detail: a => { const c = a.html || a.content || (Array.isArray(a.files) && a.files[0] && a.files[0].content) || ''; return { path: '/apps/' + slug(a.name || 'app') + '/', preview: c ? { kind: 'diff', before: '', after: String(c).slice(0, 4000) } : undefined }; },
      async run(a, t) {
        /* accept every shape models actually send: html/content/code string, files as a {path: content} map, a single file object */
        let fl = a.files; if (fl && !Array.isArray(fl) && typeof files === 'object') fl = fl.path ? [fl] : Object.entries(fl).map(([path, content]) => ({ path, content: typeof content === 'string' ? content : JSON.stringify(content) }));
        if ((!fl || !fl.length) && (a.html || a.content || a.code)) fl = [{ path: 'index.html', content: String(a.html || a.content || a.code) }];
        a.files = fl; if (a.open === undefined) a.open = true;
        const dir = '/apps/' + slug(a.name || 'app'); if (!Array.isArray(a.files) || !a.files.length) throw new Error('give html (a complete index.html) or files:[{path,content}]'); const files = await writeApp(t.thread, dir, a.files); const entry = files.find(f => /index\.html$/.test(f)) || files[0]; if (a.open) openPreview(entry); return { dir, files, entry }; },
      summarize: (a, r) => r && r.entry ? 'Created ' + r.entry : 'app ' + a.name,
      inline(part, el) {
        const r = part.result && typeof part.result === 'object' ? part.result : (() => { try { return JSON.parse(part.result); } catch (_) { return null; } })();
        if (!r || !r.entry || el._apDone) return; el._apDone = 1;
        const w = U.el('div', { class: 'ap-inl' }); const th = U.el('div', { class: 'ap-thumb' }); w.appendChild(th);
        const side = U.el('div', { class: 'col' }, '<span class="mono xs">' + esc(r.entry) + '</span>'); const b = U.el('button', { class: 'btn sm pri' }, DS.icon('play') + ' Open'); b.onclick = () => openPreview(r.entry); side.appendChild(b); w.appendChild(side); el.appendChild(w);
        DS.fs.read(r.entry).then(f => inlineAssets(f.content, r.entry)).then(h => th.appendChild(U.sandboxFrame(h))).catch(() => {});
      } });
    ctx.tool({ name: 'app_preview', label: 'Preview app', gate: 'none',
      description: 'Open an app (path to index.html or its folder) in the Preview view so the user can run it; console output appears there.',
      parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
      async run(a) { let p = DS.fs.norm(a.path); if (!/\.html?$/i.test(p)) p = p.replace(/\/$/, '') + '/index.html'; if (!(await DS.fs.exists(p))) throw new Error('Not found: ' + p); openPreview(p); return { ok: true, path: p }; } });

    // ---------- commands, prompt, suggestions ----------
    const GUIDE = 'Build it as a single self-contained index.html (inline CSS+JS, no external deps), mobile-first for a 390px screen with touch controls (and keyboard too), polished visuals. Save it with app_create, then app_preview it.';
    ctx.command({ name: 'app', args: '<idea>', desc: 'Build a web app', run(t, c) { if (!t.trim()) return c.reply('Usage: `/app <idea>` — e.g. `/app todo app`'); c.send('Make a ' + t.trim() + ' app. ' + GUIDE); } });
    ctx.command({ name: 'game', args: '<idea>', desc: 'Build a browser game', run(t, c) { if (!t.trim()) return c.reply('Usage: `/game <idea>` — e.g. `/game snake`'); c.send('Build a ' + t.trim() + ' game. ' + GUIDE + ' Include score, restart and on-screen controls.'); } });
    ctx.command({ name: 'preview', args: '[path]', desc: 'Open the app Preview', async run(t, c) { const p = t.trim(); if (p) { let q = DS.fs.norm(p.startsWith('/') ? p : '/apps/' + p); if (!/\.html?$/i.test(q)) q += '/index.html'; if (!(await DS.fs.exists(q))) return c.reply('Not found: `' + q + '`'); openPreview(q); } else DS.shell.show('preview'); } });
    ctx.prompt({ id: 'apps', text: 'APPS & GAMES: When asked to build an app/game/tool UI, write ONE self-contained /apps/<slug>/index.html (inline CSS/JS; external libs only via CDN if essential), mobile-first (390px), touch controls + keyboard, a polished dark UI. Create it with app_create {name, files:[{path:"index.html",content}]}, then call app_preview. Iterate with fs_edit on the same file. The Preview view shows console logs/errors; users may send errors back — fix them precisely. For quick demos you may also reply with an ```html fence (rendered live).' });
    ctx.suggest({ id: 'apps-snake', emoji: '🐍', title: 'Build a snake game', sub: 'Swipe + d-pad, live preview', prompt: 'build a snake game' });
    ctx.suggest({ id: 'apps-todo', emoji: '✅', title: 'Make a todo app', sub: 'Filters, counts, mobile UI', prompt: 'make a todo app' });

    // ---------- offline Sim intents ----------
    const KINDS = [
      ['snake', /snake/i, 'snake', 'Snake', 'swipe or d-pad controls, wrap-around board, score + best, speed ramps every apple'],
      ['breakout', /breakout|brick/i, 'breakout', 'Breakout', 'drag the paddle, tap to launch, 35 bricks, lives and score'],
      ['pong', /\bpong\b/i, 'breakout', 'Pong', 'Breakout-style paddle game: drag to move, tap to launch'],
      ['tictactoe', /tic[\s-]?tac[\s-]?toe|noughts/i, 'ttt', 'Tic-tac-toe', 'you vs an unbeatable minimax AI, win highlighting, scoreboard'],
      ['memory', /memory|match(ing)? game|2048/i, 'memory', 'Memory match', '16 emoji cards, move counter, pairs tracker, reshuffle'],
      ['todo', /to-?do|task list/i, 'todo', 'Todo', 'add / complete / delete, All·Active·Done filters, live counts'],
      ['calculator', /calculator|calc\b/i, 'calc', 'Calculator', 'big touch keys, chained ops, ±, %, keyboard support'],
      ['pomodoro', /pomodoro|timer|stopwatch|countdown/i, 'timer', 'Pomodoro', 'focus/break presets, animated ring, session counter'],
      ['drawing', /draw|paint|sketch|doodle/i, 'draw', 'Drawing pad', '8 colours, brush size, undo, clear, download PNG'],
    ];
    const VERB = /\b(build|make|create|code|write|generate|give me)\b/i;
    const script = (name, html, title, feat) => [
      { say: 'Planning the ' + title + ' build.', tool: { name: 'update_plan', args: { plan: [{ step: 'Write single-file ' + title + ' (mobile + touch)', status: 'in_progress' }, { step: 'Save to /apps/' + name + '/', status: 'pending' }, { step: 'Open in Preview', status: 'pending' }] } } },
      { say: 'Writing `/apps/' + name + '/index.html`.', tool: { name: 'app_create', args: { name, files: [{ path: 'index.html', content: html }] } } },
      { tool: r => ({ name: 'app_preview', args: { path: (r.find(x => x && x.entry) || {}).entry || '/apps/' + name + '/index.html' } }) },
      { final: '**' + title + '** is live in the Preview tab → `/apps/' + name + '/index.html`\n\n- ' + feat + '\n- Self-contained single file, no dependencies, works offline\n- Console panel in Preview catches errors — hit *Send errors to agent* to fix them\n\nWant changes? Ask e.g. “make it faster” or edit the file directly.' },
    ];
    const hasTool = n => { try { return !!DS.agent.tool('update_plan'); } catch (_) { return false; } };
    const wrap = s => hasTool() ? s : s.slice(1);
    ctx.intent({ id: 'apps-template', order: 50,
      match: t => VERB.test(t) && KINDS.some(k => k[1].test(t)) && /(game|app|\bpad\b|timer|calculator|stopwatch|snake|pong|breakout|tic|todo|memory|draw|paint)/i.test(t),
      script(t) { const k = KINDS.find(k => k[1].test(t)); return wrap(script(k[0], APPS_T[k[2]](), k[3], k[4])); } });
    ctx.intent({ id: 'apps-generic', order: 55,
      match: t => VERB.test(t) && /\b(app|game|tool|website|web ?page)\b/i.test(t) && !/\b(plugin|image|video|audio|picture)\b/i.test(t),
      script(t) { const idea = t.replace(/^.*?\b(build|make|create|code|write|generate|give me)\b\s*(me\s+)?(an?\s+)?/i, '').replace(/\.\s*(Build|Include) .*$/s, '').trim() || 'My app'; const title = idea.charAt(0).toUpperCase() + idea.slice(1, 50); return wrap(script(slug(idea).slice(0, 30), APPS_T.generic(title), title, 'starter with a title, cards, counter state and notes — ready to grow')); } });
  }
});
