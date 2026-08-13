const express = require('express');
const multer = require('multer');
const jwt = require('jsonwebtoken');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = Number(process.env.PORT || 10000);
const ADMIN_PASSWORD = String(process.env.ADMIN_PASSWORD || '');
const SECRET = String(process.env.ADMIN_SECRET || 'change-this-secret');
const ROOT = __dirname;
const PUBLIC = path.join(ROOT, 'public');
const UPLOADS = path.join(PUBLIC, 'uploads');
const DATA_DIR = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(ROOT, 'data');
const DB_FILE = path.join(DATA_DIR, 'data.json');
const SUPABASE_URL = String(process.env.SUPABASE_URL || '').replace(/\/$/, '');
const SUPABASE_SERVICE_ROLE_KEY = String(process.env.SUPABASE_SERVICE_ROLE_KEY || '');
const SUPABASE_BUCKET = String(process.env.SUPABASE_BUCKET || 'posters');
const USE_SUPABASE = Boolean(SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY);

fs.mkdirSync(UPLOADS, {recursive:true});
fs.mkdirSync(DATA_DIR, {recursive:true});

const DEFAULT_MOVIES = [
  {id:'m1', name:'Pushpa 2', language:'Hindi', genre:'Action • Drama', description:'A powerful action drama.', poster:''},
  {id:'m2', name:'Bahubali 3', language:'Hindi', genre:'Action • Adventure', description:'An epic adventure.', poster:''},
  {id:'m3', name:'Vikram', language:'Hindi', genre:'Action • Thriller', description:'A high-intensity thriller.', poster:''},
  {id:'m4', name:'Interstellar', language:'English', genre:'Sci-Fi • Drama', description:'A journey beyond space and time.', poster:''},
  {id:'m5', name:'Inception', language:'English', genre:'Sci-Fi • Thriller', description:'A mind-bending experience.', poster:''},
  {id:'m6', name:'Avatar', language:'English', genre:'Adventure • Sci-Fi', description:'An immersive adventure.', poster:''}
];

function freshDb(){return {movies:DEFAULT_MOVIES, votes:{}, votingOpen:true, weekLabel:'Next Week'};}
function loadLocalDb(){
  try { return JSON.parse(fs.readFileSync(DB_FILE,'utf8')); }
  catch { const db=freshDb(); saveLocalDb(db); return db; }
}
function saveLocalDb(db){ fs.writeFileSync(DB_FILE, JSON.stringify(db,null,2)); }

async function supabaseRequest(endpoint, options={}){
  const r = await fetch(`${SUPABASE_URL}${endpoint}`, {
    ...options,
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      ...(options.headers || {})
    }
  });
  const text = await r.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  if(!r.ok){
    const message = typeof body === 'object' && body ? (body.message || body.error || body.hint || body.code) : body;
    throw new Error(`Supabase ${r.status}: ${message || 'request failed'}`);
  }
  return body;
}

async function loadDb(){
  if(!USE_SUPABASE) return loadLocalDb();
  try{
    const rows = await supabaseRequest(`/rest/v1/site_data?id=eq.1&select=data&limit=1`);
    if(Array.isArray(rows) && rows[0]?.data) return rows[0].data;
    const db=freshDb();
    await saveDb(db);
    return db;
  }catch(err){
    console.error('Supabase load failed:', err.message);
    throw err;
  }
}

async function saveDb(db){
  if(!USE_SUPABASE){ saveLocalDb(db); return; }
  await supabaseRequest(`/rest/v1/site_data?id=eq.1`, {
    method:'PATCH',
    headers:{'Content-Type':'application/json', Prefer:'return=minimal'},
    body:JSON.stringify({data:db, updated_at:new Date().toISOString()})
  });
}

function isAdmin(req){
  const value=String(req.headers.authorization || '');
  if(!value.startsWith('Bearer ')) return false;
  try { jwt.verify(value.slice(7), SECRET); return true; } catch { return false; }
}
function sendJson(res,status,payload){ res.status(status).type('application/json').send(JSON.stringify(payload)); }
function adminOnly(req,res,next){ if(!isAdmin(req)) return sendJson(res,401,{ok:false,error:'Unauthorized. Please login again.'}); next(); }

