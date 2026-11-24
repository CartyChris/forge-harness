/* 73-shaders — 10 raw-WebGL fragment-shader wallpapers. No libraries, no textures: one fullscreen triangle + one program per scene.
   Engine: adaptive resolution (EMA frame time), fps cap, pause when hidden, calm + half fps while typing, reduced-motion = one still frame,
   context-loss → CSS still. Thumbs share ONE offscreen GL context. Service: forge.shaders { probe, compileErrors, stats, sampleLive, ids }. */
const SH_HEAD = '#ifdef GL_FRAGMENT_PRECISION_HIGH\nprecision highp float;\n#else\nprecision mediump float;\n#endif\n'
  + 'uniform vec2 uRes; uniform float uTime; uniform vec2 uMouse; uniform vec3 uAcc; uniform vec3 uVio; uniform vec3 uBg; uniform float uCalm; uniform float uGrain; uniform float uGlow;\n'
  + 'float h21(vec2 p){p=fract(p*vec2(123.34,456.21));p+=dot(p,p+45.32);return fract(p.x*p.y);}\n'
  + 'float vn(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(h21(i),h21(i+vec2(1.,0.)),f.x),mix(h21(i+vec2(0.,1.)),h21(i+vec2(1.,1.)),f.x),f.y);}\n'
  + 'float fbm(vec2 p){float a=.5,s=0.;mat2 m=mat2(1.6,1.2,-1.2,1.6);for(int i=0;i<5;i++){s+=a*vn(p);p=m*p;a*=.5;}return s;}\n'
  + 'vec3 stars(vec2 p,float d){vec2 g=floor(p*d),f=fract(p*d)-.5;float r=h21(g);vec2 o=(vec2(h21(g+7.1),h21(g+3.7))-.5)*.6;float s=smoothstep(.09,0.,length(f-o))*step(.88,r);return vec3(.9,.95,1.)*s*(.55+.45*sin(uTime*2.+r*60.));}\n';
const SH_FOOT = '\nvec3 aces(vec3 x){return clamp((x*(2.51*x+.03))/(x*(2.43*x+.59)+.14),0.,1.);}\n'
  + 'void main(){vec2 uv=gl_FragCoord.xy/uRes;vec2 p=(gl_FragCoord.xy-.5*uRes)/uRes.y;vec3 c=max(scene(p,uv),0.);'
  + 'c+=c*c*.35*uGlow;c=aces(c*1.15);c=pow(c,vec3(1./2.2));float L=dot(c,vec3(.2126,.7152,.0722));c=mix(vec3(L),c,1.25);c=clamp(c,0.,1.);c=mix(c,c*c*(3.-2.*c),.35);vec2 v=uv-.5;c*=1.-.6*dot(v,v);'
  + 'c+=(h21(gl_FragCoord.xy+fract(uTime*7.)*131.)-.5)*uGrain*(1.-.5*uCalm);gl_FragColor=vec4(c,1.);}\n';

