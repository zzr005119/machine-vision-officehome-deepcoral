const $ = (id) => document.getElementById(id);
const EXPECTED_MODEL = 'pr_cl_deepda_short_window_seed42';
const EXPECTED_SHA = '5298447d38220ddf8456c6115a61c6e55e4dfd68040b6cf720fdc91e2620ee57';
const MAX_BYTES = 10 * 1024 * 1024;
const MAX_BATCH = 12;
const motion = matchMedia('(prefers-reduced-motion: reduce)');
const state = { mode:'single', files:[], selected:null, nextId:0, running:false, stopRequested:false, controller:null, apiBase:'', classes:null, pca:null, points:[], domains:{Product:true,Clipart:true,upload:true}, zoom:1, panX:0, panY:0, hover:null };
let toastTimer, decodeQueue = Promise.resolve();
const toast = (message) => { $('toast').textContent=message; $('toast').hidden=false; clearTimeout(toastTimer); toastTimer=setTimeout(()=>$('toast').hidden=true,4500); };
const node = (tag,className,text) => { const el=document.createElement(tag); if(className)el.className=className;if(text!==undefined)el.textContent=text;return el; };
const percent = (p) => (p*100).toFixed(1)+'%';
const selectedFile = () => state.files.find(f=>f.id===state.selected);
const friendlyClass = (name) => name.replaceAll('_',' ');

// The hero is decorative generative art. Actual measured features are shown in the PCA plot below.
const hero = $('hero-canvas'), heroCtx=hero.getContext('2d');
let heroW=0,heroH=0,heroActive=true,heroFrame=0,heroLast=0;
const heroDots = Array.from({length:1060},(_,i)=>{
  const group=i%2, index=Math.floor(i/2), count=530;
  const y=1-2*(index+.5)/count, r=Math.sqrt(1-y*y), theta=index*2.399963229728653;
  return {x:Math.cos(theta)*r,y,z:Math.sin(theta)*r,group,phase:index*.17};
});
function renderHero(time=0) {
  if(!heroW||!heroH)return;
  const c=heroCtx,w=heroW,h=heroH;
  c.clearRect(0,0,w,h);
  const cx=w*.52,cy=h*.47,r=Math.min(w*.425,h*.405),turn=motion.matches?.25:time*.000055+.25;
  c.save();
  c.translate(cx,cy);
  c.strokeStyle='#6f795330';c.lineWidth=.65;
  c.beginPath();c.moveTo(-r*1.2,r*.8);c.lineTo(r*1.12,-r*.82);c.stroke();
  c.beginPath();c.ellipse(0,0,r*1.14,r*.57,-.6,0,Math.PI*2);c.stroke();
  c.setLineDash([2,8]);c.strokeStyle='#69745338';
  c.beginPath();c.ellipse(r*.05,0,r*.76,r*1.08,-.4,0,Math.PI*2);c.stroke();c.setLineDash([]);
  const rendered=heroDots.map(p=>{
    const ca=Math.cos(turn),sa=Math.sin(turn),x=p.x*ca+p.z*sa,z=-p.x*sa+p.z*ca;
    const tilt=p.group===0?-.24:.3,tx=x*Math.cos(tilt)-p.y*Math.sin(tilt),ty=x*Math.sin(tilt)+p.y*Math.cos(tilt);
    const shift=p.group===0?-.36:.37,perspective=1/(1-z*.17);
    return {x:(tx*.73+shift)*r*perspective,y:ty*r*.89*perspective,z,group:p.group};
  }).sort((a,b)=>a.z-b.z);
  for(const p of rendered){
    const alpha=.18+(p.z+1)*.33;
    c.fillStyle=p.group?'rgba(230,80,40,'+alpha+')':'rgba(39,57,34,'+alpha+')';
    const size=(1.15+(p.z+1)*.65)*(w<420?.83:1);
    c.beginPath();c.ellipse(p.x,p.y,size*.68,size, -.35,0,Math.PI*2);c.fill();
  }
  c.strokeStyle='#ed542db0';c.lineWidth=1.2;
  c.beginPath();c.ellipse(r*.1,-r*.02,r*.47,r*1.04,.35,Math.PI*.97,Math.PI*2.7);c.stroke();
  c.fillStyle='#ed542d';c.beginPath();c.arc(r*.385,-r*.91,3.5,0,Math.PI*2);c.fill();
  c.fillStyle='#64745180';c.font='8px Consolas,monospace';c.fillText('x',r*1.17,-r*.83);c.fillText('y',-r*.9,r*.95);
  c.restore();
}
function heroLoop(t){heroFrame=0;if(!heroActive||motion.matches||document.hidden)return;if(t-heroLast>30){renderHero(t);heroLast=t;}heroFrame=requestAnimationFrame(heroLoop);}
function syncHero(){cancelAnimationFrame(heroFrame);heroFrame=0;renderHero();if(heroActive&&!motion.matches&&!document.hidden)heroFrame=requestAnimationFrame(heroLoop);}
new ResizeObserver(([entry])=>{heroW=entry.contentRect.width;heroH=entry.contentRect.height;const dpr=Math.min(devicePixelRatio||1,2);hero.width=Math.round(heroW*dpr);hero.height=Math.round(heroH*dpr);heroCtx.setTransform(dpr,0,0,dpr,0,0);syncHero();}).observe(hero);
new IntersectionObserver(([entry])=>{heroActive=entry.isIntersecting;syncHero();},{rootMargin:'100px'}).observe(hero);
document.addEventListener('visibilitychange',syncHero);
motion.addEventListener('change',syncHero);

