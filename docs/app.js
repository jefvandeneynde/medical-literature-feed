const state = {
  articles: [], topics: [], groups: [], visible: 30, view: 'for-you',
  filters: { topics: new Set(), types: new Set(), journals: new Set(), years: new Set(), pdfOnly: false, search: '' },
  prefs: loadJSON('mlf-prefs', {recencyWeight:3,journalWeight:3,evidenceWeight:4,topicWeights:{}}),
  user: loadJSON('mlf-user', {starred:{},read:{},hidden:{}}),
  sheetMode: null, tempSelection: new Set()
};

const majorJournals = ['New England Journal of Medicine','N Engl J Med','Lancet','JAMA','Journal of the American College of Cardiology','J Am Coll Cardiol','European Heart Journal','Eur Heart J','Circulation','BMJ'];
const evidenceTypes = ['Guideline','Practice Guideline','Randomized Controlled Trial','Meta-Analysis','Systematic Review'];

function loadJSON(key, fallback){ try{return JSON.parse(localStorage.getItem(key))||fallback}catch{return fallback} }
function saveState(){ localStorage.setItem('mlf-user',JSON.stringify(state.user)); localStorage.setItem('mlf-prefs',JSON.stringify(state.prefs)); }
function esc(s=''){return s.replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]))}
function articleKey(a){return a.pmid || a.doi || a.id}

async function init(){
  try{
    const [articleRes, topicRes] = await Promise.all([fetch('data/articles.json?'+Date.now()), fetch('data/topics.json?'+Date.now())]);
    const articleData = await articleRes.json(); const topicData = await topicRes.json();
    state.articles = articleData.articles || []; state.groups = topicData.groups || [];
    state.topics = state.groups.flatMap(g=>g.topics.map(t=>({...t,group:g.label})));
    for(const t of state.topics){ if(state.prefs.topicWeights[t.id] == null) state.prefs.topicWeights[t.id]=t.weight ?? 3; }
    bindUI(); renderSidebar(); renderSettings(); render();
  }catch(e){ console.error(e); document.getElementById('feedStatus').textContent='Could not load literature data yet. The first ingestion workflow may still need to run.'; }
}

function bindUI(){
  document.querySelectorAll('.view-tab').forEach(b=>b.onclick=()=>{document.querySelectorAll('.view-tab').forEach(x=>x.classList.remove('active'));b.classList.add('active');state.view=b.dataset.view;state.visible=30;render()});
  document.getElementById('searchInput').oninput=e=>{state.filters.search=e.target.value.trim().toLowerCase();state.visible=30;render()};
  document.getElementById('pdfOnly').onchange=e=>{state.filters.pdfOnly=e.target.checked;render()};
  document.getElementById('clearFiltersBtn').onclick=()=>{state.filters={topics:new Set(),types:new Set(),journals:new Set(),years:new Set(),pdfOnly:false,search:''};document.getElementById('pdfOnly').checked=false;document.getElementById('searchInput').value='';document.querySelectorAll('.quick-type').forEach(x=>x.checked=false);renderSidebar();render()};
  document.getElementById('loadMoreBtn').onclick=()=>{state.visible+=30;render()};
  document.getElementById('refreshBtn').onclick=()=>location.reload();
  document.getElementById('topicFilterBtn').onclick=()=>openFilter('topics'); document.getElementById('typeFilterBtn').onclick=()=>openFilter('types'); document.getElementById('journalFilterBtn').onclick=()=>openFilter('journals'); document.getElementById('yearFilterBtn').onclick=()=>openFilter('years');
  document.getElementById('sheetClose').onclick=closeSheets; document.getElementById('sheetBackdrop').onclick=closeSheets; document.getElementById('sheetApply').onclick=applySheet; document.getElementById('sheetClear').onclick=()=>{state.tempSelection.clear();renderSheetOptions()};
  document.getElementById('settingsBtn').onclick=openSettings; document.getElementById('settingsClose').onclick=closeSheets;
  document.querySelectorAll('.quick-type').forEach(x=>x.onchange=e=>{e.target.checked?state.filters.types.add(e.target.value):state.filters.types.delete(e.target.value);render()});
}

function renderSidebar(){
  const wrap=document.getElementById('sidebarTopics'); wrap.innerHTML='';
  for(const g of state.groups){ const title=document.createElement('div'); title.className='muted'; title.style.margin='9px 0 3px'; title.textContent=g.label; wrap.appendChild(title);
    for(const t of g.topics){ const l=document.createElement('label'); const c=document.createElement('input'); c.type='checkbox';c.checked=state.filters.topics.has(t.id);c.onchange=()=>{c.checked?state.filters.topics.add(t.id):state.filters.topics.delete(t.id);state.visible=30;render()};l.append(c,' '+t.label);wrap.appendChild(l); }
  }
}

