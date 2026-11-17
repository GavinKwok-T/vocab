(function(){
  const $=s=>document.querySelector(s);
  const store={get(k){try{return localStorage.getItem(k)}catch(e){return null}},set(k,v){try{localStorage.setItem(k,v)}catch(e){}}};
  let days=[], errors=null, mode='all', daysLoaded=false;
  /* 课堂: class/c-YYYY-MM-DD docs are organized notes shaped like a day (groups + audio packs); inbox/* are raw captures */
  let classes=[], inbox=[], capEditId=null;   /* capEditId: the inbox note being changed in the capture form */
  /* where the reader is: a section (days | class | errors, remembered), the open day and class date (default: the newest),
     the 目录 panel, the search text, the error-book filter */
  let sec=store.get('sec')||({errors:'errors',class:'class'})[store.get('tab')]||'days', dayId='', cDate='', idxOpen=false, q='', errF='all';
  let starOnly=store.get('star-only')==='1', errNewFirst=store.get('err-order')==='new';
  if(!['days','class','errors','practice'].includes(sec)) sec='days';
  /* spelling progress per word (review/progress → words:{key:{streak,right,wrong,okDay,wrongDay,last,lastWrong}}),
     recent practice sessions, and the practice setup / session in progress */
  let progress={}, practiceLog=[], practice=null;
  let quizzes=[], quizHistory=[];   /* 今晚测验 docs (quiz/q-YYYY-MM-DD) and class words quizzed before they existed */
  let prSrc=store.get('pr-src')||'errors', prMode=store.get('pr-mode')||'zh', prCount=store.get('pr-count')||'20', prDay='', prSkip=store.get('pr-skip')!=='0';
  if(!['errors','day','class'].includes(prSrc)) prSrc='errors';
  if(!['zh','audio'].includes(prMode)) prMode='zh';
  if(!['10','20','all'].includes(prCount)) prCount='20';
  let missSet=null;   /* words in the error book, marked on day and class cards */
  let accent=store.get('accent-v2')||'en-US', slow=store.get('slow')==='1';
  const ICON='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11 5 6 9H3v6h3l5 4z"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/><path d="M18.5 5.5a9 9 0 0 1 0 13"/></svg>';

  /* speech */
  let voices=[];
  const synth=('speechSynthesis' in window)?window.speechSynthesis:null;
  function loadVoices(){ if(synth) voices=synth.getVoices()||[]; }
  if(synth){ loadVoices(); synth.addEventListener?synth.addEventListener('voiceschanged',loadVoices):(synth.onvoiceschanged=loadVoices); }
  function pickVoice(){
    const want=accent.toLowerCase();
    const same=voices.filter(v=>(v.lang||'').toLowerCase().replace('_','-')===want);
    const pref=same.find(v=>/daniel|serena|kate|google uk|samantha|google us|alex|ava/i.test(v.name));
    return pref||same[0]||voices.find(v=>(v.lang||'').toLowerCase().startsWith('en'))||null;
  }
  let lastBtn=null;
  /* natural audio: packs {clips:{key: base64 AAC}} stored as assets, fetched once each */
  let player=null;
  /* natural audio: packs {clips:{key: base64 AAC}}, one per day and accent, found by their place in the repository:
     audio/day-NN.json = British (en-GB), audio/day-NN-us.json = American (en-US); class days are under audio/class/,
     the sentence dictionary under audio/gloss/. The store fetches a pack on first use and keeps it on this device */
  const packPath=(id,lang)=>'audio/'+(String(id).startsWith('c-')?'class/'+String(id).slice(2):id)+((lang||accent)==='en-US'?'-us':'')+'.json';
  function loadPack(dayId,lang){ return dayId?Store.audio(packPath(dayId,lang)):Promise.resolve(null); }
  /* sentence-word dictionary: gloss/gNN docs {words:{key:{zh,ipaUk,ipaUs,force?,form?,day?,clip?,noAudio?}}, audio, audioUs};
     entries with day/clip reuse that day's word audio, the rest live in the doc's own packs */
  let gloss=new Map();
  function glossPack(docId){ return docId?Store.audio('audio/gloss/'+docId+(accent==='en-US'?'-us':'')+'.json'):Promise.resolve(null); }
  function preloadGloss(e){ if(!e||e.noAudio) return; if(e.day) loadPack(e.day); else glossPack(e._doc); }
  async function sayGloss(key,btn){
    const e=gloss.get(key); if(!e) return;
    if(btn) btn.classList.add('load');   /* the first play of a pack waits for it to arrive */
    const pack=e.day?await loadPack(e.day):await glossPack(e._doc);
    if(btn) btn.classList.remove('load');
    const b64=pack&&pack.clips&&pack.clips[e.day?e.clip:key];
    if(b64){ const ok=await playClip(b64,pack.type,btn); if(ok) return; }
    speak(e.form||key,btn);
  }
  function mark(btn,on){ if(lastBtn&&lastBtn!==btn) lastBtn.classList.remove('on'); if(btn){btn.classList.toggle('on',on); lastBtn=btn;} }
  function playClip(b64,type,btn){
    return new Promise(resolve=>{
      if(player){player.pause();}
      if(synth) synth.cancel();
      const a=new Audio('data:'+(type||'audio/mp4')+';base64,'+b64);
      a.playbackRate=slow?0.75:1; player=a;
      a.onended=()=>{mark(btn,false);resolve(true)};
      a.onerror=()=>{mark(btn,false);resolve(false)};
      mark(btn,true);
      a.play().catch(()=>{mark(btn,false);resolve(false)});
    });
  }
  async function say(text,btn){
    const dayId=btn&&btn.dataset.day;
    if(dayId){
      if(btn) btn.classList.add('load');
      const pack=await loadPack(dayId);
      if(btn) btn.classList.remove('load');
      const b64=pack&&pack.clips&&pack.clips[text];
      if(b64){ const ok=await playClip(b64,pack.type,btn); if(ok) return; }
    }
    /* words with no day card (error-book words from essays) use the dictionary's audio */
    const gk=text.toLowerCase();
    if(gloss.has(gk)){ sayGloss(gk,btn); return; }
    speak(text,btn);
  }
  function speak(text,btn){
    if(!synth){toast('这个设备不支持朗读，请换浏览器或手机打开');return;}
    if(player) player.pause();
    synth.cancel();
    const u=new SpeechSynthesisUtterance(text);
    u.lang=accent; const v=pickVoice(); if(v) u.voice=v;
    u.rate=slow?0.6:0.9;
    if(lastBtn) lastBtn.classList.remove('on');
    if(btn){btn.classList.add('on'); lastBtn=btn;}
    u.onend=u.onerror=()=>{ if(btn) btn.classList.remove('on'); };
    synth.speak(u);
  }
  let tt; function toast(msg){ let t=$('.toast'); if(!t){t=document.createElement('div');t.className='toast';t.setAttribute('role','status');document.body.appendChild(t);} t.textContent=msg; t.hidden=false; clearTimeout(tt); tt=setTimeout(()=>t.hidden=true,2600); }

  /* controls */
  function setPressed(ids,on){ ids.forEach(id=>$('#'+id).setAttribute('aria-pressed',id===on)); }
  [['m-all','all'],['m-zh','zh'],['m-en','en']].forEach(([id,m])=>$('#'+id).addEventListener('click',()=>{mode=m;shown.clear();setPressed(['m-all','m-zh','m-en'],id);render();}));
  function syncVoiceBtns(){ setPressed(['v-gb','v-us'],accent==='en-GB'?'v-gb':'v-us'); $('#r-slow').setAttribute('aria-pressed',slow); }
  function preload(){
    if(q.trim()) return;
    if(sec==='errors') return;   /* the error book spans many days: a day's pack loads on the first tap */
    if(sec==='class'){ const c=classes.find(x=>x.id===cDate)||classes[0]; if(c) loadPack(c.id); }
    else { const d=days.find(x=>x.id===dayId)||days[days.length-1]; if(d) loadPack(d.id); }
  }
  $('#v-gb').addEventListener('click',()=>{accent='en-GB';store.set('accent-v2',accent);syncVoiceBtns();preload();});
  $('#v-us').addEventListener('click',()=>{accent='en-US';store.set('accent-v2',accent);syncVoiceBtns();preload();});
  $('#r-slow').addEventListener('click',()=>{slow=!slow;store.set('slow',slow?'1':'0');syncVoiceBtns();});
  syncVoiceBtns();

  /* rendering */
  const esc=s=>String(s??'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
  /* navigation: three sections. 每日单词 and 课堂 show one day / one date at a time, with ‹ › and a 目录 grouped by month;
     the search field covers every day, every class date and the error book */
  function navHtml(){
    const n=errors?(errors.words||[]).length:0, searching=!!q.trim();
    const oq=openQuiz(), live=(practice&&!practice.done)||(oq&&!(oq.result&&oq.result.complete))?' •':'';   /* a practice under way, or tonight's quiz waiting */
    const items=[['days','每日单词'],['class','课堂'+(inbox.length?' +'+inbox.length:'')],['errors','错词本'+(n?' '+n:'')],['practice','练习'+live]];
    $('#tabs').innerHTML=items.map(([k,label])=>`<button class="tab${k==='errors'?' err':''}" role="tab" data-sec="${k}" aria-selected="${!searching&&k===sec}">${esc(label)}</button>`).join('');
  }
  /* IPA: words carry ipaUs / ipaUk; error-book entries borrow them from the day they came from */
  function ipaOf(w){
    if(w.ipaUs||w.ipaUk) return w;
    for(const d of days) for(const g of d.groups||[]) for(const x of g.words||[]) if(x.w===w.w) return x;
    return null;
  }
  /* part of speech: words carry pos ("n", "v/n", "vphr", …); error-book entries borrow it from their day or class card */
  const POS={n:'n. 名词',v:'v. 动词',adj:'adj. 形容词',adv:'adv. 副词',prep:'prep. 介词',conj:'conj. 连词',vphr:'动词短语',phr:'短语'};
  function posOf(w){
    if(w.pos) return w.pos;
    for(const d of days.concat(classes)) for(const g of d.groups||[]) for(const x of g.words||[]) if(x.w===w.w&&x.pos) return x.pos;
    return '';
  }
  function cardFor(w){
    for(const d of days.concat(classes)) for(const g of d.groups||[]) for(const x of g.words||[]) if(x.w===w.w) return x;
    return (errors&&errors.words||[]).find(x=>x.w===w.w)||null;   /* essay words live only in the error book */
  }
  function posHtml(w){ const p=posOf(w); return p?`<span class="pos">${esc(p.split('/').map(x=>POS[x]||x).join(' · '))}</span>`:''; }
  function ipaHtml(w,covered){
    const x=ipaOf(w); if(!x) return '';
    const us=x.ipaUs||'', uk=x.ipaUk||'';
    const inner=us===uk?`<span>${esc(us)}</span>`:`<span><b>美</b>${esc(us)}</span><span><b>英</b>${esc(uk)}</span>`;
    return `<span class="ipa${covered?' cover':''}"${covered?' data-c="en" tabindex="0" role="button" aria-label="点开看音标"':''}>${inner}</span>`;
  }
  /* example sentences: every word is a tappable span; data-g is its dictionary key ("" = this card's own word).
     Same tokenizer as scripts/gloss_todo.py */
  const TOK=/\b[ap]\.m\.|[A-Za-zÀ-ÖØ-öø-ÿ]+(?:['’][A-Za-zÀ-ÖØ-öø-ÿ]+)*(?:-[A-Za-zÀ-ÖØ-öø-ÿ]+)*/g;
  /* where the card's own word (or phrase) sits in its example sentence, allowing the usual endings:
     calorie → calories, renovate → renovated / renovating, study → studies / studied. Returns [[start,end],…] */
  const LET='A-Za-zÀ-ÖØ-öø-ÿ';
  function selfRanges(w){
    /* exMark names the words to bold when they are not the card's word itself (grammar cards, irregular forms) */
    if(w.exMark&&w.ex){
      const out=[]; [].concat(w.exMark).forEach(t=>{ const s=w.ex.indexOf(t); if(t&&s>=0) out.push([s,s+t.length]); });
      return out;
    }
    const text=w.ex||'', parts=String(w.w||'').toLowerCase().match(/[a-zà-öø-ÿ]+(?:['’][a-z]+)*/g);
    if(!text||!parts||/,/.test(w.w)) return [];
    const pat=parts.map(x=>{
      const e=x.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
      if(x.length<4) return `${e}s?`;
      if(x.endsWith('e')) return `(?:${e}(?:s|d)?|${e.slice(0,-1)}ing)`;
      if(x.endsWith('y')) return `(?:${e}(?:s|ing)?|${e.slice(0,-1)}(?:ies|ied))`;
      return `${e}(?:s|es|ed|ing)?`;
    }).join('[\\s-]+');
    const re=new RegExp(`(^|[^${LET}])(${pat})(?=[^${LET}]|$)`,'gi'), out=[]; let m;
    while((m=re.exec(text))){ const s=m.index+m[1].length; out.push([s,s+m[2].length]); if(re.lastIndex===m.index) re.lastIndex++; }
    return out;
  }
  const inRanges=(r,a,b)=>r.some(([s,e])=>a>=s&&b<=e);
  function exHtml(w){
    const self=w.w.toLowerCase(), keys=w.exKeys||{}, me=selfRanges(w); let out='', last=0;
    w.ex.replace(TOK,(m,off)=>{
      const k=m.replace(/’/g,"'").toLowerCase();
      out+=esc(w.ex.slice(last,off))+`<span class="t${inRanges(me,off,off+m.length)?' me':''}" data-g="${esc(keys[k]||(k===self?'':k))}">${esc(m)}</span>`;
      last=off+m.length; return m;
    });
    return out+esc(w.ex.slice(last));
  }
  /* the same sentence as plain text with the word in bold (practice feedback, where words are not tappable) */
  function exPlain(w){
    const t=w.ex||'', me=selfRanges(w); let out='', last=0;
    me.forEach(([s,e])=>{ out+=esc(t.slice(last,s))+'<b>'+esc(t.slice(s,e))+'</b>'; last=e; });
    return out+esc(t.slice(last));
  }
  let cards=[];
  function cover(on,kind,label){ return on?` cover" data-c="${kind}" tabindex="0" role="button" aria-label="${label}`:''; }
  /* covers the reader has opened stay open when the list re-renders (a star tap, a live update); a mode change starts over.
     遮英文 hides the word, IPA, example sentence and note (the sentence and note spell the word out); 遮中文 hides the meaning,
     the sentence translation and the note */
  const shown=new Set();
  const isCovered=(key,kind)=>mode===kind&&!shown.has(key+'|'+kind);
  const STAR='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" aria-hidden="true"><path d="m12 3.2 2.7 5.6 6.1.8-4.5 4.2 1.1 6.1L12 17l-5.4 2.9 1.1-6.1-4.5-4.2 6.1-.8z"/></svg>';
  /* word family (family: ["persuasive adj. 有说服力的", …]) and collocations (colloc: ["persuade sb to do sth 说服某人做某事", …]);
     both spell English forms, so they are covered with the card's other notes */
  function xtraHtml(w,field,label,covered){
    const list=Array.isArray(w[field])?w[field].filter(Boolean):[];
    return list.length?`<span class="xtra${cover(covered,mode,'点开看'+label)}"><span><b>${label}</b>${list.map(esc).join('；')}</span></span>`:'';
  }
  /* star: {doc, gi, wi} for 课堂 cards, which get the 想用 toggle */
  function wordLi(w,n,extra,dayId,star){
    const dd=dayId?` data-day="${esc(dayId)}"`:'';
    const key=(dayId||'')+'|'+w.w, coverEn=isCovered(key,'en'), coverZh=isCovered(key,'zh');
    cards.push({w,day:dayId,key});
    const starBtn=star?`<button class="starbtn" data-star="${esc(star.doc)}|${star.gi}|${star.wi}" aria-pressed="${!!w.star}" aria-label="想用：${esc(w.w)}">${STAR}<span>想用</span></button>`:'';
    return `<li class="word" data-ci="${cards.length-1}">
      <span class="num">${n}</span>
      <div class="main">
        <div class="wline"><span class="en${cover(coverEn,'en','点开看英文')}"><span>${esc(w.w)}</span></span>${posHtml(w)}${w.trap?'<span class="chip">易拼错</span>':''}${w.star&&!star?'<span class="chip want">想用</span>':''}${missSet&&missSet.has(w.w.toLowerCase())?'<span class="chip bad">错过</span>':''}</div>
        ${ipaHtml(w,coverEn)}
        <span class="zh${cover(coverZh,'zh','点开看中文')}"><span>${esc(w.zh)}</span></span>
        ${extra||''}
        ${w.ex?`<span class="ex"><button class="speak small" data-say="${esc(w.ex)}"${dd} aria-label="朗读例句">${ICON}</button><span class="exs${cover(coverEn,'en','点开看例句')}"><span>${exHtml(w)}</span></span></span>`:''}
        ${w.ex&&w.exZh?`<span class="exzh${cover(coverZh,'zh','点开看中文')}"><span>${esc(w.exZh)}</span></span>`:''}
        ${w.tip?`<span class="tip${cover(coverEn||coverZh,mode,'点开看说明')}"><span>${esc(w.tip)}</span></span>`:''}
        ${xtraHtml(w,'family','词族',coverEn||coverZh)}${xtraHtml(w,'colloc','搭配',coverEn||coverZh)}
      </div>
      <div class="acts"><button class="speak" data-say="${esc(w.w)}"${dd} aria-label="朗读 ${esc(w.w)}">${ICON}</button>${starBtn}</div>
    </li>`;
  }

  /* word bubble: tap (or select) a word in an example sentence */
  const pop=$('#pop'); let popTok=null;
  function hidePop(){ pop.hidden=true; if(popTok) popTok.classList.remove('sel'); popTok=null; }
  function showPop(tok){
    if(tok===popTok && !pop.hidden) return;
    const li=tok.closest('li.word'), c=li&&cards[+li.dataset.ci]; if(!c) return;
    const g=tok.dataset.g; let e, play='';
    if(!g){
      e=c.w;
      play=`<button class="speak small" data-say="${esc(c.w.w)}"${c.day?` data-day="${esc(c.day)}"`:''} aria-label="朗读 ${esc(c.w.w)}">${ICON}</button>`;
    }else{
      e=gloss.get(g);
      if(!e){ hidePop(); toast(gloss.size?'这个词还没有收录':'词典还在加载，稍等再点'); return; }
      if(!e.noAudio) play=`<button class="speak small" data-gkey="${esc(g)}" aria-label="朗读 ${esc(tok.textContent)}">${ICON}</button>`;
      preloadGloss(e);
    }
    if(popTok) popTok.classList.remove('sel');
    popTok=tok; tok.classList.add('sel');
    pop.innerHTML=`<div class="pop-h"><span class="pop-w">${esc(tok.textContent)}</span>${play}</div>${e.ipaUk||e.ipaUs?ipaHtml({ipaUk:e.ipaUk,ipaUs:e.ipaUs},false):''}<div class="pop-zh">${esc(e.zh)}</div>`;
    pop.hidden=false;
    const r=tok.getBoundingClientRect(), pw=pop.offsetWidth, ph=pop.offsetHeight, vw=document.documentElement.clientWidth;
    const left=Math.max(12,Math.min(r.left+r.width/2-pw/2,vw-pw-12));
    const below=r.bottom+8+ph<=window.innerHeight || r.top-8-ph<$('#tools').getBoundingClientRect().bottom;
    pop.style.left=(left+window.scrollX)+'px';
    pop.style.top=((below?r.bottom+8:r.top-8-ph)+window.scrollY)+'px';
  }
  /* selecting a single word (long-press on phones, double-click or drag on computers) opens the same bubble */
  let selTimer;
  document.addEventListener('selectionchange',()=>{
    clearTimeout(selTimer);
    selTimer=setTimeout(()=>{
      const s=window.getSelection(); if(!s||s.isCollapsed) return;
      const txt=s.toString().trim(); if(!txt||/\s/.test(txt)) return;
      let n=s.anchorNode; if(n&&n.nodeType===3) n=n.parentElement;
      const tok=n&&n.closest&&n.closest('.ex .t'); if(tok) showPop(tok);
    },250);
  });
  const pad=n=>String(n).padStart(2,'0');
  function localDate(d){ return d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate()); }
  function fmtDate(s){ const m=/^(\d{4})-(\d{2})-(\d{2})$/.exec(s||''); return m?`${+m[2]} 月 ${+m[3]} 日`:(s||''); }
  function when(t){ if(!t) return ''; const d=new Date(t), hm=pad(d.getHours())+':'+pad(d.getMinutes()); return localDate(d)===localDate(new Date())?hm:(d.getMonth()+1)+'/'+d.getDate()+' '+hm; }
  const shortDate=s=>{ const m=/^(\d{4})-(\d{2})-(\d{2})$/.exec(s||''); return m?`${+m[2]}/${+m[3]}`:''; };
  const monthOf=s=>{ const m=/^(\d{4})-(\d{2})/.exec(s||''); return m?(+m[1]===new Date().getFullYear()?'':m[1]+' 年 ')+(+m[2])+' 月':'更早'; };
  function byMonth(list){ const out=[]; list.forEach(x=>{ const k=monthOf(x.date); let g=out[out.length-1]; if(!g||g.k!==k) out.push(g={k,items:[]}); g.items.push(x); }); return out; }
  function lowScore(s){ const m=/^(\d+)\s*\/\s*(\d+)$/.exec(s||''); return !!(m&&+m[2]&&(+m[1])/(+m[2])<0.7); }
  const countOf=x=>(x.groups||[]).reduce((s,g)=>s+(g.words||[]).length,0);
  const classNames=x=>[...new Set((x.groups||[]).map(g=>String(g.name||'').split(' · ')[0]))].join('、');
  const starCount=x=>(x.groups||[]).reduce((s,g)=>s+(g.words||[]).filter(w=>w.star).length,0);
  const missCount=x=>missSet?(x.groups||[]).reduce((s,g)=>s+(g.words||[]).filter(w=>missSet.has(w.w.toLowerCase())).length,0):0;
  function pager(kind,title,older,newer){
    const day=kind==='day';
    return `<div class="pager">
      <button class="pg" data-go="${kind}:${esc(older||'')}"${older?'':' disabled'} aria-label="${day?'前一天':'更早一次'}">‹</button>
      <button class="pg-title" data-idx="1" aria-expanded="${idxOpen}"><span class="t">${title}</span><span class="pg-more">${idxOpen?'收起':'目录'}</span></button>
      <button class="pg" data-go="${kind}:${esc(newer||'')}"${newer?'':' disabled'} aria-label="${day?'后一天':'更近一次'}">›</button>
    </div>`;
  }
  function idxHtml(groups,row){
    return `<nav class="idx" aria-label="目录">${groups.map(g=>`<section class="group"><h3>${esc(g.k)}</h3><ol>${g.items.map(row).join('')}</ol></section>`).join('')}</nav>`;
  }
  /* opt.star: 课堂 cards get the 想用 toggle; opt.only: starred words only, still numbered by their place in the full list */
  const groupsHtml=(x,docId,opt={})=>{ let n=0; return (x.groups||[]).map((g,gi)=>{
    const lis=(g.words||[]).map((w,wi)=>{ n++; return opt.only&&!w.star?'':wordLi(w,n,'',docId,opt.star?{doc:docId,gi,wi}:null); }).join('');
    return lis?`<section class="group"><h3>${esc(g.name)}</h3><ol>${lis}</ol></section>`:''; }).join(''); };

  function renderDays(view){
    if(!days.length){ view.innerHTML=daysLoaded?'<div class="empty"><strong>还没有单词</strong>跟 AI 说“今天的单词”，新词就会出现在这里。</div>':'<div class="empty"><strong>单词正在加载</strong>稍等一下。</div>'; return; }
    let i=days.findIndex(x=>x.id===dayId); if(i<0) i=days.length-1;
    const d=days[i]; loadPack(d.id);
    const head=pager('day',`Day ${d.day} · ${esc(d.topic||'')}`,days[i-1]&&days[i-1].id,days[i+1]&&days[i+1].id);
    if(idxOpen){
      view.innerHTML=head+idxHtml(byMonth([...days].reverse()),x=>`<li><button class="idx-row" data-go="day:${esc(x.id)}" aria-current="${x.id===d.id}"><span class="idx-k">Day ${x.day}</span><span class="idx-t">${esc(x.topic||'')}</span><span class="idx-m${lowScore(x.score)?' low':''}">${esc(shortDate(x.date))}${x.score?' · '+esc(x.score):''}</span></button></li>`);
      return;
    }
    const miss=missCount(d);
    view.innerHTML=head+`<div class="meta-row"><p class="meta">${esc(fmtDate(d.date))} · ${countOf(d)} 个词 · ${d.score?'测验 '+esc(d.score):'还没考'}${miss?' · 错过 '+miss+' 个':''}</p><button class="pill" data-prgo="day:${esc(d.id)}">▶ 练这一天</button></div>`+groupsHtml(d,d.id);
  }

  function renderClass(view){
    const pend=inbox.length?`<section class="group inbox"><h3>待整理 · ${inbox.length} 条　跟 AI 说“整理课堂笔记”</h3><ol>${inbox.map(x=>`<li${x.id===capEditId?' class="editing"':''}>
        <div class="main"><span class="in-t">${esc(x.text)}</span><span class="in-m">${[x.star?'★ 想用':'',x.cls||'',x.note||'',when(x.at)+(x.editedAt?'（改过）':'')].filter(Boolean).map(esc).join(' · ')}</span></div>
        <div class="in-acts"><button class="unmiss" data-cedit="${esc(x.id)}">修改</button><button class="unmiss" data-del="${esc(x.id)}">删除</button></div></li>`).join('')}</ol></section>`:'';
    if(!classes.length){ view.innerHTML=pend+`<div class="empty"><strong>还没有整理好的课堂词句</strong>课上听到好词好句，课间在上面记一下就行，拼错、只写读音都可以；也可以把老师写的白板或本子拍照发给 AI。晚上说“整理课堂笔记”，整理好的会按日期出现在这里，能听发音。</div>`; return; }
    let i=classes.findIndex(x=>x.id===cDate); if(i<0) i=0;   /* classes are sorted newest first */
    const c=classes[i]; loadPack(c.id);
    const head=pager('cls',esc(fmtDate(c.date)),classes[i+1]&&classes[i+1].id,classes[i-1]&&classes[i-1].id);
    if(idxOpen){
      view.innerHTML=pend+head+idxHtml(byMonth(classes),x=>`<li><button class="idx-row" data-go="cls:${esc(x.id)}" aria-current="${x.id===c.id}"><span class="idx-k">${esc(shortDate(x.date))}</span><span class="idx-t">${esc(classNames(x))}</span><span class="idx-m">${countOf(x)} 条</span></button></li>`);
      return;
    }
    const st=starCount(c);
    const miss=missCount(c);
    const meta=`<div class="meta-row"><p class="meta">${countOf(c)} 条${st?' · '+st+' 个想用':''}${miss?' · 错过 '+miss+' 个':''} · ${esc(classNames(c))}</p><div class="pacts"><button class="pill star" data-staronly="1" aria-pressed="${starOnly}">★ 只看想用</button>${starredPool().length?'<button class="pill" data-prgo="class">▶ 练想用的词</button>':''}</div></div>`;
    view.innerHTML=pend+head+meta+(starOnly&&!st
      ?'<div class="empty"><strong>这一天还没有标“想用”的词</strong>点卡片右边的“☆ 想用”就能标上，标了的会进下一次测验。</div>'
      :groupsHtml(c,c.id,{star:true,only:starOnly}));
  }

  /* spelling progress on an error-book card: a dot for each day in a row it was spelled right (counted at most once a day,
     reset by any miss); at three it may come out — the reader still removes it themself */
  function progLine(w){
    const p=progress[w.w.toLowerCase()]||{}, s=Math.max(0,Math.min(3,p.streak|0));
    const dots=`<span class="streak" aria-hidden="true">${[0,1,2].map(i=>`<i class="${i<s?'on':''}"></i>`).join('')}</span>`;
    const txt=s>=3?'<span class="chip done">已连续 3 天拼对，可以移出了</span>':(s?`连续 ${s} 天拼对`:'还没有连续拼对');
    const lw=mode!=='en'&&p.lastWrong&&p.wrongDay?` · ${esc(shortDate(p.wrongDay))} 拼成 ${esc(p.lastWrong)}`:'';
    return `<span class="prog-line">${dots}<span>${txt}${lw}</span></span>`;
  }
  /* error book: grouped by where each word came from, numbered by its place in the whole book */
  const srcOf=w=>!w.day?'other':(String(w.day).startsWith('c-')?'class':'day');
  function srcLabel(key){
    if(key==='other') return '作文和自己加的';
    if(key.startsWith('c-')) return '课堂 · '+fmtDate(key.slice(2));
    const d=days.find(x=>x.id===key); return d?`Day ${d.day} · ${d.topic||''}`:key;
  }
  function renderErrors(view){
    const ws=errors?errors.words||[]:[];
    if(!ws.length){ view.innerHTML='<div class="empty"><strong>错词本是空的</strong>测验里错过的词会加到这里。</div>'; return; }
    const cnt={all:ws.length,day:0,class:0,other:0}; ws.forEach(w=>cnt[srcOf(w)]++);
    if(errF!=='all'&&!cnt[errF]) errF='all';
    const F=[['all','全部'],['day','每日单词'],['class','课堂'],['other','作文和自加']].filter(([k])=>k==='all'||cnt[k]);
    /* 正序 = book order (oldest first); 倒序 = newest first, both for the groups and inside each group; numbers stay the book's */
    const groups=new Map(), order=ws.map((w,i)=>[w,i]); if(errNewFirst) order.reverse();
    order.forEach(([w,i])=>{ if(errF!=='all'&&srcOf(w)!==errF) return; const k=w.day||'other'; if(!groups.has(k)) groups.set(k,[]); groups.get(k).push([w,i]); });
    const sortBtn=`<button class="pill sort" data-errsort="1" aria-label="切换排序，现在是${errNewFirst?'最新在前':'最早在前'}">⇅ ${errNewFirst?'最新在前':'最早在前'}</button>`;
    const extra=w=>(w.wrong?`<span class="wrong${cover(isCovered((w.day||'')+'|'+w.w,'en'),'en','点开看错误记录')}"><span>错误记录：${esc(w.wrong)}</span></span>`:'')+progLine(w)+`<button class="unmiss" data-unmiss="${esc(w.w)}">已掌握，移出</button>`;
    view.innerHTML=`<div class="day-head"><h2>错词本</h2><span>${ws.length} 个词 · 测验里错过的词都在这里，确定掌握了再自己移出</span></div>`+
      `<div class="err-tools">${F.length>2?`<div class="filters" role="group" aria-label="按来源筛选">${F.map(([k,l])=>`<button class="pill" data-errf="${k}" aria-pressed="${k===errF}">${l} ${cnt[k]}</button>`).join('')}</div>`:''}<button class="pill" data-prgo="errors">▶ 练错词本</button>${sortBtn}</div>`+
      [...groups].map(([k,items])=>`<section class="group"><h3>${esc(srcLabel(k))} · ${items.length} 个</h3><ol>${items.map(([w,i])=>wordLi(w,i+1,extra(w),w.day)).join('')}</ol></section>`).join('');
  }

  /* search: English (whole word first, then prefix, then anywhere), then Chinese meaning, then example sentences */
  function renderSearch(view){
    const raw=q.trim(), qq=raw.toLowerCase();
    const errSet=new Set((errors&&errors.words||[]).map(w=>w.w.toLowerCase()));
    const rank=w=>{ const e=w.w.toLowerCase();
      if(e===qq) return 0; if(e.startsWith(qq)) return 1; if(e.includes(qq)) return 2;
      if(String(w.zh||'').includes(raw)) return 3;
      if(String(w.ex||'').toLowerCase().includes(qq)||String(w.exZh||'').includes(raw)) return 4; return -1; };
    const hits=[];
    days.forEach(d=>(d.groups||[]).forEach(g=>(g.words||[]).forEach(w=>{ const r=rank(w); if(r>=0) hits.push({w,r,id:d.id,label:`Day ${d.day} · ${g.name}`,go:'day:'+d.id}); })));
    classes.forEach(c=>(c.groups||[]).forEach((g,gi)=>(g.words||[]).forEach((w,wi)=>{ const r=rank(w); if(r>=0) hits.push({w,r,id:c.id,label:`课堂 ${shortDate(c.date)} · ${g.name}`,go:'cls:'+c.id,star:{doc:c.id,gi,wi}}); })));
    (errors&&errors.words||[]).forEach(w=>{ if(w.day) return; const r=rank(w); if(r>=0) hits.push({w,r,id:'',label:'错词本 · 作文和自己加的',go:'sec:errors'}); });
    hits.sort((a,b)=>a.r-b.r);
    const list=hits.slice(0,50);
    const src=h=>`<span class="src"><button class="src-go" data-go="${esc(h.go)}">${esc(h.label)} ›</button>${errSet.has(h.w.w.toLowerCase())?'<span class="chip bad">在错词本里</span>':''}</span>`;
    view.innerHTML=hits.length
      ?`<div class="day-head"><h2>搜索结果</h2><span>“${esc(raw)}”找到 ${hits.length} 条${hits.length>list.length?'，先显示前 '+list.length+' 条':''}</span></div><section class="group"><ol>${list.map((h,i)=>wordLi(h.w,i+1,src(h),h.id,h.star)).join('')}</ol></section>`
      :`<div class="empty"><strong>没有找到“${esc(raw)}”</strong>换个拼法试试，或者搜中文意思。每日单词、课堂词句和错词本都在搜索范围里。</div>`;
  }

  /* ───── 练习: spelling practice ─────
     Pick a source (error book / one day / starred class words), a mode (Chinese → English, or audio → English) and a size.
     One question at a time; the answer is checked exactly (case, spacing and curly quotes aside), wrong letters are marked.
     A right answer moves on by itself after a moment; a wrong one waits until the right spelling has been typed once
     (copying it is the drill). There is no "count it as right": a slip is a miss, as in the exam.
     Each finished question updates review/progress (a short pause batches them) and the session's practice/<id> log. */
  const ADV_MS=700;   /* how long a right answer stays green before the next question */
  const MODE_L={zh:'看中文写英文',audio:'听发音写英文'};
  const CN_NUM=['','一','两','三','四','五','六','七','八'];
  const norm=s=>String(s||'').normalize('NFKC').replace(/[’‘`´]/g,"'").replace(/\s+/g,' ').trim().toLowerCase().replace(/[.。]+$/,'');
  const practicable=w=>!!(w&&w.w&&!/,/.test(w.w)&&/[a-z]/i.test(w.w));
  const errSetNow=()=>new Set((errors&&errors.words||[]).map(w=>String(w.w).toLowerCase()));
  const streakOf=w=>((progress[String(w.w).toLowerCase()]||{}).streak|0);
  function errorsPool(skipDone){ return (errors&&errors.words||[]).filter(practicable).filter(w=>!skipDone||streakOf(w)<3).map(w=>({w,day:w.day||''})); }
  function curDayId(){ return (days.find(x=>x.id===prDay)||days[days.length-1]||{}).id||''; }
  function dayPool(id){ const d=days.find(x=>x.id===id); return d?(d.groups||[]).flatMap(g=>(g.words||[]).filter(practicable).map(w=>({w,day:d.id}))):[]; }
  function starredPool(){ return classes.flatMap(c=>(c.groups||[]).flatMap(g=>(g.words||[]).filter(w=>w.star&&practicable(w)).map(w=>({w,day:c.id})))); }
  function poolFor(src){ return src==='day'?dayPool(curDayId()):src==='class'?starredPool():errorsPool(prSkip); }
  function prLabel(src){
    if(src==='day'){ const d=days.find(x=>x.id===curDayId()); return d?`Day ${d.day} · ${d.topic||''}`:'每日单词'; }
    return src==='class'?'课堂想用的词':'错词本';
  }
  function shuffle(a){ for(let i=a.length-1;i>0;i--){ const j=Math.floor(Math.random()*(i+1)); [a[i],a[j]]=[a[j],a[i]]; } return a; }
  /* which letters two spellings share (longest common subsequence): the rest are extra (yours) or missing (the answer) */
  function lcsMarks(a,b){
    const A=a.toLowerCase(), B=b.toLowerCase(), n=A.length, m=B.length;
    const dp=Array.from({length:n+1},()=>new Uint16Array(m+1));
    for(let i=n-1;i>=0;i--) for(let j=m-1;j>=0;j--) dp[i][j]=A[i]===B[j]?dp[i+1][j+1]+1:Math.max(dp[i+1][j],dp[i][j+1]);
    const ak=new Array(n).fill(false), bk=new Array(m).fill(false); let i=0, j=0;
    while(i<n&&j<m){ if(A[i]===B[j]){ ak[i]=bk[j]=true; i++; j++; } else if(dp[i+1][j]>=dp[i][j+1]) i++; else j++; }
    return [ak,bk];
  }
  function focusAnswer(){ const inp=$('#pans'); if(inp) inp.focus({preventScroll:true}); }
  function autoPlay(){ const s=practice; if(!s||s.done||s.mode!=='audio'||s.answered) return; const b=$('.prac-card .speak.big'); if(b) say(b.getAttribute('data-say'),b); }
  /* leaving a session that is not finished: a practice saves what is done, the quiz sheet saves its drafts */
  function parkPractice(){ const s=practice; if(!s||s.done) return; clearTimeout(s.advT); if(s.sheet) saveDrafts(s,true); else saveNow(s).then(()=>Store.sync()); }
  function startPractice(items,src,label,mdMode){
    if(!items.length) return;
    parkPractice();
    practice={id:'p-'+Date.now().toString(36)+Math.random().toString(36).slice(2,6),src,label,mode:mdMode||prMode,items,
      i:0,results:[],answered:null,saved:0,logged:0,startedAt:Date.now(),done:false,added:false};
    sec='practice'; store.set('sec',sec); idxOpen=false; clearSearch(); render(); window.scrollTo({top:0});
    focusAnswer(); autoPlay();
  }
  function beginFromSetup(){
    const pool=shuffle(poolFor(prSrc).slice());
    if(prSrc==='errors') pool.sort((a,b)=>streakOf(a.w)-streakOf(b.w));   /* weakest first; ties stay shuffled */
    const n=prCount==='all'?pool.length:Math.min(+prCount,pool.length);
    startPractice(pool.slice(0,n),prSrc,prLabel(prSrc));
  }
  function answerQ(skip){
    const s=practice; if(!s||s.done||s.answered) return;
    const it=s.items[s.i], inp=$('#pans'), ans=skip?'':String(inp?inp.value:'').trim().slice(0,80);
    if(!skip&&!ans) return;   /* Enter on an empty box does nothing: 不会 is its own button */
    s.answered={answer:ans,ok:!!ans&&norm(ans)===norm(it.w.w)}; s.copyBad=false;
    render(); focusAnswer();
    const fb=$('.prac-card .pfb'); if(fb) fb.scrollIntoView({block:'nearest'});
    if(s.answered.ok){ const at=s.i; clearTimeout(s.advT); s.advT=setTimeout(()=>{ if(practice===s&&!s.done&&s.i===at&&s.answered) nextQ(); },ADV_MS); }
  }
  /* after a miss: the right spelling has to be typed once before moving on */
  function checkCopy(){
    const s=practice; if(!s||s.done||!s.answered||s.answered.ok) return;
    const inp=$('#pans'), v=String(inp?inp.value:'');
    if(!v.trim()) return;
    if(norm(v)===norm(s.items[s.i].w.w)){ nextQ(); return; }
    s.copyBad=true; render(); focusAnswer();
  }
  function finalize(s){
    const it=s.items[s.i];
    s.results.push({w:it.w.w,day:it.day||null,group:it.group||null,idx:s.i,answer:s.answered.answer,ok:s.answered.ok});
    s.answered=null; s.copyBad=false; s.i++;
  }
  function nextQ(){
    const s=practice; if(!s||s.done||!s.answered) return;
    clearTimeout(s.advT);
    finalize(s);
    if(s.i>=s.items.length){ s.done=true; saveNow(s); } else queueSave(s);
    render(); window.scrollTo({top:0});
    if(!s.done){ focusAnswer(); autoPlay(); }
  }
  function quitPractice(btn){
    const s=practice; if(!s) return;
    clearTimeout(s.advT);
    if(s.sheet&&!s.done){   /* nothing is lost by stopping a quiz sheet: the drafts are kept */
      saveDrafts(s,true); practice=null; render(); window.scrollTo({top:0});
      toast('写的都存好了，回来点“继续”接着写'); return;
    }
    if(!s.done&&!btn.classList.contains('confirm')){
      btn.classList.add('confirm'); btn.textContent='确定结束？';
      setTimeout(()=>{ if(btn.isConnected){ btn.classList.remove('confirm'); btn.textContent='结束'; } },3000);
      return;
    }
    if(s.answered) finalize(s);
    s.done=true;
    if(s.results.length) saveNow(s); else practice=null;
    render(); window.scrollTo({top:0});
  }
  /* progress rule: a right answer adds one to the streak at most once a day, and not on a day the word was missed;
     a miss resets it. The page and AI (after each evening quiz) both apply this rule */
  function applyResult(words,r,today){
    const k=String(r.w).toLowerCase(), p=Object.assign({streak:0,right:0,wrong:0},words[k]||{});
    if(r.ok){ p.right++; if(p.okDay!==today&&p.wrongDay!==today){ p.streak++; p.okDay=today; } }
    else{ p.wrong++; p.streak=0; p.wrongDay=today; p.lastWrong=String(r.answer||'').slice(0,60); }
    p.last=today; words[k]=p;
  }
  let saveChain=Promise.resolve(), saveTimer=null;
  function queueSave(s){ clearTimeout(saveTimer); saveTimer=setTimeout(()=>saveNow(s),1500); }
  function saveNow(s){ clearTimeout(saveTimer); saveChain=saveChain.catch(()=>{}).then(()=>flush(s)); return saveChain; }
  /* results are written on this device at once: the store keeps them and uploads them to the repository. The upload
     starts when the session ends (or the page is left), so a 20-question practice is one update, not twenty */
  function flush(s){
    if(!Store.ready) return;
    const n=s.results.length; if(n===s.saved&&n===s.logged) return;
    if(n>s.saved){
      const today=localDate(new Date());
      Store.updateProgress(words=>s.results.slice(s.saved,n).forEach(r=>applyResult(words,r,today)),{defer:true});
      s.saved=n; progress=Store.progress;
    }
    if(n>s.logged){
      const right=s.results.slice(0,n).filter(r=>r.ok).length, answers=s.results.slice(0,n).map(({idx,...r})=>r);
      if(s.src==='quiz') Store.saveQuiz(s.quizId,quizResult(s,answers,right),{defer:true});
      else Store.savePractice({id:s.id,at:s.startedAt,date:localDate(new Date(s.startedAt)),src:s.src,label:s.label,mode:s.mode,
        planned:s.items.length,done:n,right,items:answers},{defer:true});
      s.logged=n;
    }
    if(s.done) Store.sync();
    if(practice===s&&s.done) render();
  }
  /* quiz sheet drafts: kept on this device as they are typed; uploaded when the sheet is left (先停在这里, another tab,
     the page going to the background) and when it is handed in */
  let draftTimer=null;
  function queueDrafts(s){ clearTimeout(draftTimer); draftTimer=setTimeout(()=>saveDrafts(s),1200); }
  function saveDrafts(s,upload){
    clearTimeout(draftTimer);
    if(!s||!s.sheet||s.done) return;
    const key=JSON.stringify(s.drafts);
    store.set('qdraft:'+s.quizId,key);
    if(!Store.ready) return;
    if(key!==s.draftSaved){ Store.saveQuiz(s.quizId,sheetResult(s),{defer:true}); s.draftSaved=key; }
    if(upload) Store.sync();
  }
  document.addEventListener('visibilitychange',()=>{ if(document.visibilityState==='hidden'&&practice){ if(practice.sheet&&!practice.done) saveDrafts(practice,true); else saveNow(practice).then(()=>Store.sync()); } });
  function uniqMisses(s){
    const seen=new Set(), out=[];
    s.results.forEach(r=>{ if(r.ok) return; const it=s.items[r.idx], k=String(it.w.w).toLowerCase(); if(seen.has(k)) return; seen.add(k); out.push({w:it.w,day:it.day,answer:r.answer}); });
    return out;
  }
  /* misses from a day or class practice can go into the error book, on the reader's tap (never automatically) */
  function addMissesToBook(btn){
    const s=practice; if(!s||!Store.ready||s.added) return;
    const today=localDate(new Date()), md=shortDate(today), have=errSetNow(), add=[];
    uniqMisses(s).forEach(({w,day,answer})=>{
      const k=String(w.w).toLowerCase(); if(have.has(k)) return;
      const e={w:w.w,zh:w.zh||''}; if(day) e.day=day;
      e.wrong=`${md} 练习：${answer?answer:'没写出来'}`;
      if(w.tip) e.tip=w.tip; if(w.pos) e.pos=w.pos;
      if((!day||String(day).startsWith('c-'))&&(w.ipaUk||w.ipaUs)){ e.ipaUk=w.ipaUk||w.ipaUs; e.ipaUs=w.ipaUs||w.ipaUk; }
      add.push(e); have.add(k);
    });
    if(!add.length) return;
    Store.addErrors(add); errors=Store.errors;
    s.added=true; toast(`已加进错词本 ${add.length} 个`); render();
  }
  /* ───── 今晚测验 ─────
     AI writes quiz/q-YYYY-MM-DD each night: {date, items:[{w,prompt,day,group}], stars:true, graded:false}.
     On the first start the page adds the starred class words not quizzed before (this quiz's own items, earlier quizzes
     and quiz/history count as quizzed), at most QUIZ_STARS of them, oldest class day first, so the rest wait for the
     next quizzes; then it shuffles and freezes the list in result.items. The quiz is one answer sheet:
     every question on the page, edited freely, drafts saved in result.drafts (and on this device) so it can be left and
     continued. Nothing is marked until it is handed in; then result.answers holds the marked answers, complete:true, and
     review/progress is updated the same way as in practice. When you say 考完了, AI reads result, grades, and sets
     graded:true. */
  function openQuiz(){ return quizzes.filter(q=>!q.graded).sort((a,b)=>String(b.date).localeCompare(String(a.date)))[0]||null; }
  function quizzedSet(){
    const s=new Set(quizHistory.map(x=>String(x).toLowerCase()));
    quizzes.forEach(q=>{ (q.items||[]).concat((q.result&&q.result.items)||[]).forEach(i=>{ if(i&&i.w) s.add(String(i.w).toLowerCase()); }); });
    return s;
  }
  const QUIZ_STARS=5;   /* agreed 11/9: at most 5 starred class words per quiz */
  /* a starred card's quiz prompt: its Chinese meaning plus what the answer has to look like (part of speech, first
     letter, hyphen), so near-synonyms can be told apart (asked for on 11/12: 体格健壮的 alone could be strong, muscular,
     athletic or well-built). A card can carry its own wording in qp. */
  const POS_ZH={n:'名词',v:'动词',adj:'形容词',adv:'副词',prep:'介词',conj:'连词',vphr:'动词短语',phr:'短语'};
  function starPrompt(w){
    if(w.qp) return String(w.qp);
    const pos=String(w.pos||'').split('/').map(p=>POS_ZH[p]).filter(Boolean).join('／');
    const first=(String(w.w||'').match(/[A-Za-z]/)||[''])[0].toLowerCase();
    const bits=[pos, first?first+' 开头':'', /-/.test(String(w.w||''))?'带连字符':''].filter(Boolean);
    return (w.zh||'')+(bits.length?'（'+bits.join('，')+'）':'');
  }
  /* every starred class word still waiting for a quiz, oldest class day first (card order within a day) */
  function starQueue(q){
    if(!q.stars) return [];
    const seen=quizzedSet(), out=[];
    starredPool().slice().sort((a,b)=>String(a.day).localeCompare(String(b.day))).forEach(({w,day})=>{
      const k=String(w.w).toLowerCase(); if(seen.has(k)) return; seen.add(k); out.push({w:w.w,prompt:starPrompt(w),day,group:'课堂想用的词'}); });
    return out;
  }
  function quizStarItems(q){ return starQueue(q).slice(0,QUIZ_STARS); }
  function quizItems(q){
    if(q.result&&Array.isArray(q.result.items)&&q.result.items.length) return q.result.items;
    return shuffle((q.items||[]).filter(i=>i&&i.w).map(i=>({w:i.w,prompt:i.prompt||'',day:i.day||'',group:i.group||''})).concat(quizStarItems(q)));
  }
  function quizCard(i){
    const c=cardFor({w:i.w})||{};
    return {w:{...c,w:i.w,zh:i.prompt||c.zh||''},day:i.day||c.day||'',group:i.group||'',raw:{w:i.w,prompt:i.prompt||'',day:i.day||'',group:i.group||''}};
  }
  const filledOf=a=>(a||[]).filter(x=>String(x||'').trim()).length;
  /* while the sheet is open: the frozen list and the drafts, nothing marked yet */
  function sheetResult(s){
    return {items:s.items.map(it=>it.raw),drafts:s.drafts.slice(),answers:[],startedAt:s.startedAt,total:s.items.length,
      done:filledOf(s.drafts),right:0,complete:false,finishedAt:null};
  }
  /* handed in: every answer marked */
  function quizResult(s,answers,right){
    const n=answers.length, total=s.items.length;
    return {items:s.items.map(it=>it.raw),drafts:(s.drafts||[]).slice(),answers,startedAt:s.startedAt,total,done:n,right,
      complete:n>=total,finishedAt:n>=total?Date.now():null};
  }
  async function startQuiz(q){
    if(!q) return;
    if(!Store.ready){ toast('数据还在读取，稍等几秒再点'); return; }
    const r=q.result||{}, raw=quizItems(q); if(!raw.length){ toast('这次测验还没有题'); return; }
    if(r.complete){ render(); return; }
    if(practice&&practice.sheet&&practice.quizId===q.id&&!practice.done){ sec='practice'; store.set('sec',sec); render(); return; }
    parkPractice();
    /* drafts: the quiz doc's, else this device's copy (a draft that never reached the doc); an older quiz kept answers instead */
    const dbDrafts=Array.isArray(r.drafts)?r.drafts.map(x=>String(x||'')):(r.answers||[]).map(a=>String((a&&a.answer)||''));
    let drafts=dbDrafts;
    if(!filledOf(drafts)){ try{ const local=JSON.parse(store.get('qdraft:'+q.id)||'null'); if(Array.isArray(local)) drafts=local.map(x=>String(x||'')); }catch(e){} }
    drafts=raw.map((_,i)=>String(drafts[i]||'').slice(0,80));
    const s={id:'quiz-'+q.id,quizId:q.id,src:'quiz',sheet:true,label:`今晚测验 · ${fmtDate(q.date)}`,mode:'zh',items:raw.map(quizCard),
      drafts,draftSaved:JSON.stringify(raw.map((_,i)=>dbDrafts[i]||'')),i:0,results:[],answered:null,saved:0,logged:0,
      startedAt:r.startedAt||Date.now(),done:false,added:true};
    /* the first start freezes the list of questions (with the starred class words added) and sends it up */
    if(!(Array.isArray(r.items)&&r.items.length)){ Store.saveQuiz(q.id,sheetResult(s)); s.draftSaved=JSON.stringify(s.drafts); }
    practice=s; sec='practice'; store.set('sec',sec); idxOpen=false; clearSearch(); render(); window.scrollTo({top:0});
    const first=s.drafts.findIndex(x=>!x.trim()), inp=$(`.sin[data-si="${first<0?0:first}"]`);
    if(inp){ inp.focus({preventScroll:true}); if(first>0) inp.scrollIntoView({block:'center'}); }
    if(JSON.stringify(s.drafts)!==s.draftSaved) saveDrafts(s);
  }
  function quizCardHtml(){
    const q=openQuiz(); if(!q) return '';
    const r=q.result||{}, frozen=Array.isArray(r.items)&&r.items.length;
    const list=frozen?r.items:(q.items||[]).concat(quizStarItems(q)), total=list.length;
    const filled=Array.isArray(r.drafts)?filledOf(r.drafts):(r.answers||[]).length;
    const by=new Map(); list.forEach(i=>{ const g=i.group||'其他'; by.set(g,(by.get(g)||0)+1); });
    const wait=frozen?0:Math.max(0,starQueue(q).length-QUIZ_STARS);
    const desc=[...by].map(([g,c])=>`${g} ${c} 个`).join('、')+(wait?`（另外 ${wait} 个想用的课堂词排到之后的测验，每次最多考 ${QUIZ_STARS} 个）`:'');
    const head=`<span class="plab">今晚测验 · ${esc(fmtDate(q.date))}</span>`;
    if(r.complete) return `<section class="group prac-set quiz-card">${head}<div class="score">${r.right|0} / ${r.total|0}</div><p class="quiz-next">已经交卷了。${Store.status.pending?'答案还在同步，等右上角显示“已同步”。':''}回到 AI 的会话，说“考完了”，我来批改、出新词。</p></section>`;
    return `<section class="group prac-set quiz-card">${head}
      <div class="pq-zh">${filled?`已写 ${filled} / ${total} 题`:`${total} 题`}</div>
      <p class="meta">${esc(desc)}。像一张卷子：看中文写英文，全部写完再交，交卷前可以随便改；交卷后回到 AI 的会话说“考完了”。</p>
      <button class="go" data-quiz="${esc(q.id)}"${total?'':' disabled'}>${filled||frozen?'继续':'开始'}</button></section>`;
  }
  function quizSheet(s){
    const total=s.items.length;
    const rows=s.items.map((it,i)=>{
      const w=it.w, nW=String(w.w).trim().split(/\s+/).length, wc=nW>1?(CN_NUM[nW]||nW)+'个词':'', ph=posHtml(w);
      return `<li><span class="sn">${i+1}</span><div class="sq"><div class="sz">${esc(w.zh)}</div>${ph||wc?`<div class="pq-meta">${ph}${wc?`<span>${wc}</span>`:''}</div>`:''}
        <input class="sin" data-si="${i}" value="${esc(s.drafts[i]||'')}" maxlength="80" aria-label="第 ${i+1} 题：${esc(w.zh)}" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" enterkeyhint="${i+1<total?'next':'done'}"></div></li>`;
    }).join('');
    return `<div class="prac">
      <div class="prac-top"><span>${esc(s.label)} · ${total} 题</span><button type="button" class="ghost" data-pquit="1">先停在这里</button></div>
      <p class="meta">看中文写英文。回车跳到下一题，点哪题就改哪题，写的内容会自动保存。全部写完点最下面的“交卷”，交卷后才看对错。</p>
      <section class="group"><ol class="sheet">${rows}</ol></section>
      <div class="sheet-bar"><span class="sheet-count" id="sh-n">已写 ${filledOf(s.drafts)} / ${total}</span><button type="button" class="go" data-psubmit="1">交卷</button></div>
    </div>`;
  }
  function resetSubmit(){ const b=$('.sheet-bar .go.confirm'); if(b){ b.classList.remove('confirm'); b.textContent='交卷'; } const w=$('.sheet-warn'); if(w) w.remove(); }
  function submitSheet(btn){
    const s=practice; if(!s||!s.sheet||s.done) return;
    const blank=s.drafts.map((x,i)=>String(x).trim()?-1:i).filter(i=>i>=0);
    if(blank.length&&!btn.classList.contains('confirm')){
      btn.classList.add('confirm'); btn.textContent='确定交卷';
      let w=$('.sheet-warn'); if(!w){ w=document.createElement('p'); w.className='sheet-warn'; w.setAttribute('role','status'); btn.parentElement.appendChild(w); }
      w.textContent=`还有 ${blank.length} 题空着（第 ${blank.slice(0,8).map(i=>i+1).join('、')} 题${blank.length>8?'等':''}），空着的算错。要交卷就再点一次。`;
      blank.forEach(i=>{ const x=$(`.sin[data-si="${i}"]`); if(x) x.classList.add('empty-warn'); });
      return;
    }
    clearTimeout(draftTimer);
    s.results=s.items.map((it,i)=>{ const ans=String(s.drafts[i]||'').trim().slice(0,80); return {w:it.w.w,day:it.day||null,group:it.group||null,idx:i,answer:ans,ok:!!ans&&norm(ans)===norm(it.w.w)}; });
    s.done=true; s.i=s.items.length;
    store.set('qdraft:'+s.quizId,'');
    saveNow(s); render(); window.scrollTo({top:0});
  }
  function practiceHome(){
    const eAll=errorsPool(false).length, ePool=errorsPool(prSkip).length, cPool=starredPool().length, did=curDayId(), dPool=dayPool(did).length;
    const n=prSrc==='day'?dPool:prSrc==='class'?cPool:ePool, take=prCount==='all'?n:Math.min(+prCount,n);
    const srcs=[['errors',`错词本 ${eAll}`],['day','每日单词'],['class',`课堂想用的词 ${cPool}`]];
    const dayOpts=[...days].reverse().map(d=>`<option value="${esc(d.id)}"${d.id===did?' selected':''}>Day ${d.day} · ${esc(d.topic||'')}（${dayPool(d.id).length} 个）</option>`).join('');
    const empty=prSrc==='errors'&&eAll&&!ePool?'错词本里的词都已经连续 3 天拼对了，可以取消上面的勾，全部再练一遍。'
      :(n?'':(prSrc==='class'?'还没有标“想用”的课堂词。到「课堂」页点卡片右边的“☆ 想用”就能加进来。':'这里还没有词。'));
    const recent=practiceLog.slice(0,5);
    return `<div class="prac">${quizCardHtml()}<div class="day-head"><h2>拼写练习</h2><span>看中文或听发音，把英文拼出来，马上知道对错：拼对自动进下一题，拼错要照着正确拼写打一遍。错词本里的词连续 3 天拼对，就可以考虑移出</span></div>
      <section class="group prac-set">
        <div class="prow"><span class="plab">练什么</span><div class="filters" role="group" aria-label="练什么">${srcs.map(([k,l])=>`<button class="pill" data-psrc="${k}" aria-pressed="${k===prSrc}">${esc(l)}</button>`).join('')}</div></div>
        ${prSrc==='day'&&days.length?`<div class="prow"><label class="plab" for="pr-day">哪一天</label><select id="pr-day">${dayOpts}</select></div>`:''}
        ${prSrc==='errors'?`<label class="pcheck"><input type="checkbox" id="pr-skip"${prSkip?' checked':''}>跳过已经连续 3 天拼对的</label>`:''}
        <div class="prow"><span class="plab">怎么练</span><div class="filters" role="group" aria-label="怎么练">${Object.entries(MODE_L).map(([k,l])=>`<button class="pill" data-pmode="${k}" aria-pressed="${k===prMode}">${l}</button>`).join('')}</div></div>
        <div class="prow"><span class="plab">题数</span><div class="filters" role="group" aria-label="题数">${[['10','10 题'],['20','20 题'],['all',`全部 ${n}`]].map(([k,l])=>`<button class="pill" data-pcount="${k}" aria-pressed="${k===prCount}">${l}</button>`).join('')}</div></div>
        ${empty?`<p class="note">${esc(empty)}</p>`:''}
        <button class="go" data-pstart="1"${take?'':' disabled'}>开始练习${take?`（${take} 题）`:''}</button>
      </section>
      ${recent.length?`<section class="group recent"><h3>最近的练习</h3><ol>${recent.map(r=>`<li><span>${esc(when(r.at))} · ${esc(r.label||'')} · ${esc(MODE_L[r.mode]||'')}</span><span class="r-s">${r.right|0} / ${r.done|0}</span></li>`).join('')}</ol></section>`:''}
    </div>`;
  }
  function practiceCard(s){
    const it=s.items[s.i], w=it.w, a=s.answered, total=s.items.length;
    const nWords=String(w.w).trim().split(/\s+/).length, wc=nWords>1?(CN_NUM[nWords]||nWords)+'个词':'';
    const dd=it.day?` data-day="${esc(it.day)}"`:'';
    const from=s.src==='day'||s.src==='quiz'?'':`<span>出自 ${esc(srcLabel(it.day||'other'))}</span>`;
    const meta=`<div class="pq-meta">${posHtml(w)}${wc?`<span>${wc}</span>`:''}${from}</div>`;
    const prompt=s.mode==='audio'
      ?`<div class="pq-listen"><button type="button" class="speak big" data-say="${esc(w.w)}"${dd} aria-label="播放发音">${ICON}</button><span>听发音，拼出这个${nWords>1?'短语':'词'}</span></div>${a?`<div class="pq-zh">${esc(w.zh)}</div>`:''}`
      :`<div class="pq-zh">${esc(w.zh)}</div>`;
    let fb='';
    if(a&&a.ok) fb=`<div class="pfb ok" role="status"><div class="pfb-h">✓ 拼对了</div></div>`;
    else if(a){
      const exw=w.ex?w:cardFor(w);   /* error-book entries have no example: borrow the one on their card */
      const [ak,bk]=lcsMarks(a.answer,w.w);
      const yours=a.answer?[...a.answer].map((ch,i)=>ak[i]?esc(ch):`<span class="x">${esc(ch)}</span>`).join(''):'（没写）';
      const right=[...w.w].map((ch,i)=>bk[i]?esc(ch):`<span class="m${ch===' '?' sp':''}">${ch===' '?' ':esc(ch)}</span>`).join('');
      fb=`<div class="pfb bad" role="status">
          <div class="pfb-h">✗ 拼错了</div>
          <div class="pw"><span class="pans-l">你写的</span>${yours}</div>
          <div class="pw"><span class="pans-l">正确</span>${right}</div>
          <div class="pfb-note">${s.copyBad?'还不对，对照正确拼写再打一遍':'照着正确拼写，在上面的框里打一遍，再进下一题'}</div>
        </div>
        <div class="pinfo">
          <div class="pacts"><button type="button" class="speak small" data-say="${esc(w.w)}"${dd} aria-label="朗读 ${esc(w.w)}">${ICON}</button>${ipaHtml(w,false)}</div>
          ${exw&&exw.ex?`<span class="exp">${exPlain(exw)}</span>`:''}
          ${w.tip?`<span class="tip">${esc(w.tip)}</span>`:''}
        </div>`;
    }
    return `<div class="prac">
      <div class="prac-top"><span>${esc(s.label)} · ${MODE_L[s.mode]}</span><span>${s.i+1} / ${total}</span><button type="button" class="ghost" data-pquit="1">结束</button></div>
      <div class="bar-prog" role="progressbar" aria-label="进度" aria-valuemin="0" aria-valuemax="${total}" aria-valuenow="${s.i}"><i style="width:${Math.round(s.i/total*100)}%"></i></div>
      <section class="group prac-card">
        ${prompt}${meta}
        <form class="pform" id="pform" autocomplete="off"><input id="pans" data-k="${esc(s.id)}|${s.i}|${a?(a.ok?'ok':'copy'):'q'}" class="${a?(a.ok?'ok':(s.copyBad?'bad':'')):''}" value="${a&&a.ok?esc(a.answer):''}"${a&&a.ok?' readonly':''} placeholder="${a?(a.ok?'':'照着正确拼写打一遍'):'拼写英文'}" aria-label="${a&&!a.ok?'照着正确拼写打一遍':'拼写英文'}" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" enterkeyhint="${a?'next':'done'}"><button class="go" type="submit">${a?(a.ok?(s.i+1<total?'下一题':'看结果'):'抄好了'):'提交'}</button></form>
        ${a?'':'<div class="pacts"><button type="button" class="ghost" data-pskip="1">不会，看答案</button></div>'}
        ${fb}
      </section></div>`;
  }
  /* one line of the result list: a miss shows what was written against the right spelling, letter by letter */
  function resultRow(s,r,have){
    const it=s.items[r.idx]||{}, w=it.w||{w:r.w,zh:''}, dd=it.day?` data-day="${esc(it.day)}"`:'';
    const spk=`<button type="button" class="speak small" data-say="${esc(w.w)}"${dd} aria-label="朗读 ${esc(w.w)}">${ICON}</button>`;
    const no=s.sheet?`第 ${r.idx+1} 题 · `:'';
    if(r.ok) return `<li><div class="main"><span class="pw">${esc(w.w)}</span><span class="in-m">${no}${esc(w.zh||'')}</span></div>${spk}</li>`;
    const [ak,bk]=lcsMarks(r.answer||'',w.w);
    const yours=r.answer?[...r.answer].map((ch,i)=>ak[i]?esc(ch):`<span class="x">${esc(ch)}</span>`).join(''):'（没写）';
    const right=[...w.w].map((ch,i)=>bk[i]?esc(ch):`<span class="m${ch===' '?' sp':''}">${ch===' '?' ':esc(ch)}</span>`).join('');
    const inBook=!s.sheet&&have.has(String(w.w).toLowerCase())?' · 在错词本里':'';
    return `<li><div class="main"><span class="in-m">${no}${esc(w.zh||'')}${inBook}</span><span class="pw"><span class="pans-l">你写的</span>${yours}</span><span class="pw"><span class="pans-l">正确</span>${right}</span></div>${spk}</li>`;
  }
  function practiceSummary(s){
    const n=s.results.length, right=s.results.filter(r=>r.ok).length, miss=uniqMisses(s), have=errSetNow();
    const notIn=miss.filter(x=>!have.has(String(x.w.w).toLowerCase()));
    const bad=s.results.filter(r=>!r.ok), good=s.results.filter(r=>r.ok);
    const quiz=s.src==='quiz', partial=n<s.items.length, allSaved=s.saved===n&&s.logged===n;
    const up=Store.status, synced=allSaved&&!up.pending;
    const saved=!allSaved?'正在保存结果…':synced?(quiz?'答案已同步，AI 可以批改了。':'结果已记进进度。'):up.syncing?'已存在这台设备上，正在同步…':'已存在这台设备上，还没同步上去（检查网络）。';
    return `<div class="prac">
      <div class="day-head"><h2>${quiz?'交卷了':'练习完成'}</h2><span>${esc(s.label)}${quiz?'':' · '+MODE_L[s.mode]}${partial?` · 做了 ${n} / ${s.items.length} 题`:''}</span></div>
      <section class="group prac-set"><div class="score">${right} / ${n}</div>
        <p class="meta">${right===n?'全部拼对，很棒！':`拼错 ${n-right} 个，在下面。`} ${saved}</p>
        ${quiz?'<p class="quiz-next">回到 AI 的会话，说“考完了”。我来批改、讲错词、更新错词本，再给你下一天的新词。</p>':''}
        <div class="pacts">
          ${allSaved&&up.pending&&!up.syncing?'<button class="go" data-presave="1">再同步一次</button>':''}
          ${miss.length?`<button class="${allSaved&&up.pending&&!up.syncing?'ghost':'go'}" data-pretry="1">再练一次错的 ${miss.length} 个</button>`:''}
          ${notIn.length&&!s.added?`<button class="ghost" data-padd="1">把不在错词本里的 ${notIn.length} 个加进错词本</button>`:''}
          <button class="ghost" data-phome="1">回到练习首页</button>
        </div></section>
      ${bad.length?`<section class="group miss"><h3>错了 ${bad.length} 个</h3><ol>${bad.map(r=>resultRow(s,r,have)).join('')}</ol></section>`:''}
      ${good.length?`<section class="group miss"><h3>对了 ${good.length} 个</h3><ol>${good.map(r=>resultRow(s,r,have)).join('')}</ol></section>`:''}
    </div>`;
  }
  function renderPractice(view){
    const s=practice;
    view.innerHTML=!s?practiceHome():s.done?practiceSummary(s):s.sheet?quizSheet(s):practiceCard(s);
  }

  function render(){
    navHtml(); hidePop(); cards=[];
    const view=$('#view'), searching=!!q.trim();
    if(!Store.ready){ $('#cap-wrap').hidden=true; document.body.classList.remove('has-bar'); view.innerHTML=gateHtml(); return; }
    /* a re-render (live data, a save) must not wipe what is being typed into the practice box */
    const ae=document.activeElement, pa=$('#pans');
    const keep=pa&&!pa.readOnly?{k:pa.dataset.k,v:pa.value,f:ae===pa,s:pa.selectionStart,e:pa.selectionEnd}:null;
    const sk=ae&&ae.classList&&ae.classList.contains('sin')?{i:ae.dataset.si,s:ae.selectionStart,e:ae.selectionEnd}:null;
    $('#cap-wrap').hidden=searching||sec!=='class';
    $('#m-all').parentElement.hidden=!searching&&sec==='practice';
    document.body.classList.toggle('has-bar',!searching&&sec==='practice'&&!!practice&&!!practice.sheet&&!practice.done);
    missSet=!searching&&(sec==='days'||sec==='class')?errSetNow():null;
    if(searching) renderSearch(view);
    else if(sec==='practice') renderPractice(view);
    else if(sec==='class') renderClass(view);
    else if(sec==='errors') renderErrors(view);
    else renderDays(view);
    const pb=$('#pans');   /* same question, same step only: a miss must not carry the wrong spelling into the copy box */
    if(keep&&pb&&!pb.readOnly&&pb.dataset.k===keep.k){ pb.value=keep.v; if(keep.f){ pb.focus({preventScroll:true}); try{ pb.setSelectionRange(keep.s,keep.e); }catch(e){} } }
    const sb=sk&&$(`.sin[data-si="${sk.i}"]`);
    if(sb){ sb.focus({preventScroll:true}); try{ sb.setSelectionRange(sk.s,sk.e); }catch(e){} }
  }
  function openRef(ref){
    const at=ref.indexOf(':'), k=ref.slice(0,at), v=ref.slice(at+1); if(!v) return;
    if(k==='day'){ sec='days'; dayId=v; } else if(k==='cls'){ sec='class'; cDate=v; } else if(k==='sec'){ sec=v; }
    store.set('sec',sec); idxOpen=false; clearSearch(); render(); window.scrollTo({top:0});
  }
  function clearSearch(){ if(!q) return; q=''; $('#q').value=''; $('#q-clear').hidden=true; }
  let qTimer;
  $('#q').addEventListener('input',e=>{ clearTimeout(qTimer); const v=e.target.value; $('#q-clear').hidden=!v; qTimer=setTimeout(()=>{ q=v; render(); },150); });
  $('#q').addEventListener('keydown',e=>{ if(e.key==='Escape'&&q){ clearSearch(); render(); } if(e.key==='Enter') e.target.blur(); });
  $('#q-clear').addEventListener('click',()=>{ clearSearch(); render(); $('#q').focus(); });
  /* opening one covered block opens its partners in the same card: Chinese word + sentence, or English word + IPA */
  function uncover(c){
    const li=c.closest('li.word'), card=li&&cards[+li.dataset.ci];
    if(card&&c.dataset.c) shown.add(card.key+'|'+c.dataset.c);
    (li&&c.dataset.c?li.querySelectorAll(`.cover[data-c="${c.dataset.c}"]`):[c]).forEach(x=>{x.classList.remove('cover');['role','tabindex','aria-label'].forEach(a=>x.removeAttribute(a));});
  }
  document.addEventListener('click',e=>{
    /* connection and settings */
    if(e.target.closest('#sync-btn')||e.target.closest('[data-settings]')){ openDlg('settings'); return; }
    const hp=e.target.closest('[data-help]'); if(hp){ openDlg(hp.dataset.help); return; }
    if(e.target.closest('[data-close]')||e.target===$('#dlg')){ $('#dlg').close(); return; }
    if(e.target.closest('[data-syncnow]')){ Store.sync().then(()=>Store.refresh()); return; }
    if(e.target.closest('[data-reload]')){ Store.refresh(true); return; }
    const sg=e.target.closest('[data-signout]'); if(sg){ signOut(sg); return; }
    if(e.target.closest('[data-retry]')){ Store.start(); return; }
    const gb=e.target.closest('[data-gkey]'); if(gb){sayGloss(gb.dataset.gkey,gb);return;}
    /* in a practice question the speak button hands the cursor back to the answer box, so Enter still answers */
    const sb=e.target.closest('[data-say]'); if(sb){say(sb.getAttribute('data-say'),sb); if(sb.closest('.prac-card')) focusAnswer(); return;}
    if(e.target.closest('#pop')) return;
    const t=e.target.closest('.ex .t'); if(t){showPop(t);return;}
    hidePop();
    const go=e.target.closest('[data-go]'); if(go){ if(!go.disabled) openRef(go.dataset.go); return; }
    const ix=e.target.closest('[data-idx]'); if(ix){ idxOpen=!idxOpen; render(); return; }
    const sc=e.target.closest('[data-sec]'); if(sc){ sec=sc.dataset.sec; store.set('sec',sec); idxOpen=false; clearSearch(); render(); window.scrollTo({top:0}); return; }
    const ef=e.target.closest('[data-errf]'); if(ef){ errF=ef.dataset.errf; render(); return; }
    const es=e.target.closest('[data-errsort]'); if(es){ errNewFirst=!errNewFirst; store.set('err-order',errNewFirst?'new':'old'); render(); return; }
    const sb2=e.target.closest('[data-star]'); if(sb2){ toggleStar(sb2); return; }
    const so=e.target.closest('[data-staronly]'); if(so){ starOnly=!starOnly; store.set('star-only',starOnly?'1':'0'); render(); return; }
    /* practice */
    const pg=e.target.closest('[data-prgo]'); if(pg){
      const v=pg.dataset.prgo;
      if(!practice||practice.done){ practice=null; if(v.startsWith('day:')){ prSrc='day'; prDay=v.slice(4); } else prSrc=v; store.set('pr-src',prSrc); }
      sec='practice'; store.set('sec',sec); idxOpen=false; clearSearch(); render(); window.scrollTo({top:0}); return;
    }
    const ps=e.target.closest('[data-psrc]'); if(ps){ prSrc=ps.dataset.psrc; store.set('pr-src',prSrc); render(); return; }
    const pm=e.target.closest('[data-pmode]'); if(pm){ prMode=pm.dataset.pmode; store.set('pr-mode',prMode); render(); return; }
    const pc=e.target.closest('[data-pcount]'); if(pc){ prCount=pc.dataset.pcount; store.set('pr-count',prCount); render(); return; }
    if(e.target.closest('[data-pstart]')){ beginFromSetup(); return; }
    const qz=e.target.closest('[data-quiz]'); if(qz){ startQuiz(quizzes.find(x=>x.id===qz.dataset.quiz)); return; }
    if(e.target.closest('[data-pskip]')){ answerQ(true); return; }
    const psb=e.target.closest('[data-psubmit]'); if(psb){ submitSheet(psb); return; }
    if(e.target.closest('[data-presave]')){ Store.sync(); return; }
    const pq=e.target.closest('[data-pquit]'); if(pq){ quitPractice(pq); return; }
    if(e.target.closest('[data-pretry]')){ const s=practice; if(s) startPractice(shuffle(uniqMisses(s).map(({w,day})=>({w,day}))),'retry','刚才错的',s.mode); return; }
    const pad=e.target.closest('[data-padd]'); if(pad){ addMissesToBook(pad); return; }
    if(e.target.closest('[data-phome]')){ practice=null; render(); window.scrollTo({top:0}); return; }
    const c=e.target.closest('.cover'); if(c) uncover(c);
    const u=e.target.closest('[data-unmiss]'); if(u) unmiss(u);
    const dl=e.target.closest('[data-del]'); if(dl) delCapture(dl);
    const ce=e.target.closest('[data-cedit]'); if(ce) editCapture(ce.dataset.cedit);
  });
  document.addEventListener('keydown',e=>{ if(e.key==='Escape') hidePop(); });
  /* a speak button in a practice question never takes the focus from the answer box (desktop: no focus on mousedown) */
  document.addEventListener('mousedown',e=>{ if(e.target.closest&&e.target.closest('.prac-card [data-say]')) e.preventDefault(); });
  document.addEventListener('submit',e=>{
    if(e.target.id!=='pform') return;
    e.preventDefault();
    const s=practice; if(!s||s.done) return;
    if(!s.answered) answerQ(false); else if(s.answered.ok) nextQ(); else checkCopy();
  });
  /* quiz sheet: typing keeps the draft, Enter goes to the next question */
  document.addEventListener('input',e=>{
    const t=e.target; if(!t.classList||!t.classList.contains('sin')) return;
    const s=practice; if(!s||!s.sheet||s.done) return;
    s.drafts[+t.dataset.si]=t.value.slice(0,80);
    if(t.value.trim()) t.classList.remove('empty-warn');
    const c=$('#sh-n'); if(c) c.textContent=`已写 ${filledOf(s.drafts)} / ${s.items.length}`;
    resetSubmit(); queueDrafts(s);
  });
  document.addEventListener('keydown',e=>{
    const t=e.target; if(e.key!=='Enter'||e.isComposing||!t.classList||!t.classList.contains('sin')) return;
    e.preventDefault();
    const next=$(`.sin[data-si="${+t.dataset.si+1}"]`);
    if(next){ next.focus({preventScroll:true}); next.scrollIntoView({block:'center'}); }
    else{ t.blur(); const b=$('.sheet-bar .go'); if(b) b.scrollIntoView({block:'end'}); }
  });
  document.addEventListener('change',e=>{
    if(e.target.id==='pr-day'){ prDay=e.target.value; render(); }
    else if(e.target.id==='pr-skip'){ prSkip=e.target.checked; store.set('pr-skip',prSkip?'1':'0'); render(); }
  });
  /* back to top: shows after about a screen of scrolling, hides again at the top */
  const toTop=$('#totop'); let topTick=false;
  function syncTop(){ topTick=false; toTop.hidden=window.scrollY<700; }
  window.addEventListener('scroll',()=>{ if(!topTick){ topTick=true; requestAnimationFrame(syncTop); } },{passive:true});
  toTop.addEventListener('click',()=>{
    const still=window.matchMedia&&window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    toTop.blur(); window.scrollTo({top:0,behavior:still?'auto':'smooth'});
  });
  syncTop();
  /* the tool bar sticks to the top; a hairline shows once the page has scrolled under it */
  if('IntersectionObserver' in window) new IntersectionObserver(([en])=>$('#tools').classList.toggle('stuck',!en.isIntersecting)).observe($('#stick-mark'));
  /* 错词只由用户自己移出：第一次点按钮变成“确定移出？”，3 秒内再点才写入 */
  let pending=null;
  async function unmiss(btn){
    if(!btn.classList.contains('confirm')){
      btn.classList.add('confirm'); btn.textContent='确定移出？再点一次';
      clearTimeout(pending); pending=setTimeout(()=>{btn.classList.remove('confirm');btn.textContent='已掌握，移出';},3000);
      return;
    }
    if(!Store.ready) return; clearTimeout(pending);
    Store.removeError(btn.dataset.unmiss); errors=Store.errors;
    toast(`已移出 ${btn.dataset.unmiss}`); render();
  }

  /* 想用 on 课堂 cards: the AI sets a card's first star in the class file; a tap here is kept in state/stars.json and
     wins over it. The quiz reads the result (Store.classes) */
  function toggleStar(btn){
    if(!Store.ready){ toast('数据还在读取，稍等几秒再点'); return; }
    const [doc,gi,wi]=btn.dataset.star.split('|'), c=classes.find(x=>x.id===doc);
    const w=c&&c.groups&&c.groups[+gi]&&(c.groups[+gi].words||[])[+wi]; if(!w) return;
    const on=!w.star;
    Store.setStar(doc,w.w,on); classes=Store.classes; render();
    toast(on?`已标“想用”：${w.w}，下次测验会考`:`已取消“想用”：${w.w}`);
  }

  /* quick capture: one line of text (+ optional note, class, star) becomes one inbox doc; AI deletes it after organizing.
     修改 loads a note back into the same form; saving rewrites that doc (keeping when it was first written). A note AI
     has already organized is gone from the inbox and can no longer be changed: what was typed can be kept as a new note. */
  const CLS=['口语','听力','阅读','语法','讨论','写作','发音','其他'];
  let capCls=store.get('cap-cls')||'', capStar=false;
  function syncCap(){
    $('#cap-cls').innerHTML=CLS.map(c=>`<button type="button" class="pill" data-cls="${c}" aria-pressed="${c===capCls}">${c}</button>`).join('');
    $('#cap-star').setAttribute('aria-pressed',capStar);
    $('#cap-editing').hidden=!capEditId;
    $('#cap-go').textContent=capEditId?'保存修改':'记下';
  }
  syncCap();
  function editCapture(id){
    const x=inbox.find(n=>n.id===id); if(!x) return;
    capEditId=id; capCls=x.cls||''; capStar=!!x.star;
    $('#cap-text').value=x.text||''; $('#cap-note').value=x.note||'';
    syncCap(); render();
    $('#cap').scrollIntoView({block:'start'}); $('#cap-text').focus({preventScroll:true});
  }
  /* leaving edit mode: back to the class used last for new notes; clear=false keeps what is typed (to save it as a new note) */
  function endEdit(clear){
    capEditId=null; capCls=store.get('cap-cls')||''; capStar=false;
    if(clear){ $('#cap-text').value=''; $('#cap-note').value=''; }
    syncCap();
  }
  $('#cap-cancel').addEventListener('click',()=>{ endEdit(true); render(); });
  $('#cap-cls').addEventListener('click',e=>{ const b=e.target.closest('[data-cls]'); if(!b) return; capCls=capCls===b.dataset.cls?'':b.dataset.cls; if(!capEditId) store.set('cap-cls',capCls); syncCap(); });
  $('#cap-star').addEventListener('click',()=>{ capStar=!capStar; syncCap(); });
  $('#cap').addEventListener('submit',async e=>{
    e.preventDefault();
    const tx=$('#cap-text'), nt=$('#cap-note'), go=$('#cap-go'), text=tx.value.trim();
    if(!text){ tx.focus(); return; }
    if(!Store.ready){ toast('数据还在读取，稍等几秒再点'); return; }
    const now=new Date(), data={text:text.slice(0,200),at:now.getTime(),date:localDate(now)};
    if(nt.value.trim()) data.note=nt.value.trim().slice(0,300);
    if(capCls) data.cls=capCls;
    if(capStar) data.star=true;
    if(capEditId){
      const old=inbox.find(x=>x.id===capEditId);
      if(!old){ endEdit(false); render(); toast('这条刚被 AI 整理成卡片了，改不了；你写的还在框里，点“记下”可以存成新的一条'); return; }
      Store.editNote(capEditId,{...data,at:old.at||data.at,date:old.date||data.date,editedAt:now.getTime()});
      endEdit(true); inbox=Store.inbox; render(); toast('改好了');
    }else{
      Store.addNote(data); inbox=Store.inbox;
      tx.value=''; nt.value=''; capStar=false; syncCap(); render(); toast('记下了'); tx.focus();
    }
  });
  async function delCapture(btn){
    if(!btn.classList.contains('confirm')){
      btn.classList.add('confirm'); btn.textContent='确定删除？';
      setTimeout(()=>{ if(btn.isConnected){btn.classList.remove('confirm');btn.textContent='删除';} },3000);
      return;
    }
    if(!Store.ready) return;
    if(btn.dataset.del===capEditId) endEdit(true);
    Store.deleteNote(btn.dataset.del); inbox=Store.inbox; render();
  }
  document.addEventListener('keydown',e=>{ if((e.key==='Enter'||e.key===' ')&&e.target.classList&&e.target.classList.contains('cover')){e.preventDefault();uncover(e.target);} });

  /* ───── connection: the gate shown until the data is here, the sync badge in the header, the settings panel ───── */
  const fmtWhen=t=>{ if(!t) return ''; const d=new Date(t); return (d.getMonth()+1)+' 月 '+d.getDate()+' 日 '+pad(d.getHours())+':'+pad(d.getMinutes()); };
  function gateHtml(){
    const s=Store.status;
    if(s.state==='setup'||s.state==='auth') return `<section class="group gate">
        <strong>${s.state==='auth'?'令牌失效了':'连接你的词汇本'}</strong>
        <p class="meta">${s.state==='auth'?'换一个新的令牌贴进来。':'第一次在这台设备上打开，要贴一次 GitHub 令牌。令牌只存在这台设备上。'}</p>
        <form class="pform" id="tok-form" autocomplete="off"><input id="tok" type="password" placeholder="github_pat_…" aria-label="GitHub 令牌" autocomplete="off" autocapitalize="off" spellcheck="false"><button class="go" type="submit">连接</button></form>
        <p class="note" id="tok-msg" role="status"></p>
        <div><button type="button" class="linkish" data-help="token">令牌怎么拿？</button></div>
      </section>`;
    if(s.state==='error') return `<div class="empty"><strong>词表暂时打不开</strong>${esc(s.error)}<div class="pacts gate-acts"><button class="go" data-retry="1">再试一次</button><button class="ghost" data-settings="1">设置</button></div></div>`;
    const pct=s.total?Math.round(s.done/s.total*100):0;
    return `<div class="empty"><strong>正在读取单词</strong>${s.total?`${s.done} / ${s.total} 个文件，第一次会慢一点`:'稍等一下'}<div class="bar-prog gate-bar"><i style="width:${pct}%"></i></div></div>`;
  }
  document.addEventListener('submit',async e=>{
    if(e.target.id!=='tok-form') return;
    e.preventDefault();
    const msg=$('#tok-msg'), btn=e.target.querySelector('button');
    btn.disabled=true; msg.textContent='正在连接…';
    try{ await Store.connect($('#tok').value); }
    catch(err){ if(msg.isConnected){ msg.textContent=err.message||'没连上'; btn.disabled=false; } }
  });
  function syncBadge(){
    const s=Store.status, on=Store.hasToken();
    $('#sync-btn').dataset.k=!on?'off':s.state==='auth'?'bad':s.syncing?'busy':s.pending?(s.offline||s.error?'bad':'busy'):s.offline?'off':'ok';
    $('#sync-txt').textContent=!on?'未连接':s.state==='auth'?'令牌失效':s.syncing?'正在同步':s.pending?`${s.pending} 项待同步`:s.offline?'离线':s.state==='loading'?'读取中':'已同步';
  }
  let dlgKind='', latest=null;
  function settingsHtml(){
    const s=Store.status, c=Store.config, on=Store.hasToken(), last=days[days.length-1];
    const line=!on?'还没连接':s.state==='auth'?'令牌失效了，要换一个':s.syncing?'正在同步…':s.pending?`有 ${s.pending} 项记录还没同步上去${s.offline?'（没连上网络）':''}`:'全部记录都已同步';
    return `<div class="dlg-h"><h2 id="dlg-h">同步和设置</h2><button type="button" class="clr" data-close="1" aria-label="关闭">×</button></div>
      <dl class="kv">
        <dt>记录</dt><dd>${esc(line)}${s.lastSync?`<br><span class="note">上次同步 ${esc(fmtWhen(s.lastSync))}</span>`:''}</dd>
        <dt>最新内容</dt><dd>${last?`Day ${last.day} · ${esc(fmtDate(last.date))}`:'—'}${latest?`<br><span class="note">${esc(fmtWhen(latest.date))} 更新：${esc(latest.message)}</span>`:''}</dd>
        <dt>数据仓库</dt><dd>${esc(c.owner+'/'+c.repo)}</dd>
        <dt>页面版本</dt><dd>${esc(c.version||'—')}</dd>
      </dl>
      ${s.error?`<p class="note bad-t">${esc(s.error)}</p>`:''}${s.warn?`<p class="note bad-t">${esc(s.warn)}</p>`:''}
      <div class="pacts">${on?'<button class="go" data-syncnow="1">立即同步</button><button class="ghost" data-reload="1">重新读取数据</button><button class="ghost" data-signout="1">断开这台设备</button>':''}<button class="ghost" data-help="token">令牌怎么拿？</button></div>`;
  }
  function helpHtml(k){
    const c=Store.config;
    return `<div class="dlg-h"><h2 id="dlg-h">令牌怎么拿</h2><button type="button" class="clr" data-close="1" aria-label="关闭">×</button></div>
      <ol class="steps">
        <li>登录 github.com，点右上角头像 → Settings → 最下面的 Developer settings → Personal access tokens → Fine-grained tokens → Generate new token。</li>
        <li>Repository access 选 Only select repositories，只勾 <b>${esc(c.owner+'/'+c.repo)}</b>。</li>
        <li>Permissions 里找到 Contents，选 Read and write。</li>
        <li>生成后复制 github_pat_ 开头的那一串，贴到页面上的框里。</li>
      </ol>
      <p class="note">令牌只存在这台设备的浏览器里，只能读写这一个仓库。每台设备贴一次。</p>`;
  }
  function openDlg(kind){
    dlgKind=kind; $('#dlg-in').innerHTML=kind==='settings'?settingsHtml():helpHtml(kind);
    if(!$('#dlg').open) $('#dlg').showModal();
    if(kind==='settings'&&Store.hasToken()) Store.latestContent().then(x=>{ if(x){ latest=x; refreshDlg(); } });
  }
  function refreshDlg(){ if($('#dlg').open&&dlgKind==='settings') $('#dlg-in').innerHTML=settingsHtml(); }
  function signOut(btn){
    if(!btn.classList.contains('confirm')){
      const n=Store.status.pending;
      btn.classList.add('confirm'); btn.textContent=n?`还有 ${n} 项没同步，断开会丢掉。确定？`:'确定断开？再点一次';
      setTimeout(()=>{ if(btn.isConnected){ btn.classList.remove('confirm'); btn.textContent='断开这台设备'; } },4000);
      return;
    }
    practice=null; $('#dlg').close(); Store.disconnect();
  }

  /* data: everything comes from the store (store.js), which reads the private repository and keeps a copy on this device */
  function pull(){
    days=Store.days; classes=Store.classes; errors=Store.errors; progress=Store.progress; quizzes=Store.quizzes;
    quizHistory=Store.quizHistory; practiceLog=Store.practiceLog; inbox=Store.inbox; gloss=Store.gloss; daysLoaded=Store.ready;
  }
  Store.on(type=>{
    if(type==='status'){
      syncBadge(); refreshDlg();
      if(!Store.ready){ if(!($('#tok')&&['setup','auth'].includes(Store.status.state))) render(); }
      else if((practice&&practice.done)||(sec==='practice'&&!practice&&!q.trim())) render();   /* the "已同步" lines */
      return;
    }
    pull();
    if(capEditId&&!inbox.some(x=>x.id===capEditId)){ endEdit(false); toast('正在改的那条刚被 AI 整理成卡片了；你写的还在框里，点“记下”可以存成新的一条'); }
    if(practice&&!practice.done) navHtml(); else render();   /* never redraw a question or the quiz sheet under the reader */
  });
  syncBadge(); render();
  Store.start();
})();
