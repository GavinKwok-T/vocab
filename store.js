/* Data layer of the vocabulary page.

   Everything lives in ONE private GitHub repository, read and written through the GitHub REST API with a fine-grained
   token that is kept on this device only:

     data/**    written by the AI, read-only here    days, class cards, sentence dictionary, quizzes, error book
     state/**   written here, read-only for the AI   progress, quiz answers, practice logs, inbox, stars, error-book ops
     audio/**   audio packs, fetched on first use and kept on this device

   Each side owns its own files, so the page and the AI never edit the same file and there is nothing to merge between
   them. Two devices writing the same state file are merged per file (MERGE below).

   Reading: the last snapshot is kept in IndexedDB and shown at once; then the repository tree is compared by blob sha
   and only the files that changed are fetched.
   Writing: a change is applied on this device first (and kept in IndexedDB), then uploaded one file at a time. Nothing
   is lost without a network; it goes up the next time the page is open and online. */
(function(){
  'use strict';
  const CFG=Object.assign({owner:'',repo:'',branch:'main',api:'https://api.github.com',committer:null,token:'',version:''},window.VOCAB_CONFIG||{});
  const ls={get(k){try{return localStorage.getItem(k)}catch(e){return null}},set(k,v){try{localStorage.setItem(k,v)}catch(e){}},del(k){try{localStorage.removeItem(k)}catch(e){}}};
  /* the repository can be pointed somewhere else on this device ("owner/repo"), e.g. after a rename */
  (function(){ const m=/^([\w.-]+)\/([\w.-]+)$/.exec(ls.get('vocab.repo')||''); if(m){ CFG.owner=m[1]; CFG.repo=m[2]; } })();
  let token=CFG.token||ls.get('vocab.token')||'';
  const repoPath=()=>'/repos/'+encodeURIComponent(CFG.owner)+'/'+encodeURIComponent(CFG.repo);
  const encPath=p=>p.split('/').map(encodeURIComponent).join('/');
  const pad=n=>String(n).padStart(2,'0');
  const today=()=>{ const d=new Date(); return d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate()); };
  const clone=x=>JSON.parse(JSON.stringify(x));
  const num=x=>+x||0;   /* timestamps are milliseconds: never use |0 on them */

  /* ── IndexedDB (falls back to memory when it is not available, e.g. a private window) ── */
  const mem={blobs:new Map(),meta:new Map()}; let dbp=null;
  function openDb(){
    if(!dbp) dbp=new Promise(res=>{ try{
      const r=indexedDB.open('vocab',1);
      r.onupgradeneeded=()=>{ r.result.createObjectStore('blobs'); r.result.createObjectStore('meta'); };
      r.onsuccess=()=>res(r.result); r.onerror=()=>res(null); r.onblocked=()=>res(null);
    }catch(e){ res(null); } });
    return dbp;
  }
  const kv={
    async get(s,k){ const d=await openDb(); if(!d) return mem[s].get(k);
      return new Promise(res=>{ try{ const q=d.transaction(s).objectStore(s).get(k); q.onsuccess=()=>res(q.result); q.onerror=()=>res(undefined); }catch(e){ res(undefined); } }); },
    async set(s,k,v){ const d=await openDb(); if(!d){ mem[s].set(k,v); return true; }
      return new Promise(res=>{ try{ const tx=d.transaction(s,'readwrite'); tx.objectStore(s).put(v,k); tx.oncomplete=()=>res(true); tx.onerror=()=>res(false); tx.onabort=()=>res(false); }catch(e){ res(false); } }); },
    async del(s,k){ const d=await openDb(); if(!d){ mem[s].delete(k); return; }
      return new Promise(res=>{ try{ const tx=d.transaction(s,'readwrite'); tx.objectStore(s).delete(k); tx.oncomplete=()=>res(); tx.onerror=()=>res(); }catch(e){ res(); } }); },
    async keys(s){ const d=await openDb(); if(!d) return [...mem[s].keys()];
      return new Promise(res=>{ try{ const q=d.transaction(s).objectStore(s).getAllKeys(); q.onsuccess=()=>res(q.result||[]); q.onerror=()=>res([]); }catch(e){ res([]); } }); },
    async clear(){ mem.blobs.clear(); mem.meta.clear(); const d=await openDb(); if(!d) return;
      return new Promise(res=>{ try{ const tx=d.transaction(['blobs','meta'],'readwrite'); tx.objectStore('blobs').clear(); tx.objectStore('meta').clear(); tx.oncomplete=()=>res(); tx.onerror=()=>res(); }catch(e){ res(); } }); }
  };

  /* ── GitHub ── */
  async function gh(path,o){
    o=o||{};
    const h={Accept:o.raw?'application/vnd.github.raw+json':'application/vnd.github+json'};
    if(token) h.Authorization='Bearer '+token;
    if(o.body) h['Content-Type']='application/json';
    let r;
    try{ r=await fetch(CFG.api+path,{method:o.method||'GET',headers:h,body:o.body?JSON.stringify(o.body):undefined,cache:'no-store'}); }
    catch(e){ const err=new Error('offline'); err.offline=true; throw err; }
    if(!r.ok){ const err=new Error('GitHub '+r.status); err.status=r.status; try{ err.detail=String((await r.json()).message||''); }catch(e){} throw err; }
    return o.raw?r.text():r.json();
  }
  function b64(str){ const b=new TextEncoder().encode(str); let s=''; for(let i=0;i<b.length;i+=0x8000) s+=String.fromCharCode.apply(null,b.subarray(i,i+0x8000)); return btoa(s); }
  function unb64(s){ const bin=atob(String(s||'').replace(/\s/g,'')), b=new Uint8Array(bin.length); for(let i=0;i<bin.length;i++) b[i]=bin.charCodeAt(i); return new TextDecoder().decode(b); }
  async function pool(list,n,fn){
    const out=new Array(list.length); let i=0;
    await Promise.all(Array.from({length:Math.min(n,list.length)},async()=>{ while(i<list.length){ const k=i++; out[k]=await fn(list[k]); } }));
    return out;
  }

  /* ── which files the page reads ── */
  const DATA=[/^data\/days\/day-\d+\.json$/,/^data\/class\/\d{4}-\d{2}-\d{2}\.json$/,/^data\/gloss\/g\d+\.json$/,/^data\/quiz\/[\w-]+\.json$/,/^data\/errors\.json$/,/^data\/inbox-done\.json$/];
  const isData=p=>DATA.some(r=>r.test(p));
  const isPractice=p=>/^state\/practice\/\d{4}-\d{2}-\d{2}\.json$/.test(p);
  const isState=p=>/^state\/(progress|stars|inbox|error-ops)\.json$/.test(p)||/^state\/quiz\/q-[\w-]+\.json$/.test(p);
  const PRACTICE_DAYS=3;   /* practice logs are one file per day; the page only needs the latest few */

  let tree=new Map();   /* path → blob sha, the whole repository at `commit` */
  let commit='';        /* the branch head the tree was read at */
  let content={};       /* data path → {sha, json} */
  let files={};         /* state path → {data, baseSha, dirty, rev}; baseSha = the version in the repository this copy grew from */
  const packs=new Map();/* audio path → {sha, p: Promise<pack|null>} */
  let lastRefresh=0;

  const listeners=[]; let pendingEv=null;
  /* listeners hear about a change after the code that made it has finished (one call per kind) */
  function emit(type){
    if(!pendingEv){ pendingEv=new Set(); Promise.resolve().then(()=>{ const ev=pendingEv; pendingEv=null; ev.forEach(t=>listeners.forEach(fn=>{ try{ fn(t); }catch(e){ console.error(e); } })); }); }
    pendingEv.add(type);
  }

  const Store={ready:false,days:[],classes:[],gloss:new Map(),quizzes:[],quizHistory:[],errors:{words:[]},progress:{},inbox:[],practiceLog:[],
    /* state: setup (no token) | loading | ready | auth (token refused) | error */
    status:{state:token?'loading':'setup',done:0,total:0,pending:0,syncing:false,offline:false,error:'',lastSync:0,dirtySince:0,warn:''},
    config:CFG};
  const st=Store.status;
  const anyDirty=()=>Object.keys(files).some(p=>files[p].dirty);
  function setStatus(p){
    Object.assign(st,p||{});
    st.pending=Object.keys(files).filter(k=>files[k].dirty).length;
    if(!st.pending) st.dirtySince=0; else if(!st.dirtySince) st.dirtySince=Date.now();
    emit('status');
  }
  function fail(e){
    const have=Store.ready;
    if(e&&e.offline) setStatus({offline:true,error:'没连上网络',state:have?'ready':'error'});
    else if(e&&e.status===401) setStatus({state:'auth',error:'令牌失效了，或者贴得不对'});
    else if(e&&e.status===404) setStatus({state:have?'ready':'error',error:'找不到仓库：令牌没有这个仓库的权限，或者仓库名不对'});
    else if(e&&e.status===403) setStatus({state:have?'ready':'error',error:'GitHub 拒绝了请求：'+(e.detail||'令牌权限不够，或者请求太频繁')});
    else setStatus({state:have?'ready':'error',error:'出错了：'+((e&&(e.detail||e.message))||'原因不明')});
  }

  /* ── the model the page renders from ── */
  const doneSet=()=>new Set(((content['data/inbox-done.json']||{}).json||{}).ids||[]);
  const foldedSet=()=>new Set(((content['data/errors.json']||{}).json||{}).folded||[]);
  function rebuild(){
    const F=p=>files[p]&&files[p].data;
    const ov=(F('state/stars.json')||{}).stars||{};
    const days=[],classes=[],quizzes=[],gloss=new Map();
    Object.keys(content).sort().forEach(p=>{
      const j=content[p].json||{}; let m;
      if((m=/^data\/days\/(day-\d+)\.json$/.exec(p))) days.push(Object.assign({},j,{id:m[1]}));
      else if((m=/^data\/class\/(\d{4}-\d{2}-\d{2})\.json$/.exec(p))){
        /* 想用 stars: the card's own star (set by the AI) unless this device or another one changed it since */
        const id='c-'+m[1];
        classes.push(Object.assign({},j,{id,groups:(j.groups||[]).map(g=>Object.assign({},g,{words:(g.words||[]).map(w=>{
          const o=ov[id+'|'+w.w]; if(!o) return w;
          const x=Object.assign({},w); if(o.on) x.star=true; else delete x.star; return x; })}))}));
      }
      else if((m=/^data\/gloss\/(g\d+)\.json$/.exec(p))) Object.keys(j.words||{}).forEach(k=>gloss.set(k,Object.assign({},j.words[k],{_doc:m[1]})));
      else if((m=/^data\/quiz\/(q-[\w-]+)\.json$/.exec(p))) quizzes.push(Object.assign({},j,{id:m[1],result:F('state/quiz/'+m[1]+'.json')||j.result}));
    });
    days.sort((a,b)=>num(a.day)-num(b.day));
    classes.sort((a,b)=>String(b.date).localeCompare(String(a.date)));
    Store.days=days; Store.classes=classes; Store.gloss=gloss; Store.quizzes=quizzes;
    Store.quizHistory=((content['data/quiz/history.json']||{}).json||{}).words||[];
    /* error book = the AI's file, plus what was added or removed here since the AI last folded those changes in */
    const base=(content['data/errors.json']||{}).json||{words:[]}, folded=foldedSet();
    let words=(base.words||[]).slice(); const have=new Set(words.map(w=>String(w.w).toLowerCase()));
    ((F('state/error-ops.json')||{}).ops||[]).slice().sort((a,b)=>num(a.at)-num(b.at)).forEach(o=>{
      if(folded.has(o.id)) return;
      if(o.op==='add'&&o.entry&&o.entry.w){ const k=String(o.entry.w).toLowerCase(); if(!have.has(k)){ words.push(o.entry); have.add(k); } }
      else if(o.op==='remove'){ words=words.filter(w=>w.w!==o.w); have.delete(String(o.w).toLowerCase()); }
    });
    Store.errors=Object.assign({},base,{words});
    Store.progress=(F('state/progress.json')||{}).words||{};
    /* inbox = notes typed here, minus the ones deleted, minus the ones the AI has turned into cards */
    const ib=F('state/inbox.json')||{}, done=doneSet(), del=ib.deleted||{};
    Store.inbox=(ib.notes||[]).filter(n=>!done.has(n.id)&&!del[n.id]).sort((a,b)=>num(a.at)-num(b.at));
    const log=[]; Object.keys(files).filter(isPractice).forEach(p=>((files[p].data||{}).sessions||[]).forEach(s=>log.push(s)));
    Store.practiceLog=log.sort((a,b)=>num(b.at)-num(a.at)).slice(0,5);
  }

  /* ── two devices changed the same state file: keep both sides' work ── */
  const MERGE={
    progress(r,l){ const w=Object.assign({},r.words||{});
      Object.keys(l.words||{}).forEach(k=>{ const v=l.words[k], o=w[k];
        if(!o||String(v.last||'')>String(o.last||'')||(String(v.last||'')===String(o.last||'')&&num(v.right)+num(v.wrong)>=num(o.right)+num(o.wrong))) w[k]=v; });
      return Object.assign({},r,l,{words:w}); },
    stars(r,l){ const s=Object.assign({},r.stars||{}); Object.keys(l.stars||{}).forEach(k=>{ const v=l.stars[k]; if(!s[k]||num(v.at)>=num(s[k].at)) s[k]=v; }); return {stars:s}; },
    inbox(r,l){ const del=Object.assign({},r.deleted||{},l.deleted||{}), m=new Map();
      (r.notes||[]).concat(l.notes||[]).forEach(n=>{ const o=m.get(n.id); if(!o||num(n.editedAt||n.at)>=num(o.editedAt||o.at)) m.set(n.id,n); });
      return {notes:[...m.values()].filter(n=>!del[n.id]).sort((a,b)=>num(a.at)-num(b.at)),deleted:del}; },
    ops(r,l){ const m=new Map(); (r.ops||[]).concat(l.ops||[]).forEach(o=>m.set(o.id,o)); return {ops:[...m.values()].sort((a,b)=>num(a.at)-num(b.at))}; },
    practice(r,l){ const m=new Map(); (r.sessions||[]).concat(l.sessions||[]).forEach(s=>{ const o=m.get(s.id); if(!o||num(s.done)>=num(o.done)) m.set(s.id,s); });
      return {sessions:[...m.values()].sort((a,b)=>num(a.at)-num(b.at))}; },
    /* a quiz: a handed-in sheet beats a draft (the first one handed in if both are); between drafts the later save */
    quiz(r,l){ if(r.complete&&!l.complete) return r; if(l.complete&&!r.complete) return l;
      if(r.complete&&l.complete) return num(r.finishedAt)<=num(l.finishedAt)?r:l;
      return num(l.savedAt)>=num(r.savedAt)?l:r; }
  };
  const kindOf=p=>p==='state/progress.json'?'progress':p==='state/stars.json'?'stars':p==='state/inbox.json'?'inbox':p==='state/error-ops.json'?'ops':isPractice(p)?'practice':'quiz';
  function merge(p,remote,local){ try{ return MERGE[kindOf(p)](remote||{},local||{}); }catch(e){ return local; } }
  /* before an upload: drop what the AI has already taken over, and old delete marks */
  function prune(p,d){
    if(p==='state/inbox.json'){ const done=doneSet(), cut=Date.now()-30*864e5;
      d.notes=(d.notes||[]).filter(n=>!done.has(n.id)); d.deleted=d.deleted||{};
      Object.keys(d.deleted).forEach(k=>{ if(num(d.deleted[k])<cut) delete d.deleted[k]; }); }
    else if(p==='state/error-ops.json'){ const folded=foldedSet(); d.ops=(d.ops||[]).filter(o=>!folded.has(o.id)); }
  }
  const MSG={progress:'记录：拼写进度',stars:'记录：想用标记',inbox:'记录：课堂收集箱',ops:'记录：错词本的增减',practice:'记录：练习',quiz:'记录：测验答卷'};

  /* ── persistence on this device ── */
  let saveT=null;
  function persist(){ clearTimeout(saveT); saveT=setTimeout(persistNow,150); }
  function persistNow(){ clearTimeout(saveT); const snap={}; Object.keys(files).forEach(p=>{ const f=files[p]; snap[p]={data:f.data,baseSha:f.baseSha,dirty:f.dirty}; }); return kv.set('meta','state',snap); }
  const persistTree=()=>kv.set('meta','tree',{commit,tree:[...tree]});
  const persistContent=()=>kv.set('meta','content',content);

  /* ── reading ── */
  let refreshing=null;
  function refresh(force){ if(!token) return Promise.resolve(false); if(!refreshing) refreshing=doRefresh(force).finally(()=>{ refreshing=null; }); return refreshing; }
  async function doRefresh(force){
    try{
      const head=await gh(repoPath()+'/commits/'+encodeURIComponent(CFG.branch));
      lastRefresh=Date.now();
      if(head.sha===commit&&Store.ready&&!force){ setStatus({state:'ready',offline:false,error:''}); return true; }
      const t=await gh(repoPath()+'/git/trees/'+head.commit.tree.sha+'?recursive=1');
      const next=new Map(); (t.tree||[]).forEach(e=>{ if(e.type==='blob') next.set(e.path,e.sha); });
      const prac=new Set([...next.keys()].filter(isPractice).sort().slice(-PRACTICE_DAYS));
      const need=[];
      next.forEach((sha,p)=>{
        if(isData(p)){ if(!content[p]||content[p].sha!==sha) need.push([p,sha]); }
        else if(isState(p)||prac.has(p)){ const f=files[p]; if(!f||f.baseSha!==sha) need.push([p,sha]); }
      });
      setStatus({total:need.length,done:0,state:Store.ready?'ready':'loading'});
      const bad=[];
      const got=await pool(need,6,async([p,sha])=>{
        const txt=await gh(repoPath()+'/git/blobs/'+sha,{raw:true});
        st.done++; emit('status');
        try{ return [p,sha,JSON.parse(txt)]; }catch(e){ bad.push(p); return null; }   /* a file that is not valid JSON is skipped, not fatal */
      });
      got.forEach(x=>{
        if(!x) return; const p=x[0], sha=x[1], json=x[2];
        if(isData(p)) content[p]={sha,json};
        else{ const f=files[p];
          if(f&&f.dirty){ f.data=merge(p,json,f.data); f.rev++; f.baseSha=sha; }
          else files[p]={data:json,baseSha:sha,dirty:false,rev:0}; }
      });
      Object.keys(content).forEach(p=>{ if(!next.has(p)) delete content[p]; });
      Object.keys(files).forEach(p=>{ const f=files[p]; if(!next.has(p)&&f.baseSha){ if(f.dirty) f.baseSha=null; else delete files[p]; } });
      packs.forEach((v,p)=>{ if(next.get(p)!==v.sha) packs.delete(p); });
      tree=next; commit=head.sha; Store.ready=true;
      rebuild(); emit('change');
      setStatus({state:'ready',offline:false,error:'',warn:bad.length?'这些文件不是合法的 JSON，先跳过了：'+bad.join('、'):''});
      await Promise.all([persistContent(),persistTree(),persistNow()]);
      gc();
      return true;
    }catch(e){ fail(e); return false; }
  }
  /* audio packs of versions that are no longer in the repository */
  async function gc(){ try{ const live=new Set(tree.values()); (await kv.keys('blobs')).forEach(k=>{ if(!live.has(k)) kv.del('blobs',k); }); }catch(e){} }

  /* ── writing ── */
  let syncing=null, syncT=null, again=false, retryT=null;
  function syncSoon(ms){ clearTimeout(syncT); syncT=setTimeout(sync,ms==null?3000:ms); }
  function sync(){
    clearTimeout(syncT);
    if(!token) return Promise.resolve(false);
    if(syncing){ again=true; return syncing; }
    if(!anyDirty()) return Promise.resolve(true);
    setStatus({syncing:true});
    syncing=(async()=>{
      try{
        for(const p of Object.keys(files)) if(files[p]&&files[p].dirty) await push(p);
        setStatus({syncing:false,offline:false,error:'',lastSync:Date.now(),state:'ready'});
        persistTree(); return true;
      }catch(e){
        st.syncing=false; fail(e);
        clearTimeout(retryT); retryT=setTimeout(()=>{ if(anyDirty()) sync(); },30000);
        return false;
      }
    })();
    syncing.then(()=>{ syncing=null; if(again){ again=false; if(anyDirty()) syncSoon(300); } });
    return syncing;
  }
  async function push(p){
    const f=files[p];
    for(let attempt=0;attempt<5;attempt++){
      if(!f.dirty) return;
      const rev=f.rev; prune(p,f.data);
      const body={message:MSG[kindOf(p)]+'（'+p.replace(/^state\//,'').replace(/\.json$/,'')+'）',content:b64(JSON.stringify(f.data,null,1)+'\n'),branch:CFG.branch};
      if(CFG.committer) body.committer=CFG.committer;
      if(f.baseSha) body.sha=f.baseSha;
      try{
        const r=await gh(repoPath()+'/contents/'+encPath(p),{method:'PUT',body});
        f.baseSha=r.content.sha; tree.set(p,f.baseSha);
        if(r.commit&&r.commit.parents&&r.commit.parents[0]&&r.commit.parents[0].sha===commit) commit=r.commit.sha;
        if(f.rev===rev) f.dirty=false;
        persist();
      }catch(e){
        if(e.status!==409&&e.status!==422) throw e;
        /* the file changed in the repository since this copy was read (another device): take that version, put this
           device's changes on top, and try again */
        let cur=null;
        try{ cur=await gh(repoPath()+'/contents/'+encPath(p)+'?ref='+encodeURIComponent(CFG.branch)); }catch(err){ if(err.status!==404) throw err; }
        if(cur&&cur.sha===f.baseSha&&attempt>1) throw e;   /* not a version conflict after all */
        if(cur){ let remote={}; try{ remote=JSON.parse(unb64(cur.content)); }catch(err){} f.data=merge(p,remote,f.data); f.baseSha=cur.sha; }
        else f.baseSha=null;
        f.rev++; persist(); rebuild(); emit('change');
      }
    }
    if(f.dirty) throw new Error('同步冲突，稍后再试');
  }
  /* change one state file: fn edits the data in place. o.defer = keep it on this device for now (the caller uploads
     later with sync()); o.now = upload straight away; default = upload after a short pause */
  function change(p,init,fn,o){
    if(!files[p]) files[p]={data:init,baseSha:null,dirty:false,rev:0};
    const f=files[p]; fn(f.data); f.dirty=true; f.rev++;
    persist(); rebuild(); setStatus({}); emit('change');
    if(!(o&&o.defer)) syncSoon(o&&o.now?0:3000);
  }
  const newId=pre=>pre+Date.now().toString(36)+Math.random().toString(36).slice(2,6);

  /* ── public API ── */
  Store.on=fn=>{ listeners.push(fn); };
  Store.hasToken=()=>!!token;
  Store.refresh=refresh;
  Store.sync=sync;
  /* words: {key:{streak,right,wrong,okDay,wrongDay,last,lastWrong}} — fn edits it in place */
  Store.updateProgress=(fn,o)=>change('state/progress.json',{words:{}},d=>{ d.words=d.words||{}; fn(d.words); d.updated=today(); },o);
  Store.saveQuiz=(id,result,o)=>change('state/quiz/'+id+'.json',{},d=>{ Object.keys(d).forEach(k=>delete d[k]); Object.assign(d,clone(result),{savedAt:Date.now()}); },o);
  Store.savePractice=(sess,o)=>change('state/practice/'+sess.date+'.json',{sessions:[]},d=>{ d.sessions=(d.sessions||[]).filter(x=>x.id!==sess.id); d.sessions.push(clone(sess)); },o);
  Store.setStar=(doc,w,on)=>change('state/stars.json',{stars:{}},d=>{ d.stars=d.stars||{}; d.stars[doc+'|'+w]={on:!!on,at:Date.now()}; });
  Store.addNote=n=>{ const id=newId('n'); change('state/inbox.json',{notes:[],deleted:{}},d=>{ d.notes=d.notes||[]; d.notes.push(Object.assign({id},clone(n))); }); return id; };
  Store.editNote=(id,n)=>change('state/inbox.json',{notes:[],deleted:{}},d=>{ const i=(d.notes||[]).findIndex(x=>x.id===id); if(i>=0) d.notes[i]=Object.assign({},clone(n),{id}); });
  Store.deleteNote=id=>change('state/inbox.json',{notes:[],deleted:{}},d=>{ d.notes=(d.notes||[]).filter(x=>x.id!==id); d.deleted=d.deleted||{}; d.deleted[id]=Date.now(); });
  Store.removeError=w=>change('state/error-ops.json',{ops:[]},d=>{ d.ops=d.ops||[]; d.ops.push({id:newId('o'),op:'remove',w,at:Date.now()}); });
  Store.addErrors=list=>change('state/error-ops.json',{ops:[]},d=>{ d.ops=d.ops||[]; list.forEach((e,i)=>d.ops.push({id:newId('o'),op:'add',entry:clone(e),at:Date.now()+i})); });
  /* an audio pack {clips:{key: base64 AAC}} by its path in the repository; null when there is none */
  Store.audio=function(path){
    const sha=tree.get(path), hit=packs.get(path);
    if(hit&&hit.sha===sha) return hit.p;
    if(!sha||!token) return Promise.resolve(null);
    const p=(async()=>{
      let txt=await kv.get('blobs',sha);
      if(!txt){ txt=await gh(repoPath()+'/git/blobs/'+sha,{raw:true}); kv.set('blobs',sha,txt); }
      return JSON.parse(txt);
    })().catch(()=>{ packs.delete(path); return null; });
    packs.set(path,{sha,p}); return p;
  };
  /* when the AI last changed the content (data/), for the settings panel */
  Store.latestContent=async function(){
    try{ const r=await gh(repoPath()+'/commits?path=data&per_page=1&sha='+encodeURIComponent(CFG.branch)); const c=r&&r[0];
      return c?{date:c.commit.committer.date,message:String(c.commit.message||'').split('\n')[0]}:null; }catch(e){ return null; }
  };
  Store.connect=async function(t){
    const old=token; token=String(t||'').trim();
    if(!token){ token=old; throw new Error('先把令牌贴进来'); }
    try{ await gh(repoPath()+'/commits/'+encodeURIComponent(CFG.branch)); }
    catch(e){ token=old;
      throw new Error(e.offline?'没连上网络，检查一下再试':e.status===401?'这个令牌不对或已经过期':e.status===404?'令牌没有 '+CFG.owner+'/'+CFG.repo+' 这个仓库的权限':'GitHub 返回 '+(e.status||'')+'：'+(e.detail||e.message)); }
    ls.set('vocab.token',token);
    return boot();
  };
  Store.disconnect=async function(){
    token=''; ls.del('vocab.token'); files={}; content={}; tree=new Map(); commit=''; packs.clear(); Store.ready=false;
    await kv.clear(); rebuild(); setStatus({state:'setup',error:'',offline:false,syncing:false}); emit('change');
  };
  Store.setRepo=function(full){ const m=/^([\w.-]+)\/([\w.-]+)$/.exec(String(full||'').trim()); if(!m) return false; ls.set('vocab.repo',m[1]+'/'+m[2]); CFG.owner=m[1]; CFG.repo=m[2]; return true; };

  async function boot(){
    if(!token){ setStatus({state:'setup'}); return false; }
    const who=[CFG.api,CFG.owner,CFG.repo,CFG.branch].join('|');
    if(await kv.get('meta','who')!==who){ await kv.clear(); await kv.set('meta','who',who); files={}; content={}; tree=new Map(); commit=''; }
    else if(!Store.ready){
      const c=await kv.get('meta','content'), t=await kv.get('meta','tree'), s=await kv.get('meta','state');
      if(s) Object.keys(s).forEach(p=>{ files[p]=Object.assign({rev:0},s[p]); });
      if(c&&t){ content=c; commit=t.commit||''; tree=new Map(t.tree||[]); Store.ready=true; rebuild(); emit('change'); }
    }
    setStatus({state:Store.ready?'ready':'loading',error:''});
    const ok=await refresh();
    if(anyDirty()) sync();
    return ok;
  }
  Store.start=boot;

  document.addEventListener('visibilitychange',()=>{
    if(!token) return;
    if(document.visibilityState==='hidden'){ persistNow(); if(anyDirty()) sync(); }
    else{ if(Date.now()-lastRefresh>60000) refresh(); if(anyDirty()) sync(); }
  });
  window.addEventListener('online',()=>{ if(token){ refresh(); if(anyDirty()) sync(); } });
  window.addEventListener('pagehide',()=>{ persistNow(); });
  /* anything left on this device for two minutes (a practice left half way) goes up by itself */
  setInterval(()=>{ if(token&&!syncing&&anyDirty()&&st.dirtySince&&Date.now()-st.dirtySince>120000) sync(); },30000);

  window.Store=Store;
})();