function renderSettings(){
  ['recencyWeight','journalWeight','evidenceWeight'].forEach(id=>{const el=document.getElementById(id);el.value=state.prefs[id]??3;el.oninput=e=>{state.prefs[id]=+e.target.value;saveState();render()}});
  const w=document.getElementById('topicWeights');w.innerHTML='';
  for(const t of state.topics){const row=document.createElement('label');row.className='weight-row'; const s=document.createElement('span');s.textContent=t.label; const r=document.createElement('input');r.type='range';r.min=0;r.max=5;r.step=1;r.value=state.prefs.topicWeights[t.id]; const v=document.createElement('span');v.className='weight-value';v.textContent=r.value; r.oninput=()=>{v.textContent=r.value;state.prefs.topicWeights[t.id]=+r.value;saveState();render()};row.append(s,r,v);w.appendChild(row)}
}

function openSettings(){document.getElementById('sheetBackdrop').classList.remove('hidden');document.getElementById('settingsSheet').classList.remove('hidden')}
function closeSheets(){document.getElementById('sheetBackdrop').classList.add('hidden');document.getElementById('filterSheet').classList.add('hidden');document.getElementById('settingsSheet').classList.add('hidden')}

function openFilter(mode){state.sheetMode=mode;state.tempSelection=new Set(state.filters[mode]);document.getElementById('sheetTitle').textContent={topics:'Topics',types:'Article type',journals:'Journal',years:'Year'}[mode];renderSheetOptions();document.getElementById('sheetBackdrop').classList.remove('hidden');document.getElementById('filterSheet').classList.remove('hidden')}
function availableValues(mode){
  if(mode==='topics') return state.topics.map(t=>[t.id,t.label]);
  if(mode==='types') return [...new Set(state.articles.flatMap(a=>a.publication_types||[]))].sort().map(x=>[x,x]);
  if(mode==='journals') return [...new Set(state.articles.map(a=>a.journal).filter(Boolean))].sort().map(x=>[x,x]);
  if(mode==='years') return [...new Set(state.articles.map(a=>String(a.year)).filter(Boolean))].sort((a,b)=>b-a).map(x=>[x,x]); return [];
}
function renderSheetOptions(){const b=document.getElementById('sheetBody');b.innerHTML='';for(const [value,label] of availableValues(state.sheetMode)){const l=document.createElement('label');l.className='sheet-option';const c=document.createElement('input');c.type='checkbox';c.checked=state.tempSelection.has(value);c.onchange=()=>c.checked?state.tempSelection.add(value):state.tempSelection.delete(value);l.append(c,label);b.appendChild(l)}}
function applySheet(){state.filters[state.sheetMode]=new Set(state.tempSelection);state.visible=30;renderSidebar();closeSheets();render()}

function score(a){
  let s=0; const now=Date.now(); const ageDays=Math.max(0,(now-new Date(a.date||`${a.year}-01-01`).getTime())/86400000);
  s += Math.max(0,5-Math.log10(ageDays+1)*2) * (state.prefs.recencyWeight||0);
  for(const t of a.topics||[]) s += (state.prefs.topicWeights[t]||0)*3;
  if(majorJournals.some(j=>(a.journal||'').toLowerCase().includes(j.toLowerCase()))) s += (state.prefs.journalWeight||0)*5;
  if((a.publication_types||[]).some(t=>evidenceTypes.includes(t))) s += (state.prefs.evidenceWeight||0)*5;
  if((a.publication_types||[]).includes('Randomized Controlled Trial')) s+=8;
  if((a.publication_types||[]).includes('Guideline')||(a.publication_types||[]).includes('Practice Guideline')) s+=12;
  if(a.has_full_text) s+=1; return s;
}
function isMustRead(a){return score(a)>=42 || (a.publication_types||[]).some(t=>['Guideline','Practice Guideline','Randomized Controlled Trial'].includes(t)) && majorJournals.some(j=>(a.journal||'').toLowerCase().includes(j.toLowerCase()))}

function filtered(){
  let arr=state.articles.filter(a=>!state.user.hidden[articleKey(a)]);
  if(state.view==='reading-list') arr=arr.filter(a=>state.user.starred[articleKey(a)]);
  if(state.view==='must-read') arr=arr.filter(isMustRead);
  if(state.filters.topics.size) arr=arr.filter(a=>(a.topics||[]).some(t=>state.filters.topics.has(t)));
  if(state.filters.types.size) arr=arr.filter(a=>(a.publication_types||[]).some(t=>state.filters.types.has(t)));
  if(state.filters.journals.size) arr=arr.filter(a=>state.filters.journals.has(a.journal));
  if(state.filters.years.size) arr=arr.filter(a=>state.filters.years.has(String(a.year)));
  if(state.filters.pdfOnly) arr=arr.filter(a=>a.has_full_text);
  if(state.filters.search){const q=state.filters.search;arr=arr.filter(a=>[a.title,a.abstract,a.journal,(a.authors||[]).join(' ')].join(' ').toLowerCase().includes(q))}
  if(state.view==='newest') arr.sort((a,b)=>new Date(b.date||0)-new Date(a.date||0)); else arr.sort((a,b)=>score(b)-score(a)||new Date(b.date||0)-new Date(a.date||0));
  return arr;
}

