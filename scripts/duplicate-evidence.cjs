const Database=require('better-sqlite3');const {join}=require('node:path');
const db=new Database(join(process.env.APPDATA,'course-reminder','reminder.sqlite'),{readonly:true});
const rows=t=>db.prepare(`SELECT payload FROM ${t}`).all().map(r=>JSON.parse(r.payload));
const courses=rows('courses'),tasks=rows('tasks'),reqs=rows('requirements');
const pairs=[];for(const c of courses.filter(c=>c.platform==='mooc'))for(const s of courses.filter(s=>s.platform==='spoc'&&s.title.replace(/\s/g,'')===c.title.replace(/\s/g,''))){
 const left=tasks.filter(t=>t.courseId===c.id),right=tasks.filter(t=>t.courseId===s.id);
 pairs.push({course:c.title,terms:[c.term,s.term],mooc:left.length,spoc:right.length,matches:left.flatMap(t=>right.filter(u=>u.title===t.title&&u.kind===t.kind).map(u=>({title:t.title,kind:t.kind,systemDates:[t,u].map(v=>reqs.filter(r=>r.taskId===v.id&&r.source==='system'&&!r.retired).map(r=>r.dueAt||r.date)),sameBody:t.body===u.body,states:[t.submission,u.submission]})))})
}console.log(JSON.stringify(pairs,null,2));db.close();
