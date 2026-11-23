(function(){
  const $=s=>document.querySelector(s);
  const store={get(k){try{return localStorage.getItem(k)}catch(e){return null}},set(k,v){try{localStorage.setItem(k,v)}catch(e){}}};
  let days=[], errors=null, mode='all', daysLoaded=false;
  /* 课堂: class/c-YYYY-MM-DD docs are organized notes shaped like a day (groups + audio packs); inbox/* are raw captures */
  let classes=[], inbox=[], capEditId=null;   /* capEditId: the inbox note being changed in the capture form */
  /* 短语: sets of common phrases (data/phrases/ph-NN, shaped like a day); phId is the set being read, kept on this device */
  let phrases=[], phId=store.get('ph-id')||'';
  /* where the reader is: a section (days | class | errors, remembered), the open day and class date (default: the newest),
     the 目录 panel, the search text, the error-book filter */
  let sec='today', pview=false, dayId='', cDate='', idxOpen=false, q='', errB=store.get('err-b')||'todo';   /* pview: a practice or the quiz is on screen */
  let starOnly=store.get('star-only')==='1', errSort=store.get('err-sort')||'weak';
  if(!['todo','near','done','all'].includes(errB)) errB='todo';
  if(!['weak','new','old'].includes(errSort)) errSort='weak';
  /* card notes (记法 / 词族 / 搭配) are folded by default: detAll opens them everywhere, detTog holds the cards that differ;
     rowOpen holds the error-book rows that are expanded */
  let detAll=store.get('det-all')==='1', inboxOpen=false; const detTog=new Set(), rowOpen=new Set();
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
     phrase sets under audio/phrases/, the sentence dictionary under audio/gloss/. The store fetches a pack on first use
     and keeps it on this device */
  const packPath=(id,lang)=>{ const s=String(id); return 'audio/'+(s.startsWith('c-')?'class/'+s.slice(2):s.startsWith('ph-')?'phrases/'+s:s)+((lang||accent)==='en-US'?'-us':'')+'.json'; };
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
  let tt; function toast(msg){ let t=$('.toast'); if(!t){t=document.createElement('div');t.className='toast';t.setAttribute('role','status');} (document.querySelector('dialog[open]')||document.body).appendChild(t); t.textContent=msg; t.hidden=false; clearTimeout(tt); tt=setTimeout(()=>t.hidden=true,2600); }

  /* controls */
  function setPressed(ids,on){ ids.forEach(id=>$('#'+id).setAttribute('aria-pressed',id===on)); }
  [['m-all','all'],['m-zh','zh'],['m-en','en']].forEach(([id,m])=>$('#'+id).addEventListener('click',()=>{mode=m;shown.clear();setPressed(['m-all','m-zh','m-en'],id);render();}));
  function syncVoiceBtns(){ setPressed(['v-gb','v-us'],accent==='en-GB'?'v-gb':'v-us'); $('#acc-btn').dataset.a=accent==='en-GB'?'gb':'us'; $('#acc-btn').setAttribute('aria-label',accent==='en-GB'?'现在是英音，点一下换美音':'现在是美音，点一下换英音'); $('#r-slow').setAttribute('aria-pressed',slow); }
  function preload(){
    if(q.trim()) return;
    if(sec==='errors') return;   /* the error book spans many days: a day's pack loads on the first tap */
    if(sec==='class'){ const c=classes.find(x=>x.id===cDate)||classes[0]; if(c) loadPack(c.id); }
    else if(sec==='phrases'){ const p=phrases.find(x=>x.id===phId)||phrases[0]; if(p) loadPack(p.id); }
    else { const d=days.find(x=>x.id===dayId)||days[days.length-1]; if(d) loadPack(d.id); }
  }
  $('#v-gb').addEventListener('click',()=>{accent='en-GB';store.set('accent-v2',accent);syncVoiceBtns();preload();});
  $('#v-us').addEventListener('click',()=>{accent='en-US';store.set('accent-v2',accent);syncVoiceBtns();preload();});
  $('#acc-btn').addEventListener('click',()=>{accent=accent==='en-GB'?'en-US':'en-GB';store.set('accent-v2',accent);syncVoiceBtns();preload();toast(accent==='en-GB'?'已换成英音':'已换成美音');});
  $('#r-slow').addEventListener('click',()=>{slow=!slow;store.set('slow',slow?'1':'0');syncVoiceBtns();});
  syncVoiceBtns();
  $('#d-toggle').addEventListener('click',()=>{ detAll=!detAll; detTog.clear(); store.set('det-all',detAll?'1':'0'); render(); });
  $('#q-open').addEventListener('click',()=>{ const s=$('#search'); if(s.hidden){ s.hidden=false; $('#q').focus(); } else { clearSearch(); render(); } });
  /* 记一条: the capture form lives in its own dialog, opened from 今天 and 课堂 */
  function openCap(){ const d=$('#cap-dlg'); if(!d.open) d.showModal(); $('#cap-text').focus(); }
  $('#cap-dlg').addEventListener('close',()=>{ if(capEditId){ endEdit(true); render(); } });
  document.addEventListener('toggle',e=>{ if(e.target.id==='inbox-d') inboxOpen=e.target.open; },true);

  /* rendering */
  const esc=s=>String(s??'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
  /* navigation: three sections. 每日单词 and 课堂 show one day / one date at a time, with ‹ › and a 目录 grouped by month;
     the search field covers every day, every class date and the error book */
  const svg=d=>'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'+d+'</svg>';
  const I={
    home:svg('<path d="M3 10.5 12 3l9 7.5"/><path d="M5 9v12h14V9"/>'),
    book:svg('<path d="M12 6.5V20"/><path d="M12 6.5C10 5 7 4.5 4 5v13.5c3-.5 6 0 8 1.5 2-1.5 5-2 8-1.5V5c-3-.5-6 0-8 1.5z"/>'),
    note:svg('<path d="M6 3h11a2 2 0 0 1 2 2v16H8a2 2 0 0 1-2-2z"/><path d="M10 8h5"/><path d="M10 12h5"/>'),
    mark:svg('<path d="M6 3h12v18l-6-4.5L6 21z"/>'),
    info:svg('<circle cx="12" cy="12" r="9"/><path d="M12 11v6"/><path d="M12 7.5h.01"/>'),
    play:svg('<path d="M7 5l12 7-12 7z"/>'),
    plus:svg('<path d="M12 5v14"/><path d="M5 12h14"/>'),
    ok:svg('<circle cx="12" cy="12" r="9"/><path d="m8 12.5 3 3 5-6"/>'),
    todo:svg('<circle cx="12" cy="12" r="9"/>'),
    sort:svg('<path d="M7 4v16"/><path d="m3.5 7.5 3.5-3.5 3.5 3.5"/><path d="M17 20V4"/><path d="m13.5 16.5 3.5 3.5 3.5-3.5"/>'),
    bulb:svg('<path d="M9 18h6"/><path d="M10 21h4"/><path d="M8.5 14.5a6 6 0 1 1 7 0c-.6.5-1 1.2-1 2V17h-5v-.5c0-.8-.4-1.5-1-2z"/>'),
    talk:svg('<path d="M4 5h16v11h-9l-4.5 3.5V16H4z"/><path d="M8 9.2h8"/><path d="M8 12.4h5"/>')
  };
  /* five places: 今天 (what to do, how it is going), 单词, 课堂, 错词本, 短语 (last, so the first four keep their places on a
     phone). The same buttons fill the side bar (wide screens) and the bottom tab bar (phones). Practice and the quiz are
     not a place: they take over the screen (pview) */
  const NAV=[['today','今天',I.home],['days','单词',I.book],['class','课堂',I.note],['errors','错词本',I.mark],['phrases','短语',I.talk]];
  const todayStr=()=>localDate(new Date());
  function navHtml(){
    const searching=!!q.trim(), oq=openQuiz();
    const due=(practice&&!practice.done)||(oq&&String(oq.date)<=todayStr()&&!(oq.result&&oq.result.complete));
    const badge={today:due?'dot':'',class:inbox.length?String(inbox.length):''};
    const html=NAV.map(([k,label,ic])=>`<button class="navb" role="tab" data-sec="${k}" aria-selected="${!searching&&!pview&&k===sec}">${ic}<span class="nl">${label}</span>${badge[k]?`<span class="nb${badge[k]==='dot'?' dot':''}">${badge[k]==='dot'?'':esc(badge[k])}</span>`:''}</button>`).join('');
    $('#tabs').innerHTML=html; $('#tabbar').innerHTML=html;
  }
  /* IPA: words carry ipaUs / ipaUk; error-book entries borrow them from the day they came from */
  function ipaOf(w){
    if(w.ipaUs||w.ipaUk) return w;
    for(const d of days) for(const g of d.groups||[]) for(const x of g.words||[]) if(x.w===w.w) return x;
    return null;
  }
  /* part of speech: words carry pos ("n", "v/n", "vphr", …); error-book entries borrow it from their day or class card */
  const POS={n:'n. 名词',v:'v. 动词',adj:'adj. 形容词',adv:'adv. 副词',prep:'prep. 介词',conj:'conj. 连词',vphr:'动词短语',phr:'短语',idiom:'习语'};
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
  /* a card shows the word, IPA, meaning and example. Its notes (记法 = tip, 词族, 搭配) sit behind small chips: a tap on a
     chip opens them for this card, 展开详情 in the tool row opens them on every card.
     star: {doc, gi, wi} for 课堂 cards, which get the 想用 toggle */
  const detOpen=key=>detAll!==detTog.has(key);
  /* a teacher's word met before: the class card is a copy, with seen:["day-09","c-2026-11-09"] naming where it was learned */
  const seenName=id=>{ const s=String(id); if(s.startsWith('c-')) return shortDate(s.slice(2)); const d=days.find(x=>x.id===s); return d?'Day '+d.day:s; };
  const seenHtml=w=>Array.isArray(w.seen)&&w.seen.length?`<span class="chip seen">${esc(w.seen.map(seenName).join('、'))} 学过</span>`:'';
  function wordLi(w,n,extra,dayId,star){
    const dd=dayId?` data-day="${esc(dayId)}"`:'';
    const key=(dayId||'')+'|'+w.w, coverEn=isCovered(key,'en'), coverZh=isCovered(key,'zh');
    cards.push({w,day:dayId,key});
    const starBtn=star?`<button class="starbtn" data-star="${esc(star.doc)}|${star.gi}|${star.wi}" aria-pressed="${!!w.star}" aria-label="想用：${esc(w.w)}">${STAR}<span>想用</span></button>`:'';
    const fam=Array.isArray(w.family)?w.family.filter(Boolean):[], col=Array.isArray(w.colloc)?w.colloc.filter(Boolean):[];
    const chips=[w.tip?I.bulb+'记法':'',fam.length?'词族 '+fam.length:'',col.length?'搭配 '+col.length:''].filter(Boolean), open=detOpen(key);
    return `<li class="word" data-ci="${cards.length-1}">
      <div class="main">
        <div class="wline"><span class="en${cover(coverEn,'en','点开看英文')}"><span>${esc(w.w)}</span></span>${posHtml(w)}${w.trap?'<span class="chip">易拼错</span>':''}${w.star&&!star?'<span class="chip want">想用</span>':''}${missSet&&missSet.has(w.w.toLowerCase())?'<span class="chip bad">错过</span>':''}${seenHtml(w)}</div>
        ${ipaHtml(w,coverEn)}
        <span class="zh${cover(coverZh,'zh','点开看中文')}"><span>${esc(w.zh)}</span></span>
        ${extra||''}
        ${w.ex?`<span class="ex"><button class="speak small" data-say="${esc(w.ex)}"${dd} aria-label="朗读例句">${ICON}</button><span class="exs${cover(coverEn,'en','点开看例句')}"><span>${exHtml(w)}</span></span></span>`:''}
        ${w.ex&&w.exZh?`<span class="exzh${cover(coverZh,'zh','点开看中文')}"><span>${esc(w.exZh)}</span></span>`:''}
        ${chips.length?`<div class="chips">${chips.map(c=>`<button type="button" class="chipb" data-det="1" aria-expanded="${open}">${c}</button>`).join('')}</div>`:''}
        ${open&&chips.length?`<div class="det">${w.tip?`<span class="tip${cover(coverEn||coverZh,mode,'点开看说明')}"><span>${esc(w.tip)}</span></span>`:''}${xtraHtml(w,'family','词族',coverEn||coverZh)}${xtraHtml(w,'colloc','搭配',coverEn||coverZh)}</div>`:''}
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
  const classNames=x=>[...new Set((x.groups||[]).map(g=>String(g.name||'').split(' · ')[0].split('（')[0]))].join('、');
  const starCount=x=>(x.groups||[]).reduce((s,g)=>s+(g.words||[]).filter(w=>w.star).length,0);
  const missCount=x=>missSet?(x.groups||[]).reduce((s,g)=>s+(g.words||[]).filter(w=>missSet.has(w.w.toLowerCase())).length,0):0;
  function pager(kind,title,older,newer){
    const lab=kind==='day'?['前一天','后一天']:kind==='ph'?['上一组','下一组']:['更早一次','更近一次'];
    return `<div class="pager">
      <button class="pg" data-go="${kind}:${esc(older||'')}"${older?'':' disabled'} aria-label="${lab[0]}">‹</button>
      <button class="pg-title" data-idx="1" aria-expanded="${idxOpen}"><span class="t">${title}</span><span class="pg-more">${idxOpen?'收起':'目录'}</span></button>
      <button class="pg" data-go="${kind}:${esc(newer||'')}"${newer?'':' disabled'} aria-label="${lab[1]}">›</button>
    </div>`;
  }
  function idxHtml(groups,row){
    return `<nav class="idx" aria-label="目录">${groups.map(g=>`<section class="group"><h3>${esc(g.k)}</h3><ol>${g.items.map(row).join('')}</ol></section>`).join('')}</nav>`;
  }
  /* opt.star: 课堂 cards get the 想用 toggle; opt.only: starred words only, still numbered by their place in the full list */
  /* a group heading keeps to its short name; what follows in brackets (a teacher's note on the group) opens from the ⓘ */
  function groupHead(name){
    const s=String(name||''), i=s.indexOf('（'), long=i>0&&s.length-i>18, short=long?s.slice(0,i):s, more=long?s.slice(i+1).replace(/）\s*$/,''):'';
    return `<h3>${esc(short)}${more?`<button type="button" class="ib sm" data-note="${esc(more)}" data-nt="${esc(short)}" aria-label="这一组的说明">${I.info}</button>`:''}</h3>`;
  }
  const groupsHtml=(x,docId,opt={})=>{ let n=0; return (x.groups||[]).map((g,gi)=>{
    const lis=(g.words||[]).map((w,wi)=>{ n++; return opt.only&&!w.star?'':wordLi(w,n,'',docId,opt.star?{doc:docId,gi,wi}:null); }).join('');
    return lis?`<section class="wg">${groupHead(g.name)}<ol class="cards">${lis}</ol></section>`:''; }).join(''); };
  /* 单词 and 课堂: the index beside the cards on a wide screen; on a phone the pager's 目录 swaps the cards for it */
  const twoPane=(index,body)=>`<div class="two${idxOpen?' idx-open':''}"><div class="side-idx">${index}</div><div class="pane">${body}</div></div>`;

  function renderDays(view){
    if(!days.length){ view.innerHTML='<div class="empty"><strong>还没有单词</strong>跟 AI 说“今天的单词”，新词就会出现在这里。</div>'; return; }
    let i=days.findIndex(x=>x.id===dayId); if(i<0) i=days.length-1;
    const d=days[i]; loadPack(d.id);
    const head=pager('day',`Day ${d.day} · ${esc(d.topic||'')}`,days[i-1]&&days[i-1].id,days[i+1]&&days[i+1].id);
    const index=idxHtml(byMonth([...days].reverse()),x=>`<li><button class="idx-row" data-go="day:${esc(x.id)}" aria-current="${x.id===d.id}"><span class="idx-k">Day ${x.day}</span><span class="idx-t">${esc(x.topic||'')}</span><span class="idx-m${lowScore(x.score)?' low':''}">${x.score?esc(x.score):esc(shortDate(x.date))}</span></button></li>`);
    const miss=missCount(d);
    const meta=`<div class="meta-row"><p class="meta">${esc(fmtDate(d.date))} · ${countOf(d)} 个词 · ${d.score?'测验 '+esc(d.score):'还没考'}${miss?' · 错过 '+miss+' 个':''}</p><button class="pill" data-prgo="day:${esc(d.id)}">${I.play}练这一天</button></div>`;
    view.innerHTML=twoPane(index,head+meta+groupsHtml(d,d.id));
  }

  function renderClass(view){
    const add=`<div class="meta-row"><button class="go sm" data-capopen="1">${I.plus}记一条</button><button type="button" class="ib sm" data-help="class" aria-label="课堂怎么用">${I.info}</button></div>`;
    const pend=inbox.length?`<details class="group inbox" id="inbox-d"${inboxOpen||capEditId?' open':''}><summary><span>待整理 ${inbox.length} 条</span><span class="note">跟 AI 说“整理课堂笔记”</span></summary><ol>${inbox.map(x=>`<li${x.id===capEditId?' class="editing"':''}>
        <div class="main"><span class="in-t">${esc(x.text)}</span><span class="in-m">${[x.star?'★ 想用':'',x.cls||'',x.note||'',when(x.at)+(x.editedAt?'（改过）':'')].filter(Boolean).map(esc).join(' · ')}</span></div>
        <div class="in-acts"><button class="unmiss" data-cedit="${esc(x.id)}">修改</button><button class="unmiss" data-del="${esc(x.id)}">删除</button></div></li>`).join('')}</ol></details>`:'';
    if(!classes.length){ view.innerHTML=add+pend+`<div class="empty"><strong>还没有整理好的课堂词句</strong>课间点“记一条”随手记；晚上跟 AI 说“整理课堂笔记”。</div>`; return; }
    let i=classes.findIndex(x=>x.id===cDate); if(i<0) i=0;   /* classes are sorted newest first */
    const c=classes[i]; loadPack(c.id);
    const head=pager('cls',esc(fmtDate(c.date)),classes[i+1]&&classes[i+1].id,classes[i-1]&&classes[i-1].id);
    const index=idxHtml(byMonth(classes),x=>`<li><button class="idx-row" data-go="cls:${esc(x.id)}" aria-current="${x.id===c.id}"><span class="idx-k">${esc(shortDate(x.date))}</span><span class="idx-t">${esc(classNames(x))}</span><span class="idx-m">${countOf(x)} 条</span></button></li>`);
    const st=starCount(c), miss=missCount(c);
    const meta=`<div class="meta-row"><p class="meta">${countOf(c)} 条${st?' · '+st+' 个想用':''}${miss?' · 错过 '+miss+' 个':''}</p><div class="pacts"><button class="pill star" data-staronly="1" aria-pressed="${starOnly}">★ 只看想用</button>${starredPool().length?`<button class="pill" data-prgo="class">${I.play}练想用的词</button>`:''}</div></div>`;
    const body=starOnly&&!st
      ?'<div class="empty"><strong>这一天还没有标“想用”的词</strong>点卡片右边的“☆ 想用”就能标上。</div>'
      :groupsHtml(c,c.id,{star:true,only:starOnly});
    view.innerHTML=add+pend+twoPane(index,head+meta+body);
  }

  /* 短语: one set at a time with ‹ › and a 目录 grouped by level, like 单词. Not in the quiz: read, listen, cover and check */
  function renderPhrases(view){
    if(!phrases.length){ view.innerHTML='<div class="empty"><strong>还没有短语</strong>整理好的短语会出现在这里。</div>'; return; }
    let i=phrases.findIndex(x=>x.id===phId); if(i<0) i=0;
    const p=phrases[i]; loadPack(p.id);
    const head=pager('ph',`${esc(p.set)} · ${esc(p.topic||'')}`,phrases[i-1]&&phrases[i-1].id,phrases[i+1]&&phrases[i+1].id);
    const levels=[]; phrases.forEach(x=>{ const k=x.levelName||'短语'; let g=levels[levels.length-1]; if(!g||g.k!==k) levels.push(g={k,items:[]}); g.items.push(x); });
    const index=idxHtml(levels,x=>`<li><button class="idx-row" data-go="ph:${esc(x.id)}" aria-current="${x.id===p.id}"><span class="idx-k">第 ${esc(x.set)} 组</span><span class="idx-t">${esc(x.topic||'')}</span><span class="idx-m">${countOf(x)} 个</span></button></li>`);
    const meta=`<div class="meta-row"><p class="meta">${p.levelName?esc(p.levelName)+' · ':''}${countOf(p)} 个 · 不进测验</p><button type="button" class="ib sm" data-help="phrases" aria-label="短语怎么学">${I.info}</button></div>`;
    view.innerHTML=twoPane(index,head+meta+groupsHtml(p,p.id));
  }

  /* 今天: what is waiting (tonight's quiz, the newest day, the error book, class notes) and how it is going
     (days learned, cards, error-book size, the last quiz scores) */
  const WK=['日','一','二','三','四','五','六'];
  function pctOf(s){ const m=/^(\d+)\s*\/\s*(\d+)$/.exec(s||''); return m&&+m[2]?Math.round(+m[1]/+m[2]*100):null; }
  function renderToday(view){
    const now=new Date(), t=todayStr(), ws=errors?errors.words||[]:[];
    const nCards=days.reduce((s,d)=>s+countOf(d),0)+classes.reduce((s,c)=>s+countOf(c),0);
    const stats=`<section class="stats"><div class="stat"><span>已学</span><b>${days.length}</b> 天</div><div class="stat"><span>卡片</span><b>${nCards}</b></div><div class="stat"><span>错词本</span><b>${ws.length}</b></div></section>`;
    /* the last quizzes with a score (written by the AI when it grades) */
    const scored=quizzes.filter(x=>x.graded&&pctOf(x.score)!=null).sort((a,b)=>String(a.date).localeCompare(String(b.date))).slice(-7);
    const last=scored[scored.length-1];
    const chart=scored.length?`<section class="group chart"><div class="chart-h"><span>近 ${scored.length} 次测验</span><b>${esc(last.score)} · ${pctOf(last.score)}%</b></div>
        <div class="bars" role="img" aria-label="近 ${scored.length} 次测验的正确率：${scored.map(x=>shortDate(x.date)+' '+pctOf(x.score)+'%').join('，')}">${scored.map((x,i)=>{ const p=pctOf(x.score); return `<i class="${p<70?'low':''}${i===scored.length-1?' cur':''}" style="height:${Math.max(10,Math.round((p-50)/50*100))}%" title="${esc(shortDate(x.date))} · ${esc(x.score)}"></i>`; }).join('')}</div>
        <div class="chart-x"><span>${esc(shortDate(scored[0].date))}</span><span>${esc(shortDate(last.date))}</span></div></section>`:'';
    const d=days[days.length-1], all=Store.practiceAll||[];
    const dayRuns=d?all.filter(s=>s.src==='day'&&String(s.label||'').startsWith(`Day ${d.day} `)):[];
    const errRuns=all.filter(s=>s.src==='errors'&&s.date===t);
    const waiting=ws.filter(w=>streakOf(w)<2).length;
    const row=(done,title,sub,btn)=>`<li class="${done?'done':''}">${done?I.ok:I.todo}<div class="main"><span class="tt">${title}</span><span class="in-m">${sub}</span></div>${btn}</li>`;
    const rows=(d?row(dayRuns.length>0,`练新词 Day ${d.day}`,esc(d.topic||'')+' · '+(dayRuns.length?`已练 ${dayRuns.length} 遍，最近 ${dayRuns[0].right|0}/${dayRuns[0].done|0}`:`${countOf(d)} 个词，还没练`),`<button class="pill" data-prgo="day:${esc(d.id)}">${I.play}练</button>`):'')
      +(ws.length?row(errRuns.length>0,'错词回炉',`待练 ${waiting} 个`+(errRuns.length?` · 今天练了 ${errRuns.length} 次`:''),`<button class="pill" data-prgo="errors">${I.play}练</button>`):'')
      +row(false,'课堂笔记',inbox.length?`待整理 ${inbox.length} 条`:'课间听到的词随手记',`<button class="pill" data-capopen="1">${I.plus}记一条</button>`);
    const resume=practice&&!practice.done&&!practice.sheet?`<section class="group qcard"><div class="qc-b"><div><span class="plab">练习做到一半</span><p class="meta">${esc(practice.label)} · 第 ${practice.i+1} / ${practice.items.length} 题</p></div><button class="go" data-prgo="resume">继续</button></div></section>`:'';
    const recent=practiceLog.slice(0,5);
    const rec=recent.length?`<section class="group recent"><h3>最近的练习</h3><ol>${recent.map(r=>`<li><span>${esc(when(r.at))} · ${esc(r.label||'')} · ${esc(MODE_L[r.mode]||'')}</span><span class="r-s">${r.right|0} / ${r.done|0}</span></li>`).join('')}</ol></section>`:'';
    view.innerHTML=`<p class="meta">${now.getMonth()+1} 月 ${now.getDate()} 日 周${WK[now.getDay()]}</p>
      <div class="today">
        <div class="t-main">${quizCardHtml()}${resume}<section class="group"><ol class="todos">${rows}</ol></section></div>
        <div class="t-side">${stats}${chart}${rec}</div>
      </div>`;
  }

  /* error book: one line per word (word, meaning, the three streak dots, a speak button), sorted by how much it needs
     practice; a tap on the line opens its record. Three piles by streak: 待练 (0–1), 快掌握 (2), 可移出 (3: the reader still
     removes it themself) */
  const srcOf=w=>!w.day?'other':(String(w.day).startsWith('c-')?'class':'day');
  function srcLabel(key){
    if(key==='other') return '作文和自己加的';
    if(key.startsWith('c-')) return '课堂 · '+fmtDate(key.slice(2));
    const d=days.find(x=>x.id===key); return d?`Day ${d.day} · ${d.topic||''}`:key;
  }
  const bucketOf=w=>{ const s=streakOf(w); return s>=3?'done':s===2?'near':'todo'; };
  const BUCKETS=[['todo','待练'],['near','快掌握'],['done','可移出'],['all','全部']];
  const SORTS={weak:'最该练的在前',new:'最新加入在前',old:'最早加入在前'};
  function errRow(w){
    const key=(w.day||'')+'|'+w.w, coverEn=isCovered(key,'en'), coverZh=isCovered(key,'zh'), open=rowOpen.has(key);
    cards.push({w,day:w.day,key});
    const s=Math.max(0,Math.min(3,streakOf(w))), dd=w.day?` data-day="${esc(w.day)}"`:'';
    let det='';
    if(open){
      const c=cardFor(w)||{}, exw=w.ex?w:c, src=srcOf(w);
      det=`<div class="det">
        <div class="wline">${posHtml(w)}${ipaHtml(w,coverEn)}</div>
        ${w.wrong?`<span class="wrong${cover(coverEn,'en','点开看错误记录')}"><span>${esc(w.wrong)}</span></span>`:''}
        ${w.tip?`<span class="tip${cover(coverEn||coverZh,mode,'点开看说明')}"><span>${esc(w.tip)}</span></span>`:''}
        ${exw&&exw.ex?`<span class="exp${cover(coverEn,'en','点开看例句')}"><span>${exPlain(exw)}</span></span>`:''}
        <div class="meta-row">${src==='other'?`<span class="note">${esc(srcLabel('other'))}</span>`:`<button class="src-go" data-go="${src==='class'?'cls':'day'}:${esc(w.day)}">${esc(srcLabel(w.day))} ›</button>`}<button class="unmiss" data-unmiss="${esc(w.w)}">已掌握，移出</button></div>
      </div>`;
    }
    return `<li class="word row${open?' open':''}" data-ci="${cards.length-1}" data-row="${esc(key)}">
      <div class="main"><span class="en${cover(coverEn,'en','点开看英文')}"><span>${esc(w.w)}</span></span><span class="zh${cover(coverZh,'zh','点开看中文')}"><span>${esc(w.zh)}</span></span>${det}</div>
      <div class="racts"><span class="streak" role="img" aria-label="连续 ${s} 天拼对">${[0,1,2].map(k=>`<i class="${k<s?'on':''}"></i>`).join('')}</span><button class="speak small" data-say="${esc(w.w)}"${dd} aria-label="朗读 ${esc(w.w)}">${ICON}</button></div>
    </li>`;
  }
  function renderErrors(view){
    const ws=errors?errors.words||[]:[];
    if(!ws.length){ view.innerHTML='<div class="empty"><strong>错词本是空的</strong>测验里错过的词会加到这里。</div>'; return; }
    const cnt={todo:0,near:0,done:0,all:ws.length}; ws.forEach(w=>cnt[bucketOf(w)]++);
    const lastOf=w=>String((progress[String(w.w).toLowerCase()]||{}).last||'');
    const list=ws.map((w,i)=>[w,i]).filter(([w])=>errB==='all'||bucketOf(w)===errB);
    if(errSort==='new') list.reverse();
    else if(errSort==='weak') list.sort((a,b)=>streakOf(a[0])-streakOf(b[0])||lastOf(a[0]).localeCompare(lastOf(b[0]))||a[1]-b[1]);
    const head=`<div class="meta-row"><div class="filters" role="group" aria-label="按掌握程度看">${BUCKETS.map(([k,l])=>`<button class="pill${k==='todo'?' warn':''}" data-errb="${k}" aria-pressed="${k===errB}">${l} ${cnt[k]}</button>`).join('')}</div></div>
      <div class="meta-row"><button class="pill" data-prgo="errors">${I.play}练错词本</button><span class="pacts"><button class="pill" data-errsort="1" aria-label="换一种排序，现在是${SORTS[errSort]}">${I.sort}${SORTS[errSort]}</button><button type="button" class="ib sm" data-help="errors" aria-label="错词本怎么用">${I.info}</button></span></div>`;
    view.innerHTML=head+(list.length
      ?`<section class="group"><ol class="rows">${list.map(([w])=>errRow(w)).join('')}</ol></section>`
      :`<div class="empty"><strong>这一档现在没有词</strong>${errB==='done'?'连续 3 天拼对的词会出现在这里，移不移出由你决定。':'换一档看看。'}</div>`);
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
    phrases.forEach(p=>(p.groups||[]).forEach(g=>(g.words||[]).forEach(w=>{ const r=rank(w); if(r>=0) hits.push({w,r,id:p.id,label:`短语 第 ${p.set} 组 · ${g.name}`,go:'ph:'+p.id}); })));
    (errors&&errors.words||[]).forEach(w=>{ if(w.day) return; const r=rank(w); if(r>=0) hits.push({w,r,id:'',label:'错词本 · 作文和自己加的',go:'sec:errors'}); });
    hits.sort((a,b)=>a.r-b.r);
    const list=hits.slice(0,50);
    const src=h=>`<span class="src"><button class="src-go" data-go="${esc(h.go)}">${esc(h.label)} ›</button>${errSet.has(h.w.w.toLowerCase())?'<span class="chip bad">在错词本里</span>':''}</span>`;
    view.innerHTML=hits.length
      ?`<div class="day-head"><h2>搜索结果</h2><span>“${esc(raw)}”找到 ${hits.length} 条${hits.length>list.length?'，先显示前 '+list.length+' 条':''}</span></div><section class="wg"><ol class="cards">${list.map((h,i)=>wordLi(h.w,i+1,src(h),h.id,h.star)).join('')}</ol></section>`
      :`<div class="empty"><strong>没有找到“${esc(raw)}”</strong>换个拼法试试，或者搜中文意思。每日单词、课堂词句、错词本和短语都在搜索范围里。</div>`;
  }

  /* ───── 练习: spelling practice ─────
     Pick a source (error book / one day / starred class words), a mode (Chinese → English, or audio → English) and a size.
     One question at a time; the answer is checked exactly (case, spacing and curly quotes aside), wrong letters are marked.
     A right answer moves on by itself after a moment; a wrong one waits until the right spelling has been typed once
     (copying it is the drill). There is no "count it as right": a slip is a miss, as in the exam.
     Each finished question updates review/progress (a short pause batches them) and the session's practice/<id> log. */
  const ADV_MS=2200;   /* how long a right answer stays green before the next question (11/17: 0.7 s was too fast) */
  const MODE_L={zh:'看中文写英文',audio:'听发音写英文'};
  const CN_NUM=['','一','两','三','四','五','六','七','八'];
  const norm=s=>String(s||'').normalize('NFKC').replace(/[’‘`´]/g,"'").replace(/\s+/g,' ').trim().toLowerCase().replace(/[.。]+$/,'');
  const practicable=w=>!!(w&&w.w&&!/,/.test(w.w)&&/[a-z]/i.test(w.w));
  const errSetNow=()=>new Set((errors&&errors.words||[]).map(w=>String(w.w).toLowerCase()));
  const streakOf=w=>((progress[String(w.w).toLowerCase()]||{}).streak|0);
  /* how many times a word has come up in practice and quizzes (right + wrong), and the last day it did */
  const timesOf=w=>{ const p=progress[String(w.w).toLowerCase()]||{}; return (p.right|0)+(p.wrong|0); };
  const lastDayOf=w=>String((progress[String(w.w).toLowerCase()]||{}).last||'');
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
    pview=true; idxOpen=false; clearSearch(); render(); window.scrollTo({top:0});
    focusAnswer(); autoPlay();
  }
  function beginFromSetup(){
    const pool=shuffle(poolFor(prSrc).slice());
    /* error book: the words take turns (user's request, 11/19). Fewest times practised first, then the one that came up
       longest ago, so the same words don't come back day after day; ties stay shuffled */
    if(prSrc==='errors') pool.sort((a,b)=>timesOf(a.w)-timesOf(b.w)||lastDayOf(a.w).localeCompare(lastDayOf(b.w)));
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
    if(practice&&practice.sheet&&practice.quizId===q.id&&!practice.done){ pview=true; render(); return; }
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
    practice=s; pview=true; idxOpen=false; clearSearch(); render(); window.scrollTo({top:0});
    const first=s.drafts.findIndex(x=>!x.trim()), inp=$(`.sin[data-si="${first<0?0:first}"]`);
    if(inp){ inp.focus({preventScroll:true}); if(first>0) inp.scrollIntoView({block:'center'}); }
    if(JSON.stringify(s.drafts)!==s.draftSaved) saveDrafts(s);
  }
  function quizCardHtml(){
    const q=openQuiz(); if(!q) return '';
    const r=q.result||{}, frozen=Array.isArray(r.items)&&r.items.length;
    const list=frozen?r.items:(q.items||[]).concat(quizStarItems(q)), total=list.length;
    const filled=Array.isArray(r.drafts)?filledOf(r.drafts):(r.answers||[]).length;
    const by=new Map(); list.forEach(i=>{ const g=String(i.group||'其他').replace(/^Day (\d+) · .*$/,'Day $1 新词'); by.set(g,(by.get(g)||0)+1); });
    const wait=frozen?0:Math.max(0,starQueue(q).length-QUIZ_STARS);
    const t=todayStr(), name=(q.date===t?'今晚测验':String(q.date)>t?'下一次测验':'测验')+' · '+fmtDate(q.date);
    const head=`<div class="qc-h"><span class="plab">${esc(name)}</span><button type="button" class="ib sm" data-help="quiz" aria-label="测验怎么考">${I.info}</button></div>`;
    if(r.complete) return `<section class="group qcard">${head}<div class="score">${r.right|0} / ${r.total|0}</div><p class="quiz-next">${Store.status.pending?'已交卷，答案还在同步，等右上角显示“已同步”。':'已交卷。回到 AI 的会话说“考完了”。'}</p></section>`;
    return `<section class="group qcard">${head}
      <div class="qc-b"><div><div class="pq-zh">${filled?`已写 ${filled} / ${total}`:`${total} 题`}</div><p class="meta">${esc([...by].map(([g,c])=>`${g} ${c}`).join(' · '))}${wait?`；另有 ${wait} 个想用的词排到之后`:''}</p></div>
      <button class="go" data-quiz="${esc(q.id)}"${total?'':' disabled'}>${filled||frozen?'继续':'开始'}</button></div></section>`;
  }
  function quizSheet(s){
    const total=s.items.length;
    const rows=s.items.map((it,i)=>{
      const w=it.w, nW=String(w.w).trim().split(/\s+/).length, wc=nW>1?(CN_NUM[nW]||nW)+'个词':'', ph=posHtml(w);
      return `<li><span class="sn">${i+1}</span><div class="sq"><div class="sz">${esc(w.zh)}</div>${ph||wc?`<div class="pq-meta">${ph}${wc?`<span>${wc}</span>`:''}</div>`:''}
        <input class="sin" data-si="${i}" value="${esc(s.drafts[i]||'')}" maxlength="80" aria-label="第 ${i+1} 题：${esc(w.zh)}" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" enterkeyhint="${i+1<total?'next':'done'}"></div></li>`;
    }).join('');
    return `<div class="prac">
      <div class="prac-top"><span>${esc(s.label)} · ${total} 题</span><span class="pacts"><button type="button" class="ib sm" data-help="quiz" aria-label="测验怎么考">${I.info}</button><button type="button" class="ghost" data-pquit="1">先停在这里</button></span></div>
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
  /* the practice set-up, shown in the dialog: what to practise, how, how many */
  function practiceSetupHtml(){
    const eAll=errorsPool(false).length, ePool=errorsPool(prSkip).length, cPool=starredPool().length, did=curDayId(), dPool=dayPool(did).length;
    const n=prSrc==='day'?dPool:prSrc==='class'?cPool:ePool, take=prCount==='all'?n:Math.min(+prCount,n);
    const srcs=[['errors',`错词本 ${eAll}`],['day','每日单词'],['class',`想用的课堂词 ${cPool}`]];
    const dayOpts=[...days].reverse().map(d=>`<option value="${esc(d.id)}"${d.id===did?' selected':''}>Day ${d.day} · ${esc(d.topic||'')}（${dayPool(d.id).length} 个）</option>`).join('');
    const empty=prSrc==='errors'&&eAll&&!ePool?'错词本里的词都已经连续 3 天拼对了，取消上面的勾可以全部再练一遍。'
      :(n?'':(prSrc==='class'?'还没有标“想用”的课堂词。到「课堂」页点卡片右边的“☆ 想用”。':'这里还没有词。'));
    return `<div class="dlg-h"><h2 id="dlg-h">拼写练习</h2><span class="pacts"><button type="button" class="ib sm" data-help="practice" aria-label="练习怎么算">${I.info}</button><button type="button" class="clr" data-close="1" aria-label="关闭">×</button></span></div>
      <div class="prow"><span class="plab">练什么</span><div class="filters" role="group" aria-label="练什么">${srcs.map(([k,l])=>`<button class="pill" data-psrc="${k}" aria-pressed="${k===prSrc}">${esc(l)}</button>`).join('')}</div></div>
      ${prSrc==='day'&&days.length?`<div class="prow"><label class="plab" for="pr-day">哪一天</label><select id="pr-day">${dayOpts}</select></div>`:''}
      ${prSrc==='errors'?`<label class="pcheck"><input type="checkbox" id="pr-skip"${prSkip?' checked':''}>跳过已经连续 3 天拼对的</label>`:''}
      <div class="prow"><span class="plab">怎么练</span><div class="filters" role="group" aria-label="怎么练">${Object.entries(MODE_L).map(([k,l])=>`<button class="pill" data-pmode="${k}" aria-pressed="${k===prMode}">${l}</button>`).join('')}</div></div>
      <div class="prow"><span class="plab">题数</span><div class="filters" role="group" aria-label="题数">${[['10','10 题'],['20','20 题'],['all',`全部 ${n}`]].map(([k,l])=>`<button class="pill" data-pcount="${k}" aria-pressed="${k===prCount}">${l}</button>`).join('')}</div></div>
      ${empty?`<p class="note">${esc(empty)}</p>`:''}
      <button class="go wide" data-pstart="1"${take?'':' disabled'}>开始${take?`（${take} 题）`:''}</button>`;
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
          <button class="ghost" data-phome="1">完成</button>
        </div></section>
      ${bad.length?`<section class="group miss"><h3>错了 ${bad.length} 个</h3><ol>${bad.map(r=>resultRow(s,r,have)).join('')}</ol></section>`:''}
      ${good.length?`<section class="group miss"><h3>对了 ${good.length} 个</h3><ol>${good.map(r=>resultRow(s,r,have)).join('')}</ol></section>`:''}
    </div>`;
  }
  function renderPractice(view){
    const s=practice;
    view.innerHTML=s.done?practiceSummary(s):s.sheet?quizSheet(s):practiceCard(s);
  }

  const TITLES={today:'今天',days:'单词',class:'课堂',errors:'错词本',phrases:'短语'};
  function render(){
    if(!practice) pview=false;
    navHtml(); hidePop(); cards=[];
    const view=$('#view'), searching=!!q.trim(), ready=Store.ready, inP=pview&&ready;
    document.body.classList.toggle('in-practice',inP&&!practice.done);   /* a question or the quiz sheet: nothing else on screen */
    document.body.classList.toggle('has-bar',inP&&!!practice.sheet&&!practice.done);
    $('#title').textContent=!ready?'雅思词汇本':inP?(practice.sheet?'测验':'练习'):searching?'搜索':TITLES[sec];
    $('#tools').hidden=!ready||inP||(!searching&&sec==='today');
    $('#d-toggle').hidden=!searching&&sec==='errors';
    $('#d-toggle').setAttribute('aria-pressed',detAll);
    if(!ready){ view.innerHTML=gateHtml(); return; }
    /* a re-render (live data, a save) must not wipe what is being typed into the practice box */
    const ae=document.activeElement, pa=$('#pans');
    const keep=pa&&!pa.readOnly?{k:pa.dataset.k,v:pa.value,f:ae===pa,s:pa.selectionStart,e:pa.selectionEnd}:null;
    const sk=ae&&ae.classList&&ae.classList.contains('sin')?{i:ae.dataset.si,s:ae.selectionStart,e:ae.selectionEnd}:null;
    missSet=!searching&&!inP&&(sec==='days'||sec==='class')?errSetNow():null;
    if(inP) renderPractice(view);
    else if(searching) renderSearch(view);
    else if(sec==='today') renderToday(view);
    else if(sec==='class') renderClass(view);
    else if(sec==='errors') renderErrors(view);
    else if(sec==='phrases') renderPhrases(view);
    else renderDays(view);
    const pb=$('#pans');   /* same question, same step only: a miss must not carry the wrong spelling into the copy box */
    if(keep&&pb&&!pb.readOnly&&pb.dataset.k===keep.k){ pb.value=keep.v; if(keep.f){ pb.focus({preventScroll:true}); try{ pb.setSelectionRange(keep.s,keep.e); }catch(e){} } }
    const sb=sk&&$(`.sin[data-si="${sk.i}"]`);
    if(sb){ sb.focus({preventScroll:true}); try{ sb.setSelectionRange(sk.s,sk.e); }catch(e){} }
  }
  function openRef(ref){
    const at=ref.indexOf(':'), k=ref.slice(0,at), v=ref.slice(at+1); if(!v) return;
    if(k==='day'){ sec='days'; dayId=v; } else if(k==='cls'){ sec='class'; cDate=v; } else if(k==='ph'){ sec='phrases'; phId=v; store.set('ph-id',v); } else if(k==='sec'){ sec=v; }
    pview=false; idxOpen=false; clearSearch(); render(); window.scrollTo({top:0});
  }
  function clearSearch(){ $('#search').hidden=true; if(!q) return; q=''; $('#q').value=''; }
  let qTimer;
  $('#q').addEventListener('input',e=>{ clearTimeout(qTimer); const v=e.target.value; qTimer=setTimeout(()=>{ q=v; render(); },150); });
  $('#q').addEventListener('keydown',e=>{ if(e.key==='Escape'){ clearSearch(); render(); } if(e.key==='Enter') e.target.blur(); });
  $('#q-clear').addEventListener('click',()=>{ clearSearch(); render(); });
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
    const cl=e.target.closest('[data-close]'); if(cl){ cl.closest('dialog').close(); return; }
    if(e.target.tagName==='DIALOG'){ e.target.close(); return; }   /* a tap on the backdrop */
    if(e.target.closest('[data-capopen]')){ if(capEditId) endEdit(true); openCap(); return; }
    const nt=e.target.closest('[data-note]'); if(nt){ openDlg('text',{title:nt.dataset.nt,text:nt.dataset.note}); return; }
    const dt=e.target.closest('[data-det]'); if(dt){ const li=dt.closest('li.word'), c=li&&cards[+li.dataset.ci]; if(c){ detTog.has(c.key)?detTog.delete(c.key):detTog.add(c.key); render(); } return; }
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
    const sc=e.target.closest('[data-sec]'); if(sc){ sec=sc.dataset.sec; pview=false; idxOpen=false; clearSearch(); render(); window.scrollTo({top:0}); return; }
    const eb=e.target.closest('[data-errb]'); if(eb){ errB=eb.dataset.errb; store.set('err-b',errB); render(); window.scrollTo({top:0}); return; }
    const es=e.target.closest('[data-errsort]'); if(es){ errSort=({weak:'new',new:'old',old:'weak'})[errSort]; store.set('err-sort',errSort); render(); return; }
    const sb2=e.target.closest('[data-star]'); if(sb2){ toggleStar(sb2); return; }
    const so=e.target.closest('[data-staronly]'); if(so){ starOnly=!starOnly; store.set('star-only',starOnly?'1':'0'); render(); return; }
    /* practice */
    const pg=e.target.closest('[data-prgo]'); if(pg){
      const v=pg.dataset.prgo;
      if(practice&&!practice.done){ pview=true; render(); window.scrollTo({top:0}); return; }   /* one is under way: back to it */
      if(v.startsWith('day:')){ prSrc='day'; prDay=v.slice(4); } else if(['errors','day','class'].includes(v)) prSrc=v;
      store.set('pr-src',prSrc); openDlg('practice'); return;
    }
    const ps=e.target.closest('[data-psrc]'); if(ps){ prSrc=ps.dataset.psrc; store.set('pr-src',prSrc); refreshDlg(); return; }
    const pm=e.target.closest('[data-pmode]'); if(pm){ prMode=pm.dataset.pmode; store.set('pr-mode',prMode); refreshDlg(); return; }
    const pc=e.target.closest('[data-pcount]'); if(pc){ prCount=pc.dataset.pcount; store.set('pr-count',prCount); refreshDlg(); return; }
    if(e.target.closest('[data-pstart]')){ $('#dlg').close(); beginFromSetup(); return; }
    const qz=e.target.closest('[data-quiz]'); if(qz){ startQuiz(quizzes.find(x=>x.id===qz.dataset.quiz)); return; }
    if(e.target.closest('[data-pskip]')){ answerQ(true); return; }
    const psb=e.target.closest('[data-psubmit]'); if(psb){ submitSheet(psb); return; }
    if(e.target.closest('[data-presave]')){ Store.sync(); return; }
    const pq=e.target.closest('[data-pquit]'); if(pq){ quitPractice(pq); return; }
    if(e.target.closest('[data-pretry]')){ const s=practice; if(s) startPractice(shuffle(uniqMisses(s).map(({w,day})=>({w,day}))),'retry','刚才错的',s.mode); return; }
    const pad=e.target.closest('[data-padd]'); if(pad){ addMissesToBook(pad); return; }
    if(e.target.closest('[data-phome]')){ practice=null; render(); window.scrollTo({top:0}); return; }
    const rw=e.target.closest('li.row');   /* an error-book line opens and closes on a tap (not on its buttons or a covered block) */
    if(rw&&!e.target.closest('button,.cover,.det')){ const k=rw.dataset.row; rowOpen.has(k)?rowOpen.delete(k):rowOpen.add(k); render(); return; }
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
    if(e.target.id==='pr-day'){ prDay=e.target.value; refreshDlg(); }
    else if(e.target.id==='pr-skip'){ prSkip=e.target.checked; store.set('pr-skip',prSkip?'1':'0'); refreshDlg(); }
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
    openCap();
  }
  /* leaving edit mode: back to the class used last for new notes; clear=false keeps what is typed (to save it as a new note) */
  function endEdit(clear){
    capEditId=null; capCls=store.get('cap-cls')||''; capStar=false;
    if(clear){ $('#cap-text').value=''; $('#cap-note').value=''; }
    syncCap();
  }
  $('#cap-cancel').addEventListener('click',()=>{ endEdit(true); $('#cap-dlg').close(); render(); });
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
      endEdit(true); inbox=Store.inbox; $('#cap-dlg').close(); render(); toast('改好了');
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
      <div class="pacts">${on?'<button class="go" data-syncnow="1">立即同步</button><button class="ghost" data-reload="1">重新读取数据</button><button class="ghost" data-signout="1">断开这台设备</button>':''}<button class="ghost" data-help="token">令牌怎么拿？</button><button class="ghost" data-help="guide">使用说明</button></div>`;
  }
  /* everything the page used to explain in running text now opens from an ⓘ or the ? in the top bar */
  const HELP={
    cards:['单词卡',['点喇叭听发音。一天的发音第一次播放要下载，之后就存在这台设备上。','例句里的每个词都能点，会弹出它在这句里的音标、意思和发音。','卡片下面的“记法”“词族”“搭配”点一下展开；工具栏的“展开详情”一次全部展开。','单词后面的小框是词性。红色的“错过”表示这个词在错词本里。']],
    cover:['遮住自测',['“遮中文”“遮英文”把一边盖住，点灰色块看答案。','点开一块，这张卡片同一边的内容一起打开。']],
    class:['课堂',['课间点“记一条”，把听到的词或句子记下来，拼错、只写读音都行。','晚上跟 AI 说“整理课堂笔记”，整理好的会变成能听发音的卡片，按日期排。','卡片右边的“☆ 想用”：标了的词会进之后的测验，每次最多 5 个。']],
    phrases:['短语',['这里是常用短语：每个词都认识，连在一起意思却猜不出来。现在是第一级，全由简单词组成；学得差不多了再加第二级。','短语不进每晚测验，有空就翻一组。','学法：点上面的“遮中文”，先看英文、点喇叭听，说出意思，再点灰块核对。','卡片下面的“记法”写着什么时候用、容易和什么弄混。']],
    quiz:['每晚测验',['像一张卷子：看中文写英文，回车跳到下一题，交卷前可以随便改。','中途可以点“先停在这里”，回来接着写。','交卷后才显示对错。等右上角显示“已同步”，再回到 AI 的会话说“考完了”。','判分严格：多一个 s、少一个连字符都算错。']],
    practice:['拼写练习',['看中文或听发音，把英文拼出来，马上知道对错。','拼对自动进下一题；拼错要照着正确拼写打一遍。','一个词每天最多算一次拼对，拼错就重新数。']],
    errors:['错词本',['测验里错过的词都在这里。三个点表示连续几天拼对。','连续 3 天拼对会进“可移出”，移不移出由你自己决定。','点“练错词本”时轮流出题：练过次数少的先出，刚练过的排到后面，同一批词不会天天出现。','点一行展开，看错误记录、记法和例句。']],
    sync:['同步',['你的记录先存在这台设备上，再自动传到 GitHub。没网也能用，回头会补传。','右上角显示“已同步”就是全部传上去了。','每台设备第一次打开要贴一次令牌。']]
  };
  const GUIDE=['cards','cover','class','phrases','quiz','practice','errors','sync'];
  const dlgHead=t=>`<div class="dlg-h"><h2 id="dlg-h">${esc(t)}</h2><button type="button" class="clr" data-close="1" aria-label="关闭">×</button></div>`;
  function helpHtml(k){
    const c=Store.config;
    if(k==='token') return dlgHead('令牌怎么拿')+`<ol class="steps">
        <li>登录 github.com，点右上角头像 → Settings → 最下面的 Developer settings → Personal access tokens → Fine-grained tokens → Generate new token。</li>
        <li>Repository access 选 Only select repositories，只勾 <b>${esc(c.owner+'/'+c.repo)}</b>。</li>
        <li>Permissions 里加上 Contents，改成 Read and write。</li>
        <li>生成后复制 github_pat_ 开头的那一串，贴到页面上的框里。</li>
      </ol>
      <p class="note">令牌只存在这台设备的浏览器里，只能读写这一个仓库。每台设备贴一次。</p>`;
    const keys=k==='guide'?GUIDE:[HELP[k]?k:'cards'];
    return dlgHead(keys.length>1?'使用说明':HELP[keys[0]][0])+keys.map(x=>`${keys.length>1?`<h3 class="hh">${esc(HELP[x][0])}</h3>`:''}<ul class="hl">${HELP[x][1].map(s=>`<li>${esc(s)}</li>`).join('')}</ul>`).join('');
  }
  let dlgArg=null;
  const dlgHtml=()=>dlgKind==='settings'?settingsHtml():dlgKind==='practice'?practiceSetupHtml():dlgKind==='text'?dlgHead(dlgArg.title)+`<p class="dlg-p">${esc(dlgArg.text)}</p>`:helpHtml(dlgKind);
  function openDlg(kind,arg){
    dlgKind=kind; dlgArg=arg||null; $('#dlg-in').innerHTML=dlgHtml(); $('#dlg-voice').hidden=kind!=='settings';
    if(!$('#dlg').open) $('#dlg').showModal();
    $('#dlg').scrollTop=0;
    if(kind==='settings'&&Store.hasToken()) Store.latestContent().then(x=>{ if(x){ latest=x; refreshDlg(); } });
  }
  function refreshDlg(){ if($('#dlg').open&&(dlgKind==='settings'||dlgKind==='practice')) $('#dlg-in').innerHTML=dlgHtml(); }
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
    days=Store.days; classes=Store.classes; phrases=Store.phrases||[]; errors=Store.errors; progress=Store.progress; quizzes=Store.quizzes;
    quizHistory=Store.quizHistory; practiceLog=Store.practiceLog; inbox=Store.inbox; gloss=Store.gloss; daysLoaded=Store.ready;
  }
  Store.on(type=>{
    if(type==='status'){
      syncBadge(); refreshDlg();
      if(!Store.ready){ if(!($('#tok')&&['setup','auth'].includes(Store.status.state))) render(); }
      else if((pview&&practice&&practice.done)||(sec==='today'&&!pview&&!q.trim())) render();   /* the "已同步" lines */
      return;
    }
    pull();
    if(capEditId&&!inbox.some(x=>x.id===capEditId)){ endEdit(false); toast('正在改的那条刚被 AI 整理成卡片了；你写的还在框里，点“记下”可以存成新的一条'); }
    if(practice&&!practice.done) navHtml(); else render();   /* never redraw a question or the quiz sheet under the reader */
  });
  syncBadge(); render();
  Store.start();
})();
