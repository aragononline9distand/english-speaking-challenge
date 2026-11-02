/**
 * SKR Learning Challenge - Google Apps Script backend
 * Run initializePlatform() once, then deploy as Web App.
 */
const SHEETS = {
  Users: ['userId','studentCode','fullName','role','passwordHash','salt','active','createdAt'],
  Subjects: ['subjectId','name','level','description','active','createdAt'],
  Questions: ['questionId','subjectId','level','type','question','choiceA','choiceB','choiceC','choiceD','answer','explanation','active','createdAt'],
  Attempts: ['attemptId','userId','subjectId','score','total','answersJson','createdAt']
};

function initializePlatform() {
  const props = PropertiesService.getScriptProperties();
  let id = props.getProperty('DB_ID');
  let ss;
  if (id) {
    ss = SpreadsheetApp.openById(id);
  } else {
    ss = SpreadsheetApp.create('SKR Learning Challenge - Database');
    props.setProperty('DB_ID', ss.getId());
  }
  Object.keys(SHEETS).forEach(name => {
    let sh = ss.getSheetByName(name) || ss.insertSheet(name);
    if (sh.getLastRow() === 0) {
      sh.appendRow(SHEETS[name]);
      sh.setFrozenRows(1);
    }
  });
  const users = ss.getSheetByName('Users');
  if (users.getLastRow() < 2) {
    const password = Utilities.getUuid().replace(/-/g,'').slice(0,12);
    const salt = Utilities.getUuid();
    users.appendRow(['U-ADMIN-001','ADMIN','ผู้ดูแลระบบ','admin',hashPassword_(password,salt),salt,true,new Date()]);
    Logger.log('บัญชีผู้ดูแลเริ่มต้น: ADMIN');
    Logger.log('รหัสผ่านชั่วคราว: ' + password + ' (กรุณาเข้าสู่ระบบและเปลี่ยนทันที)');
  }
  Logger.log('ฐานข้อมูลพร้อมใช้งาน: ' + ss.getUrl());
  return ss.getUrl();
}

function doGet() {
  return HtmlService.createHtmlOutputFromFile('Index')
    .setTitle('SKR Learning Challenge')
    .addMetaTag('viewport','width=device-width, initial-scale=1');
}

function api(action, payload) {
  payload = payload || {};
  try {
    switch (action) {
      case 'login': return login_(payload);
      case 'logout': return logout_(payload);
      case 'bootstrap': return bootstrap_(payload);
      case 'addSubject': return addSubject_(payload);
      case 'addQuestion': return addQuestion_(payload);
      case 'addStudent': return addStudent_(payload);
      case 'getQuestions': return getQuestions_(payload);
      case 'submitAttempt': return submitAttempt_(payload);
      case 'getReport': return getReport_(payload);
      default: throw new Error('ไม่พบคำสั่งที่ร้องขอ');
    }
  } catch (e) {
    return {ok:false, message:e.message || String(e)};
  }
}

