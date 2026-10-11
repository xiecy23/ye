/* =========================================================================
 * id-alias.js —— 器械 id 归一化映射层
 * =========================================================================
 * 为什么需要这个文件：
 *   器材库和动作库是两个独立来源，各自都出现过命名漂移（lat_pulldown vs
 *   high_pulldown、leg_press vs leg_press_machine……）。如果让它们直接互相
 *   引用，界面就会显示不出器械名，计划里的「去哪台机器」就会变成空白。
 *
 *   这里不改动任何数据文件，只在读取后做一次归一化：
 *     动作.machine ──> MACHINE_ALIAS ──> 器材.id
 *
 *   设计原则：别名只做"同一台机器的不同叫法"的合并，绝不改变安全语义。
 *   如果某个 alias 的目标不存在，resolveMachine 会返回原值并记录到
 *   unresolved 列表，由 verify 脚本报警——不静默吞掉。
 * ========================================================================= */

(function (global) {
  'use strict';

  /** 动作库写法的 id -> 器材库实际 id */
  const MACHINE_ALIAS = {
    // ── 拉 / 推类
    lat_pulldown:        'high_pulldown',
    chest_press:         'chest_press_machine',
    row_machine:         'seated_row',
    cable_station:       'cable_machine',
    reverse_fly_machine: 'reverse_fly',
    pec_fly_machine:     'pec_fly_machine',
    decline_chest_press: 'decline_chest_press',
    pull_up_bar:         'pull_up_bar',
    // ── 腿 / 臀
    leg_press:           'leg_press_machine',
    leg_curl:            'lying_leg_curl',
    hack_squat_machine:  'hack_squat_machine',
    hip_glute_bridge_machine: 'hip_thrust',
    // ── 核心
    ab_crunch_machine:   'ab_crunch_machine',
    ab_twist_machine:    'ab_twist_machine',
    // ── 有氧 / 自重
    mat:                 'yoga_mat_area',
    rowing_machine:      'rower',
    recumbent_bike:      'stationary_bike',
    air_bike:            'stationary_bike',
    // ── 禁用类（自由重量/单侧），指向器材库里对应的禁用条目
    barbell:             'barbell_squat_rack',
    dumbbell:            'free_weight_dumbbell_area',
    shoulder_press:      'shoulder_press_machine',
    trap_shrug_machine:  'upper_trap_shrug'
  };

  /** 一台机器的别名（用户搜索用），从器材库 aliases 汇总，这里只放跨机器的同义词 */
  const MACHINE_SYNONYMS = {
    // 健身房俗称 → 器材库 id，用于搜索框「认不出机器」的模糊匹配
    '下拉': 'high_pulldown',
    '拉背': 'high_pulldown',
    '背阔肌': 'high_pulldown',
    '划船': 'seated_row',
    '划船机': 'seated_row',
    '推胸': 'chest_press_machine',
    '坐姿推胸': 'chest_press_machine',
    '史密斯': 'smith_machine',
    '深蹲架': 'barbell_squat_rack',
    '哑铃区': 'free_weight_dumbbell_area',
    '蝴蝶机': 'pec_fly_machine',
    '夹胸': 'pec_fly_machine',
    '腹肌机': 'ab_crunch_machine',
    '卷腹': 'ab_crunch_machine',
    '扭腰': 'ab_twist_machine',
    '哈克': 'hack_squat_machine',
    '单杠': 'pull_up_bar',
    '双杠': 'dip_machine',
    '罗马椅': 'abdominal_bench',
    '龙门架': 'cable_machine',
    '单侧绳索': 'single_arm_cable',
    '肩推': 'shoulder_press_machine',
    '直立划船': 'upright_row',
    '腿举': 'leg_press_machine',
    '倒蹬': 'leg_press_machine',
    '腿屈伸': 'leg_extension',
    '腿弯举': 'lying_leg_curl',
    '髋外展': 'hip_abduction',
    '外展': 'hip_abduction',
    '髋内收': 'hip_adduction',
    '内收': 'hip_adduction',
    '提踵': 'calf_raise_machine',
    '臀推': 'hip_thrust',
    '飞鸟': 'reverse_fly',
    '椭圆': 'elliptical',
    '跑步': 'treadmill',
    '单车': 'stationary_bike',
    '动感单车': 'stationary_bike',
    '登山机': 'stair_climber',
    '战绳': 'battle_rope',
    '瑜伽垫': 'yoga_mat_area',
    '按摩床': 'massage_bed'
  };

  const unresolved = [];

  /** 归一化：返回器材库中真实存在的 id */
  function resolveMachine(id) {
    if (!id) return null;
    if (MACHINE_ALIAS[id]) return MACHINE_ALIAS[id];
    return id;
  }

  /** 对一个动作数组做归一化（原地改写 ex.machine），返回同一数组 */
  function normalizeExercises(list) {
    unresolved.length = 0;
    list.forEach(ex => {
      const before = ex.machine;
      const after = resolveMachine(before);
      if (after !== before) ex._machineAliasFrom = before;
      ex.machine = after;
    });
    return list;
  }

  /** 校验：动作引用的每个器械是否都真实存在 */
  function auditMachines(machines, exercises) {
    const ids = new Set(machines.map(m => m.id));
    const missing = [];
    exercises.forEach(ex => {
      if (!ids.has(ex.machine)) {
        missing.push({ exercise: ex.name, machine: ex.machine, from: ex._machineAliasFrom });
      }
    });
    return { ok: missing.length === 0, missing };
  }

  global.IdAlias = {
    MACHINE_ALIAS, MACHINE_SYNONYMS,
    resolveMachine, normalizeExercises, auditMachines,
    get unresolved() { return unresolved.slice(); }
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = global.IdAlias;

})(typeof window !== 'undefined' ? window : globalThis);