function render(){
  const arr=filtered(); const feed=document.getElementById('feed');feed.innerHTML='';
  arr.slice(0,state.visible).forEach(a=>feed.appendChild(renderArticle(a)));
  document.getElementById('loadMoreBtn').classList.toggle('hidden',arr.length<=state.visible);
  document.getElementById('emptyState').classList.toggle('hidden',arr.length>0);
  document.getElementById('readingCount').textContent=Object.keys(state.user.starred).filter(k=>state.user.starred[k]).length?`(${Object.keys(state.user.starred).filter(k=>state.user.starred[k]).length})`:'';
  const newest=state.articles.map(a=>a.date).filter(Boolean).sort().at(-1);document.getElementById('feedStatus').textContent=`${arr.length.toLocaleString()} papers in this view${newest?` · updated through ${formatDate(newest)}`:''}`;
  renderActiveFilters();
}

function renderArticle(a){
  const node=document.getElementById('articleTemplate').content.firstElementChild.cloneNode(true); const k=articleKey(a);
  if(state.user.read[k]) node.classList.add('is-read');
  const badges=node.querySelector('.badges');
  if(isMustRead(a)) badges.appendChild(badge('Must read','must'));
  const ptypes=(a.publication_types||[]); if(ptypes.length) badges.appendChild(badge(shortType(ptypes[0]),'')); if(a.has_full_text) badges.appendChild(badge('Full text','oa'));
  const star=node.querySelector('.star-btn'); star.textContent=state.user.starred[k]?'★':'☆';star.classList.toggle('starred',!!state.user.starred[k]);star.onclick=()=>{state.user.starred[k]=!state.user.starred[k];saveState();render()};
  node.querySelector('.article-title').textContent=a.title||'Untitled';
  node.querySelector('.article-meta').innerHTML=`${esc(formatAuthors(a.authors||[]))} · <strong>${esc(a.journal||'')}</strong>${a.date?` · ${esc(formatDate(a.date))}`:''}`;
  const tags=node.querySelector('.topic-tags');(a.topics||[]).slice(0,5).forEach(id=>{const t=state.topics.find(x=>x.id===id);if(t){const x=document.createElement('span');x.className='topic-tag';x.textContent=t.label;tags.appendChild(x)}});
  const abs=node.querySelector('.abstract');abs.textContent=a.abstract||'No abstract available.'; const toggle=node.querySelector('.abstract-toggle'); if(!a.abstract){toggle.classList.add('hidden')} else toggle.onclick=()=>{abs.classList.toggle('collapsed');toggle.textContent=abs.classList.contains('collapsed')?'Show abstract':'Collapse abstract'};
  const pubmed=`https://pubmed.ncbi.nlm.nih.gov/${a.pmid||''}/`; const doi=a.doi?`https://doi.org/${encodeURIComponent(a.doi)}`:pubmed;
  const pp=node.querySelector('.paperpile-action');pp.href=doi;pp.title='Open article page; use your signed-in Paperpile browser extension to save';
  const pm=node.querySelector('.pubmed-action');pm.href=pubmed;pm.classList.toggle('hidden',!a.pmid);
  const publisher=node.querySelector('.publisher-action');publisher.href=doi;publisher.classList.toggle('hidden',!a.doi);
  const full=node.querySelector('.fulltext-action');full.href=a.full_text_url||'';full.classList.toggle('hidden',!a.full_text_url);
  node.querySelector('.read-action').textContent=state.user.read[k]?'Mark unread':'Mark read';node.querySelector('.read-action').onclick=()=>{state.user.read[k]=!state.user.read[k];saveState();render()};
  node.querySelector('.hide-action').onclick=()=>{state.user.hidden[k]=true;saveState();render()}; return node;
}
function badge(text,cls){const x=document.createElement('span');x.className=`badge ${cls}`;x.textContent=text;return x}
function shortType(t){return t.replace('Randomized Controlled Trial','RCT').replace('Systematic Review','Systematic review').replace('Practice Guideline','Guideline')}
function formatAuthors(a){if(!a.length)return '';if(a.length<=3)return a.join(', ');return `${a.slice(0,3).join(', ')} et al.`}
function formatDate(s){try{return new Intl.DateTimeFormat('en-GB',{day:'numeric',month:'short',year:'numeric'}).format(new Date(s))}catch{return s}}
function renderActiveFilters(){const w=document.getElementById('activeFilters');w.innerHTML='';const add=x=>{const s=document.createElement('span');s.className='active-filter';s.textContent=x;w.appendChild(s)}; state.filters.topics.forEach(id=>add(state.topics.find(t=>t.id===id)?.label||id));state.filters.types.forEach(add);state.filters.journals.forEach(add);state.filters.years.forEach(add);if(state.filters.pdfOnly)add('Full text')}

if('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(()=>{});
init();