app.disable('x-powered-by');
app.use(express.json({limit:'8mb'}));

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req,_file,cb)=>cb(null,UPLOADS),
    filename: (_req,file,cb)=>{
      const ext = path.extname(file.originalname).toLowerCase() === '.jpeg' ? '.jpeg' : '.jpg';
      cb(null, `poster-${Date.now()}-${Math.random().toString(36).slice(2,8)}${ext}`);
    }
  }),
  limits:{fileSize:5*1024*1024, files:1},
  fileFilter: (_req,file,cb)=>{
    const ok = /\.jpe?g$/i.test(file.originalname);
    cb(ok ? null : new Error('Only JPG/JPEG image files are allowed.'));
  }
});

app.get('/api/health', (_req,res)=>sendJson(res,200,{ok:true,service:'anant-vijay',version:'6.0.0',persistentStorage:USE_SUPABASE?'supabase':'local'}));
app.get('/api/movies', async (_req,res)=>{
  try{ const db=await loadDb(); sendJson(res,200,{ok:true,movies:db.movies,votingOpen:db.votingOpen,weekLabel:db.weekLabel}); }
  catch(err){ console.error(err); sendJson(res,503,{ok:false,error:'Website data storage is not configured or unavailable. Please check Supabase settings in Render.'}); }
});

app.post('/api/login',(req,res)=>{
  if(!ADMIN_PASSWORD) return sendJson(res,500,{ok:false,error:'ADMIN_PASSWORD is not configured in Render Environment Variables.'});
  if(String(req.body?.password || '') !== ADMIN_PASSWORD) return sendJson(res,401,{ok:false,error:'Invalid password.'});
  const token=jwt.sign({role:'superadmin'},SECRET,{expiresIn:'12h'});
  sendJson(res,200,{ok:true,token});
});

app.get('/api/admin-data',adminOnly,async (_req,res)=>{
  try{ sendJson(res,200,{ok:true,...await loadDb()}); }
  catch(err){ console.error(err); sendJson(res,503,{ok:false,error:'Could not load persistent website data. Check Supabase settings.'}); }
});

app.post('/api/vote',async (req,res)=>{
  try{
    const db=await loadDb();
    if(!db.votingOpen) return sendJson(res,403,{ok:false,error:'Voting is closed.'});
    const id=String(req.body?.movieId || '');
    if(!id || !db.movies.some(m=>m.id===id)) return sendJson(res,400,{ok:false,error:'Invalid movie.'});
    db.votes[id]=(db.votes[id]||0)+1;
    await saveDb(db);
    sendJson(res,200,{ok:true,message:'Vote recorded.'});
  }catch(err){ console.error(err); sendJson(res,503,{ok:false,error:'Vote could not be saved. Please try again.'}); }
});

app.put('/api/movies',adminOnly,async (req,res)=>{
  try{
    const body=req.body || {};
    if(!Array.isArray(body.movies)) return sendJson(res,400,{ok:false,error:'Invalid movie list.'});
    const db=await loadDb();
    db.movies=body.movies.map((m,i)=>({
      id:String(m.id || `m${Date.now()}-${i}`),
      name:String(m.name || 'Untitled').trim(),
      language:m.language === 'English' ? 'English' : 'Hindi',
      genre:String(m.genre || '').trim(),
      description:String(m.description || '').trim(),
      poster:String(m.poster || '').trim()
    }));
    db.weekLabel=String(body.weekLabel || 'Next Week');
    await saveDb(db); sendJson(res,200,{ok:true,data:db});
  }catch(err){ console.error(err); sendJson(res,503,{ok:false,error:'Could not save weekly movies. Check persistent storage settings.'}); }
});

async function uploadToSupabase(buffer, filename){
  const objectPath=`${Date.now()}-${Math.random().toString(36).slice(2,10)}-${filename}`;
  await supabaseRequest(`/storage/v1/object/${encodeURIComponent(SUPABASE_BUCKET)}/${encodeURIComponent(objectPath)}`,{
    method:'POST',
    headers:{'Content-Type':'image/jpeg','x-upsert':'true'},
    body:buffer
  });
  return `${SUPABASE_URL}/storage/v1/object/public/${SUPABASE_BUCKET}/${encodeURIComponent(objectPath)}`;
}

