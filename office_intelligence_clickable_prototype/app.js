
function showToast(msg){
  const t=document.getElementById('toast');
  t.textContent=msg;t.classList.add('show');
  setTimeout(()=>t.classList.remove('show'),2200);
}
function openAI(context){
  document.getElementById('overlay').classList.add('open');
  const d=document.getElementById('drawer');
  d.classList.add('open');
  document.getElementById('chat').innerHTML=
    `<div class="bubble ai"><strong>Nightingale AI</strong><br>${context||'How can I help with this workflow?'}</div>`;
}
function closeAI(){
  document.getElementById('overlay').classList.remove('open');
  document.getElementById('drawer').classList.remove('open');
}
function sendChat(){
  const input=document.getElementById('chatText');
  const text=input.value.trim();
  if(!text)return;
  const chat=document.getElementById('chat');
  chat.innerHTML+=`<div class="bubble user">${text}</div>`;
  input.value='';
  setTimeout(()=>{
    let reply='I reviewed the available information and prepared the next recommended action for staff approval.';
    const q=text.toLowerCase();
    if(q.includes('ready')) reply='The patient is clinically ready. Insurance is approved, labs are complete, consent is signed, and transportation is confirmed.';
    if(q.includes('schedule')) reply='I found one resource conflict in OR 2 and can move the second case by 15 minutes to reduce projected overtime.';
    if(q.includes('heart')||q.includes('risk')) reply='Risk is elevated because of recent weight gain, rising blood pressure, and lower medication adherence. Nurse outreach is recommended today.';
    chat.innerHTML+=`<div class="bubble ai">${reply}</div>`;
    chat.scrollTop=chat.scrollHeight;
  },500);
}
document.addEventListener('keydown',e=>{if(e.key==='Escape')closeAI()});
