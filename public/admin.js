let token='',data=null;
const $=id=>document.getElementById(id);

async function readJson(r){
  const text=await r.text();
  try{return JSON.parse(text)}
  catch{return {ok:false,error:`Unexpected server response (HTTP ${r.status}). The server did not return JSON.`}}
}

async function login(){
  const password=$('pw').value.trim();
  if(!password)return alert('Please enter the Super Admin password.');
  try{
    const r=await fetch('/api/login',{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({password})
    });
    const x=await readJson(r);
    if(!r.ok||!x.ok)throw new Error(x.error||'Login failed.');
    token=x.token;
    $('login').classList.add('hidden');
    $('dash').classList.remove('hidden');
    await load();
  }catch(e){alert(e.message)}
}

async function api(path,options={}){
  const headers={Authorization:`Bearer ${token}`,...(options.headers||{})};
  if(options.body && !(options.body instanceof FormData))headers['Content-Type']='application/json';
  const r=await fetch('/api/'+path,{...options,headers});
  const x=await readJson(r);
  if(r.status===401){logout();throw new Error('Session expired. Please login again.')}
  return {r,x};
}

async function load(){
  const {r,x}=await api('admin-data');
  if(!r.ok||!x.ok)throw new Error(x.error||'Could not load dashboard.');
  data=x;render();bindInputs();
}

function render(){
  const total=Object.values(data.votes||{}).reduce((a,b)=>a+Number(b||0),0);
  const sorted=[...data.movies].sort((a,b)=>(data.votes[b.id]||0)-(data.votes[a.id]||0));
  $('total').textContent=total;
  $('lead').textContent=total?(sorted[0]?.name||'—'):'—';
  $('openText').textContent=data.votingOpen?'Open':'Closed';
  $('toggle').textContent=data.votingOpen?'Close Voting':'Open Voting';
  $('week').value=data.weekLabel||'Next Week';
  $('movieEditor').innerHTML=data.movies.map((m,i)=>movieEditor(m,i)).join('');
  $('adminResults').innerHTML=sorted.map(m=>`<div class="result"><span>${esc(m.name)}</span><b>${data.votes[m.id]||0} votes</b></div>`).join('')||'<p class="hint">No movies available.</p>';
}

function movieEditor(m,i){
  return `<div class="movie">
    <div class="movie-grid">
      <label class="field">Movie name<input value="${esc(m.name)}" data-i="${i}" data-k="name"></label>
      <label class="field">Language<select data-i="${i}" data-k="language"><option ${m.language==='Hindi'?'selected':''}>Hindi</option><option ${m.language==='English'?'selected':''}>English</option></select></label>
      <label class="field">Genre<input value="${esc(m.genre)}" data-i="${i}" data-k="genre" placeholder="Action • Drama"></label>
    </div>
    <label class="field">Description<textarea data-i="${i}" data-k="description" placeholder="Short movie description">${esc(m.description)}</textarea></label>
    <div class="poster-tools">
      <b>Poster image</b>
      <div class="hint">Select a JPG/JPEG file. Maximum 5 MB. No URL needed.</div>
      <input type="file" accept=".jpg,.jpeg,image/jpeg" onchange="uploadPoster(${i},this)">
      <div class="upload-status" id="status-${i}">${m.poster?'✓ Poster is uploaded':'No poster uploaded'}</div>
      ${m.poster?`<img class="preview" style="display:block" src="${esc(m.poster)}?v=${Date.now()}" alt="Poster preview">`:''}
    </div>
    <div class="actions" style="margin-top:12px"><button class="danger" onclick="removeMovie(${i})">Remove Movie</button></div>
  </div>`;
}

function bindInputs(){
  document.querySelectorAll('[data-k]').forEach(el=>{
    el.addEventListener('input',()=>{
      data.movies[Number(el.dataset.i)][el.dataset.k]=el.value
    });
    el.addEventListener('change',()=>{
      data.movies[Number(el.dataset.i)][el.dataset.k]=el.value
    });
  });
}

function addMovie(){
  data.movies.push({id:'m'+Date.now(),name:'New Movie',language:'Hindi',genre:'',description:'',poster:''});
  render();bindInputs();
}

function removeMovie(i){
  if(confirm('Remove this movie?')){
    data.movies.splice(i,1);render();bindInputs();
  }
}

async function uploadPoster(i,input){
  const file=input?.files?.[0];
  if(!file)return;

  const name=String(file.name||'');
  const type=String(file.type||'').toLowerCase();
  const isJpg=/\.jpe?g$/i.test(name) || type==='image/jpeg';
  if(!isJpg){
    alert('Please choose a JPG/JPEG image.');
    input.value='';
    return;
  }
  if(file.size>5*1024*1024){
    alert('JPG must be 5 MB or smaller.');
    input.value='';
    return;
  }

  const status=$(`status-${i}`);
  status.textContent='Uploading JPG…';
  input.disabled=true;

  try{
    const fd=new FormData();
    fd.append('poster',file);

    // Do NOT set Content-Type here. The browser must add the multipart
    // boundary itself. This avoids the common "file selected but server
    // receives no file" problem.
    const r=await fetch('/api/upload-poster',{
      method:'POST',
      headers:{Authorization:`Bearer ${token}`},
      body:fd
    });
    const x=await readJson(r);

    if(r.status===401){
      logout();
      throw new Error('Session expired. Please login again.');
    }
    if(!r.ok||!x.ok)throw new Error(x.error||`Upload failed (HTTP ${r.status}).`);

    data.movies[i].poster=x.url;
    render();
    bindInputs();
    $(`status-${i}`).textContent='✓ JPG uploaded successfully';
  }catch(e){
    status.textContent='Upload failed';
    alert(e.message);
  }finally{
    input.disabled=false;
  }
}

async function saveMovies(){
  try{
    const {r,x}=await api('movies',{
      method:'PUT',
      body:JSON.stringify({movies:data.movies,weekLabel:$('week').value})
    });
    if(!r.ok||!x.ok)throw new Error(x.error||'Save failed.');
    data=x.data;render();bindInputs();
    alert('Weekly movies saved successfully.');
  }catch(e){alert(e.message)}
}

async function toggleVoting(){
  try{
    const {r,x}=await api('voting',{
      method:'PUT',
      body:JSON.stringify({open:!data.votingOpen})
    });
    if(!r.ok||!x.ok)throw new Error(x.error||'Could not change voting status.');
    data.votingOpen=x.votingOpen;render();bindInputs();
  }catch(e){alert(e.message)}
}

async function resetVotes(){
  if(!confirm('Reset all votes? This cannot be undone.'))return;
  try{
    const {r,x}=await api('reset',{method:'POST'});
    if(!r.ok||!x.ok)throw new Error(x.error||'Reset failed.');
    await load();
  }catch(e){alert(e.message)}
}

function logout(){token='';location.reload()}
function esc(s){return String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}

document.addEventListener('DOMContentLoaded',()=>{
  $('loginBtn').addEventListener('click',login);
  $('pw').addEventListener('keydown',e=>{if(e.key==='Enter')login()});
});
