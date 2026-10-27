const Database=require('better-sqlite3');
const {join}=require('node:path');
const db=new Database(join(process.env.APPDATA,'course-reminder','reminder.sqlite'),{readonly:true});
const tasks=db.prepare('SELECT payload FROM tasks').all().map(r=>JSON.parse(r.payload));
const requirements=db.prepare('SELECT payload FROM requirements').all().map(r=>JSON.parse(r.payload));
console.log(JSON.stringify(tasks.filter(t=>t.kind==='announcement'&&requirements.some(r=>r.taskId===t.id&&r.date==='2026-10-08')).map(t=>({id:t.id,body:process.argv.includes('--summary')?undefined:t.body.slice(0,4000),requirements:requirements.filter(r=>r.taskId===t.id).map(r=>({date:r.date,original:process.argv.includes('--summary')?undefined:r.original,confidence:r.confidence,retired:!!r.retired}))})),null,2));
db.close();
