const Database=require('better-sqlite3');
const {join}=require('node:path');
const db=new Database(join(process.env.APPDATA,'course-reminder','reminder.sqlite'),{readonly:true});
const payloads=table=>db.prepare(`SELECT payload FROM ${table}`).all().map(r=>JSON.parse(r.payload));
console.log(JSON.stringify({at:new Date().toISOString(),coverageErrors:payloads('coverage').filter(c=>c.status!=='success'),recentRuns:payloads('sync_runs').sort((a,b)=>b.at.localeCompare(a.at)).slice(0,6).map(r=>({at:r.at,platform:r.platform,courses:r.courses,tasks:r.tasks,errors:r.coverage.filter(c=>c.status!=='success').length})),accounts:payloads('accounts'),settings:JSON.parse(db.prepare("SELECT value FROM meta WHERE key='settings'").get()?.value||'{}')},null,2));
db.close();
