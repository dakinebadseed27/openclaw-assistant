(function(){
'use strict';
var URL_='./status.json', POLL=15000;
var $=function(id){return document.getElementById(id)};
var data=null, lastFetchOk=true;

function num(v){return typeof v==='number'&&isFinite(v)?v:null}
function pad(n){return n<10?'0'+n:''+n}
function gb(b){return (b/1073741824).toFixed(b>=107374182400?0:1)}
function rate(b){
  b=num(b); if(b===null)return '--';
  var u=['B/s','KB/s','MB/s','GB/s'],i=0;
  while(b>=1000&&i<3){b/=1000;i++}
  return (i===0?Math.round(b):b.toFixed(b>=100?0:1))+' '+u[i];
}
function lvl(p,a,r){return p>=r?'var(--red)':p>=a?'var(--amber)':'var(--accent)'}
function when(iso){
  if(!iso)return '--';
  var d=new Date(iso); if(isNaN(d))return '--';
  return d.toLocaleString([], {month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'});
}
function el(tag,cls,text){var e=document.createElement(tag);if(cls)e.className=cls;if(text!=null)e.textContent=text;return e}
function kv(dl,rows){
  dl.textContent='';
  rows.forEach(function(r){
    dl.appendChild(el('dt','',r[0]));
    var dd=el('dd',(r[2]||'')+(r[3]?' big':''),r[1]);
    dd.title=r[1];
    dl.appendChild(dd);
  });
}

function ring(id,valId,p,text){
  var r=$(id); p=num(p);
  r.style.setProperty('--p',p===null?0:Math.min(100,p));
  r.style.setProperty('--c',p===null?'var(--muted)':lvl(p,id==='ringDisk'?85:75,id==='ringDisk'?95:90));
  $(valId).textContent=text;
}

function health(d){
  var lv=0, why=[];
  function w(c,m){if(c){lv=Math.max(lv,1);why.push(m)}}
  function a(c,m){if(c){lv=2;why.push(m)}}
  (d.services||[]).forEach(function(s){a(s.state!=='active',s.label||s.name)});
  a(d.firstboot&&d.firstboot.state==='failed','firstboot failed');
  a(d.tailscale&&d.tailscale.installed!==false&&d.tailscale.online===false,'tailscale offline');
  var root=(d.disks||[]).filter(function(x){return x.mount==='/'})[0];
  if(root){a(root.pct>95,'disk >95%');w(root.pct>85,'disk >85%')}
  w(d.cpu&&num(d.cpu.temp_c)!==null&&d.cpu.temp_c>80,'temp >80C');
  w(d.memory&&d.memory.pct>90,'mem >90%');
  w(d.updates&&d.updates.reboot_required,'reboot required');
  w(d.updates&&d.updates.security>0,'security updates');
  var p=$('health');
  p.dataset.s=['ok','warn','alert'][lv];
  p.textContent=['OK','WARN','ALERT'][lv];
  p.title=why.join(', ');
}

function render(d){
  $('host').textContent=d.hostname||'SERVER';
  document.title=(d.hostname||'Server')+' monitor';
  $('os').textContent=[d.os,d.kernel&&('kernel '+d.kernel)].filter(Boolean).join('  ·  ')||'--';
  $('sampleBadge').hidden=!d.sample;
  health(d);

  var c=d.cpu||{}, m=d.memory||{}, root=(d.disks||[]).filter(function(x){return x.mount==='/'})[0]||{};
  ring('ringCpu','cpuV',c.usage_pct,num(c.usage_pct)===null?'--':Math.round(c.usage_pct)+'%');
  var t=num(c.temp_c), te=$('cpuTemp');
  te.textContent=t===null?'-- °C':Math.round(t)+' °C';
  te.style.color=t===null?'var(--muted)':lvl(t,70,80);
  $('cpuSub').textContent=(c.cores?c.cores+' threads':'')+(t===null?' · no temp':'');
  ring('ringMem','memV',m.pct,num(m.pct)===null?'--':Math.round(m.pct)+'%');
  $('memUsed').textContent=m.total_bytes?gb(m.used_bytes)+' / '+gb(m.total_bytes):'--';
  var s=d.swap||{};
  $('memSub').textContent=s.total_bytes?'GB \u00b7 swap '+gb(s.used_bytes)+' / '+gb(s.total_bytes)+' GB':'';
  ring('ringDisk','diskV',root.pct,num(root.pct)===null?'--':Math.round(root.pct)+'%');
  $('diskUsed').textContent=root.total_bytes?gb(root.used_bytes)+' / '+gb(root.total_bytes):'--';
  var others=(d.disks||[]).filter(function(x){return x.mount!=='/'}).map(function(x){return x.mount+' '+Math.round(x.pct)+'%'});
  $('diskSub').textContent=others.join(' · ');

  var up=num(d.uptime_seconds);
  if(up===null){$('upV').textContent='--'}
  else{var dd=Math.floor(up/86400),hh=Math.floor(up%86400/3600),mm=Math.floor(up%3600/60);
    $('upV').textContent=dd>0?dd+'d '+hh+'h':hh>0?hh+'h '+mm+'m':mm+'m'}
  $('upSub').textContent=d.boot_time?'since '+when(d.boot_time):'';
  var ld=d.load||[];
  $('l1').textContent=num(ld[0])!==null?ld[0].toFixed(2):'--';
  $('l5').textContent=num(ld[1])!==null?ld[1].toFixed(2):'--';
  $('l15').textContent=num(ld[2])!==null?ld[2].toFixed(2):'--';

  var n=d.network||{}, ts=d.tailscale||{};
  function yn(v,y,no){return [v?y:no,v?'ok':'bad']}
  var tso=ts.installed===false?['not installed','dim']:yn(ts.online,'online','offline');
  var srv=yn(ts.serving,'yes','no');
  kv($('net'),[
    ['LAN IP',n.lan_ip||'--','',1],
    ['Interface',n.interface||'--'],
    ['Download ↓',rate(n.rx_bytes_per_s),'',1],
    ['Upload ↑',rate(n.tx_bytes_per_s),'',1],
    ['Tailscale',tso[0],tso[1]],
    ['Tailscale IP',ts.ip||'--'],
    ['DNS name',ts.dns_name||'--'],
    ['Dashboard served',srv[0],srv[1]]
  ]);

  var ul=$('svcs'); ul.textContent='';
  (d.services||[]).forEach(function(x){
    var cls=x.state==='active'?'':x.state==='activating'?'warn':'bad';
    var li=el('li',cls);
    li.appendChild(el('i'));
    var nm=el('span','n',x.label||x.name); li.appendChild(nm);
    var u=el('span','u',x.state==='active'?x.name:x.name+' · '+x.state); li.appendChild(u);
    ul.appendChild(li);
  });
  if(!ul.children.length)ul.appendChild(el('li','empty','No services'));

  var u2=d.updates||{};
  var pend=num(u2.pending), sec=num(u2.security);
  kv($('upd2'),[
    ['Pending',pend===null?'--':''+pend,pend>0?'warn':'ok',1],
    ['Security',sec===null?'--':''+sec,sec>0?'bad':'ok',1],
    ['Reboot required',u2.reboot_required?'yes':'no',u2.reboot_required?'warn':'ok'],
    ['Last checked',when(u2.checked)]
  ]);

  var fb=d.firstboot||{}, fp=$('fbPill');
  fp.textContent=(fb.state||'--').toUpperCase();
  fp.dataset.s=fb.state==='done'?'ok':fb.state==='failed'?'alert':'warn';
  $('fbLog').textContent=(fb.log_tail||[]).join('\n');

  var tb=$('procs'); tb.textContent='';
  (d.top_processes||[]).slice(0,6).forEach(function(p){
    var tr=el('tr');
    tr.appendChild(el('td','',p.name));
    tr.appendChild(el('td','',num(p.cpu_pct)!==null?p.cpu_pct.toFixed(1)+'%':'--'));
    tr.appendChild(el('td','',num(p.mem_pct)!==null?p.mem_pct.toFixed(1)+'%':'--'));
    tb.appendChild(tr);
  });
  drawChart(d);
  tick();
}

function drawChart(d){
  var cv=$('chart'), w=cv.clientWidth, h=cv.clientHeight;
  if(!w||!h)return;
  var dpr=window.devicePixelRatio||1;
  cv.width=Math.round(w*dpr); cv.height=Math.round(h*dpr);
  var g=cv.getContext('2d'); g.setTransform(dpr,0,0,dpr,0,0); g.clearRect(0,0,w,h);
  var rem=parseFloat(getComputedStyle(document.documentElement).fontSize)||16;
  var hs=(d&&d.history)||{}, step=hs.interval_seconds||30;
  var series=[[hs.cpu_pct||[],'#2ee6d6'],[hs.mem_pct||[],'#a78bfa']];
  var padL=2.6*rem, padB=1.3*rem, padT=.4*rem, padR=.5*rem;
  var pw=w-padL-padR, ph=h-padT-padB;
  g.font=(.8*rem)+'px '+getComputedStyle(document.body).fontFamily;
  g.fillStyle='#8499ad'; g.strokeStyle='#1a2a3a'; g.lineWidth=1;
  g.textAlign='right'; g.textBaseline='middle';
  [0,25,50,75,100].forEach(function(v){
    var y=padT+ph*(1-v/100);
    g.beginPath(); g.moveTo(padL,Math.round(y)+.5); g.lineTo(w-padR,Math.round(y)+.5); g.stroke();
    g.fillText(v+'%',padL-.5*rem,y);
  });
  var N=Math.max(hs.cpu_pct?hs.cpu_pct.length:0,hs.mem_pct?hs.mem_pct.length:0,2);
  var span=(N-1)*step/60;
  g.textBaseline='top'; g.textAlign='center';
  [0,15,30,45,60].forEach(function(mn){
    if(mn>span+1)return;
    var x=padL+pw*(1-mn/Math.max(span,1));
    if(x<padL-1)return;
    g.fillText(mn===0?'now':'-'+mn+'m',Math.min(Math.max(x,padL+1.2*rem),w-padR-.8*rem),h-padB+.3*rem);
  });
  series.forEach(function(s){
    var a=s[0]; if(a.length<2)return;
    g.beginPath(); g.strokeStyle=s[1]; g.lineWidth=Math.max(2,.14*rem); g.lineJoin='round';
    a.forEach(function(v,i){
      var x=w-padR-pw*((a.length-1-i)*step/60)/Math.max(span,1);
      var y=padT+ph*(1-Math.min(100,Math.max(0,v))/100);
      i?g.lineTo(x,y):g.moveTo(x,y);
    });
    g.stroke();
  });
}

function tick(){
  var now=new Date();
  $('clock').textContent=pad(now.getHours())+':'+pad(now.getMinutes());
  $('date').textContent=now.toLocaleDateString([], {weekday:'long',month:'long',day:'numeric'});
  var u=$('upd'), ago=$('updAgo'), tag=$('staleTag');
  u.className='upd'; tag.hidden=true;
  if(!data){ago.textContent='--';return}
  var gen=new Date(data.generated), age=isNaN(gen)?null:Math.max(0,Math.round((now-gen)/1000));
  if(age===null){ago.textContent='--';return}
  ago.textContent=age<120?age+'s ago':age<7200?Math.round(age/60)+'m ago':Math.round(age/3600)+'h ago';
  if(age>300){u.className='upd down';tag.textContent='COLLECTOR DOWN';tag.hidden=false}
  else if(age>90){u.className='upd stale';tag.textContent='STALE';tag.hidden=false}
}

function poll(){
  fetch(URL_+'?t='+Date.now(),{cache:'no-store'})
    .then(function(r){if(!r.ok)throw new Error(r.status);return r.json()})
    .then(function(d){data=d;lastFetchOk=true;$('fetchErr').hidden=true;render(d)})
    .catch(function(){lastFetchOk=false;$('fetchErr').hidden=false});
}

var rt;
window.addEventListener('resize',function(){clearTimeout(rt);rt=setTimeout(function(){if(data)drawChart(data)},150)});
tick(); setInterval(tick,1000);
poll(); setInterval(poll,POLL);
})();
