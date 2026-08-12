let token="",data=null;

document.addEventListener("DOMContentLoaded", () => {
  const btn = document.getElementById("loginBtn");
  if (btn) btn.addEventListener("click", login);
  const pw = document.getElementById("pw");
  if (pw) pw.addEventListener("keydown", e => {
    if (e.key === "Enter") login();
  });
});
const api=(path,opt={})=>fetch("/api/"+path,{...opt,headers:{"Content-Type":"application/json",Authorization:"Bearer "+token,...(opt.headers||{})}});
async function login(){
  const password = document.getElementById("pw").value;
  if(!password){ alert("Please enter the Super Admin password."); return; }
  try {
    const r = await fetch("/api/login", {
      method:"POST",
      headers:{"Content-Type":"application/json"},
      body:JSON.stringify({password})
    });
    const text = await r.text();
    let x = {};
    try { x = JSON.parse(text); } catch(e) {}
    if(!r.ok){
      alert(x.error || ("Login/API error: HTTP " + r.status));
      return;
    }
    if(!x.token){ alert("Backend response did not contain a login token. Check Netlify Functions deployment."); return; }
    token=x.token;
    document.getElementById("login").classList.add("hidden");
    document.getElementById("dash").classList.remove("hidden");
    load();
  } catch(e) {
    alert("Backend se connection nahi ho pa raha. Netlify Functions deployed hain ya nahi check karein.");
  }
}
async function load(){const r=await api("admin-data");if(r.status===401){logout();return}data=await r.json();render();}
function render(){document.getElementById("week").value=data.weekLabel||"Next Week";let total=Object.values(data.votes).reduce((a,b)=>a+b,0),sorted=[...data.movies].sort((a,b)=>(data.votes[b.id]||0)-(data.votes[a.id]||0));document.getElementById("total").textContent=total;document.getElementById("lead").textContent=total?sorted[0].name:"—";document.getElementById("openText").textContent=data.votingOpen?"Open":"Closed";document.getElementById("toggle").textContent=data.votingOpen?"Close Voting":"Open Voting";
document.getElementById("movieEditor").innerHTML=data.movies.map((m,i)=>`<div class="editmovie"><input value="${esc(m.name)}" data-i="${i}" data-k="name" placeholder="Movie name"><select data-i="${i}" data-k="language"><option ${m.language==="Hindi"?"selected":""}>Hindi</option><option ${m.language==="English"?"selected":""}>English</option></select><input value="${esc(m.genre)}" data-i="${i}" data-k="genre" placeholder="Genre"><input value="${esc(m.poster)}" data-i="${i}" data-k="poster" placeholder="Poster image URL (optional)"><textarea data-i="${i}" data-k="description" placeholder="Description">${esc(m.description)}</textarea><button class="danger small" onclick="removeMovie(${i})">Remove</button></div>`).join("");
document.querySelectorAll("#movieEditor [data-k]").forEach(el=>el.oninput=()=>{data.movies[el.dataset.i][el.dataset.k]=el.value});
document.getElementById("adminResults").innerHTML=sorted.map(m=>`<div class="adminresult"><b>${esc(m.name)}</b><span>${data.votes[m.id]||0} votes</span></div>`).join("")}
function addMovie(){data.movies.push({id:"m"+Date.now(),name:"New Movie",language:"Hindi",genre:"",description:"",poster:""});render()}
function removeMovie(i){data.movies.splice(i,1);render()}
async function saveMovies(){const r=await api("movies",{method:"PUT",body:JSON.stringify({movies:data.movies,weekLabel:document.getElementById("week").value})});const x=await r.json();if(!r.ok){alert(x.error);return}data=x.data;alert("Weekly movies updated successfully.");render()}
async function toggleVoting(){data.votingOpen=!data.votingOpen;await api("voting",{method:"PUT",body:JSON.stringify({open:data.votingOpen})});render()}
async function resetVotes(){if(!confirm("Reset all votes?"))return;await api("reset",{method:"POST"});load()}
function logout(){token="";location.reload()}
function esc(s){return String(s??"").replace(/&/g,"&amp;").replace(/"/g,"&quot;").replace(/</g,"&lt;").replace(/>/g,"&gt;")}
