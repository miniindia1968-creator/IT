const express = require("express");
const cors = require("cors");
const fs = require("fs");
const path = require("path");
const jwt = require("jsonwebtoken");

const app = express();
const PORT = process.env.PORT || 10000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "";
const SECRET = process.env.ADMIN_SECRET || "change-this-secret-in-render";

app.use(cors());
app.use(express.json({limit:"10mb"}));

const dataDir = process.env.DATA_DIR || path.join(__dirname, "data");
fs.mkdirSync(dataDir, {recursive:true});
const dbFile = path.join(dataDir, "data.json");

const DEFAULT_MOVIES = [
  {id:"m1",name:"Pushpa 2",language:"Hindi",genre:"Action / Drama",description:"A powerful action drama.",poster:""},
  {id:"m2",name:"Bahubali 3",language:"Hindi",genre:"Action / Adventure",description:"An epic adventure.",poster:""},
  {id:"m3",name:"Vikram",language:"Hindi",genre:"Action / Thriller",description:"A high-intensity thriller.",poster:""},
  {id:"m4",name:"Interstellar",language:"English",genre:"Sci-Fi / Drama",description:"A journey beyond space and time.",poster:""},
  {id:"m5",name:"Inception",language:"English",genre:"Sci-Fi / Thriller",description:"A mind-bending experience.",poster:""},
  {id:"m6",name:"Avatar",language:"English",genre:"Adventure / Sci-Fi",description:"An immersive adventure.",poster:""}
];

function loadDb(){
  try { return JSON.parse(fs.readFileSync(dbFile,"utf8")); }
  catch { return {movies:DEFAULT_MOVIES,votes:{},votingOpen:true,weekLabel:"Next Week"}; }
}
function saveDb(db){ fs.writeFileSync(dbFile, JSON.stringify(db,null,2)); }
function issueToken(){ return jwt.sign({role:"superadmin"},SECRET,{expiresIn:"12h"}); }
function isAdmin(req){
  const h = String(req.headers.authorization || "");
  if(!h.startsWith("Bearer ")) return false;
  try { jwt.verify(h.slice(7),SECRET); return true; } catch { return false; }
}

app.get("/api/health",(req,res)=>res.json({ok:true,service:"anant-vijay"}));

app.get("/api/movies",(req,res)=>{
  const db=loadDb();
  res.json({movies:db.movies,votingOpen:db.votingOpen,weekLabel:db.weekLabel});
});

app.post("/api/vote",(req,res)=>{
  const db=loadDb();
  if(!db.votingOpen) return res.status(403).json({error:"Voting is closed."});
  const id=String(req.body?.movieId||"");
  if(!id || !db.movies.some(m=>m.id===id)) return res.status(400).json({error:"Invalid movie."});
  db.votes[id]=(db.votes[id]||0)+1;
  saveDb(db);
  res.json({ok:true});
});

app.post("/api/login",(req,res)=>{
  if(!ADMIN_PASSWORD) return res.status(500).json({error:"ADMIN_PASSWORD is not configured in Render."});
  if(String(req.body?.password||"")!==ADMIN_PASSWORD) return res.status(401).json({error:"Invalid password"});
  res.json({token:issueToken()});
});

app.get("/api/admin-data",(req,res)=>{
  if(!isAdmin(req)) return res.status(401).json({error:"Unauthorized"});
  res.json(loadDb());
});

app.put("/api/movies",(req,res)=>{
  if(!isAdmin(req)) return res.status(401).json({error:"Unauthorized"});
  const db=loadDb(), body=req.body||{};
  if(!Array.isArray(body.movies)) return res.status(400).json({error:"movies must be an array"});
  db.movies=body.movies.map((m,i)=>({
    id:String(m.id||("m"+Date.now()+i)),
    name:String(m.name||"Untitled"),
    language:m.language==="English"?"English":"Hindi",
    genre:String(m.genre||""),
    description:String(m.description||""),
    poster:String(m.poster||"")
  }));
  if(body.weekLabel!==undefined) db.weekLabel=String(body.weekLabel);
  saveDb(db);
  res.json({ok:true,data:db});
});

app.put("/api/voting",(req,res)=>{
  if(!isAdmin(req)) return res.status(401).json({error:"Unauthorized"});
  const db=loadDb();
  db.votingOpen=!!req.body?.open;
  saveDb(db);
  res.json({ok:true,votingOpen:db.votingOpen});
});

app.post("/api/reset",(req,res)=>{
  if(!isAdmin(req)) return res.status(401).json({error:"Unauthorized"});
  const db=loadDb(); db.votes={}; saveDb(db);
  res.json({ok:true});
});

// Serve the website from the same Render Web Service.
app.use(express.static(path.join(__dirname,"public")));
app.get("*",(req,res)=>{
  if(req.path.startsWith("/api/")) return res.status(404).json({error:"Not found"});
  res.sendFile(path.join(__dirname,"public","index.html"));
});

app.listen(PORT,"0.0.0.0",()=>console.log(`Anant Vijay running on ${PORT}`));
