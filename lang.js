(function(){
const packs=window.MetaLangPacks=window.MetaLangPacks||{};
const origText=new WeakMap();
let rev=null;
const api={cur:'',onchange:null,langs:packs,t,apply,init,set,available:()=>langOrder()};
function fallback(){const k=packs.en?'en':packs.fr?'fr':Object.keys(packs)[0];return k&&packs[k]?packs[k].dict||{}:{}}
function buildReverse(){rev={};Object.keys(packs).forEach(c=>{const d=(packs[c]&&packs[c].dict)||{};Object.keys(d).forEach(k=>{if(rev[k]==null)rev[k]=k;const v=String(d[k]);if(rev[v]==null)rev[v]=k})})}
function canonical(k){if(!rev)buildReverse();return rev[k]||k}
function get(k){k=canonical(k);const d=(packs[api.cur]&&packs[api.cur].dict)||{},f=fallback();return d[k]??f[k]??k}
function t(k,v){return String(get(k)).replace(/\{(\w+)\}/g,(_,x)=>v&&v[x]!=null?v[x]:'')}
function pick(){const saved=localStorage.getItem('metaspriteLang');if(saved&&packs[saved])return saved;const nav=[...(navigator.languages||[]),navigator.language||''];for(const l of nav){const c=String(l).toLowerCase().split('-')[0];if(packs[c])return c}return packs.en?'en':packs.fr?'fr':Object.keys(packs)[0]||'en'}
function preserve(raw,val){const a=(raw.match(/^\s*/)||[''])[0],b=(raw.match(/\s*$/)||[''])[0];return a+val+b}
function walk(n){if(!n||['SCRIPT','STYLE','TEXTAREA'].includes(n.nodeName))return;if(n.nodeType===1&&(n.id==='langSelect'||n.closest&&n.closest('#langSelect')))return;if(n.nodeType===3){const raw=n.nodeValue,trim=raw.trim();if(!trim)return;if(!origText.has(n))origText.set(n,canonical(trim));const key=origText.get(n),val=t(key);if(trim!==val)n.nodeValue=preserve(raw,val);return}if(n.nodeType!==1)return;['title','placeholder','aria-label'].forEach(a=>{if(!n.hasAttribute(a))return;const k='i18nOrig'+a.replace(/-([a-z])/g,(_,c)=>c.toUpperCase());let key=n.dataset[k];if(!key){key=canonical(n.getAttribute(a));n.dataset[k]=key}else key=canonical(key);const val=t(key);if(n.getAttribute(a)!==val)n.setAttribute(a,val)});for(const c of [...n.childNodes])walk(c)}
function apply(){rev=null;document.documentElement.lang=api.cur||'en';document.querySelectorAll('[data-i18n]').forEach(e=>e.textContent=t(e.dataset.i18n));document.querySelectorAll('[data-i18n-html]').forEach(e=>e.innerHTML=t(e.dataset.i18nHtml));document.querySelectorAll('[data-i18n-title]').forEach(e=>e.title=t(e.dataset.i18nTitle));document.querySelectorAll('[data-i18n-placeholder]').forEach(e=>e.placeholder=t(e.dataset.i18nPlaceholder));walk(document.body);renderFlags()}
function set(c){if(!packs[c])return;api.cur=c;localStorage.setItem('metaspriteLang',c);apply();if(typeof api.onchange==='function')api.onchange(c);apply()}
function init(){api.cur=pick();apply()}
function langOrder(){const out=[];['fr','en'].forEach(c=>{if(packs[c])out.push(c)});Object.keys(packs).forEach(c=>{if(!out.includes(c))out.push(c)});return out}
function renderFlags(){const box=document.getElementById('langSelect');if(!box)return;box.innerHTML='';langOrder().forEach(c=>{const b=document.createElement('button'),img=document.createElement('img'),sp=document.createElement('span');b.type='button';b.className='lang-btn'+(c===api.cur?' active':'');b.title=packs[c].name||c;b.onclick=()=>set(c);img.src='flags/'+c+'.svg';img.alt=c;img.onerror=()=>img.remove();sp.textContent=c.toUpperCase();b.append(img,sp);box.appendChild(b)})}
window.MetaLang=api;window.mt=t;if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();