const plot=$('pca-canvas'),ctx=plot.getContext('2d'),surface=$('plot-surface');
let plotW=0,plotH=0,plotDPR=1,plotBounds=null,plotted=[],drag=null,lastHover=null;
function plotTransform(){
  if(!plotBounds)return null;
  const pad={left:plotW<450?38:54,right:32,top:28,bottom:plotW<450?77:60};
  const iw=plotW-pad.left-pad.right,ih=plotH-pad.top-pad.bottom;
  const rangeX=plotBounds.maxX-plotBounds.minX,rangeY=plotBounds.maxY-plotBounds.minY;
  const scale=Math.min(iw/rangeX,ih/rangeY)*state.zoom;
  const midX=(plotBounds.minX+plotBounds.maxX)/2,midY=(plotBounds.minY+plotBounds.maxY)/2;
  const cx=pad.left+iw/2+state.panX,cy=pad.top+ih/2+state.panY;
  return {pad,iw,ih,scale,midX,midY,cx,cy,x:(v)=>cx+(v-midX)*scale,y:(v)=>cy-(v-midY)*scale};
}
function drawPlot(){
  if(!plotW||!plotH)return;
  ctx.clearRect(0,0,plotW,plotH);plotted=[];
  const t=plotTransform();if(!t)return;
  const {pad,iw,ih}=t;
  ctx.save();ctx.font='8px Consolas,monospace';ctx.lineWidth=.65;
  for(let i=0;i<=4;i++){
    const x=pad.left+iw*i/4,y=pad.top+ih*i/4;
    ctx.strokeStyle='#525c422f';ctx.beginPath();ctx.moveTo(x,pad.top);ctx.lineTo(x,pad.top+ih);ctx.stroke();
    ctx.beginPath();ctx.moveTo(pad.left,y);ctx.lineTo(pad.left+iw,y);ctx.stroke();
    ctx.fillStyle='#7d896b';ctx.textAlign='center';ctx.fillText(((x-t.cx)/t.scale+t.midX).toFixed(1),x,pad.top+ih+16);
    ctx.textAlign='right';ctx.fillText((-(y-t.cy)/t.scale+t.midY).toFixed(1),pad.left-9,y+3);
  }
  ctx.beginPath();ctx.rect(pad.left-5,pad.top-5,iw+10,ih+10);ctx.clip();
  const all=state.points.concat(state.files.filter(f=>f.result?.pca).map(f=>({x:f.result.pca[0],y:f.result.pca[1],domain:'upload',id:f.id,name:f.name})));
  for(const p of all){
    if(!state.domains[p.domain])continue;
    const x=t.x(p.x),y=t.y(p.y);
    if(x<pad.left-6||x>pad.left+iw+6||y<pad.top-6||y>pad.top+ih+6)continue;
    const isUpload=p.domain==='upload',isSelected=isUpload&&p.id===state.selected;
    ctx.fillStyle=isUpload?'#bce6ff':p.domain==='Product'?'#cad9a595':'#ed795896';
    ctx.beginPath();
    if(isUpload){const sz=isSelected?6:4.5;ctx.moveTo(x,y-sz);ctx.lineTo(x+sz,y);ctx.lineTo(x,y+sz);ctx.lineTo(x-sz,y);ctx.closePath();}
    else ctx.arc(x,y,plotW<450?1.5:1.9,0,Math.PI*2);
    ctx.fill();plotted.push({...p,px:x,py:y});
    if(isSelected){ctx.strokeStyle='#bce6ff66';ctx.lineWidth=1;ctx.beginPath();ctx.arc(x,y,13,0,Math.PI*2);ctx.stroke();}
  }
  if(state.hover){const p=plotted.find(p=>p.domain===state.hover.domain&&p.id===state.hover.id);if(p){ctx.strokeStyle='#f5f2e5';ctx.lineWidth=1;ctx.beginPath();ctx.arc(p.px,p.py,6,0,Math.PI*2);ctx.stroke();}}
  ctx.restore();
  $('upload-point-count').textContent=String(state.files.filter(f=>f.result?.pca).length);
}
function changeZoom(factor){state.zoom=Math.max(.5,Math.min(8,state.zoom*factor));$('plot-tooltip').hidden=true;drawPlot();}
function resetPlot(){state.zoom=1;state.panX=state.panY=0;state.hover=null;$('plot-tooltip').hidden=true;drawPlot();}
new ResizeObserver(([entry])=>{plotW=entry.contentRect.width;plotH=entry.contentRect.height;plotDPR=Math.min(devicePixelRatio||1,2);plot.width=Math.round(plotW*plotDPR);plot.height=Math.round(plotH*plotDPR);ctx.setTransform(plotDPR,0,0,plotDPR,0,0);drawPlot();}).observe(plot);
$('zoom-in').addEventListener('click',()=>changeZoom(1.3));
$('zoom-out').addEventListener('click',()=>changeZoom(1/1.3));
$('zoom-reset').addEventListener('click',resetPlot);
for(const button of document.querySelectorAll('[data-domain]'))button.addEventListener('click',()=>{const domain=button.dataset.domain;state.domains[domain]=!state.domains[domain];button.setAttribute('aria-pressed',String(state.domains[domain]));state.hover=null;$('plot-tooltip').hidden=true;drawPlot();});
plot.addEventListener('pointerdown',e=>{if(e.button!==0)return;drag={id:e.pointerId,x:e.clientX,y:e.clientY,px:state.panX,py:state.panY};plot.setPointerCapture(e.pointerId);$('plot-tooltip').hidden=true;});
plot.addEventListener('pointermove',e=>{
  if(drag){state.panX=drag.px+e.clientX-drag.x;state.panY=drag.py+e.clientY-drag.y;drawPlot();return;}
  const rect=plot.getBoundingClientRect(),x=e.clientX-rect.left,y=e.clientY-rect.top;
  let nearest=null,dist=81;
  for(const p of plotted){const d=(p.px-x)**2+(p.py-y)**2;if(d<dist){nearest=p;dist=d;}}
  const tooltip=$('plot-tooltip');
  if(nearest){
    const label=nearest.domain==='upload'?'你的图像 · '+nearest.name:nearest.domain+' · 参考点 '+(nearest.id+1);
    tooltip.textContent=label+'\n('+nearest.x.toFixed(2)+', '+nearest.y.toFixed(2)+')';
    tooltip.style.left=Math.min(Math.max(10,x+15),Math.max(10,plotW-216))+'px';tooltip.style.top=Math.max(10,y-55)+'px';tooltip.hidden=false;
  }else tooltip.hidden=true;
  const next=nearest?nearest.domain+nearest.id:null;
  if(next!==lastHover){state.hover=nearest;lastHover=next;drawPlot();}
});
function stopDrag(){drag=null;}
plot.addEventListener('pointerup',stopDrag);plot.addEventListener('pointercancel',stopDrag);plot.addEventListener('lostpointercapture',stopDrag);
plot.addEventListener('pointerleave',()=>{if(!drag){state.hover=null;lastHover=null;$('plot-tooltip').hidden=true;drawPlot();}});
plot.addEventListener('keydown',e=>{
  const moves={ArrowLeft:[24,0],ArrowRight:[-24,0],ArrowUp:[0,24],ArrowDown:[0,-24]};
  if(moves[e.key]){e.preventDefault();state.panX+=moves[e.key][0];state.panY+=moves[e.key][1];drawPlot();}
  else if(e.key==='+'||e.key==='='){e.preventDefault();changeZoom(1.3);}
  else if(e.key==='-'){e.preventDefault();changeZoom(1/1.3);}
  else if(e.key==='Home'||e.key==='0'){e.preventDefault();resetPlot();}
});
function locateSelected(){
  const f=selectedFile();if(!f?.result?.pca)return;
  const t=plotTransform();if(t){state.panX=-(f.result.pca[0]-t.midX)*t.scale;state.panY=(f.result.pca[1]-t.midY)*t.scale;state.domains.upload=true;document.querySelector('[data-domain="upload"]').setAttribute('aria-pressed','true');drawPlot();}
  $('space').scrollIntoView({behavior:motion.matches?'instant':'smooth',block:'start'});
}
$('locate-point').addEventListener('click',locateSelected);
async function loadReference(){
  $('plot-loading').hidden=false;$('plot-retry').hidden=true;$('plot-loading').textContent='正在读取仓库中的真实参考点…';
  try{
    const [pcaResponse,mapResponse]=await Promise.all([fetch(new URL('../demo_assets/short_window_pca.json',import.meta.url)),fetch(new URL('../data/splits/class_to_idx.json',import.meta.url))]);
    if(!pcaResponse.ok||!mapResponse.ok)throw Error('参考数据未能读取');
    const [pca,mapping]=await Promise.all([pcaResponse.json(),mapResponse.json()]);
    if(pca.model_id!==EXPECTED_MODEL||pca.checkpoint_sha256!==EXPECTED_SHA||pca.feature_dim!==256)throw Error('参考数据与当前演示模型不匹配');
    if(!Array.isArray(pca.explained_variance_ratio)||pca.explained_variance_ratio.length<2||pca.explained_variance_ratio.slice(0,2).some(v=>!Number.isFinite(v)||v<0||v>1))throw Error('PCA 解释方差信息无效');
    const ids=Object.values(mapping);if(ids.length!==65||new Set(ids).size!==65||ids.some(i=>!Number.isInteger(i)||i<0||i>64))throw Error('65 类映射无效');
    const points=[];
    for(const domain of ['Product','Clipart']){
      const values=pca.reference_points?.[domain];
      if(!Array.isArray(values)||values.length!==512)throw Error('参考点数量不符合当前实验');
      values.forEach((p,id)=>{if(!Array.isArray(p)||p.length!==2||!p.every(Number.isFinite))throw Error('参考坐标无效');points.push({x:p[0],y:p[1],domain,id});});
    }
    state.pca=pca;state.classes=mapping;state.points=points;
    const xs=points.map(p=>p.x),ys=points.map(p=>p.y),minX=Math.min(...xs),maxX=Math.max(...xs),minY=Math.min(...ys),maxY=Math.max(...ys);
    plotBounds={minX:minX-(maxX-minX)*.08,maxX:maxX+(maxX-minX)*.08,minY:minY-(maxY-minY)*.08,maxY:maxY+(maxY-minY)*.08};
    $('axis-x').textContent='PC 1 / '+(pca.explained_variance_ratio[0]*100).toFixed(2)+'%';
    $('axis-y').textContent='PC 2 / '+(pca.explained_variance_ratio[1]*100).toFixed(2)+'%';
    $('plot-loading').hidden=true;drawPlot();render();
  }catch(e){$('plot-loading').textContent='参考图暂时无法显示：'+e.message;$('plot-retry').hidden=false;}
}
$('plot-retry').addEventListener('click',loadReference);
function render(){
  const f=selectedFile(),max=state.mode==='batch'?MAX_BATCH:1;
  $('file-count').textContent=String(state.files.length).padStart(2,'0')+' / '+String(max).padStart(2,'0');
  $('upload-empty').hidden=!!f;$('image-preview').hidden=!f;
  if(f){$('preview-image').src=f.url;$('preview-image').alt=f.isExample?'原创杯子界面示例，非 Office-Home 数据集样本':'所选图像预览：'+f.name;$('preview-name').textContent=f.name;}
  else{$('preview-image').removeAttribute('src');$('preview-image').alt='';}
  $('image-note').textContent=f?.isExample?'原创界面示例 · 非 Office-Home 数据集样本':'图像仅在开始识别后发送到所连接的服务';
  $('add-files').hidden=!f;$('add-files').textContent=state.mode==='batch'?'添加图片 ↗':'更换图片 ↗';
  const list=$('file-list');list.replaceChildren();
  if(state.mode==='batch'&&state.files.length){
    for(const [i,item] of state.files.entries()){
      const button=node('button','file-chip'+(item.status==='complete'?' complete':item.status==='failed'?' failed':''));
      button.type='button';button.dataset.number=String(i+1);button.setAttribute('aria-pressed',String(item.id===state.selected));
      const status={queued:'待识别',running:'识别中',complete:'已完成',failed:'识别失败',cancelled:'已取消'}[item.status]||'';
      button.setAttribute('aria-label',item.name+'，'+status);button.title=item.name+' · '+status;
      const image=node('img');image.src=item.url;image.alt='';button.append(image);
      button.addEventListener('click',()=>{state.selected=item.id;render();drawPlot();});list.append(button);
    }
  }
  $('result-empty').hidden=!!f?.result;$('prediction').hidden=!f?.result;
  if(f?.result){
    const results=f.result.top_k;
    $('prediction-class').textContent=friendlyClass(results[0].class_name);$('prediction-probability').textContent=percent(results[0].probability);
    const ranking=$('prediction-list');ranking.replaceChildren();
    results.forEach((row,i)=>{
      const li=node('li'),rank=node('span','rank',String(i+1).padStart(2,'0')),body=node('span'),name=node('span','prediction-item-name',friendlyClass(row.class_name)),bar=node('span','prediction-bar'),fill=node('i'),score=node('span','prediction-score',percent(row.probability));
      fill.style.width=(row.probability*100)+'%';bar.append(fill);body.append(name,bar);li.append(rank,body,score);ranking.append(li);
    });
    $('locate-point').hidden=!f.result.pca;
  }else{
    $('result-empty-copy').textContent=f?(f.status==='running'?'正在连接模型，读取图像中的语义…':f.error||'图像已就绪。\n连接模型后，即可查看真实的识别结果。'):'先选择一张图片，\n让视觉实验从这里发生。';
    $('result-empty-copy').style.whiteSpace='pre-line';
  }
  $('result-panel').setAttribute('aria-busy',String(state.running));
  $('choose-files').disabled=state.running;$('add-files').disabled=state.running;$('remove-file').disabled=state.running;$('example-button').disabled=state.running;
  for(const button of document.querySelectorAll('[data-mode]')){button.disabled=state.running;button.classList.toggle('active',button.dataset.mode===state.mode);button.setAttribute('aria-pressed',String(button.dataset.mode===state.mode));}
  $('file-input').multiple=state.mode==='batch';
  $('run-button').disabled=!state.files.length||state.running;
  $('run-label').textContent=state.running?'识别中…':!state.apiBase&&state.files.length?'连接模型，开始识别':state.mode==='batch'?'识别全部图像':'开始识别';
  $('cancel-run').hidden=!state.running;
  if(!state.running){
    $('run-message').classList.toggle('error',!!f?.error);
    $('run-message').textContent=f?.error||(f?.result?'识别完成。可切换图像，或到特征空间查看投影。':state.apiBase?'服务地址已设置；点击开始后将上传所选图像。':'当前为前端预览，连接模型后可进行真实识别。');
  }
}
function releaseFile(file){URL.revokeObjectURL(file.url);}
function setMode(mode){
  if(state.running)return;
  if(state.mode===mode)return;
  state.mode=mode;
  if(mode==='single'&&state.files.length>1){
    const keep=selectedFile()||state.files[0];state.files.filter(f=>f!==keep).forEach(releaseFile);state.files=[keep];state.selected=keep.id;toast('已保留当前图像，切换为单张探索。');
  }
  render();drawPlot();
}
for(const button of document.querySelectorAll('[data-mode]'))button.addEventListener('click',()=>setMode(button.dataset.mode));
function openFilePicker(){if(!state.running){$('file-input').value='';$('file-input').click();}}
$('choose-files').addEventListener('click',openFilePicker);$('add-files').addEventListener('click',openFilePicker);
async function acceptFiles(incoming,isExample=false){
  if(state.running){toast('请等待当前识别完成，或先取消。');return;}
  const files=Array.from(incoming),limit=state.mode==='single'?1:Math.max(0,MAX_BATCH-state.files.length);
  if(!limit){toast('最多可以同时观察 12 张图片。');return;}
  const accepted=[],errors=[];
  for(const file of files){
    if(accepted.length>=limit)break;
    if(!['image/jpeg','image/png','image/webp'].includes(file.type)){errors.push(file.name+'：请使用 JPG、PNG 或 WEBP 图片');continue;}
    if(file.size>MAX_BYTES){errors.push(file.name+'：超过 10 MB');continue;}
    if(!file.size){errors.push(file.name+'：图片为空');continue;}
    try{
      const bitmap=await createImageBitmap(file),pixels=bitmap.width*bitmap.height;bitmap.close();
      if(pixels>40_000_000)throw Error('图像尺寸过大，请先缩小至 4,000 万像素以内');
      accepted.push({id:'image-'+(++state.nextId),file,name:file.name||'图像.png',url:URL.createObjectURL(file),isExample,result:null,error:null,status:'queued'});
    }catch(e){errors.push(file.name+'：'+(e.message.startsWith('图像尺寸')?e.message:'图片无法解码，请换一张有效图片'));}
  }
  if(accepted.length){
    if(state.mode==='single'){state.files.forEach(releaseFile);state.files=[accepted[0]];}
    else state.files.push(...accepted);
    state.selected=accepted[0].id;render();drawPlot();
  }
  if(errors.length)toast(errors.slice(0,2).join('；'));
  else if(files.length>limit)toast(state.mode==='single'?'单张模式只读取第一张有效图像；多张图片可切换批量观察。':'本批最多 12 张，超出的图像未添加。');
}
function queueFiles(files,isExample=false){decodeQueue=decodeQueue.then(()=>acceptFiles(files,isExample)).catch(()=>toast('图像暂时无法读取，请重试。'));return decodeQueue;}
$('file-input').addEventListener('change',e=>queueFiles(e.target.files));
$('remove-file').addEventListener('click',()=>{if(state.running)return;const index=state.files.findIndex(f=>f.id===state.selected);if(index<0)return;releaseFile(state.files[index]);state.files.splice(index,1);state.selected=state.files[Math.min(index,state.files.length-1)]?.id||null;render();drawPlot();});
const drop=$('drop-area');
let dragDepth=0;
drop.addEventListener('dragenter',e=>{if(!e.dataTransfer.types.includes('Files'))return;e.preventDefault();dragDepth++;if(!state.running)drop.classList.add('dragging');});
drop.addEventListener('dragover',e=>{if(e.dataTransfer.types.includes('Files'))e.preventDefault();});
drop.addEventListener('dragleave',e=>{e.preventDefault();dragDepth=Math.max(0,dragDepth-1);if(!dragDepth)drop.classList.remove('dragging');});
drop.addEventListener('drop',e=>{e.preventDefault();dragDepth=0;drop.classList.remove('dragging');queueFiles(e.dataTransfer.files);});
window.addEventListener('dragover',e=>{if(e.dataTransfer.types.includes('Files'))e.preventDefault();});
window.addEventListener('drop',e=>{if(e.dataTransfer.types.includes('Files'))e.preventDefault();});
$('example-button').addEventListener('click',async()=>{
  const canvas=document.createElement('canvas');canvas.width=800;canvas.height=600;const c=canvas.getContext('2d');
  c.fillStyle='#eeebdf';c.fillRect(0,0,800,600);
  c.fillStyle='#b4b8a0';c.font='11px Consolas,monospace';c.fillText('VISUAL STUDY / 001',35,40);c.fillText('AN ORIGINAL INTERFACE EXAMPLE',35,568);
  c.strokeStyle='#d5d6c5';c.lineWidth=1;for(let x=40;x<800;x+=40){c.beginPath();c.moveTo(x,75);c.lineTo(x,530);c.stroke();}for(let y=90;y<540;y+=40){c.beginPath();c.moveTo(30,y);c.lineTo(770,y);c.stroke();}
  c.save();c.translate(390,320);c.rotate(-.11);c.fillStyle='#b9b9a466';c.beginPath();c.ellipse(10,151,169,21,0,0,Math.PI*2);c.fill();
  c.strokeStyle='#e95c35';c.lineWidth=31;c.beginPath();c.ellipse(116,-6,69,72,0,0,Math.PI*2);c.stroke();
  c.fillStyle='#ed542d';c.beginPath();c.moveTo(-122,-115);c.lineTo(108,-115);c.lineTo(98,91);c.quadraticCurveTo(92,148,-10,148);c.quadraticCurveTo(-112,148,-117,88);c.closePath();c.fill();
  c.fillStyle='#ff9c76';c.beginPath();c.ellipse(-7,-115,115,25,0,0,Math.PI*2);c.fill();c.fillStyle='#653b29';c.beginPath();c.ellipse(-7,-115,101,17,0,0,Math.PI*2);c.fill();
  c.strokeStyle='#ffb18a';c.lineWidth=2;c.beginPath();c.moveTo(-92,-81);c.lineTo(-87,77);c.stroke();c.restore();
  const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));if(!blob){toast('示例暂时无法生成，请选择自己的图片。');return;}
  await queueFiles([new File([blob],'visual-study-001.png',{type:'image/png'})],true);
});

