export type CharacterId = "martial" | "boxer" | "samurai" | "huntress" | "wizard" | "skeleton";

export interface CharacterDef {
  id: CharacterId;
  name: string;
  style: string;
  sheetUrl: string;
  projectile: "arrow" | "orb" | "swordwave" | "wave";
  element: "fire" | "thunder" | "ice";
  meleeStyle: "fist" | "blade" | "staff" | "bow";
  rig?: boolean;
  rangedPrimary?: boolean;
  rangedDamage: number;
}

/** 四名可选角色，素材均来自 LuizMelo（CC0），构建产物同名 json。 */
export const CHARACTERS: CharacterDef[] = [
  { id: "martial", name: "武僧", style: "拳脚/短兵", sheetUrl: "assets/martial-hero/hero.json", projectile: "wave", element: "thunder", rangedDamage: 6, meleeStyle: "fist" },
  { id: "boxer", name: "拳师", style: "贴身钝击", sheetUrl: "assets/martial-hero/hero.json", projectile: "wave", element: "thunder", rangedDamage: 6, meleeStyle: "fist", rangedPrimary: false },
  { id: "samurai", name: "武士", style: "太刀连斩", sheetUrl: "assets/samurai-mack/enemy.json", projectile: "swordwave", element: "fire", rangedDamage: 8, meleeStyle: "blade" },
  { id: "huntress", name: "猎手", style: "长弓/突进", sheetUrl: "assets/huntress/huntress.json", projectile: "arrow", element: "ice", rangedDamage: 10, meleeStyle: "bow", rangedPrimary: true },
  { id: "wizard", name: "法师", style: "法杖/远程", sheetUrl: "assets/evil-wizard/wizard.json", projectile: "orb", element: "fire", rangedDamage: 12, meleeStyle: "staff", rangedPrimary: true },
  { id: "skeleton", name: "骨架", style: "分件骨骼（测试）", sheetUrl: "assets/martial-hero/hero.json", projectile: "wave", element: "thunder", rangedDamage: 7, meleeStyle: "fist", rig: true },
];

export const CHARACTER_IDS: CharacterId[] = CHARACTERS.map((c) => c.id);

export function characterOf(id: string | null | undefined): CharacterDef {
  return CHARACTERS.find((c) => c.id === id) ?? CHARACTERS[0];
}










