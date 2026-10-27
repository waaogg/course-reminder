const Database=require('better-sqlite3');
const {join}=require('node:path');
const db=new Database(join(process.env.APPDATA,'course-reminder','reminder.sqlite'),{readonly:true});
console.log(JSON.stringify({observedAt:new Date().toISOString(),lastNotificationClick:db.prepare("SELECT value FROM meta WHERE key='lastNotificationClick'").get()?.value||null},null,2));
db.close();
