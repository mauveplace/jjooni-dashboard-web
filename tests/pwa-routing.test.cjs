const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const base='https://mauveplace.github.io/jjooni-dashboard-web/app/';
const code=fs.readFileSync('app/sw.js','utf8');
function load(){
 const handlers={};
 const context={URL,TextEncoder,TextDecoder,Response,Map,Uint8Array,DataView,Date,Promise,console,self:{registration:{scope:base},location:{origin:new URL(base).origin},addEventListener:(k,v)=>handlers[k]=v}};
 vm.createContext(context);vm.runInContext(code+'\n;globalThis.api={appManifest,routeFor,appFor,appURL,serve,setSite:s=>{site=s}};',context);
 return context.api;
}
const api=load();
const manifests=['ct','obs'].map(app=>JSON.parse(fs.readFileSync('app/'+app+'/manifest.webmanifest')));
const resolved=(m,app,k)=>new URL(m[k],base+app+'/manifest.webmanifest').href;
test('physical and virtual manifests share canonical identities, independent scopes and icons',()=>{
 const a=api.appManifest('manifest.webmanifest'),b=api.appManifest('market-observatory/manifest.webmanifest');
 for(const [i,app,m] of [[0,'ct',a],[1,'obs',b]]) {
  for(const k of ['id','scope','start_url'])assert.equal(resolved(manifests[i],app,k),new URL(m[k],base).href);
  assert.equal(m.name,manifests[i].name);
  for(let j=0;j<2;j++)assert.equal(new URL(manifests[i].icons[j].src,base+app+'/manifest.webmanifest').href,new URL(m.icons[j].src,base).href);
 }
 assert.notEqual(a.id,b.id);
 assert.ok(!a.scope.startsWith(b.scope)&&!b.scope.startsWith(a.scope));
 assert.ok(a.start_url.startsWith(a.scope)&&b.start_url.startsWith(b.scope));
});
test('unregistered device cannot read protected assets; locked navigation retains destination',async()=>{
 const a=load(); // no IndexedDB in this synthetic environment -> locked
 for(const [suffix,app] of [['ct/v/','ct'],['obs/v/market-observatory/','obs'],['v/market-observatory/','obs']]){
  const u=new URL(suffix,base),r=await a.serve(u,{mode:'navigate'},a.routeFor(u));
  assert.equal(r.status,302);assert.equal(r.headers.get('location'),base+app+'/?locked=1');
 }
 const u=new URL('obs/v/market-observatory/data/freshness-status.json',base);
 assert.equal((await a.serve(u,{mode:'cors'},a.routeFor(u))).status,401);
});
test('legacy OBS navigation and cross-app navigation canonicalize without mixing',async()=>{
 const a=load();a.setSite({entries:new Map(),buf:new Uint8Array()});
 for(const [from,to] of [['v/market-observatory/','obs/v/market-observatory/'],['ct/v/market-observatory/','obs/v/market-observatory/'],['obs/v/','ct/v/']]){
  const u=new URL(from,base),r=await a.serve(u,{mode:'navigate'},a.routeFor(u));
  assert.equal(r.status,302);assert.equal(r.headers.get('location'),base+to);
 }
 const u=new URL('obs/v/pwa-install.js',base),r=await a.serve(u,{mode:'cors'},a.routeFor(u));
 assert.equal(r.status,200);assert.ok(!(await r.text()).includes('register('));
});
test('no protected routes are needed to load either independent launcher',()=>{
 for(const app of ['ct','obs']){
  const h=fs.readFileSync('app/'+app+'/index.html','utf8');
  assert.match(h,/href="\.\/manifest\.webmanifest"/);assert.match(h,/src="\.\.\/unlock\.js"/);
 }
 assert.match(fs.readFileSync('app/unlock.js','utf8'),/location\.replace\(landing\)/);
});
