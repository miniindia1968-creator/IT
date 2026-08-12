let state=null;
async function load(){const r=await fetch("/api/movies");state=await r.json();render();}
function poster(m){return m.poster?`<img src="${escapeHtml(m.poster)}" alt="">`:"<div class='postertext'>🎬</div>"}
function card(m){return `<article class="card">${poster(m)}<div class="body"><h3>${escapeHtml(m.name)}</h3><small>${escapeHtml(m.genre)}</small><p>${escapeHtml(m.description)}</p><button onclick="vote('${m.id}')">Vote Now</button></div></article>`}
function render(){
 document.getElementById("status").textContent=state.votingOpen?"🟢 Voting is OPEN":"🔴 Voting is CLOSED";
 const h=state.movies.filter(m=>m.language==="Hindi"),e=state.movies.filter(m=>m.language==="English");
 document.getElementById("hindiMovies").innerHTML=h.map(card).join("")||"<p>No Hindi movies added.</p>";
 document.getElementById("englishMovies").innerHTML=e.map(card).join("")||"<p>No English movies added.</p>";
}
async function vote(id){
 if(localStorage.getItem("av_voted")){alert("A vote has already been recorded on this browser.");return}
 const r=await fetch("/api/vote",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({movieId:id})});
 const x=await r.json(); if(!r.ok){alert(x.error||"Vote failed");return}
 localStorage.setItem("av_voted","1"); alert("Your vote has been recorded."); load();
}
function escapeHtml(s){return String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]))}
load();