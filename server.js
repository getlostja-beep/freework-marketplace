const express = require('express');
const session = require('express-session');
const SQLiteStore = require('connect-sqlite3')(session);
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcryptjs');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const path = require('path');
const crypto = require('crypto');

const app = express();
const PORT = Number(process.env.PORT || 3000);
const SECRET = process.env.SESSION_SECRET;
if (!SECRET || SECRET.length < 32) {
  console.error('Set SESSION_SECRET to a random value of at least 32 characters (see .env.example).');
  process.exit(1);
}
const db = new sqlite3.Database(process.env.DB_PATH || path.join(__dirname, 'marketplace.sqlite'));
const run = (sql, params=[]) => new Promise((resolve,reject)=>db.run(sql,params,function(e){e?reject(e):resolve({id:this.lastID,changes:this.changes})}));
const get = (sql, params=[]) => new Promise((resolve,reject)=>db.get(sql,params,(e,r)=>e?reject(e):resolve(r)));
const all = (sql, params=[]) => new Promise((resolve,reject)=>db.all(sql,params,(e,r)=>e?reject(e):resolve(r)));

async function init() {
  await run(`PRAGMA foreign_keys = ON`);
  await run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL, role TEXT NOT NULL CHECK(role IN ('freelancer','client','admin')),
    bio TEXT DEFAULT '', skills TEXT DEFAULT '', portfolio TEXT DEFAULT '', verified INTEGER DEFAULT 0,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  )`);
  await run(`CREATE TABLE IF NOT EXISTS jobs (
    id INTEGER PRIMARY KEY AUTOINCREMENT, client_id INTEGER NOT NULL REFERENCES users(id),
    title TEXT NOT NULL, description TEXT NOT NULL, skills TEXT DEFAULT '', budget REAL,
    status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','in_progress','completed','closed')),
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  )`);
  await run(`CREATE TABLE IF NOT EXISTS proposals (
    id INTEGER PRIMARY KEY AUTOINCREMENT, job_id INTEGER NOT NULL REFERENCES jobs(id),
    freelancer_id INTEGER NOT NULL REFERENCES users(id), cover_letter TEXT NOT NULL, bid REAL,
    status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','accepted','rejected')),
    created_at TEXT DEFAULT CURRENT_TIMESTAMP, UNIQUE(job_id,freelancer_id)
  )`);
  await run(`CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT, sender_id INTEGER NOT NULL REFERENCES users(id),
    receiver_id INTEGER NOT NULL REFERENCES users(id), job_id INTEGER REFERENCES jobs(id),
    body TEXT NOT NULL, created_at TEXT DEFAULT CURRENT_TIMESTAMP
  )`);
  await run(`CREATE TABLE IF NOT EXISTS reviews (
    id INTEGER PRIMARY KEY AUTOINCREMENT, job_id INTEGER NOT NULL REFERENCES jobs(id),
    reviewer_id INTEGER NOT NULL REFERENCES users(id), reviewee_id INTEGER NOT NULL REFERENCES users(id),
    rating INTEGER NOT NULL CHECK(rating BETWEEN 1 AND 5), comment TEXT DEFAULT '',
    created_at TEXT DEFAULT CURRENT_TIMESTAMP, UNIQUE(job_id,reviewer_id)
  )`);
  await run(`CREATE TABLE IF NOT EXISTS milestones (
    id INTEGER PRIMARY KEY AUTOINCREMENT, job_id INTEGER NOT NULL REFERENCES jobs(id),
    title TEXT NOT NULL, amount REAL DEFAULT 0, due_date TEXT DEFAULT '', status TEXT DEFAULT 'pending'
  )`);
  await run(`CREATE TABLE IF NOT EXISTS reports (
    id INTEGER PRIMARY KEY AUTOINCREMENT, reporter_id INTEGER NOT NULL REFERENCES users(id),
    reported_user_id INTEGER REFERENCES users(id), job_id INTEGER REFERENCES jobs(id),
    reason TEXT NOT NULL, status TEXT DEFAULT 'open', created_at TEXT DEFAULT CURRENT_TIMESTAMP
  )`);
  const email = (process.env.ADMIN_EMAIL || '').trim().toLowerCase();
  const pass = process.env.ADMIN_PASSWORD || '';
  if (email && pass && pass !== 'change-this-admin-password-now') {
    const existing = await get('SELECT id FROM users WHERE email=?',[email]);
    if (!existing) await run('INSERT INTO users(name,email,password_hash,role) VALUES(?,?,?,?)',
      ['Administrator',email,await bcrypt.hash(pass,12),'admin']);
  }
}
app.disable('x-powered-by');
app.use(helmet({contentSecurityPolicy:{directives:{
  defaultSrc:["'self'"], scriptSrc:["'self'"], styleSrc:["'self'"], imgSrc:["'self'","data:"],
  connectSrc:["'self'"], objectSrc:["'none'"], upgradeInsecureRequests: null
}}}));
app.use(express.json({limit:'50kb'}));
app.use(express.urlencoded({extended:false,limit:'20kb'}));
app.use(session({
  name:'freework.sid', secret:SECRET, resave:false, saveUninitialized:false,
  store:new SQLiteStore({db:'sessions.sqlite',dir:__dirname}),
  cookie:{httpOnly:true,sameSite:'lax',secure:process.env.NODE_ENV==='production',maxAge:1000*60*60*8}
}));
app.use(express.static(path.join(__dirname,'public')));
app.use('/api/auth', rateLimit({windowMs:15*60*1000,limit:30,standardHeaders:true,legacyHeaders:false}));

function clean(v,max=2000){return typeof v==='string'?v.trim().slice(0,max):'';}
function validEmail(v){return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);}
function userView(u){return {id:u.id,name:u.name,email:u.email,role:u.role,bio:u.bio||'',skills:u.skills||'',portfolio:u.portfolio||'',verified:!!u.verified,created_at:u.created_at};}
function auth(req,res,next){if(!req.session.user)return res.status(401).json({error:'Please sign in first.'});next();}
function roles(...allowed){return (req,res,next)=>{if(!req.session.user)return res.status(401).json({error:'Please sign in first.'});if(!allowed.includes(req.session.user.role))return res.status(403).json({error:'You do not have permission for this action.'});next();}}
function csrf(req,res,next){
  if(['GET','HEAD','OPTIONS'].includes(req.method))return next();
  const origin=req.get('origin');
  const expected=process.env.APP_ORIGIN;
  if(origin && expected && origin!==expected)return res.status(403).json({error:'Request origin rejected.'});
  next();
}
app.use('/api',csrf);
app.get('/api/health',(req,res)=>res.json({ok:true,service:'FreeWork Marketplace'}));
app.get('/api/me',(req,res)=>res.json({user:req.session.user||null}));
app.post('/api/auth/register',async(req,res,next)=>{
 try{
  const name=clean(req.body.name,80), email=clean(req.body.email,254).toLowerCase(), password=String(req.body.password||''), role=req.body.role;
  if(name.length<2||!validEmail(email)||password.length<10||password.length>200||!['freelancer','client'].includes(role))
   return res.status(400).json({error:'Enter a name, valid email, a password of at least 10 characters, and a valid account type.'});
  if(await get('SELECT id FROM users WHERE email=?',[email]))return res.status(409).json({error:'An account with that email already exists.'});
  const result=await run('INSERT INTO users(name,email,password_hash,role) VALUES(?,?,?,?)',[name,email,await bcrypt.hash(password,12),role]);
  const u=await get('SELECT * FROM users WHERE id=?',[result.id]);req.session.user=userView(u);res.status(201).json({user:req.session.user});
 }catch(e){next(e)}
});
app.post('/api/auth/login',async(req,res,next)=>{
 try{
  const email=clean(req.body.email,254).toLowerCase(), password=String(req.body.password||'');
  const u=await get('SELECT * FROM users WHERE email=?',[email]);
  if(!u||!(await bcrypt.compare(password,u.password_hash)))return res.status(401).json({error:'Email or password is incorrect.'});
  req.session.regenerate(err=>{if(err)return next(err);req.session.user=userView(u);res.json({user:req.session.user});});
 }catch(e){next(e)}
});
app.post('/api/auth/logout',auth,(req,res)=>req.session.destroy(()=>res.json({ok:true})));

app.get('/api/freelancers',async(req,res,next)=>{try{
 const q=clean(req.query.q,100).toLowerCase(), skill=clean(req.query.skill,80).toLowerCase();
 let rows=await all(`SELECT u.id,u.name,u.bio,u.skills,u.portfolio,u.verified,u.created_at,
 (SELECT ROUND(AVG(r.rating),1) FROM reviews r WHERE r.reviewee_id=u.id) rating,
 (SELECT COUNT(*) FROM reviews r WHERE r.reviewee_id=u.id) review_count
 FROM users u WHERE u.role='freelancer' AND (?='' OR lower(u.name||' '||u.bio||' '||u.skills) LIKE ?)
 ORDER BY u.verified DESC,u.created_at DESC LIMIT 100`,[q,q?`%${q}%`:'']);
 if(skill)rows=rows.filter(x=>x.skills.toLowerCase().includes(skill));
 res.json({freelancers:rows});
 }catch(e){next(e)}});
app.get('/api/freelancers/:id',async(req,res,next)=>{try{
 const u=await get(`SELECT id,name,bio,skills,portfolio,verified,created_at FROM users WHERE id=? AND role='freelancer'`,[req.params.id]);
 if(!u)return res.status(404).json({error:'Freelancer not found.'});
 u.rating=await get('SELECT ROUND(AVG(rating),1) rating,COUNT(*) count FROM reviews WHERE reviewee_id=?',[u.id]);res.json({freelancer:u});
 }catch(e){next(e)}});
app.put('/api/profile',auth,async(req,res,next)=>{try{
 const bio=clean(req.body.bio,1200),skills=clean(req.body.skills,500),portfolio=clean(req.body.portfolio,1000);
 await run('UPDATE users SET bio=?,skills=?,portfolio=? WHERE id=?',[bio,skills,portfolio,req.session.user.id]);
 const u=await get('SELECT * FROM users WHERE id=?',[req.session.user.id]);req.session.user=userView(u);res.json({user:req.session.user});
 }catch(e){next(e)}});

app.get('/api/jobs',async(req,res,next)=>{try{
 const q=clean(req.query.q,100).toLowerCase(), status=clean(req.query.status,30)||'open';
 const jobs=await all(`SELECT j.*,u.name client_name,
 (SELECT COUNT(*) FROM proposals p WHERE p.job_id=j.id) proposal_count
 FROM jobs j JOIN users u ON u.id=j.client_id
 WHERE (?='' OR j.status=?) AND (?='' OR lower(j.title||' '||j.description||' '||j.skills) LIKE ?)
 ORDER BY j.created_at DESC LIMIT 100`,[status,status,q,q?`%${q}%`:'']);
 res.json({jobs});
 }catch(e){next(e)}});
app.post('/api/jobs',roles('client','admin'),async(req,res,next)=>{try{
 const title=clean(req.body.title,120),description=clean(req.body.description,5000),skills=clean(req.body.skills,500),budget=Number(req.body.budget);
 if(title.length<5||description.length<20||!Number.isFinite(budget)||budget<0||budget>100000000)return res.status(400).json({error:'Add a title (5+ chars), description (20+ chars), and a valid non-negative budget.'});
 const r=await run('INSERT INTO jobs(client_id,title,description,skills,budget) VALUES(?,?,?,?,?)',[req.session.user.id,title,description,skills,budget]);
 res.status(201).json({job:await get('SELECT * FROM jobs WHERE id=?',[r.id])});
 }catch(e){next(e)}});
app.get('/api/jobs/:id',async(req,res,next)=>{try{
 const job=await get(`SELECT j.*,u.name client_name FROM jobs j JOIN users u ON u.id=j.client_id WHERE j.id=?`,[req.params.id]);
 if(!job)return res.status(404).json({error:'Project not found.'});
 const proposals=await all(`SELECT p.id,p.cover_letter,p.bid,p.status,p.created_at,u.id freelancer_id,u.name freelancer_name,u.skills
 FROM proposals p JOIN users u ON u.id=p.freelancer_id WHERE p.job_id=? ORDER BY p.created_at DESC`,[job.id]);
 const visible= req.session.user && (req.session.user.id===job.client_id||req.session.user.role==='admin') ? proposals : [];
 res.json({job,proposals:visible});
 }catch(e){next(e)}});
app.post('/api/jobs/:id/proposals',roles('freelancer'),async(req,res,next)=>{try{
 const job=await get('SELECT * FROM jobs WHERE id=?',[req.params.id]);
 const cover=clean(req.body.cover_letter,3000),bid=Number(req.body.bid);
 if(!job||job.status!=='open')return res.status(404).json({error:'This project is not open.'});
 if(job.client_id===req.session.user.id)return res.status(400).json({error:'You cannot apply to your own project.'});
 if(cover.length<20||!Number.isFinite(bid)||bid<0)return res.status(400).json({error:'Proposal must be at least 20 characters and include a valid bid.'});
 try{const r=await run('INSERT INTO proposals(job_id,freelancer_id,cover_letter,bid) VALUES(?,?,?,?)',[job.id,req.session.user.id,cover,bid]);res.status(201).json({proposal:await get('SELECT * FROM proposals WHERE id=?',[r.id])});}
 catch(e){if(String(e.message).includes('UNIQUE'))return res.status(409).json({error:'You already submitted a proposal for this project.'});throw e;}
 }catch(e){next(e)}});
app.post('/api/proposals/:id/decision',roles('client','admin'),async(req,res,next)=>{try{
 const p=await get('SELECT p.*,j.client_id,j.id job_id FROM proposals p JOIN jobs j ON j.id=p.job_id WHERE p.id=?',[req.params.id]);
 if(!p)return res.status(404).json({error:'Proposal not found.'});
 if(req.session.user.role!=='admin'&&p.client_id!==req.session.user.id)return res.status(403).json({error:'Only the project owner can decide on this proposal.'});
 if(!['accepted','rejected'].includes(req.body.status))return res.status(400).json({error:'Invalid decision.'});
 await run('UPDATE proposals SET status=? WHERE id=?',[req.body.status,p.id]);
 if(req.body.status==='accepted')await run("UPDATE jobs SET status='in_progress' WHERE id=?",[p.job_id]);
 res.json({ok:true});
 }catch(e){next(e)}});

app.get('/api/dashboard',auth,async(req,res,next)=>{try{
 const uid=req.session.user.id,role=req.session.user.role;
 let data={user:req.session.user};
 if(role==='client'||role==='admin'){
  data.jobs=await all(`SELECT j.*,(SELECT COUNT(*) FROM proposals p WHERE p.job_id=j.id) proposal_count FROM jobs j WHERE j.client_id=? ORDER BY j.created_at DESC`,[uid]);
  data.proposals=await all(`SELECT p.*,j.title job_title,u.name freelancer_name FROM proposals p JOIN jobs j ON j.id=p.job_id JOIN users u ON u.id=p.freelancer_id WHERE j.client_id=? ORDER BY p.created_at DESC`,[uid]);
 } else {
  data.proposals=await all(`SELECT p.*,j.title job_title,j.status job_status FROM proposals p JOIN jobs j ON j.id=p.job_id WHERE p.freelancer_id=? ORDER BY p.created_at DESC`,[uid]);
  data.jobs=await all(`SELECT j.*,u.name client_name FROM jobs j JOIN users u ON u.id=j.client_id JOIN proposals p ON p.job_id=j.id WHERE p.freelancer_id=? AND p.status='accepted'`,[uid]);
 }
 data.messages=await all(`SELECT m.*,u.name other_name FROM messages m JOIN users u ON u.id=CASE WHEN m.sender_id=? THEN m.receiver_id ELSE m.sender_id END WHERE m.sender_id=? OR m.receiver_id=? ORDER BY m.created_at DESC LIMIT 30`,[uid,uid,uid]);
 res.json(data);
 }catch(e){next(e)}});

app.get('/api/messages/:otherId',auth,async(req,res,next)=>{try{
 const other=Number(req.params.otherId);
 const msgs=await all(`SELECT id,sender_id,receiver_id,job_id,body,created_at FROM messages WHERE (sender_id=? AND receiver_id=?) OR (sender_id=? AND receiver_id=?) ORDER BY id ASC LIMIT 200`,[req.session.user.id,other,other,req.session.user.id]);
 res.json({messages:msgs});
 }catch(e){next(e)}});
app.post('/api/messages',auth,async(req,res,next)=>{try{
 const receiver=Number(req.body.receiver_id),body=clean(req.body.body,2000),jobId=req.body.job_id?Number(req.body.job_id):null;
 if(!receiver||receiver===req.session.user.id||body.length<1)return res.status(400).json({error:'Choose another user and enter a message.'});
 const target=await get('SELECT id FROM users WHERE id=?',[receiver]);if(!target)return res.status(404).json({error:'Recipient not found.'});
 if(jobId){
  const job=await get('SELECT * FROM jobs WHERE id=?',[jobId]);
  if(!job)return res.status(404).json({error:'Project not found.'});
  const p=await get('SELECT id FROM proposals WHERE job_id=? AND freelancer_id=?',[jobId,req.session.user.id]);
  const involved=job.client_id===req.session.user.id||job.client_id===receiver||p;
  if(!involved)return res.status(403).json({error:'You are not connected to this project.'});
 }
 const r=await run('INSERT INTO messages(sender_id,receiver_id,job_id,body) VALUES(?,?,?,?)',[req.session.user.id,receiver,jobId,body]);
 res.status(201).json({message:await get('SELECT * FROM messages WHERE id=?',[r.id])});
 }catch(e){next(e)}});

app.post('/api/reviews',auth,async(req,res,next)=>{try{
 const jobId=Number(req.body.job_id),reviewee=Number(req.body.reviewee_id),rating=Number(req.body.rating),comment=clean(req.body.comment,1500);
 const job=await get('SELECT * FROM jobs WHERE id=?',[jobId]);
 if(!job||job.status!=='completed')return res.status(400).json({error:'Reviews are available only after a project is marked completed.'});
 if(![job.client_id].includes(req.session.user.id)&&req.session.user.role!=='admin'){
  const p=await get("SELECT id FROM proposals WHERE job_id=? AND freelancer_id=? AND status='accepted'",[jobId,req.session.user.id]);
  if(!p)return res.status(403).json({error:'You are not a participant in this project.'});
 }
 if(!Number.isInteger(rating)||rating<1||rating>5||reviewee===req.session.user.id)return res.status(400).json({error:'Choose a 1–5 rating and a different reviewee.'});
 try{await run('INSERT INTO reviews(job_id,reviewer_id,reviewee_id,rating,comment) VALUES(?,?,?,?,?)',[jobId,req.session.user.id,reviewee,rating,comment]);res.status(201).json({ok:true});}
 catch(e){if(String(e.message).includes('UNIQUE'))return res.status(409).json({error:'You already reviewed this project.'});throw e;}
 }catch(e){next(e)}});

app.post('/api/reports',auth,async(req,res,next)=>{try{
 const reason=clean(req.body.reason,1500),reported=req.body.reported_user_id?Number(req.body.reported_user_id):null,job=req.body.job_id?Number(req.body.job_id):null;
 if(reason.length<10)return res.status(400).json({error:'Please explain the issue in at least 10 characters.'});
 const r=await run('INSERT INTO reports(reporter_id,reported_user_id,job_id,reason) VALUES(?,?,?,?)',[req.session.user.id,reported,job,reason]);
 res.status(201).json({id:r.id,status:'open'});
 }catch(e){next(e)}});

app.get('/api/admin/overview',roles('admin'),async(req,res,next)=>{try{
 const [users,jobs,proposals,reports]=await Promise.all([
  all('SELECT id,name,email,role,verified,created_at FROM users ORDER BY id DESC LIMIT 500'),
  all('SELECT j.*,u.name client_name FROM jobs j JOIN users u ON u.id=j.client_id ORDER BY j.id DESC LIMIT 500'),
  all('SELECT * FROM proposals ORDER BY id DESC LIMIT 500'),
  all('SELECT r.*,u.name reporter_name FROM reports r JOIN users u ON u.id=r.reporter_id ORDER BY r.id DESC LIMIT 500')]);
 res.json({users,jobs,proposals,reports});
 }catch(e){next(e)}});
app.patch('/api/admin/users/:id',roles('admin'),async(req,res,next)=>{try{
 const verified=Number(req.body.verified);if(![0,1].includes(verified))return res.status(400).json({error:'verified must be 0 or 1'});
 await run('UPDATE users SET verified=? WHERE id=? AND role<>?',[verified,req.params.id,'admin']);res.json({ok:true});
 }catch(e){next(e)}});
app.patch('/api/admin/jobs/:id',roles('admin'),async(req,res,next)=>{try{
 if(!['open','in_progress','completed','closed'].includes(req.body.status))return res.status(400).json({error:'Invalid job status'});
 await run('UPDATE jobs SET status=? WHERE id=?',[req.body.status,req.params.id]);res.json({ok:true});
 }catch(e){next(e)}});
app.patch('/api/admin/reports/:id',roles('admin'),async(req,res,next)=>{try{
 if(!['open','reviewing','resolved','dismissed'].includes(req.body.status))return res.status(400).json({error:'Invalid report status'});
 await run('UPDATE reports SET status=? WHERE id=?',[req.body.status,req.params.id]);res.json({ok:true});
 }catch(e){next(e)}});

app.use('/api',(req,res)=>res.status(404).json({error:'API endpoint not found.'}));
app.use((err,req,res,next)=>{console.error(err);res.status(500).json({error:'Something went wrong. Please try again.'});});
init().then(()=>app.listen(PORT,()=>console.log(`FreeWork running at http://localhost:${PORT}`))).catch(e=>{console.error('Database initialization failed:',e);process.exit(1);});
