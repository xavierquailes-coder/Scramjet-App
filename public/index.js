"use strict";
const form=document.getElementById("sj-form");
const address=document.getElementById("sj-address");
const searchEngine=document.getElementById("sj-search-engine");
const error=document.getElementById("sj-error");
const errorCode=document.getElementById("sj-error-code");
const homeBtn=document.getElementById("homeBtn");
const backBtn=document.getElementById("backBtn");
const refreshBtn=document.getElementById("refreshBtn");
const {ScramjetController}=$scramjetLoadController();
const scramjet=new ScramjetController({files:{wasm:"/scram/scramjet.wasm.wasm",all:"/scram/scramjet.all.js",sync:"/scram/scramjet.sync.js"}});
scramjet.init();
const connection=new BareMux.BareMuxConnection("/baremux/worker.js");
let activeFrame=null;
let syncTimer=null;
let lastShownUrl="https://duckduckgo.com";
const loadingOverlay=document.getElementById("sj-loading-overlay");
let loadingTimer=null;
let loadingToken=0;
function showLoadingBee(){
  loadingToken++;
  if(loadingTimer)clearTimeout(loadingTimer);
  if(loadingOverlay){loadingOverlay.classList.add("show");loadingOverlay.setAttribute("aria-hidden","false");}
  const token=loadingToken;
  loadingTimer=setTimeout(()=>hideLoadingBee(token),9000);
  try{window.parent.postMessage({type:"squiddcore-browser-loading",loading:true},"*");}catch(_){}
  return token;
}
function hideLoadingBee(token){
  if(token&&token!==loadingToken)return;
  if(loadingTimer){clearTimeout(loadingTimer);loadingTimer=null;}
  if(loadingOverlay){loadingOverlay.classList.remove("show");loadingOverlay.setAttribute("aria-hidden","true");}
  try{window.parent.postMessage({type:"squiddcore-browser-loading",loading:false},"*");}catch(_){}
}
function bindFrameNavigationSignals(){
  if(!activeFrame||!activeFrame.frame)return;
  const iframe=activeFrame.frame;
  try{
    const doc=iframe.contentDocument;
    if(!doc||doc.__sqBeeBound)return;
    doc.__sqBeeBound=true;
    doc.addEventListener("pointerdown",e=>{
      const a=e.target&&e.target.closest?e.target.closest("a[href],button,input[type=submit]"):null;
      if(a)showLoadingBee();
    },true);
    doc.addEventListener("submit",()=>showLoadingBee(),true);
  }catch(_){}
}

function decodePossibleTarget(rawValue){
  if(!rawValue)return"";const raw=String(rawValue);
  const encodedMatch=raw.match(/(https?%3A%2F%2F.*)$/i);if(encodedMatch){try{return decodeURIComponent(encodedMatch[1]);}catch(_){}}
  const plainMatch=raw.match(/(https?:\/\/.*)$/i);if(plainMatch&&!plainMatch[1].startsWith(location.origin))return plainMatch[1];
  const pathParts=new URL(raw,location.href).pathname.split("/").filter(Boolean);
  for(let i=pathParts.length-1;i>=0;i--){const part=pathParts[i].replace(/-/g,"+").replace(/_/g,"/");if(part.length<12)continue;try{const padded=part+"=".repeat((4-(part.length%4))%4);const decoded=decodeURIComponent(atob(padded));if(/^https?:\/\//i.test(decoded)){const current=new URL(raw,location.href);return decoded+current.search+current.hash;}}catch(_){}}
  return"";
}
function readCurrentTarget(){
  if(!activeFrame||!activeFrame.frame)return"";const iframe=activeFrame.frame;
  try{const decoded=decodePossibleTarget(iframe.contentWindow.location.href);if(decoded)return decoded;}catch(_){}
  try{const decoded=decodePossibleTarget(iframe.src);if(decoded)return decoded;}catch(_){}
  return"";
}
function syncAddressBar(){const current=readCurrentTarget();if(!current||current===lastShownUrl)return;lastShownUrl=current;if(document.activeElement!==address)address.value=current;}
function attachAddressSync(){
  if(!activeFrame||!activeFrame.frame)return;const iframe=activeFrame.frame;iframe.id="sj-frame";iframe.title="Scramjet browser content";document.body.classList.add("proxy-open");
  iframe.addEventListener("load",()=>{const token=loadingToken;setTimeout(syncAddressBar,80);setTimeout(syncAddressBar,450);setTimeout(syncAddressBar,1200);setTimeout(bindFrameNavigationSignals,120);setTimeout(()=>hideLoadingBee(token),650);});
  clearInterval(syncTimer);syncTimer=setInterval(syncAddressBar,350);
}
async function ensureTransport(){const wispUrl=(location.protocol==="https:"?"wss":"ws")+"://"+location.host+"/wisp/";if((await connection.getTransport())!=="/libcurl/index.mjs")await connection.setTransport("/libcurl/index.mjs",[{websocket:wispUrl}]);}
async function navigate(raw){
  const token=showLoadingBee();
  error.textContent="";errorCode.textContent="";
  try{await registerSW();await ensureTransport();const url=search(raw,searchEngine.value);lastShownUrl=url;address.value=url;if(!activeFrame){activeFrame=scramjet.createFrame();document.body.appendChild(activeFrame.frame);attachAddressSync();}activeFrame.go(url);setTimeout(syncAddressBar,300);}catch(err){hideLoadingBee(token);error.textContent="Browser failed to open the page.";errorCode.textContent=err?.toString?.()||String(err);}
}
form.addEventListener("submit",e=>{e.preventDefault();navigate(address.value);});
homeBtn.addEventListener("click",()=>{
  hideLoadingBee();
  address.value="https://duckduckgo.com";lastShownUrl=address.value;
  if(activeFrame){try{activeFrame.frame.remove();}catch(_){}activeFrame=null;document.body.classList.remove("proxy-open");clearInterval(syncTimer);} 
});
backBtn.addEventListener("click",()=>{if(!activeFrame)return;showLoadingBee();try{activeFrame.frame.contentWindow.history.back();}catch(_){hideLoadingBee();}});
refreshBtn.addEventListener("click",()=>{if(!activeFrame)return;showLoadingBee();try{activeFrame.frame.contentWindow.location.reload();}catch(_){const current=readCurrentTarget();if(current)activeFrame.go(current);else hideLoadingBee();}});
address.addEventListener("focus",()=>address.select());
