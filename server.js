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
const DATA_DIR = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(ROOT, 'data');
// Store uploaded posters on the persistent data volume, not inside the deploy folder.
// Render can replace the deploy filesystem during restarts/redeploys.
const UPLOADS = path.join(DATA_DIR, 'uploads');
const DB_FILE = path.join(DATA_DIR, 'data.json');
fs.mkdirSync(DATA_DIR, {recursive:true});
fs.mkdirSync(UPLOADS, {recursive:true});

const DEFAULT_MOVIES = [
  {id:'m1', name:'Pushpa 2', language:'Hindi', genre:'Action • Drama', description:'A powerful action drama.', poster:''},
  {id:'m2', name:'Bahubali 3', language:'Hindi', genre:'Action • Adventure', description:'An epic adventure.', poster:''},
  {id:'m3', name:'Vikram', language:'Hindi', genre:'Action • Thriller', description:'A high-intensity thriller.', poster:''},
  {id:'m4', name:'Interstellar', language:'English', genre:'Sci-Fi • Drama', description:'A journey beyond space and time.', poster:''},
  {id:'m5', name:'Inception', language:'English', genre:'Sci-Fi • Thriller', description:'A mind-bending experience.', poster:''},
  {id:'m6', name:'Avatar', language:'English', genre:'Adventure • Sci-Fi', description:'An immersive adventure.', poster:''}
];

function freshDb(){return {movies:DEFAULT_MOVIES, votes:{}, votingOpen:true, weekLabel:'Next Week'};}
function loadDb(){
  try { return JSON.parse(fs.readFileSync(DB_FILE,'utf8')); }
  catch { const db=freshDb(); saveDb(db); return db; }
}
function saveDb(db){ fs.writeFileSync(DB_FILE, JSON.stringify(db,null,2)); }
function isAdmin(req){
  const value=String(req.headers.authorization || '');
  if(!value.startsWith('Bearer ')) return false;
  try { jwt.verify(value.slice(7), SECRET); return true; } catch { return false; }
}
function sendJson(res,status,payload){
  res.status(status).type('application/json').send(JSON.stringify(payload));
}
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
    // Some browsers/OS configurations report JPEG as application/octet-stream
    // or omit the MIME type. Validate by extension here and verify JPEG bytes
    // after upload below.
    const ok = /\.jpe?g$/i.test(file.originalname);
    cb(ok ? null : new Error('Only JPG/JPEG image files are allowed.'));
  }
});

app.get('/api/health', (_req,res)=>sendJson(res,200,{ok:true,service:'anant-vijay',version:'3.1.0'}));
// Uploaded posters live outside the public deploy directory and are served from the persistent volume.
app.use('/uploads', express.static(UPLOADS, {maxAge:'1h'}));
app.get('/api/movies', (_req,res)=>{const db=loadDb(); sendJson(res,200,{ok:true,movies:db.movies,votingOpen:db.votingOpen,weekLabel:db.weekLabel});});

app.post('/api/login',(req,res)=>{
  if(!ADMIN_PASSWORD) return sendJson(res,500,{ok:false,error:'ADMIN_PASSWORD is not configured in Render Environment Variables.'});
  if(String(req.body?.password || '') !== ADMIN_PASSWORD) return sendJson(res,401,{ok:false,error:'Invalid password.'});
  const token=jwt.sign({role:'superadmin'},SECRET,{expiresIn:'12h'});
  sendJson(res,200,{ok:true,token});
});

app.get('/api/admin-data',adminOnly,(_req,res)=>sendJson(res,200,{ok:true,...loadDb()}));

app.post('/api/vote',(req,res)=>{
  const db=loadDb();
  if(!db.votingOpen) return sendJson(res,403,{ok:false,error:'Voting is closed.'});
  const id=String(req.body?.movieId || '');
  if(!id || !db.movies.some(m=>m.id===id)) return sendJson(res,400,{ok:false,error:'Invalid movie.'});
  db.votes[id]=(db.votes[id]||0)+1; saveDb(db);
  sendJson(res,200,{ok:true,message:'Vote recorded.'});
});

app.put('/api/movies',adminOnly,(req,res)=>{
  const body=req.body || {};
  if(!Array.isArray(body.movies)) return sendJson(res,400,{ok:false,error:'Invalid movie list.'});
  const db=loadDb();
  db.movies=body.movies.map((m,i)=>({
    id:String(m.id || `m${Date.now()}-${i}`),
    name:String(m.name || 'Untitled').trim(),
    language:m.language === 'English' ? 'English' : 'Hindi',
    genre:String(m.genre || '').trim(),
    description:String(m.description || '').trim(),
    poster:String(m.poster || '').trim()
  }));
  db.weekLabel=String(body.weekLabel || 'Next Week');
  saveDb(db); sendJson(res,200,{ok:true,data:db});
});