const SH_SCENES = {
  aurora: { label: 'Aurora (GPU)', cat: 'gpu', fb: 'aurora', still: 'linear-gradient(180deg,#020814,#06303a 45%,#0a1a2a 55%,#03070c)', glsl: `
vec3 sky(vec2 q){float hz=-.18;vec3 c=uBg*.25+vec3(.005,.012,.03)+vec3(.0,.02,.05)*(1.-q.y);
 c+=stars(q+uMouse*.02,70.)*smoothstep(hz,hz+.25,q.y);vec3 a=vec3(0.);
 for(int i=0;i<9;i++){float fi=float(i);float yb=hz+.14+fi*.028+.16*fbm(vec2(q.x*1.3+fi*.37-uTime*.04+uMouse.x*.15,fi*.21+uTime*.02));
  float d=q.y-yb;float w=smoothstep(-.01,.012,d)*exp(-max(d,0.)*(7.+fi))*(.55+.45*sin(q.x*9.+fi*1.3+uTime*.3));
  a+=mix(uAcc,uVio,fi/8.)*w*.16;}
 return c+a*(1.-.3*uCalm);}
vec3 scene(vec2 p,vec2 uv){float hz=-.18;if(p.y>hz)return sky(p);
 float rip=fbm(vec2(p.x*4.,p.y*40.+uTime*.2))-.5;vec2 q=vec2(p.x+rip*.02,2.*hz-p.y+rip*.015);
 vec3 r=sky(q)*.55;r+=vec3(.02,.035,.05)*vn(p*vec2(30.,90.))*smoothstep(hz,hz-.4,p.y);return r;}` },
  nebula: { label: 'Nebula (GPU)', cat: 'gpu', fb: 'warp', still: 'radial-gradient(circle at 40% 45%,#5a2a7a,#1a0f3a 45%,#04040c)', glsl: `
vec3 scene(vec2 p,vec2 uv){float t=uTime*.015;vec2 q=p*1.3+uMouse*.08;
 float d=fbm(q*1.4+vec2(t,-t));float e=fbm(q*2.6+d*2.2+vec2(-t,t*.5));float g=fbm(q*5.+e*1.5);
 vec3 c=uBg*.15+vec3(.006,.004,.015);c+=mix(uVio,uAcc,e)*pow(d,2.6)*2.4;c+=uAcc*pow(e*g,3.)*2.;c+=vec3(1.,.85,.7)*pow(g*d,6.)*6.;
 c*=.4+.8*smoothstep(.2,.8,fbm(q*.8-t));c+=stars(p+uMouse*.03,45.)*.8+stars(p*1.7+uMouse*.11,70.)*.6;return c;}` },
  chrome: { label: 'Liquid chrome (GPU)', cat: 'gpu', fb: 'orbs', still: 'radial-gradient(circle at 45% 40%,#e8eef8,#7a8aa8 25%,#1a2236 55%,#05070c)', glsl: `
float sm(float a,float b,float k){float h=clamp(.5+.5*(b-a)/k,0.,1.);return mix(b,a,h)-k*h*(1.-h);}
float map(vec2 p){float d=length(p-uMouse*vec2(.75,.45))-.16;
 for(int i=0;i<5;i++){float fi=float(i);vec2 c=vec2(.55*sin(uTime*.31+fi*1.7),.33*cos(uTime*.27+fi*2.3));d=sm(d,length(p-c)-.09-.025*fi,.22);}return d;}
vec3 scene(vec2 p,vec2 uv){float d=map(p);vec2 e=vec2(.003,0.);vec2 g=vec2(map(p+e.xy)-map(p-e.xy),map(p+e.yx)-map(p-e.yx))/.006;
 vec3 n=normalize(vec3(g,max(-d*9.,.04)));vec3 r=reflect(vec3(0.,0.,-1.),n);
 vec3 env=mix(uBg*.3+.03,uAcc*.9,smoothstep(-.3,.7,r.y));env+=uVio*smoothstep(.2,1.,-r.x)*.7;env+=vec3(1.3)*smoothstep(.03,0.,abs(r.y-.15))*.8;env+=vec3(2.)*pow(max(dot(r,normalize(vec3(.4,.6,.7))),0.),40.);
 vec3 bg=uBg*.3+.015+uAcc*.12*exp(-max(d,0.)*9.);return mix(bg,env,smoothstep(.004,-.004,d));}` },
  synth: { label: 'Synthwave (GPU)', cat: 'gpu', fb: 'grid', still: 'linear-gradient(180deg,#12002a,#5a1060 46%,#ff7a3a 50%,#14002a 52%,#050010)', glsl: `
vec3 scene(vec2 p,vec2 uv){p.x+=uMouse.x*.06;float hz=-.04;vec3 c;
 if(p.y>hz){c=mix(uVio*.55+vec3(.15,0.,.1),vec3(.02,0.,.06),clamp((p.y-hz)*2.2,0.,1.));c+=stars(p,60.)*smoothstep(.1,.4,p.y);
  vec2 sp=p-vec2(0.,.17);float r=length(sp);float sun=smoothstep(.27,.265,r);
  float band=step(.0,fract(sp.y*16.-uTime*.25)-clamp(-sp.y*3.2,0.,1.));sun*=sp.y>0.?1.:band;
  c+=mix(vec3(1.,.85,.35),uAcc*1.4+vec3(.4,0.,.2),clamp(.5-sp.y*2.,0.,1.))*sun*1.6;c+=uVio*.35*exp(-r*4.5)+vec3(1.,.4,.6)*.12*exp(-r*2.);
  float m=hz+.035+.09*fbm(vec2(p.x*2.5+3.,1.))*smoothstep(0.,.6,abs(p.x));
  if(p.y<m)c=vec3(.03,0.,.05)+uVio*.12*(m-p.y)*8.;c+=uAcc*smoothstep(.006,0.,abs(p.y-m))*.7;}
 else{float dz=hz-p.y;float z=.22/(dz+.002);vec2 gr=vec2(p.x*z,z+uTime*1.2);vec2 f=abs(fract(gr)-.5);
  float w=.04+.02*z*.1;float l=max(smoothstep(.5-w,.5,f.x),smoothstep(.5-w*1.5,.5,f.y))*exp(-z*.05);
  c=vec3(.02,0.,.04)+uAcc*l*1.3+uVio*.5*exp(-dz*10.)+vec3(1.,.5,.3)*.1*exp(-dz*30.)*exp(-abs(p.x)*4.);}
 return c;}` },
  ocean: { label: 'Ocean dusk (GPU)', cat: 'gpu', fb: 'aurora', still: 'linear-gradient(180deg,#1a1440,#c25a3a 48%,#2a1a30 52%,#050a14)', glsl: `
float sea(vec2 p){float h=0.,a=.32,f=.55;mat2 m=mat2(.8,.6,-.6,.8);for(int i=0;i<5;i++){h+=a*sin(p.x*f+uTime*(.9+.2*float(i)))*sin(p.y*f*.8+uTime*.6);p=m*p;f*=1.85;a*=.45;}return h;}
vec3 skyc(vec3 rd,vec3 sd){float s=max(dot(rd,sd),0.);vec3 c=mix(uVio*.35+vec3(.45,.18,.1),vec3(.03,.03,.09)+uBg*.2,clamp(rd.y*3.5,0.,1.));
 return c+vec3(1.,.55,.25)*pow(s,6.)*.5+vec3(1.,.8,.5)*pow(s,500.)*4.;}
vec3 scene(vec2 p,vec2 uv){vec3 ro=vec3(0.,1.4,uTime*.6);vec3 rd=normalize(vec3(p.x+uMouse.x*.12,p.y-.12+uMouse.y*.05,1.));vec3 sd=normalize(vec3(0.,.07,1.));
 if(rd.y>-.003)return skyc(rd,sd);float t=(ro.y-.4)/-rd.y*.6;float d=0.;
 for(int i=0;i<48;i++){vec3 q=ro+rd*t;d=q.y-sea(q.xz);if(abs(d)<.002*t||t>80.)break;t+=d*.7;}
 vec3 q=ro+rd*t;vec2 e=vec2(.05,0.);vec3 n=normalize(vec3(sea(q.xz-e.xy)-sea(q.xz+e.xy),2.*e.x,sea(q.xz-e.yx)-sea(q.xz+e.yx)));
 float fr=pow(1.-max(dot(n,-rd),0.),4.);vec3 rf=reflect(rd,n);rf.y=abs(rf.y);vec3 c=mix(vec3(.01,.03,.05)+uAcc*.04,skyc(rf,sd),.25+.75*fr);
 c+=vec3(1.,.7,.4)*pow(max(dot(rf,sd),0.),120.)*3.;return mix(c,skyc(vec3(rd.x,0.,rd.z),sd),smoothstep(10.,70.,t));}` },
  tunnel: { label: 'Plasma tunnel (GPU)', cat: 'gpu', fb: 'warp', still: 'radial-gradient(circle,#fff 0,#7a5cff 6%,#2a1060 22%,#0a2a55 48%,#03020a 78%)', glsl: `
vec3 scene(vec2 p,vec2 uv){vec2 q=p-uMouse*.18;float r=length(q)+.001;float a=atan(q.y,q.x);float z=.42/r+uTime*.75;
 vec2 ring=vec2(cos(a),sin(a));float w=fbm(ring*1.7+vec2(z*.55,z*.23));
 float bands=.5+.5*sin(z*9.+w*5.);float ribs=pow(.5+.5*sin(a*6.+z*1.3),8.);
 vec3 c=mix(uVio,uAcc,bands)*(.18+1.1*w*w)+uAcc*ribs*.55;
 float depth=smoothstep(.02,.85,r);c*=.25+depth*1.25;
 float id=floor((a+3.14159265)*19.0986);float sp=pow(fract(z*.35+h21(vec2(id,1.))),26.)*step(.82,h21(vec2(id,5.)));
 c+=mix(uAcc,vec3(1.),.6)*sp*depth*2.;c+=mix(uAcc,vec3(1.),.5)*.022/(r*r+.012);return c*(1.-.35*uCalm);}` },
  crystal: { label: 'Voronoi crystal (GPU)', cat: 'gpu', fb: 'constellation', still: 'linear-gradient(135deg,#0a1a2a,#2a5a8a 40%,#6a3aa8 70%,#0a0a1a)', glsl: `
vec2 vor(vec2 x){vec2 n=floor(x),f=fract(x);float a=8.,b=8.;vec2 id=vec2(0.);
 for(int j=-1;j<=1;j++)for(int i=-1;i<=1;i++){vec2 g=vec2(float(i),float(j));vec2 o=vec2(h21(n+g),h21(n+g+19.3));o=.5+.45*sin(uTime*.35+6.2831*o);vec2 r=g+o-f;float d=dot(r,r);
  if(d<a){b=a;a=d;id=n+g;}else if(d<b)b=d;}return vec2(sqrt(b)-sqrt(a),h21(id));}
vec3 scene(vec2 p,vec2 uv){vec2 q=p*3.6+uMouse*.25;vec2 vr=vor(q*1.004+.01),vg=vor(q),vb=vor(q*.996-.01);
 vec3 edge=vec3(exp(-vr.x*28.),exp(-vg.x*28.),exp(-vb.x*28.));vec3 tint=mix(uAcc,uVio,vg.y);
 float ca=pow(abs(sin(fbm(q*1.3+uTime*.12+vg.y*4.)*9.)),6.);
 vec3 c=uBg*.2+tint*(.12+.25*vg.y)+tint*ca*.55*(1.-edge.g)+edge*1.3*(.7+.3*sin(uTime*1.3+vg.y*30.));return c;}` },
  blackhole: { label: 'Black hole (GPU)', cat: 'gpu', fb: 'warp', still: 'radial-gradient(ellipse at 50% 50%,#000 0 9%,#ffb46a 10%,#a8401a 16%,#1a0a1a 30%,#020206 70%)', glsl: `
vec3 scene(vec2 p,vec2 uv){vec2 q=p-uMouse*.08;float r=max(length(q),.001);float rs=.11;
 vec2 bp=q*(1.-rs*rs*2.2/(r*r));vec3 bg=stars(bp*1.2,55.)+mix(uVio,uAcc,fbm(bp*2.))*pow(fbm(bp*1.6+3.),3.)*.7+uBg*.1;
 vec3 c=bg+vec3(1.,.8,.55)*exp(-abs(r-rs*1.5)*90.)*.9;
 vec2 hp=vec2(q.x,(q.y-rs*.3)/.55);float hr=length(hp);c+=mix(uAcc,vec3(1.,.7,.4),.5)*smoothstep(rs*1.2,rs*1.6,hr)*smoothstep(rs*3.2,rs*1.7,hr)*step(0.,q.y)*.6;
 c*=smoothstep(rs,rs*1.06,r);
 vec2 dp=vec2(q.x,q.y/.22);float dr=length(dp);float an=atan(dp.y,dp.x)-uTime*.5/max(dr*6.,.3);
 float dd=smoothstep(rs*1.4,rs*2.,dr)*smoothstep(rs*5.,rs*2.,dr)*(.45+.55*fbm(vec2(cos(an),sin(an))*2.5+dr*14.));dd*=1.+.7*(dp.x/max(dr,.001));
 if(q.y<0.||r>rs*1.08)c+=mix(uAcc*1.2,vec3(1.,.85,.6),clamp(dd,0.,1.))*dd*1.8;return c;}` },
  ink: { label: 'Ink smoke (GPU, calm)', cat: 'calm', fb: 'orbs', still: 'radial-gradient(circle at 35% 40%,#3a2a5a,#141024 50%,#05050a)', glsl: `
vec3 scene(vec2 p,vec2 uv){float t=uTime*.025;vec2 q=p*1.1+uMouse*.04;
 vec2 a=vec2(fbm(q+vec2(t,0.)),fbm(q+vec2(5.2,1.3)-t));vec2 b=vec2(fbm(q+2.8*a+vec2(1.7,9.2)+t*.5),fbm(q+2.8*a+vec2(8.3,2.8)));float f=fbm(q+3.*b);
 vec3 c=mix(uBg*.5+.015,uVio*.55,clamp(f*f*2.2,0.,1.));c=mix(c,uAcc*.75,clamp(length(b)*.6-.35,0.,1.)*f);c*=.55+.6*f;return c;}` },
  lattice: { label: 'Gyroid lattice (GPU)', cat: 'gpu', fb: 'constellation', still: 'radial-gradient(circle,#123a5a,#0a1626 45%,#020408)', glsl: `
vec2 path(float z){return vec2(sin(z*.18)*.8,cos(z*.14)*.8);}
float map(vec3 p){vec3 g3=p*2.2;float g=(abs(dot(sin(g3),cos(g3.yzx)))-.09)*.28;float tun=.42-length(p.xy-path(p.z));return max(g,tun);}
vec3 scene(vec2 p,vec2 uv){float T=uTime*.55;float zc=T*1.6;vec3 ro=vec3(path(zc),zc);vec3 fw=normalize(vec3(path(zc+1.)-path(zc),1.));vec3 rt=normalize(cross(vec3(0.,1.,0.),fw)),up=cross(fw,rt);
 vec2 pp=p+uMouse*.3;float cr=cos(T*.12),sr=sin(T*.12);pp=mat2(cr,-sr,sr,cr)*pp;vec3 rd=normalize(fw*1.25+rt*pp.x+up*pp.y);
 float t=0.,g=0.,d=1.;for(int i=0;i<56;i++){vec3 q=ro+rd*t;d=map(q);g+=exp(-abs(d)*38.)*.018;if(d<.0015||t>13.)break;t+=d*.85;}
 vec3 q=ro+rd*t;vec2 e=vec2(.003,0.);vec3 n=normalize(vec3(map(q+e.xyy)-map(q-e.xyy),map(q+e.yxy)-map(q-e.yxy),map(q+e.yyx)-map(q-e.yyx)));
 float hit=step(t,13.);float dif=clamp(dot(n,normalize(vec3(.4,.7,-.6))),0.,1.);float fr=pow(1.-abs(dot(n,rd)),3.);
 vec3 base=mix(uVio,uAcc,.5+.5*sin(q.z*.35+T*.3));float lines=smoothstep(.035,0.,abs(fract(q.z*.22-T*.35)-.5))*(.4+.6*fr);
 vec3 c=hit*(base*(.02+.32*dif)+uAcc*fr*1.1+mix(uAcc,vec3(1.),.35)*lines*1.4)+base*g*.9;
 float fog=1.-exp(-t*.28);return mix(c,uBg*.35,fog)*(1.-.3*uCalm);}` }
};

