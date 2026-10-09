const $=s=>document.querySelector(s);
let authMode='register', currentUser=null;
async function api(url,options={}) {
 const opts={credentials:'same-origin',...options,headers:{'Content-Type':'application/json',...(options.headers||{})}};
 const response=await fetch('/api'+url,opts);
 const data=await response.json().catch(()=>({error:'Unexpected server response.'}));
 if(!response.ok)throw new Error(data.error||'Request failed.');
 return data;
}
function esc(s=''){return String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
function money(n){return n==null?'Budget flexible':new Intl.NumberFormat('en-IN',{style:'currency',currency:'INR',maximumFractionDigits:0}).format(n);}
function toast(s){const el=$('#toast');el.textContent=s;el.classList.add('show');setTimeout(()=>el.classList.remove('show'),2600);}
function openAuth(mode='register'){setAuthMode(mode);$('#authModal').hidden=false;document.body.style.overflow='hidden';}
function closeAuth(){$('#authModal').hidden=true;document.body.style.overflow='';}
function setAuthMode(mode){authMode=mode;$('#modalTitle').textContent=mode==='register'?'Create your account':'Welcome back';$('#nameWrap').hidden=mode==='login';$('#roleWrap').hidden=mode==='login';$('#authName').required=mode==='register';$('#authPassword').autocomplete=mode==='login'?'current-password':'new-password';$('#authPassword').placeholder=mode==='login'?'Your password':'At least 10 characters';$('#authSubmit').textContent=mode==='login'?'Log in →':'Create free account ↗';$('#authMessage').textContent='';document.querySelectorAll('.tab').forEach(b=>b.classList.toggle('active',b.dataset.mode===mode));}
async function loadJobs(q=''){
 const list=$('#jobsList');list.innerHTML='<div class="empty">Finding projects…</div>';
 try{const {jobs}=await api('/jobs?status=open&q='+encodeURIComponent(q));
 if(!jobs.length){list.innerHTML='<div class="empty">No open projects yet. Be the first to invite talent to your next idea.</div>';return;}
 list.innerHTML=jobs.slice(0,9).map(j=>`<article class="job-card"><div class="card-top"><span class="tag">${esc((j.skills||'New project').split(',')[0].trim().slice(0,24))}</span><span class="budget">${money(j.budget)}</span></div><h3>${esc(j.title)}</h3><p>${esc(j.description.slice(0,150))}${j.description.length>150?'…':''}</p><div class="card-meta"><span>◉ ${esc(j.client_name)}</span><span>${j.proposal_count} proposal${j.proposal_count===1?'':'s'}</span></div><button class="card-action" data-job="${j.id}">${currentUser?.role==='freelancer'?'View & apply':'View project'} →</button></article>`).join('');
 list.querySelectorAll('[data-job]').forEach(b=>b.onclick=()=>viewJob(b.dataset.job));
 }catch(e){list.innerHTML=`<div class="empty">${esc(e.message)} Check that the server is running.</div>`;}
}
async function loadTalent(q=''){
 const list=$('#talentList');list.innerHTML='<div class="empty">Finding independent talent…</div>';
 try{const {freelancers}=await api('/freelancers?q='+encodeURIComponent(q));
 if(!freelancers.length){list.innerHTML='<div class="empty">No freelancer profiles yet. Create a freelancer account and add your skills.</div>';return;}
 list.innerHTML=freelancers.slice(0,9).map(f=>`<article class="talent-card"><div class="talent-head"><div class="person-avatar">${esc((f.name||'?').split(/\s+/).map(x=>x[0]).slice(0,2).join('').toUpperCase())}</div><div><h3>${esc(f.name)}</h3><div class="verified">${f.verified?'✓ Profile verified':'Independent freelancer'} · ${f.rating?`★ ${f.rating} (${f.review_count})`:'New profile'}</div></div></div><p>${esc(f.bio||'This freelancer is building their profile. Contact them to learn more.')}</p><div class="skills">${(f.skills||'Open to opportunities').split(',').slice(0,5).map(s=>`<span>${esc(s.trim())}</span>`).join('')}</div><button class="card-action" data-profile="${f.id}">View profile →</button></article>`).join('');
 list.querySelectorAll('[data-profile]').forEach(b=>b.onclick=()=>viewProfile(b.dataset.profile));
 }catch(e){list.innerHTML=`<div class="empty">${esc(e.message)}</div>`;}
}
async function viewJob(id){
 try{const {job,proposals}=await api('/jobs/'+id);let msg=`${job.title}\n\nClient: ${job.client_name}\nBudget: ${money(job.budget)}\nStatus: ${job.status}\n\n${job.description}\n\nSkills: ${job.skills||'Not specified'}`;
 if(currentUser?.role==='freelancer'&&job.status==='open'){
  const cover=prompt('Write a short proposal (at least 20 characters):');if(cover===null)return;
  const bid=prompt('Your proposed total price (INR):',job.budget||'');if(bid===null)return;
  const result=await api(`/jobs/${id}/proposals`,{method:'POST',body:JSON.stringify({cover_letter:cover,bid:Number(bid)})});toast('Proposal submitted successfully.');
 }else if(currentUser?.role==='client'&&proposals.length){msg+='\n\nPROPOSALS:\n'+proposals.map(p=>`${p.freelancer_name} · ${money(p.bid)} · ${p.status}\n${p.cover_letter}`).join('\n\n');alert(msg);return;}
 alert(msg);
 }catch(e){toast(e.message);}
}
async function viewProfile(id){
 try{const {freelancer:f}=await api('/freelancers/'+id);alert(`${f.name}${f.verified?' ✓ Verified':''}\n\n${f.bio||'No bio added yet.'}\n\nSkills: ${f.skills||'Not listed'}\nPortfolio: ${f.portfolio||'Not listed'}\n\nRating: ${f.rating?.rating||'No ratings yet'}`);}
 catch(e){toast(e.message);}
}
async function refreshMe(){
 try{const d=await api('/me');currentUser=d.user;const login=$('#loginOpen'),signup=$('#signupOpen');
 if(currentUser){login.textContent=currentUser.name.split(' ')[0];login.onclick=()=>location.hash='#dashboard';signup.textContent='Log out';signup.onclick=async()=>{try{await api('/auth/logout',{method:'POST',body:'{}'});currentUser=null;location.reload();}catch(e){toast(e.message)}};}
 }catch{}
}
$('#loginOpen').onclick=()=>openAuth('login');$('#signupOpen').onclick=()=>openAuth('register');$('#heroSignup').onclick=()=>openAuth('register');$('#bottomSignup').onclick=()=>openAuth('register');$('#modalClose').onclick=closeAuth;
$('#authModal').addEventListener('click',e=>{if(e.target===$('#authModal'))closeAuth();});
document.querySelectorAll('.tab').forEach(b=>b.onclick=()=>setAuthMode(b.dataset.mode));
$('#authForm').onsubmit=async e=>{e.preventDefault();const message=$('#authMessage');message.textContent='Please wait…';
 const body={email:$('#authEmail').value,password:$('#authPassword').value};
 if(authMode==='register'){body.name=$('#authName').value;body.role=$('#authRole').value;}
 try{const d=await api('/auth/'+authMode,{method:'POST',body:JSON.stringify(body)});currentUser=d.user;message.style.color='#78e3b5';message.textContent=authMode==='register'?'Account created. You are signed in.':'Signed in successfully.';setTimeout(()=>{closeAuth();refreshMe();toast('Welcome to FreeWork, '+currentUser.name.split(' ')[0]+'!');},650);}
 catch(err){message.style.color='#ffb7a8';message.textContent=err.message;}
};
$('#searchJobs').onclick=()=>loadJobs($('#jobSearch').value);$('#jobSearch').addEventListener('keydown',e=>{if(e.key==='Enter')loadJobs(e.target.value)});
$('#searchTalent').onclick=()=>loadTalent($('#talentSearch').value);$('#talentSearch').addEventListener('keydown',e=>{if(e.key==='Enter')loadTalent(e.target.value)});
$('#menuBtn').onclick=()=>document.querySelector('.topbar nav').classList.toggle('open');
document.querySelectorAll('.topbar nav a').forEach(a=>a.addEventListener('click',()=>document.querySelector('.topbar nav').classList.remove('open')));
refreshMe();loadJobs();loadTalent();