app.post('/api/upload-poster',adminOnly,(req,res)=>{
  // The admin page sends the JPG as JSON/base64 instead of multipart/form-data.
  // This avoids reverse-proxy/browser multipart handling issues where the
  // selected file reaches the browser but multer receives no file.
  if(req.is('application/json')){
    try{
      const originalName=String(req.body?.name || '');
      const dataUrl=String(req.body?.data || '');

      if(!/\.jpe?g$/i.test(originalName)){
        return sendJson(res,400,{ok:false,error:'Only JPG/JPEG image files are allowed.'});
      }
      const match=dataUrl.match(/^data:image\/(?:jpeg|jpg);base64,([A-Za-z0-9+/=]+)$/i);
      if(!match){
        return sendJson(res,400,{ok:false,error:'Invalid JPG data received. Please choose the JPG again.'});
      }

      const buffer=Buffer.from(match[1],'base64');
      if(!buffer.length){
        return sendJson(res,400,{ok:false,error:'The selected JPG is empty.'});
      }
      if(buffer.length>5*1024*1024){
        return sendJson(res,400,{ok:false,error:'JPG file must be 5 MB or smaller.'});
      }

      const isJpeg=buffer.length>=3 &&
        buffer[0]===0xFF && buffer[1]===0xD8 && buffer[2]===0xFF;
      if(!isJpeg){
        return sendJson(res,400,{ok:false,error:'The selected file is not a valid JPG/JPEG image. Please convert it to JPG and try again.'});
      }

      const filename=`poster-${Date.now()}-${Math.random().toString(36).slice(2,8)}.jpg`;
      const filepath=path.join(UPLOADS,filename);
      fs.writeFileSync(filepath,buffer);

      return sendJson(res,200,{
        ok:true,
        url:`/uploads/${encodeURIComponent(filename)}`,
        name:originalName
      });
    }catch(err){
      console.error('Base64 poster upload error:',err);
      return sendJson(res,500,{ok:false,error:'Could not save the uploaded JPG file.'});
    }
  }

  // Keep multipart support as a fallback for older clients.
  upload.single('poster')(req,res,(err)=>{
    if(err){
      console.error('Poster upload error:', err);
      return sendJson(res,400,{
        ok:false,
        error:err.code === 'LIMIT_FILE_SIZE'
          ? 'JPG file must be 5 MB or smaller.'
          : (err.message || 'Upload failed.')
      });
    }
    if(!req.file){
      return sendJson(res,400,{ok:false,error:'No JPG file was received by the server. Please choose the JPG again and retry.'});
    }

    try{
      const fd=fs.openSync(req.file.path,'r');
      const magic=Buffer.alloc(3);
      const bytes=fs.readSync(fd,magic,0,3,0);
      fs.closeSync(fd);
      const isJpeg=bytes===3 && magic[0]===0xFF && magic[1]===0xD8 && magic[2]===0xFF;
      if(!isJpeg){
        try{fs.unlinkSync(req.file.path)}catch{}
        return sendJson(res,400,{ok:false,error:'The selected file is not a valid JPG/JPEG image. Please convert it to JPG and try again.'});
      }
    }catch(err){
      console.error('JPEG verification error:',err);
      try{fs.unlinkSync(req.file.path)}catch{}
      return sendJson(res,500,{ok:false,error:'Could not verify the uploaded JPG file.'});
    }

    sendJson(res,200,{
      ok:true,
      url:`/uploads/${encodeURIComponent(req.file.filename)}`,
      name:req.file.originalname
    });
  });
});

app.put('/api/voting',adminOnly,(req,res)=>{const db=loadDb();db.votingOpen=Boolean(req.body?.open);saveDb(db);sendJson(res,200,{ok:true,votingOpen:db.votingOpen});});
app.post('/api/reset',adminOnly,(_req,res)=>{const db=loadDb();db.votes={};saveDb(db);sendJson(res,200,{ok:true});});

app.use(express.static(PUBLIC, {extensions:['html']}));
app.get('*',(req,res)=>{
  if(req.path.startsWith('/api/')) return sendJson(res,404,{ok:false,error:'API endpoint not found.'});
  res.sendFile(path.join(PUBLIC,'index.html'));
});

app.use((err,_req,res,_next)=>{ console.error(err); if(!res.headersSent) sendJson(res,500,{ok:false,error:'Server error.'}); });
app.listen(PORT,'0.0.0.0',()=>console.log(`Anant Vijay Voting v2 running on port ${PORT}`));