function normalizeBase(value){
  if(!value.trim())return '';
  const url=new URL(value.trim());
  if(!['https:','http:'].includes(url.protocol)||url.username||url.password||url.search||url.hash)throw Error('请填写不包含密码、查询参数或片段的 HTTP(S) 服务地址。');
  if(location.protocol==='https:'&&url.protocol==='http:'&&!['localhost','127.0.0.1','[::1]'].includes(url.hostname))throw Error('当前网页使用 HTTPS，模型服务也需要提供 HTTPS 地址。');
  return url.href.replace(/\/+$/,'').replace(/\/predict$/,'');
}
function updateService(){
  $('service-label').textContent=state.apiBase?'服务地址已设置':'模型服务待接入';$('service-open').classList.toggle('configured',!!state.apiBase);render();
}
function openService(){if(state.running){toast('请先完成或取消当前识别。');return;}$('api-base').value=state.apiBase;$('service-error').textContent='';$('service-dialog').showModal();setTimeout(()=>$('api-base').focus(),30);}
$('service-open').addEventListener('click',openService);
$('service-close').addEventListener('click',()=>$('service-dialog').close());
$('service-dialog').addEventListener('click',e=>{if(e.target===$('service-dialog')){const r=e.target.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)e.target.close();}});
$('service-form').addEventListener('submit',e=>{
  e.preventDefault();
  try{const base=normalizeBase($('api-base').value);if(!base)throw Error('请先填写模型服务地址，或选择断开服务。');state.apiBase=base;$('service-dialog').close();updateService();toast('已设置服务地址；真实识别将在点击开始后发起。');}
  catch(error){$('service-error').textContent=error.message;}
});
$('disconnect-service').addEventListener('click',()=>{state.apiBase='';$('service-dialog').close();updateService();toast('已断开服务。页面与参考分布仍可使用。');});
function validatePrediction(payload){
  if(!state.classes)throw Error('类别映射尚未就绪，请先重试读取参考数据。');
  if(!payload||typeof payload!=='object'||!Array.isArray(payload.top_k)||!payload.top_k.length||payload.top_k.length>5)throw Error('模型返回的数据缺少有效的 Top-5 结果。');
  if(payload.model_id&&payload.model_id!==EXPECTED_MODEL)throw Error('服务中的模型与当前短窗演示模型不匹配。');
  if(payload.checkpoint_sha256&&payload.checkpoint_sha256!==EXPECTED_SHA)throw Error('服务中的模型权重与当前演示版本不匹配。');
  const seen=new Set();
  const top_k=payload.top_k.map(row=>{
    if(!row||!Number.isInteger(row.class_id)||row.class_id<0||row.class_id>=65||typeof row.class_name!=='string'||state.classes[row.class_name]!==row.class_id||!Number.isFinite(row.probability)||row.probability<0||row.probability>1||seen.has(row.class_id))throw Error('模型返回的类别或概率无效。');
    seen.add(row.class_id);return {class_id:row.class_id,class_name:row.class_name,probability:row.probability};
  }).sort((a,b)=>b.probability-a.probability);
  if(top_k.reduce((s,row)=>s+row.probability,0)>1.00001)throw Error('模型返回的概率总和无效。');
  let pca=null;
  if(payload.pca!==undefined&&payload.pca!==null){if(!Array.isArray(payload.pca)||payload.pca.length!==2||!payload.pca.every(v=>Number.isFinite(v)&&Math.abs(v)<1e9))throw Error('模型返回的二维投影无效。');pca=[...payload.pca];}
  return {top_k,pca};
}
async function runInference(){
  if(state.running||!state.files.length)return;
  if(!state.apiBase){openService();return;}
  if(!state.classes){toast('类别映射还未读取成功，请在特征空间区域重试。');return;}
  const batch=[...state.files];state.running=true;state.stopRequested=false;render();
  let completed=0,failed=0;
  for(const [index,file] of batch.entries()){
    if(state.stopRequested)break;
    state.selected=file.id;file.result=null;file.error=null;file.status='running';render();drawPlot();
    $('run-message').classList.remove('error');$('run-message').textContent='正在识别 '+(index+1)+' / '+batch.length+'：'+file.name;
    let timedOut=false;const controller=new AbortController();state.controller=controller;
    const configuredTimeout=Number(window.CORAL_CONFIG?.timeoutMs),timeout=Number.isFinite(configuredTimeout)&&configuredTimeout>0?configuredTimeout:30000;
    const timer=setTimeout(()=>{timedOut=true;controller.abort();},timeout);
    try{
      const form=new FormData();form.append('image',file.file,file.name);
      const response=await fetch(state.apiBase+'/predict',{method:'POST',body:form,signal:controller.signal,credentials:'omit',referrerPolicy:'no-referrer'});
      if(!response.ok)throw Error('模型服务返回 HTTP '+response.status+'，请稍后重试。');
      let payload;try{payload=await response.json();}catch{throw Error('模型服务未返回可读取的 JSON 结果。');}
      file.result=validatePrediction(payload);file.status='complete';completed++;
    }catch(error){
      if(state.stopRequested){file.status='cancelled';file.error='本次识别已取消。';break;}
      file.status='failed';failed++;file.error=timedOut?'模型服务响应超时，请稍后重试。':error instanceof TypeError?'无法连接模型服务，请检查地址、网络和服务的跨域设置。':error.message;
    }finally{clearTimeout(timer);state.controller=null;render();drawPlot();}
  }
  state.running=false;state.controller=null;render();drawPlot();
  if(state.stopRequested)toast('已取消；已完成的 '+completed+' 张结果已保留。');
  else if(failed)toast('已完成 '+completed+' 张，'+failed+' 张未成功；可逐张切换查看。');
  else toast('已完成 '+completed+' 张真实识别。');
}
$('run-button').addEventListener('click',runInference);
$('cancel-run').addEventListener('click',()=>{state.stopRequested=true;state.controller?.abort();$('run-message').textContent='正在取消本次识别…';});
window.addEventListener('pagehide',()=>{state.controller?.abort();state.files.forEach(releaseFile);});
try{state.apiBase=normalizeBase(String(window.CORAL_CONFIG?.apiBase||''));}catch{toast('默认服务地址无效，已切换为前端预览。');}
updateService();
loadReference();