DS.plugin({ name: 'forge.shaders', title: 'GPU shader wallpapers', version: '1.0.0', tags: ['ui', 'gpu', 'generative'],
  description: '10 raw-WebGL fragment-shader wallpapers (no libraries, no textures, one fullscreen triangle each): adaptive resolution, fps cap, pauses when hidden, calms while typing, reduced-motion still frame, context-loss → CSS still.',
  apply(ctx) {
    const root = document.documentElement;
    const sysReduced = () => !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);
    const VS = 'attribute vec2 a;void main(){gl_Position=vec4(a,0.,1.);}';
    const live = new Set(); const st = { starts: 0, stops: 0, lost: 0, scale: 0, ema: 0, frames: 0, id: '' };
    let lostToast = false, cur = null;

    /* theme colours → uniforms (canvas2d parse handles any CSS colour) */
    let COL = null; const pc = document.createElement('canvas'); pc.width = pc.height = 1; const pg = pc.getContext('2d', { willReadFrequently: true });
    const parse = (s, d) => { try { pg.fillStyle = '#000'; pg.fillStyle = s || d; pg.clearRect(0, 0, 1, 1); pg.fillRect(0, 0, 1, 1); const v = pg.getImageData(0, 0, 1, 1).data; return [v[0] / 255, v[1] / 255, v[2] / 255]; } catch (e) { return [0, 0, 0]; } };
    function readCols() { const cs = getComputedStyle(root), g = k => (cs.getPropertyValue(k) || '').trim(); const acc = g('--accent') || '#4a8ac4'; COL = { acc: parse(acc), vio: parse(g('--violet') || acc), bg: parse(g('--bg') || '#000') }; return COL; }
    readCols();
    ctx.effect(() => DS.bus.on('themes:change', () => setTimeout(readCols, 30)));
    ctx.effect(() => DS.bus.on('backdrops:recolor', readCols));

    /* pointer (window, passive) → smoothed uMouse in [-1,1] */
    let tx = 0, ty = 0;
    const onP = e => { const pt = e.touches ? e.touches[0] : e; if (!pt) return; tx = (pt.clientX / innerWidth) * 2 - 1; ty = 1 - (pt.clientY / innerHeight) * 2; };
    addEventListener('pointermove', onP, { passive: true }); addEventListener('touchmove', onP, { passive: true });
    ctx.effect(() => () => { removeEventListener('pointermove', onP); removeEventListener('touchmove', onP); });
    const typing = () => { const B = ctx.service('forge.backdrops'); return !!(B && B.typing && B.typing()); };

    function makeGL(cv, pdb) { const o = { antialias: false, alpha: false, depth: false, stencil: false, powerPreference: 'low-power', preserveDrawingBuffer: !!pdb };
      let gl = null; try { gl = cv.getContext('webgl2', o); } catch (e) {} if (!gl) try { gl = cv.getContext('webgl', o) || cv.getContext('experimental-webgl', o); } catch (e) {} return gl; }
    function build(gl, key) {
      const sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS) && !gl.isContextLost()) { const m = gl.getShaderInfoLog(s); gl.deleteShader(s); throw new Error(key + ' compile: ' + m); } return s; };
      const vs = sh(gl.VERTEX_SHADER, VS); let fs; try { fs = sh(gl.FRAGMENT_SHADER, SH_HEAD + SH_SCENES[key].glsl + SH_FOOT); } catch (e) { gl.deleteShader(vs); throw e; }
      const pr = gl.createProgram(); gl.attachShader(pr, vs); gl.attachShader(pr, fs); gl.bindAttribLocation(pr, 0, 'a'); gl.linkProgram(pr);
      if (!gl.getProgramParameter(pr, gl.LINK_STATUS) && !gl.isContextLost()) { const m = gl.getProgramInfoLog(pr); gl.deleteProgram(pr); throw new Error(key + ' link: ' + m); }
      gl.detachShader(pr, vs); gl.detachShader(pr, fs); gl.deleteShader(vs); gl.deleteShader(fs);
      const buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
      const L = {}; for (const n of ['uRes', 'uTime', 'uMouse', 'uAcc', 'uVio', 'uBg', 'uCalm', 'uGrain', 'uGlow']) L[n] = gl.getUniformLocation(pr, n);
      return { pr, buf, draw(W, H, t, mx, my, calm, grain) { gl.viewport(0, 0, W, H); gl.useProgram(pr); gl.bindBuffer(gl.ARRAY_BUFFER, buf); gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
        const c = COL || readCols(); gl.uniform2f(L.uRes, W, H); gl.uniform1f(L.uTime, t); gl.uniform2f(L.uMouse, mx, my); gl.uniform3fv(L.uAcc, c.acc); gl.uniform3fv(L.uVio, c.vio); gl.uniform3fv(L.uBg, c.bg);
        gl.uniform1f(L.uCalm, calm); gl.uniform1f(L.uGrain, grain); gl.uniform1f(L.uGlow, .6); gl.drawArrays(gl.TRIANGLES, 0, 3); },
        dispose() { try { gl.deleteProgram(pr); gl.deleteBuffer(buf); } catch (e) {} } };
    }
    const lose = gl => { try { const x = gl.getExtension('WEBGL_lose_context'); x && x.loseContext(); } catch (e) {} };
    const sample = (gl, W, H) => { const n = 12, px = new Uint8Array(4); let s = 0, s2 = 0, k = 0, hsh = 0; for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) { gl.readPixels(Math.floor((x + .5) / n * W), Math.floor((y + .5) / n * H), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); const l = px[0] + px[1] + px[2]; s += l; s2 += l * l; k++; hsh = (hsh * 31 + l) | 0; } const m = s / k; return { mean: +m.toFixed(1), variance: +(s2 / k - m * m).toFixed(1), hash: hsh }; };

    /* ---------- live runner ---------- */
    function start(key, host, o) {
      o = o || {}; const sc = SH_SCENES[key]; const cv = document.createElement('canvas'); cv.className = 'fx-gl fx-shader'; cv.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;display:block';
      host.appendChild(cv); const gl = makeGL(cv, false); if (!gl) { cv.remove(); throw new Error('WebGL unavailable'); }
      let P; try { P = build(gl, key); } catch (e) { lose(gl); cv.remove(); throw e; }
      live.add(gl); st.starts++; st.id = 'gl-' + key;
      const qc = o.quality === 'high' ? 1 : o.quality === 'low' ? .5 : .65; let scale = qc; const dpr = o.dpr || Math.min(devicePixelRatio || 1, 2);
      const reduced = !!(o.reduced || sysReduced()); let raf = 0, alive = true, lost = false, last = 0, ema = 0, goodMs = 0, T = 3 + Math.random() * 20, mx = tx, my = ty, calm = 0, frames = 0, want = null;
      const size = () => { const W = Math.max(2, Math.round((host.clientWidth || innerWidth) * dpr * scale)), H = Math.max(2, Math.round((host.clientHeight || innerHeight) * dpr * scale)); if (cv.width !== W || cv.height !== H) { cv.width = W; cv.height = H; } };
      const draw = () => { size(); P.draw(cv.width, cv.height, T, mx, my, calm, .035); frames++; st.frames++; if (want) { const w = want; want = null; w(Object.assign(sample(gl, cv.width, cv.height), { frames, scale })); } };
      const step = n => { if (!alive) return; raf = requestAnimationFrame(step); if (document.hidden || lost) { last = 0; return; }
        const ty_ = typing(); const fps = ((o.quality === 'low') ? 30 : 60) / (ty_ ? 2 : 1); const target = 1000 / fps;
        if (last && n - last < target - 2) return; const dms = last ? n - last : target; last = n; const dt = Math.min(.1, dms / 1000);
        ema = ema ? ema * .9 + dms * .1 : dms; st.ema = +ema.toFixed(1);
        /* adaptive resolution: slow → step down; keeping up for 2 s → step up (cap = quality) */
        if (ema > Math.max(22, target * 1.35) && scale > .35) { scale = Math.max(.35, scale * .85); goodMs = 0; ema = target; }
        else if (ema < Math.max(12, target * 1.1)) { goodMs += dms; if (goodMs > 2000 && scale < qc) { scale = Math.min(qc, scale * 1.1); goodMs = 0; } } else goodMs = 0;
        st.scale = +scale.toFixed(3); calm += ((ty_ ? 1 : 0) - calm) * Math.min(1, dt * 3); mx += (tx - mx) * Math.min(1, dt * 4); my += (ty - my) * Math.min(1, dt * 4);
        T += dt * (o.speed || 1) * (1 - .6 * calm); draw(); };
      const onLost = e => { e.preventDefault(); lost = true; st.lost++; cancelAnimationFrame(raf); host.style.background = sc.still; cv.style.display = 'none'; if (!lostToast) { lostToast = true; ctx.toast('The GPU dropped the shader wallpaper — showing a still image instead.', 'warn', 5000); } };
      cv.addEventListener('webglcontextlost', onLost, false);
      if (reduced) draw(); else raf = requestAnimationFrame(step);
      const stop = () => { if (!alive) return; alive = false; cancelAnimationFrame(raf); cv.removeEventListener('webglcontextlost', onLost); P.dispose(); lose(gl); live.delete(gl); cv.width = cv.height = 1; cv.remove(); st.stops++; if (cur && cur.stop === stop) cur = null; };
      cur = { stop, key, sampleNext: () => new Promise(r => { if (reduced || !alive) { try { r(Object.assign(sample(gl, cv.width, cv.height), { frames, scale, note: 'immediate' })); } catch (e) { r(null); } } else want = r; }), frames: () => frames, reduced };
      return stop;
    }

    /* ---------- thumbs + probe: ONE shared offscreen GL context ---------- */
    const TH = { cv: null, gl: null, progs: new Map() };
    function thumbGL(W, H) { if (TH.gl && TH.gl.isContextLost()) { TH.gl = null; TH.progs.clear(); } if (!TH.gl) { TH.cv = document.createElement('canvas'); TH.gl = makeGL(TH.cv, true); } if (TH.gl) { TH.cv.width = W; TH.cv.height = H; } return TH.gl; }
    function thumbRender(key, W, H, t, m) { const gl = thumbGL(W, H); if (!gl) throw new Error('WebGL unavailable'); let P = TH.progs.get(key); if (!P) { P = build(gl, key); TH.progs.set(key, P); } P.draw(W, H, t, m ? m[0] : 0, m ? m[1] : 0, 0, 0); return gl; }
    function thumb(key, cv2d) { try { const W = cv2d.width || 240, H = cv2d.height || 150; thumbRender(key, W, H, 9.5, null); const g = cv2d.getContext('2d'); g.drawImage(TH.cv, 0, 0, W, H); return true; } catch (e) { ctx.log('warn', 'shader thumb ' + key + ': ' + e.message); return false; } }
    function probe(id, o) { o = o || {}; const key = String(id).replace(/^gl-/, ''); if (!SH_SCENES[key]) return { ok: false, err: 'unknown ' + id };
      try { const gl = thumbRender(key, 160, 100, o.t != null ? o.t : 7.3, o.mouse); return Object.assign({ ok: true, id: 'gl-' + key }, sample(gl, 160, 100)); } catch (e) { return { ok: false, id: 'gl-' + key, err: e.message }; } }
    function compileErrors() { const out = {}; for (const k of Object.keys(SH_SCENES)) { const r = probe(k); if (!r.ok) out['gl-' + k] = r.err; } return out; }
    ctx.effect(() => () => { for (const P of TH.progs.values()) P.dispose(); TH.progs.clear(); if (TH.gl) lose(TH.gl); TH.gl = null; if (cur) cur.stop(); });

    for (const [key, sc] of Object.entries(SH_SCENES)) ctx.backdrop({ id: 'gl-' + key, label: sc.label, group: 'gpu', cat: sc.cat, calm: sc.cat === 'calm', still: sc.still, fallback: sc.fb,
      start: (host, o) => start(key, host, o), thumb: cv => thumb(key, cv) });

    ctx.provide('forge.shaders', { ids: () => Object.keys(SH_SCENES).map(k => 'gl-' + k), probe, compileErrors, thumb: (id, cv) => thumb(String(id).replace(/^gl-/, ''), cv),
      start: (id, host, o) => start(String(id).replace(/^gl-/, ''), host, o), sampleLive: () => cur ? cur.sampleNext() : Promise.resolve(null), current: () => cur ? { id: 'gl-' + cur.key, frames: cur.frames(), reduced: cur.reduced } : null,
      stats: () => Object.assign({}, st, { live: live.size, thumbContext: !!TH.gl, thumbPrograms: TH.progs.size }) });
    ctx.intent({ id: 'gpu-wallpapers', order: 45, match: t => /\b(gpu|shader)\b.*\bwallpapers?\b|\bwallpapers?\b.*\b(gpu|shader)/i.test(t), script: () => [{ say: 'Opening the Wallpapers gallery (GPU shaders)…', tool: { name: 'wallpaper_set', args: { open: true } } }, { final: () => '**10 GPU shader wallpapers** (raw WebGL, no libraries) are in the **GPU shaders** tab. They adapt resolution to keep frame time low and pause when the tab is hidden.' }] });
    ctx.suggest({ id: 'gpu-wallpapers', emoji: '✨', title: 'GPU shader wallpapers', sub: 'Aurora, black hole, synthwave… raw WebGL', prompt: 'show gpu shader wallpapers' });
  } });
