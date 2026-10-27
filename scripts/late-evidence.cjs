const Database=require('better-sqlite3');const{join}=require('node:path');const db=new Database(join(process.env.APPDATA,'course-reminder','reminder.sqlite'),{readonly:true});
const rows=db.prepare('SELECT payload FROM tasks').all().map(r=>JSON.parse(r.payload));
console.log(JSON.stringify(rows.filter(t=>/补交|补做|迟交|延迟提交|晚交/.test(t.body+' '+t.submissionEvidence)).map(t=>({kind:t.kind,bodyExcerpts:[...((t.body+' '+t.submissionEvidence).matchAll(/.{0,55}(?:补交|补做|迟交|延迟提交|晚交).{0,75}/g))].map(m=>m[0])})),null,2));db.close();