app.post('/api/upload-poster',adminOnly,(req,res)=>{
  if(req.is('application/json')){
    (async()=>{
      try{
        const originalName=String(req.body?.name || '');
        const dataUrl=String(req.body?.data || '');
        if(!/\.jpe?g$/i.test(originalName)) return sendJson(res,400,{ok:false,error:'Only JPG/JPEG image files are allowed.'});
        const match=dataUrl.match(/^data:image\/(?:jpeg|jpg);base64,([A-Za-z0-9+/=]+)$/i);
        if(!match) return sendJson(res,400,{ok:false,error:'Invalid JPG data received. Please choose the JPG again.'});
        const buffer=Buffer.from(match[1],'base64');
        if(!buffer.length) return sendJson(res,400,{ok:false,error:'The selected JPG is empty.'});
        if(buffer.length>5*1024*1024) return sendJson(res,400,{ok:false,error:'JPG file must be 5 MB or smaller.'});
        const isJpeg=buffer.length>=3 && buffer[0]===0xFF && buffer[1]===0xD8 && buffer[2]===0xFF;
        if(!isJpeg) return sendJson(res,400,{ok:false,error:'The selected file is not a valid JPG/JPEG image.'});
        let url;
        if(USE_SUPABASE){
          url=await uploadToSupabase(buffer,'poster.jpg');
        }else{
          const filename=`poster-${Date.now()}-${Math.random().toString(36).slice(2,8)}.jpg`;
          fs.writeFileSync(path.join(UPLOADS,filename),buffer);
          url=`/uploads/${encodeURIComponent(filename)}`;
        }
        return sendJson(res,200,{ok:true,url,name:originalName,persistent:USE_SUPABASE});
      }catch(err){
        console.error('Poster upload error:',err);
        return sendJson(res,503,{ok:false,error:USE_SUPABASE?'Poster storage is not configured correctly. Check SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY and SUPABASE_BUCKET in Render.':'Could not save the uploaded JPG file.'});
      }
    })();
    return;
  }

  upload.single('poster')(req,res,(err)=>{
    if(err) return sendJson(res,400,{ok:false,error:err.code === 'LIMIT_FILE_SIZE'?'JPG file must be 5 MB or smaller.':(err.message||'Upload failed.')});
    if(!req.file) return sendJson(res,400,{ok:false,error:'No JPG file was received.'});
    try{
      const fd=fs.openSync(req.file.path,'r'); const magic=Buffer.alloc(3); const bytes=fs.readSync(fd,magic,0,3,0); fs.closeSync(fd);
      const isJpeg=bytes===3 && magic[0]===0xFF && magic[1]===0xD8 && magic[2]===0xFF;
      if(!isJpeg){try{fs.unlinkSync(req.file.path)}catch{};return sendJson(res,400,{ok:false,error:'The selected file is not a valid JPG/JPEG image.'});}
      sendJson(res,200,{ok:true,url:`/uploads/${encodeURIComponent(req.file.filename)}`,name:req.file.originalname,persistent:false});
    }catch(err){try{fs.unlinkSync(req.file.path)}catch{};sendJson(res,500,{ok:false,error:'Could not verify the uploaded JPG file.'});}
  });
});

app.put('/api/voting',adminOnly,async (req,res)=>{try{const db=await loadDb();db.votingOpen=Boolean(req.body?.open);await saveDb(db);sendJson(res,200,{ok:true,votingOpen:db.votingOpen});}catch(err){console.error(err);sendJson(res,503,{ok:false,error:'Could not save voting status.'});}});
app.post('/api/reset',adminOnly,async (_req,res)=>{try{const db=await loadDb();db.votes={};await saveDb(db);sendJson(res,200,{ok:true});}catch(err){console.error(err);sendJson(res,503,{ok:false,error:'Could not reset votes.'});}});

app.use(express.static(PUBLIC, {extensions:['html']}));
app.get('*',(req,res)=>{ if(req.path.startsWith('/api/')) return sendJson(res,404,{ok:false,error:'API endpoint not found.'}); res.sendFile(path.join(PUBLIC,'index.html')); });
app.use((err,_req,res,_next)=>{ console.error(err); if(!res.headersSent) sendJson(res,500,{ok:false,error:'Server error.'}); });
app.listen(PORT,'0.0.0.0',()=>console.log(`Anant Vijay Voting v6 running on port ${PORT} | persistent storage: ${USE_SUPABASE?'Supabase':'local'}`));