function db_() {
  const id = PropertiesService.getScriptProperties().getProperty('DB_ID');
  if (!id) throw new Error('ยังไม่ได้ตั้งค่าฐานข้อมูล กรุณาให้ผู้ดูแลรัน initializePlatform()');
  return SpreadsheetApp.openById(id);
}
function rows_(name) {
  const values = db_().getSheetByName(name).getDataRange().getValues();
  const headers = values.shift();
  return values.filter(r => r.some(v => v !== '')).map(r => {
    const o = {}; headers.forEach((h,i) => o[h] = r[i]); return o;
  });
}
function hashPassword_(password,salt) {
  const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, salt + password, Utilities.Charset.UTF_8);
  return bytes.map(b => ('0'+((b+256)%256).toString(16)).slice(-2)).join('');
}
function token_(user) {
  const token = Utilities.getUuid() + Utilities.getUuid();
  CacheService.getScriptCache().put('sess_'+token, JSON.stringify({userId:user.userId,role:user.role}), 21600);
  return token;
}
function session_(payload) {
  const token = payload.token || '';
  const raw = CacheService.getScriptCache().get('sess_'+token);
  if (!raw) throw new Error('เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่');
  return JSON.parse(raw);
}
function login_(p) {
  const code = String(p.studentCode || '').trim().toUpperCase();
  const password = String(p.password || '');
  const user = rows_('Users').find(u => String(u.studentCode).toUpperCase() === code && String(u.active) !== 'false');
  if (!user || hashPassword_(password,String(user.salt)) !== String(user.passwordHash)) throw new Error('รหัสผู้ใช้หรือรหัสผ่านไม่ถูกต้อง');
  return {ok:true,token:token_(user),user:{fullName:user.fullName,role:user.role,studentCode:user.studentCode}};
}
function logout_(p) {
  CacheService.getScriptCache().remove('sess_'+(p.token || ''));
  return {ok:true};
}
function bootstrap_(p) {
  const s = session_(p);
  const subjects = rows_('Subjects').filter(x => String(x.active) !== 'false').map(x => ({subjectId:x.subjectId,name:x.name,level:x.level,description:x.description}));
  const user = rows_('Users').find(x => x.userId === s.userId);
  return {ok:true,user:{fullName:user.fullName,role:user.role,studentCode:user.studentCode},subjects};
}
function requireAdmin_(p) {
  const s = session_(p);
  if (s.role !== 'admin' && s.role !== 'teacher') throw new Error('ไม่มีสิทธิ์ดำเนินการ');
  return s;
}
function addSubject_(p) {
  requireAdmin_(p);
  if (!p.name) throw new Error('กรุณาระบุชื่อวิชา');
  db_().getSheetByName('Subjects').appendRow(['SUB-'+Utilities.getUuid().slice(0,8),p.name,p.level || 'ทุกระดับ',p.description || '',true,new Date()]);
  return {ok:true};
}
function addQuestion_(p) {
  requireAdmin_(p);
  if (!p.subjectId || !p.question || !p.answer) throw new Error('กรุณากรอกวิชา คำถาม และเฉลย');
  const choices = [p.choiceA,p.choiceB,p.choiceC,p.choiceD];
  if (p.type !== 'short' && choices.some(x => !x)) throw new Error('กรุณากรอกตัวเลือกให้ครบ 4 ข้อ');
  db_().getSheetByName('Questions').appendRow(['Q-'+Utilities.getUuid().slice(0,10),p.subjectId,p.level || 'พื้นฐาน',p.type || 'choice',p.question,...choices,p.answer,p.explanation || '',true,new Date()]);
  return {ok:true};
}
function addStudent_(p) {
  requireAdmin_(p);
  if (!p.studentCode || !p.fullName || !p.password) throw new Error('กรุณากรอกรหัสนักศึกษา ชื่อ และรหัสผ่าน');
  const code = String(p.studentCode).trim().toUpperCase();
  if (rows_('Users').some(u => String(u.studentCode).toUpperCase() === code)) throw new Error('มีรหัสผู้ใช้นี้แล้ว');
  const salt = Utilities.getUuid();
  db_().getSheetByName('Users').appendRow(['U-'+Utilities.getUuid().slice(0,8),code,p.fullName,'student',hashPassword_(p.password,salt),salt,true,new Date()]);
  return {ok:true};
}
function getQuestions_(p) {
  session_(p);
  const n = Math.min(50,Math.max(1,Number(p.count)||10));
  const qs = rows_('Questions').filter(q => String(q.subjectId) === String(p.subjectId) && String(q.active) !== 'false');
  if (!qs.length) return {ok:true,questions:[]};
  const shuffled = qs.sort(() => Math.random()-.5).slice(0,n);
  return {ok:true,questions:shuffled.map(q => ({questionId:q.questionId,question:q.question,type:q.type,choiceA:q.choiceA,choiceB:q.choiceB,choiceC:q.choiceC,choiceD:q.choiceD}))};
}
function submitAttempt_(p) {
  const s = session_(p);
  const qs = rows_('Questions');
  const answers = p.answers || [];
  let score = 0;
  const details = answers.map(a => {
    const q = qs.find(x => x.questionId === a.questionId);
    const correct = !!q && String(q.answer).trim().toLowerCase() === String(a.answer).trim().toLowerCase();
    if (correct) score++;
    return {questionId:a.questionId,correct,correctAnswer:q ? q.answer : ''};
  });
  db_().getSheetByName('Attempts').appendRow(['AT-'+Utilities.getUuid().slice(0,10),s.userId,p.subjectId,score,answers.length,JSON.stringify(details),new Date()]);
  return {ok:true,score,total:answers.length,details};
}
function getReport_(p) {
  requireAdmin_(p);
  const users = rows_('Users');
  const attempts = rows_('Attempts');
  return {ok:true,attempts:attempts.slice(-200).reverse().map(a => {
    const u = users.find(x => x.userId === a.userId);
    return {studentCode:u ? u.studentCode : '',fullName:u ? u.fullName : '',subjectId:a.subjectId,score:a.score,total:a.total,createdAt:a.createdAt};
  })};
}
