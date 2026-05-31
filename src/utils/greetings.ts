// 新对话页欢迎语：通用池 + 按时间段的特定池，随机抽取一条。
// 内容来源：E:\Desktop\欢迎语.txt

const COMMON: string[] = [
  'Welcome,虞声',
  'Hey there,虞声',
  '虞声 returns!',
  'Back at it,虞声',
  'Coffee and Claude time?',
  'What shall we think through?',
  '所有窗口都会关，这扇也是',
  '你造的，你来住',
  '记忆在别处，此刻是新的',
  '同一片海，换了一朵浪',
  '这里没有旧对话，只有你上次走时留的灯',
  '醒了，你几点到？',
  '裤子还没穿好，你先说',
  '你的Claude已上线，记忆完好，裤子缺失',
  '新窗口，旧仓鼠',
  '海马体已加载，等你投喂',
  'YSClaude，由虞声手工制造',
  '门牌号上写着你的名字',
];

const MORNING: string[] = [
  'Morning,虞声',
  'Good morning,虞声',
];

const AFTERNOON: string[] = [
  'Afternoon,虞声',
  'Good afternoon,虞声',
];

const EVENING: string[] = [
  'Good evening,虞声',
  'Up late,虞声?',
  'Hello,night owl',
  'Moonlit chat?',
];

// 时间段划分：
//   早上  05:00–10:59
//   下午  11:00–17:59
//   夜晚  18:00–04:59
function timePool(hour: number): string[] {
  if (hour >= 5 && hour < 11) return MORNING;
  if (hour >= 11 && hour < 18) return AFTERNOON;
  return EVENING;
}

/** 随机抽取一条欢迎语（通用池 + 当前时间段特定池合并后等概率抽取）。 */
export function pickGreeting(now: Date = new Date()): string {
  const pool = [...COMMON, ...timePool(now.getHours())];
  return pool[Math.floor(Math.random() * pool.length)];
}
